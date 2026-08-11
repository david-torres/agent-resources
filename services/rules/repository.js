const { supabaseAdmin } = require('../../models/_base');

// The only consumer of supabaseAdmin for the rules domain. Holds every
// privileged (service-role) query verbatim; models/rules.js keeps the
// surrounding logic (code generation, family-id fallback, view gating).
const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

module.exports = {
  // Admin-only: embedded profile/granter joins require bypassing RLS so
  // non-public grantee profiles still resolve in the manage UI.
  listUnlockGrantsAdmin: (rulesPdfId) => withResult(
    supabaseAdmin
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
      .order('unlocked_at', { ascending: false })
  ),

  insertUnlockCodes: (rows) => withResult(
    supabaseAdmin.from('rules_pdf_unlock_codes').insert(rows).select()
  ),

  // Admin client so the lookup isn't RLS-filtered.
  fetchPdfFamilyIdsByTitle: (title) => withResult(
    supabaseAdmin.from('rules_pdfs').select('id').eq('title', title)
  ),

  // Admin read mirrors isClassUnlocked: the shared anon client carries no
  // JWT, so RLS would hide the user's own unlock rows.
  fetchActiveUnlockForUser: ({ userId, familyIds }) => {
    const now = new Date().toISOString();
    return withResult(
      supabaseAdmin
        .from('rules_pdf_unlocks')
        .select('rules_pdf_id, expires_at')
        .eq('user_id', userId)
        .in('rules_pdf_id', familyIds)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .limit(1)
    );
  }
};
