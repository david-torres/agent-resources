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
  ),

  // Which rulesets does this user hold a CORE rulebook for? Admin client so
  // RLS does not hide the user's own unlock rows. is_active is deliberately
  // not filtered: a retired edition of a book still names the ruleset owned.
  // book_type IS filtered: rules_edition only says which ruleset a book
  // belongs to, and a supplement for that ruleset confers no classes.
  //
  // The book_type filter targets the EMBEDDED rules_pdfs resource, so it must
  // be qualified with the embed alias — a bare .eq('book_type', 'core') would
  // resolve against rules_pdf_unlocks and error. The embed is also !inner:
  // without it PostgREST keeps the parent unlock row and nulls the embed
  // instead of dropping the row.
  // Returns a { data, error } envelope: on failure data is null and error is
  // set, so callers can fail closed on book-derived classes while still
  // surfacing the failure instead of mistaking it for "no books".
  fetchActiveBooksForUser: async ({ userId, nowIso }) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('rules_pdf_unlocks')
        .select('expires_at, rules_pdf:rules_pdfs!inner(rules_edition, title)')
        .eq('user_id', userId)
        .eq('rules_pdf.book_type', 'core')
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      if (error || !Array.isArray(data)) {
        if (error) console.error(error);
        return { data: null, error: error || { message: 'rules_pdf_unlocks read returned no rows' } };
      }
      // The grant's expiry rides along with the book it confers: a
      // book-derived class is only as durable as the grant behind it.
      return {
        data: data
          .filter(row => row.rules_pdf && row.rules_pdf.rules_edition)
          .map(row => ({ ...row.rules_pdf, expires_at: row.expires_at ?? null })),
        error: null
      };
    } catch (e) {
      console.error(e);
      return { data: null, error: e };
    }
  }
};
