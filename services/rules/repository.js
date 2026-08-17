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
  },

  // Dashboard: every grant across every PDF, with the PDF joined in so
  // rows can be labeled without a second lookup.
  listAllUnlockGrantsAdmin: () => withResult(
    supabaseAdmin
      .from('rules_pdf_unlocks')
      .select(`
        user_id,
        profile_id,
        granted_by,
        unlocked_at,
        expires_at,
        profile:profiles!rules_pdf_unlocks_profile_id_fkey(id, name),
        granter:profiles!rules_pdf_unlocks_granted_by_fkey(id, name),
        rules_pdf:rules_pdfs(id, title, edition)
      `)
      .order('unlocked_at', { ascending: false })
  ),

  // Dashboard: every code across every PDF. Admin client: creator profiles
  // may not be public, and the codes table is admin-only under RLS.
  listAllUnlockCodesAdmin: () => withResult(
    supabaseAdmin
      .from('rules_pdf_unlock_codes')
      .select(`
        id,
        code,
        rules_pdf_id,
        created_at,
        expires_at,
        max_uses,
        used_count,
        rules_pdf:rules_pdfs(id, title, edition),
        creator:profiles!rules_pdf_unlock_codes_created_by_fkey(id, name)
      `)
      .order('created_at', { ascending: false })
  )
};
