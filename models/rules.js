const { supabase } = require('./_base');

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

const listRulesPdfUnlocks = async (rulesPdfId) => {
    const { data, error } = await supabase
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

const getRulesPdfUnlock = async (userId, rulesPdfId) => {
    const { data, error } = await supabase
        .from('rules_pdf_unlocks')
        .select('user_id, profile_id, expires_at, unlocked_at')
        .eq('user_id', userId)
        .eq('rules_pdf_id', rulesPdfId)
        .maybeSingle();
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

    const { data, error } = await getRulesPdfUnlock(userId, rulesPdf.id);
    if (error) {
        return { data: false, error };
    }

    if (!data) {
        return { data: false, error: null };
    }

    if (!data.expires_at) {
        return { data: true, error: null };
    }

    const expiresAt = new Date(data.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
        return { data: false, error: null };
    }

    return { data: expiresAt > new Date(), error: null };
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
    canViewRulesPdf
};

