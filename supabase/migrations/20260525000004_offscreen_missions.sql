-- Offscreen missions: per-character log entries created by spending a Conduit credit.
CREATE TABLE IF NOT EXISTS offscreen_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  merx_gained INTEGER NOT NULL DEFAULT 0,
  source_mission_id UUID NULL REFERENCES missions(id) ON DELETE SET NULL,
  source_mission_name TEXT NOT NULL,
  source_mission_date DATE NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offscreen_missions_character_id_idx
  ON offscreen_missions (character_id, source_mission_date DESC);

ALTER TABLE offscreen_missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offscreen_missions_select" ON offscreen_missions;
DROP POLICY IF EXISTS "offscreen_missions_mutate" ON offscreen_missions;

CREATE POLICY "offscreen_missions_select"
  ON offscreen_missions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (c.is_public = true OR p.user_id = auth.uid() OR is_admin())
    )
  );

CREATE POLICY "offscreen_missions_mutate"
  ON offscreen_missions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (p.user_id = auth.uid() OR is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (p.user_id = auth.uid() OR is_admin())
    )
  );

-- Atomic bookkeeping on spend: decrement credit, +1 completed_missions, +merx commissary_reward.
-- Raises a custom SQLSTATE so the caller can map it to a 400 with a clean message.
-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
CREATE OR REPLACE FUNCTION spend_conduit_credit(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE characters
     SET conduit_credits = conduit_credits - 1,
         completed_missions = completed_missions + 1,
         commissary_reward = commissary_reward + COALESCE(p_merx, 0)
   WHERE id = p_character_id
     AND conduit_credits > 0;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'no_conduit_credit_available' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Atomic refund on delete: +1 credit, -1 completed_missions (clamped at 0), -merx (clamped at 0).
-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
CREATE OR REPLACE FUNCTION refund_conduit_credit(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET conduit_credits = conduit_credits + 1,
         completed_missions = GREATEST(completed_missions - 1, 0),
         commissary_reward = GREATEST(commissary_reward - COALESCE(p_merx, 0), 0)
   WHERE id = p_character_id;
$$;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Adjust commissary_reward by a signed delta, clamped at 0.
-- General signed adjustment; currently used by offscreen-mission updates.
CREATE OR REPLACE FUNCTION adjust_commissary_reward(p_character_id UUID, p_delta INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET commissary_reward = GREATEST(commissary_reward + COALESCE(p_delta, 0), 0)
   WHERE id = p_character_id;
$$;
