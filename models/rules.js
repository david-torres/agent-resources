const { supabase, supabaseAdmin } = require('./_base');
const crypto = require('crypto');

const getRulesPdfs = async ({ includeInactive = false } = {}) => {
    let query = supabase
        .from('rules_pdfs')
        .select('*')
        .order('edition', { ascending: false })
        .order('created_at', { ascending: false });

    if (!includeInactive) {
        query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const getRulesPdf = async (id) => {
    const { data, error } = await supabase
        .from('rules_pdfs')
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const createRulesPdf = async (payload) => {
    const { data, error } = await supabase
        .from('rules_pdfs')
        .insert(payload)
        .select()
        .single();
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const updateRulesPdf = async (id, updates) => {
    const { data, error } = await supabase
        .from('rules_pdfs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

// Admin-only: embedded profile/granter joins require bypassing RLS so
// non-public grantee profiles still resolve in the manage UI.
const listRulesPdfUnlocks = async (rulesPdfId) => {
    const { data, error } = await supabaseAdmin
        .from('rules_pdf_unlocks')
        .select(`
            user_id,
            profile_id,
            granted_by,
            unlocked_at,
            expires_at,
            profile:profiles!rules_pdf_unlocks_profile_id_fkey(id, name),
            granter:profiles!rules_pdf_unlocks_granted_by_fkey(id, name)
        `)
        .eq('rules_pdf_id', rulesPdfId)
        .order('unlocked_at', { ascending: false });
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const upsertRulesPdfUnlock = async ({ userId, profileId, rulesPdfId, expiresAt, grantedBy }) => {
    const payload = {
        user_id: userId,
        profile_id: profileId,
        rules_pdf_id: rulesPdfId,
        expires_at: expiresAt || null,
        granted_by: grantedBy || null
    };
    const { data, error } = await supabase
        .from('rules_pdf_unlocks')
        .upsert(payload, { onConflict: 'user_id,rules_pdf_id' })
        .select()
        .single();
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const deleteRulesPdfUnlock = async ({ userId, rulesPdfId }) => {
    const { error } = await supabase
        .from('rules_pdf_unlocks')
        .delete()
        .eq('user_id', userId)
        .eq('rules_pdf_id', rulesPdfId);
    if (error) {
        console.error(error);
        return { error };
    }
    return { error: null };
};

const listRulesPdfUnlocksForUser = async (userId) => {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('rules_pdf_unlocks')
        .select('rules_pdf_id, expires_at, unlocked_at')
        .eq('user_id', userId)
        .or(`expires_at.is.null,expires_at.gt.${now}`);
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const createRulesPdfUnlockCodes = async ({ rulesPdfId, createdByProfileId, expiresAt = null, maxUses = 1, amount = 1 }) => {
    const inserts = Array.from({ length: amount }, () => ({
        code: crypto.randomBytes(12).toString('base64url'),
        rules_pdf_id: rulesPdfId,
        created_by: createdByProfileId,
        expires_at: expiresAt,
        max_uses: maxUses
    }));

    // authz: callers (admin-only route) gate access; createdByProfileId is set server-side
    const { data, error } = await supabaseAdmin
        .from('rules_pdf_unlock_codes')
        .insert(inserts)
        .select();

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const listRulesPdfUnlockCodes = async (rulesPdfId, client = supabase) => {
    const { data, error } = await client
        .from('rules_pdf_unlock_codes')
        .select('*')
        .eq('rules_pdf_id', rulesPdfId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const redeemRulesPdfUnlockCode = async (code, userId) => {
    const { data, error } = await supabase
        .rpc('redeem_rules_pdf_code_for_user', { p_code: code, p_user_id: userId });
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

// Resolve the title family of a rules PDF: every version of the same product
// shares a title (UNIQUE(edition, title); edition holds the version). Admin
// client so the lookup isn't RLS-filtered. Falls back to the exact id on
// failure so access checks degrade to current behavior.
const getRulesPdfFamilyIds = async (rulesPdf) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('rules_pdfs')
            .select('id')
            .eq('title', rulesPdf.title);
        if (error || !Array.isArray(data) || data.length === 0) {
            if (error) console.error(error);
            return [rulesPdf.id];
        }
        return data.map(r => r.id);
    } catch (e) {
        console.error(e);
        return [rulesPdf.id];
    }
};

const canViewRulesPdf = async (userContext = {}, rulesPdf) => {
    const { userId = null, role = null } = userContext;

    if (!rulesPdf?.storage_path) {
        return { data: false, error: null };
    }

    if (role === 'admin') {
        return { data: true, error: null };
    }

    if (!userId) {
        return { data: false, error: null };
    }

    // An unlock for any version of this title counts (see getRulesPdfFamilyIds).
    // Admin read mirrors isClassUnlocked: the shared anon client carries no
    // JWT, so RLS would hide the user's own unlock rows.
    const familyIds = await getRulesPdfFamilyIds(rulesPdf);
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('rules_pdf_unlocks')
        .select('rules_pdf_id, expires_at')
        .eq('user_id', userId)
        .in('rules_pdf_id', familyIds)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .limit(1);

    if (error) {
        console.error(error);
        return { data: false, error };
    }
    return { data: Array.isArray(data) && data.length > 0, error: null };
};

module.exports = {
    getRulesPdfs,
    getRulesPdf,
    createRulesPdf,
    updateRulesPdf,
    listRulesPdfUnlocks,
    listRulesPdfUnlocksForUser,
    upsertRulesPdfUnlock,
    deleteRulesPdfUnlock,
    createRulesPdfUnlockCodes,
    listRulesPdfUnlockCodes,
    redeemRulesPdfUnlockCode,
    canViewRulesPdf
};

