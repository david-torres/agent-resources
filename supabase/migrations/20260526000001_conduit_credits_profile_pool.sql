-- Conduit Credits revision: drop the per-character pool, add profile-pool primitives.

-- 1. Drop the old per-character credit primitives.
DROP FUNCTION IF EXISTS spend_conduit_credit(UUID, INT);
DROP FUNCTION IF EXISTS refund_conduit_credit(UUID, INT);
ALTER TABLE characters DROP COLUMN IF EXISTS conduit_credits;

-- 2. Enforce 1:1 between hosted missions and picker-linked offscreen missions.
-- Free-text spends (source_mission_id IS NULL) are excluded via the partial WHERE.
CREATE UNIQUE INDEX IF NOT EXISTS offscreen_missions_source_unique_idx
  ON offscreen_missions (source_mission_id)
  WHERE source_mission_id IS NOT NULL;

-- 3. Replace the credit-bookkeeping RPCs with progress-only RPCs.

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Bumps completed_missions +1 and commissary_reward + p_merx. Used by createOffscreenMission.
CREATE OR REPLACE FUNCTION apply_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = completed_missions + 1,
         commissary_reward = commissary_reward + COALESCE(p_merx, 0)
   WHERE id = p_character_id;
$$;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Reverses apply_offscreen_mission_progress, clamped at 0. Used by removeOffscreenMission.
CREATE OR REPLACE FUNCTION revert_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = GREATEST(completed_missions - 1, 0),
         commissary_reward = GREATEST(commissary_reward - COALESCE(p_merx, 0), 0)
   WHERE id = p_character_id;
$$;
