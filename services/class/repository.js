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
        .select('id, base_class_id, rules_edition');
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
  activeUnlockRows: async ({ userId, classIds, nowIso }) => {
    const { data, error } = await supabaseAdmin
      .from('class_unlocks')
      .select('class_id, expires_at')
      .eq('user_id', userId)
      .in('class_id', classIds)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  },
  unlockedClassRows: async ({ userId, nowIso }) => {
    const { data, error } = await supabaseAdmin
      .from('class_unlocks')
      .select('class:classes(*), expires_at')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  },
  unlockedClassIdRows: async ({ userId, nowIso }) => {
    const { data, error } = await supabaseAdmin
      .from('class_unlocks')
      .select('class_id')
      .eq('user_id', userId)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
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
