const { supabase } = require('./_base');
const crypto = require('crypto');
const { RulesService } = require('../services/rules/service');
const rulesRepository = require('../services/rules/repository');

const rulesService = new RulesService(rulesRepository);

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

const listAllUnlockGrantsAdmin = () => rulesRepository.listAllUnlockGrantsAdmin();
const listAllUnlockCodesAdmin = () => rulesRepository.listAllUnlockCodesAdmin();

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

const listRulesPdfUnlocksForUser = async (userId, client = supabase) => {
    const now = new Date().toISOString();
    const { data, error } = await client
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

// Route-facing compatibility function. The service enforces the
// mint-unlock-codes policy (admin/system only); this model builds the
// code rows (the non-privileged logic) and delegates the privileged
// insert to the service/repository.
const createRulesPdfUnlockCodes = async (actor, { rulesPdfId, createdByProfileId, expiresAt = null, maxUses = 1, amount = 1 }) => {
    const inserts = Array.from({ length: amount }, () => ({
        code: crypto.randomBytes(12).toString('base64url'),
        rules_pdf_id: rulesPdfId,
        created_by: createdByProfileId,
        expires_at: expiresAt,
        max_uses: maxUses
    }));

    return rulesService.mintUnlockCodes(actor, inserts);
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
        const { data, error } = await rulesRepository.fetchPdfFamilyIdsByTitle(rulesPdf.title);
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

    if (rulesPdf.free_access) {
        return { data: true, error: null };
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
    const { data, error } = await rulesRepository.fetchActiveUnlockForUser({ userId, familyIds });

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
    listAllUnlockGrantsAdmin,
    listAllUnlockCodesAdmin,
    listRulesPdfUnlocksForUser,
    upsertRulesPdfUnlock,
    deleteRulesPdfUnlock,
    createRulesPdfUnlockCodes,
    redeemRulesPdfUnlockCode,
    canViewRulesPdf
};

