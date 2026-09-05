const { supabaseAdmin } = require('../../models/_base');
const { applyClassFilters } = require('../../util/class-filters');

// The only consumer of supabaseAdmin for the class domain. Holds every
// privileged (service-role) query verbatim; models/class.js keeps the
// surrounding logic (computeVersionFamily, date math, agent serialization).
const withResult = async (query) => {
  const { data, error } = await query;
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

module.exports = {
  // Writes
  insertClass: (data) => withResult(
    supabaseAdmin.from('classes').insert([data]).select().single()
  ),
  updateClass: (id, data) => withResult(
    supabaseAdmin.from('classes').update(data).eq('id', id).select().single()
  ),
  deleteClass: async (id) => {
    const { error } = await supabaseAdmin.from('classes').delete().eq('id', id);
    if (error) console.error(error);
    return { error: error || null };
  },
  saveClassPdfMetadata: (id, data) => withResult(
    supabaseAdmin.from('classes').update(data).eq('id', id).select().single()
  ),
  insertUnlockCodes: (rows) => withResult(
    supabaseAdmin.from('class_unlock_codes').insert(rows).select()
  ),
  insertUnlock: (payload) => withResult(
    supabaseAdmin.from('class_unlocks').insert([payload]).select().single()
  ),

  // Reads
  // Lean projection of all classes for version-family resolution. Admin
  // client so private forks don't break chain links. Returns null on any
  // failure so callers can degrade to exact-id behavior.
  fetchClassFamilyRows: async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from('classes')
        .select('id, base_class_id, rules_edition, free_play_access');
      if (error || !Array.isArray(data)) {
        if (error) console.error(error);
        return null;
      }
      return data;
    } catch (e) {
      console.error(e);
      return null;
    }
  },
  fetchClassItemOwnership: async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from('classes')
        .select('id, name, is_public, base_class_id, rules_edition, gear, abilities');
      if (error || !Array.isArray(data)) {
        if (error) console.error(error);
        return [];
      }
      return data;
    } catch (e) {
      console.error(e);
      return [];
    }
  },
  unlockedClassIdRows: async ({ userId, nowIso }) => {
    const { data, error } = await supabaseAdmin
      .from('class_unlocks')
      .select('class_id, expires_at')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  },
  // Hydrate class rows for an already-resolved id set (see
  // getEffectiveClassUnlocks). Admin client so private forks resolve — which
  // is exactly why this needs its own visibility filter: the id set is
  // family-expanded, so an admin's unpublished v2 draft of a core class is in
  // it for every holder of the book, and the class-view route reads through
  // the RLS-bound anon client, so its link would 404 for them.
  //
  // alwaysVisibleIds is the caller's raw direct-unlock set. A class the user
  // holds an explicit class_unlocks row for was listed before book grants
  // existed and stays listed, private or not; only ids reached by expansion
  // are filtered. Interpolating them into the filter is safe: they are
  // class_unlocks.class_id values, a uuid column, so they cannot carry a
  // comma or quote.
  classRowsByIds: async (classIds, { alwaysVisibleIds = [] } = {}) => {
    if (!Array.isArray(classIds) || classIds.length === 0) {
      return { data: [], error: null };
    }
    const requested = new Set(classIds);
    const exempt = [...new Set(alwaysVisibleIds)].filter(id => requested.has(id));

    let query = supabaseAdmin
      .from('classes')
      .select('*')
      .in('id', classIds);
    query = exempt.length
      ? query.or(`is_public.eq.true,id.in.(${exempt.join(',')})`)
      : query.eq('is_public', true);

    // 6-12+ rows now, so an unordered read reshuffles the table between page
    // loads.
    const { data, error } = await query.order('name');
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  },
  fetchClassByIdAdmin: (id) => withResult(
    supabaseAdmin.from('classes').select('*').eq('id', id).single()
  ),
  fetchClassesForAgentAdmin: async (filters, actor) => {
    let query = applyClassFilters(supabaseAdmin.from('classes').select('*'), filters);

    if (actor.role !== 'admin') {
      if (actor.profileId) {
        query = query.or(`is_public.eq.true,created_by.eq.${actor.profileId}`);
      } else {
        query = query.eq('is_public', true);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  }
};
