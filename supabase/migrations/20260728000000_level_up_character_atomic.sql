-- Atomically apply a level-up's terminal writes: update the character's owned
-- counters/stats, insert the newly-submitted ability perks, and resolve their
-- compound links — all in one transaction. Service-role only; authorization
-- stays in CharacterService. Backfill missions and offscreen-credit rows are
-- created upstream (cross-domain) and are intentionally NOT part of this
-- transaction — they are additive and re-derivable.
CREATE OR REPLACE FUNCTION public.level_up_character_atomic(
  p_character_id uuid,
  p_creator_id uuid,
  p_fields jsonb,
  p_perks jsonb
)
RETURNS public.characters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved public.characters;
  item jsonb;
  source_id uuid;
  target_id uuid;
BEGIN
  UPDATE public.characters AS current
  SET
    vitality = COALESCE((p_fields->>'vitality')::int, current.vitality),
    might = COALESCE((p_fields->>'might')::int, current.might),
    resilience = COALESCE((p_fields->>'resilience')::int, current.resilience),
    spirit = COALESCE((p_fields->>'spirit')::int, current.spirit),
    arcane = COALESCE((p_fields->>'arcane')::int, current.arcane),
    will = COALESCE((p_fields->>'will')::int, current.will),
    sensory = COALESCE((p_fields->>'sensory')::int, current.sensory),
    reflex = COALESCE((p_fields->>'reflex')::int, current.reflex),
    vigor = COALESCE((p_fields->>'vigor')::int, current.vigor),
    skill = COALESCE((p_fields->>'skill')::int, current.skill),
    intelligence = COALESCE((p_fields->>'intelligence')::int, current.intelligence),
    luck = COALESCE((p_fields->>'luck')::int, current.luck),
    level = COALESCE((p_fields->>'level')::int, current.level),
    completed_missions = COALESCE((p_fields->>'completed_missions')::int, current.completed_missions),
    commissary_reward = COALESCE((p_fields->>'commissary_reward')::int, current.commissary_reward)
  WHERE current.id = p_character_id AND current.creator_id = p_creator_id
  RETURNING current.* INTO saved;

  IF saved.id IS NULL THEN
    RAISE EXCEPTION 'Character update returned no rows';
  END IF;

  IF p_perks IS NOT NULL THEN
    -- Insert the new perk rows.
    FOR item IN SELECT value FROM jsonb_array_elements(p_perks)
    LOOP
      INSERT INTO public.character_perks (character_id, class_ability_id, text, position)
      VALUES (
        saved.id,
        (item->>'class_ability_id')::uuid,
        item->>'text',
        COALESCE((item->>'position')::integer, 0)
      );
    END LOOP;

    -- Resolve compound links. A link is either 'position-<n>' (another perk in
    -- this batch on the SAME ability) or an existing perk UUID on the same
    -- ability. Anything else is left null.
    FOR item IN SELECT value FROM jsonb_array_elements(p_perks)
    LOOP
      IF item->>'compounds_with' IS NULL THEN CONTINUE; END IF;

      SELECT cp.id INTO source_id
      FROM public.character_perks cp
      WHERE cp.character_id = saved.id
        AND cp.class_ability_id = (item->>'class_ability_id')::uuid
        AND cp.position = COALESCE((item->>'position')::integer, 0)
      LIMIT 1;
      IF source_id IS NULL THEN CONTINUE; END IF;

      target_id := NULL;
      IF item->>'compounds_with' LIKE 'position-%' THEN
        SELECT cp.id INTO target_id
        FROM public.character_perks cp
        WHERE cp.character_id = saved.id
          AND cp.class_ability_id = (item->>'class_ability_id')::uuid
          AND cp.position = substring(item->>'compounds_with' FROM 'position-(.*)')::integer
        LIMIT 1;
      ELSIF item->>'compounds_with' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        SELECT cp.id INTO target_id
        FROM public.character_perks cp
        WHERE cp.id = (item->>'compounds_with')::uuid
          AND cp.character_id = saved.id
          AND cp.class_ability_id = (item->>'class_ability_id')::uuid
        LIMIT 1;
      END IF;

      IF target_id IS NOT NULL AND target_id <> source_id THEN
        UPDATE public.character_perks SET compounds_with = target_id WHERE id = source_id;
      END IF;
    END LOOP;
  END IF;

  RETURN saved;
END;
$$;
