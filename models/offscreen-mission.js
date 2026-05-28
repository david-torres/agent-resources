const { supabase } = require('./_base');

const normalizeMerx = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

const createOffscreenMission = async ({ characterId, payload, profileId, supabase: client = supabase }) => {
  // Two-step: insert row (integrity check via partial unique index on source_mission_id),
  // then bump character counters. Not atomic — if the RPC fails after the insert, the
  // offscreen mission row exists but completed_missions/commissary_reward weren't bumped.
  // Acceptable trade-off for a low-frequency, deliberate user action.
  // Recovery: the caller has characterId and payload.merx_gained in scope at the call
  // site, so they can re-invoke apply_offscreen_mission_progress(characterId, merx) to
  // finish the bookkeeping without needing to look up the just-inserted row.
  const merx = normalizeMerx(payload.merx_gained);

  const row = {
    character_id: characterId,
    name: payload.name,
    summary: payload.summary,
    merx_gained: merx,
    source_mission_id: payload.source_mission_id || null,
    source_mission_name: payload.source_mission_name,
    source_mission_date: payload.source_mission_date,
    created_by: profileId || null
  };

  const { data, error: insertError } = await client
    .from('offscreen_missions')
    .insert(row)
    .select()
    .single();

  if (insertError) {
    // 23505 here can only mean the partial unique index on source_mission_id —
    // it's the only UNIQUE on the table (id is a server-generated UUID).
    if (insertError.code === '23505') {
      return { data: null, error: { code: '23505', message: 'duplicate_source_mission' } };
    }
    return { data: null, error: insertError };
  }

  const { error: rpcError } = await client.rpc('apply_offscreen_mission_progress', {
    p_character_id: characterId,
    p_merx: merx
  });
  if (rpcError) return { data: null, error: rpcError };

  return { data, error: null };
};

const listOffscreenMissions = async ({ characterId, supabase: client = supabase }) => {
  const { data, error } = await client
    .from('offscreen_missions')
    .select('*')
    .eq('character_id', characterId)
    .order('source_mission_date', { ascending: false });
  return { data, error };
};

const getOffscreenMissionById = async ({ id, supabase: client = supabase }) => {
  const { data, error } = await client
    .from('offscreen_missions')
    .select('*')
    .eq('id', id)
    .single();
  return { data, error };
};

const updateOffscreenMission = async ({ id, payload, supabase: client = supabase }) => {
  // Two-step: row update then merx-delta RPC. Not atomic — same trade-off as createOffscreenMission.
  // Recovery: if the RPC fails after the row update, the merx delta wasn't applied;
  // surface the error and accept the (rare) drift.
  // Source-mission changes (picker↔free-text, or picker→picker) do NOT touch
  // completed_missions: that counter is bound to the row's existence, not to its source.
  const { data: existing, error: fetchError } = await client
    .from('offscreen_missions')
    .select('character_id, merx_gained')
    .eq('id', id)
    .single();
  if (fetchError) return { data: null, error: fetchError };

  const newMerx = normalizeMerx(payload.merx_gained);
  const row = {
    name: payload.name,
    summary: payload.summary,
    merx_gained: newMerx,
    source_mission_id: payload.source_mission_id || null,
    source_mission_name: payload.source_mission_name,
    source_mission_date: payload.source_mission_date
  };

  const { data, error } = await client
    .from('offscreen_missions')
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    // 23505 here can only mean the partial unique index on source_mission_id —
    // it's the only UNIQUE on the table (id is a server-generated UUID).
    if (error.code === '23505') {
      return { data: null, error: { code: '23505', message: 'duplicate_source_mission' } };
    }
    return { data: null, error };
  }

  // delta may be negative; clamping happens in adjust_commissary_reward (GREATEST(..., 0)).
  const delta = newMerx - (existing.merx_gained || 0);
  if (delta !== 0) {
    const { error: rpcError } = await client.rpc('adjust_commissary_reward', {
      p_character_id: existing.character_id,
      p_delta: delta
    });
    if (rpcError) return { data: null, error: rpcError };
  }

  return { data, error: null };
};

const removeOffscreenMission = async ({ id, supabase: client = supabase }) => {
  // Two-step: delete row then revert-progress RPC. Not atomic (same trade-off as create/update);
  // if the RPC fails after the delete, the row is gone but counters weren't reverted.
  // Recovery: the caller has the deleted row's character_id and merx_gained in scope before
  // the delete; they can re-invoke revert_offscreen_mission_progress(character_id, merx) to
  // finish the bookkeeping.
  const { data: existing, error: fetchError } = await client
    .from('offscreen_missions')
    .select('character_id, merx_gained')
    .eq('id', id)
    .single();
  if (fetchError) return { data: null, error: fetchError };

  const { error: deleteError } = await client
    .from('offscreen_missions')
    .delete()
    .eq('id', id);
  if (deleteError) return { data: null, error: deleteError };

  const { error: rpcError } = await client.rpc('revert_offscreen_mission_progress', {
    p_character_id: existing.character_id,
    p_merx: existing.merx_gained || 0
  });
  if (rpcError) return { data: null, error: rpcError };

  return { data: { id }, error: null };
};

const getAvailableHostedMissionsForPicker = async ({ profileId, currentSourceId = null, supabase: client = supabase }) => {
  // Step 1: gather mission IDs already used as a source for some offscreen mission.
  const { data: usedRows, error: usedError } = await client
    .from('offscreen_missions')
    .select('source_mission_id')
    .not('source_mission_id', 'is', null);
  if (usedError) return { data: null, error: usedError };

  // currentSourceId is the source the row being edited already points to — we want to keep
  // it available so the user can leave it selected. Drop it from the exclusion set.
  let usedIds = (usedRows || []).map(r => r.source_mission_id);
  if (currentSourceId) {
    usedIds = usedIds.filter(id => id !== currentSourceId);
  }

  // Step 2: query missions the user hosted, excluding the used set.
  let query = client
    .from('missions')
    .select('id, name, date')
    .eq('host_id', profileId);

  if (usedIds.length > 0) {
    // PostgREST `.in` value: parenthesized comma-separated list.
    query = query.not('id', 'in', `(${usedIds.join(',')})`);
  }

  const { data, error } = await query.order('date', { ascending: false });
  return { data, error };
};

module.exports = {
  createOffscreenMission,
  listOffscreenMissions,
  getOffscreenMissionById,
  updateOffscreenMission,
  removeOffscreenMission,
  getAvailableHostedMissionsForPicker
};
