-- Edition-aware leveling validates one promotion in the service, then commits
-- all mission/credit/character/perk writes together. Existing terminal RPC is
-- retained for backward compatibility during the application rollout.
CREATE TABLE IF NOT EXISTS public.character_level_up_requests (
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, request_id)
);
ALTER TABLE public.character_level_up_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.character_level_up_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.character_level_up_requests TO service_role;

CREATE OR REPLACE FUNCTION public.level_up_character_with_missions_atomic(
  p_character_id uuid, p_creator_id uuid, p_profile_id uuid,
  p_request_id uuid, p_request_hash text, p_snapshot jsonb,
  p_mission_names jsonb, p_credit_source_ids uuid[], p_fields jsonb, p_perks jsonb
)
RETURNS public.characters
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  current_character public.characters;
  saved public.characters;
  previous public.character_level_up_requests;
  class_rules jsonb;
  recorded_missions jsonb;
  recorded_offscreen jsonb;
  recorded_build jsonb;
  actual_completed int;
  mission_name text;
  mission_id uuid;
  source public.missions;
  source_id uuid;
BEGIN
  -- A promotion is infrequent and short. Table locks deliberately serialize
  -- it with all history writers, including inserts absent from the snapshot.
  -- Acquire history locks BEFORE the character lock: existing offscreen
  -- writers acquire the history table before updating character counters.
  -- A later automatic recalculation uses a timestamp compare-and-swap.
  LOCK TABLE public.missions, public.mission_characters, public.offscreen_missions
    IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO current_character FROM public.characters
    WHERE id = p_character_id AND creator_id = p_creator_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Character update returned no rows'; END IF;
  -- Ordinary atomic character edits lock the character before child tables.
  LOCK TABLE public.class_gear, public.class_abilities, public.character_perks, public.traits
    IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO previous FROM public.character_level_up_requests
    WHERE character_id = p_character_id AND request_id = p_request_id;
  IF FOUND THEN
    IF previous.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'This request ID has already been used for a different level-up';
    END IF;
    RETURN jsonb_populate_record(NULL::public.characters, previous.result);
  END IF;
  IF p_request_id IS NULL OR p_request_hash IS NULL THEN
    RAISE EXCEPTION 'A level-up request ID and hash are required';
  END IF;
  IF current_character.level >= 10 OR (p_fields->>'level')::int IS DISTINCT FROM current_character.level + 1
    OR (p_fields->>'level')::int > 10 THEN
    RAISE EXCEPTION 'Level Up must promote to the next level, up to level 10';
  END IF;
  IF current_character.level IS DISTINCT FROM (p_snapshot->>'level')::int
    OR current_character.class_id IS DISTINCT FROM (p_snapshot->>'class_id')::uuid
    OR current_character.creator_mode IS DISTINCT FROM p_snapshot->>'creator_mode'
    OR current_character.updated_at IS DISTINCT FROM (p_snapshot->>'updated_at')::timestamptz THEN
    RAISE EXCEPTION 'Character changed while preparing the promotion. Reload and try again';
  END IF;

  IF current_character.class_id IS NOT NULL THEN
    SELECT jsonb_build_object('rules_edition', c.rules_edition,
      'rules_version', c.rules_version, 'content_format', c.content_format)
      INTO class_rules FROM public.classes c WHERE c.id = current_character.class_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Class rules are unavailable'; END IF;
  END IF;
  IF class_rules IS DISTINCT FROM p_snapshot->'class_rules' AND
    NOT (class_rules IS NULL AND p_snapshot->'class_rules' = 'null'::jsonb) THEN
    RAISE EXCEPTION 'Class rules changed while preparing the promotion. Reload and try again';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'outcome', m.outcome,
    'difficulty', m.difficulty, 'danger', m.danger) ORDER BY m.id), '[]'::jsonb)
    INTO recorded_missions FROM public.mission_characters mc
    JOIN public.missions m ON m.id = mc.mission_id WHERE mc.character_id = p_character_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'merx_gained', o.merx_gained,
    'source_mission_id', o.source_mission_id) ORDER BY o.id), '[]'::jsonb)
    INTO recorded_offscreen FROM public.offscreen_missions o WHERE o.character_id = p_character_id;
  IF recorded_missions IS DISTINCT FROM p_snapshot->'missions'
    OR recorded_offscreen IS DISTINCT FROM p_snapshot->'offscreen' THEN
    RAISE EXCEPTION 'Mission history changed while preparing the promotion. Reload and try again';
  END IF;
  SELECT jsonb_build_object(
    'gear', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'class_id', g.class_id,
      'name', g.name, 'enchantment', g.enchantment, 'mods', g.mods) ORDER BY g.id), '[]'::jsonb)
      FROM public.class_gear g WHERE g.character_id = p_character_id),
    'abilities', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'class_id', a.class_id,
      'name', a.name, 'type', a.type) ORDER BY a.id), '[]'::jsonb)
      FROM public.class_abilities a WHERE a.character_id = p_character_id),
    'perks', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'class_ability_id', p.class_ability_id,
      'text', p.text, 'position', p.position) ORDER BY p.id), '[]'::jsonb)
      FROM public.character_perks p WHERE p.character_id = p_character_id),
    'traits', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'stat', t.stat)
      ORDER BY t.name COLLATE "C", t.stat COLLATE "C" NULLS FIRST), '[]'::jsonb)
      FROM public.traits t WHERE t.character_id = p_character_id)) INTO recorded_build;
  IF recorded_build IS DISTINCT FROM p_snapshot->'build' THEN
    RAISE EXCEPTION 'Character build changed while preparing the promotion. Reload and try again';
  END IF;

  FOR mission_name IN SELECT value FROM jsonb_array_elements_text(coalesce(p_mission_names, '[]'::jsonb))
  LOOP
    IF btrim(mission_name) = '' THEN RAISE EXCEPTION 'A backfill mission requires a name'; END IF;
    INSERT INTO public.missions(name, date, outcome, is_public, creator_id)
      VALUES (btrim(mission_name), now(), 'success', false, p_profile_id) RETURNING id INTO mission_id;
    INSERT INTO public.mission_characters(mission_id, character_id) VALUES (mission_id, p_character_id);
  END LOOP;
  FOREACH source_id IN ARRAY coalesce(p_credit_source_ids, ARRAY[]::uuid[])
  LOOP
    SELECT * INTO source FROM public.missions WHERE id = source_id AND host_id = p_profile_id FOR UPDATE;
    IF NOT FOUND OR EXISTS(SELECT 1 FROM public.offscreen_missions WHERE source_mission_id = source_id) THEN
      RAISE EXCEPTION 'A selected Conduit Credit is no longer available';
    END IF;
    INSERT INTO public.offscreen_missions(character_id, name, summary, merx_gained,
      source_mission_id, source_mission_name, source_mission_date, created_by)
    VALUES(p_character_id, 'Conduit Credit: Level ' || (p_fields->>'level'),
      'Spent through the level-up modal.', 0, source.id, source.name, source.date::date, p_profile_id);
  END LOOP;
  SELECT (SELECT count(*) FROM public.mission_characters mc JOIN public.missions m ON m.id = mc.mission_id
    WHERE mc.character_id = p_character_id AND m.outcome IN ('success', 'failure'))
    + (SELECT count(*) FROM public.offscreen_missions WHERE character_id = p_character_id)
    INTO actual_completed;
  IF actual_completed IS DISTINCT FROM (p_fields->>'completed_missions')::int THEN
    RAISE EXCEPTION 'Promotion mission count does not match recorded history';
  END IF;
  saved := public.level_up_character_atomic(p_character_id, p_creator_id, p_fields, p_perks);
  INSERT INTO public.character_level_up_requests(character_id, creator_id, request_id, request_hash, result)
    VALUES(p_character_id, p_creator_id, p_request_id, p_request_hash, to_jsonb(saved));
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.level_up_character_with_missions_atomic(uuid, uuid, uuid, uuid, text, jsonb, jsonb, uuid[], jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.level_up_character_with_missions_atomic(uuid, uuid, uuid, uuid, text, jsonb, jsonb, uuid[], jsonb, jsonb)
  TO service_role;
