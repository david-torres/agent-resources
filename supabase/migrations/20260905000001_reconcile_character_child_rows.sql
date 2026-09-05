-- Reconcile the character child tables instead of deleting and reinserting them.
-- Matched rows keep their id and created_at, so character_perks (whose
-- class_ability_id is ON DELETE CASCADE) is no longer destroyed on every save.
-- Semantics mirror util/reconcile.js#diffChildRows.
--
-- This restates the whole function body rather than patching it: Postgres
-- CREATE OR REPLACE FUNCTION has no partial form. The character INSERT/UPDATE
-- block is byte-identical to 20260815000002_character_created_at_editable.sql;
-- only the child-row handling changes.

CREATE OR REPLACE FUNCTION public.save_character_atomic(
  p_character_id uuid,
  p_creator_id uuid,
  p_character jsonb,
  p_traits jsonb,
  p_gear jsonb,
  p_abilities jsonb,
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
  perk_id uuid;
  ability_id uuid;
  source_perk_id uuid;
  target_perk_id uuid;
BEGIN
  IF p_character_id IS NULL THEN
    INSERT INTO public.characters (
      creator_id, is_public, is_deceased, hide_from_search, auto_calculate,
      name, class, vitality, might, resilience, spirit, arcane, will, sensory,
      reflex, vigor, skill, intelligence, luck, mission_id, level,
      completed_missions, commissary_reward, appearance, additional_gear,
      image_url, image_crop, flavor, ideas, background, perks, private_notes,
      class_id, common_items, quirks, accessories, creator_mode, created_at
    )
    SELECT
      record.creator_id, COALESCE(record.is_public, false), COALESCE(record.is_deceased, false), COALESCE(record.hide_from_search, false), COALESCE(record.auto_calculate, false),
      record.name, record.class, record.vitality, record.might, record.resilience, record.spirit, record.arcane, record.will, record.sensory,
      record.reflex, record.vigor, record.skill, record.intelligence, record.luck, record.mission_id, record.level,
      record.completed_missions, record.commissary_reward, record.appearance, record.additional_gear,
      record.image_url, record.image_crop, record.flavor, record.ideas, record.background, record.perks, record.private_notes,
      record.class_id, COALESCE(record.common_items, '[]'::jsonb), COALESCE(record.quirks, '[]'::jsonb), COALESCE(record.accessories, '[]'::jsonb), record.creator_mode, COALESCE(record.created_at, now())
    FROM jsonb_populate_record(NULL::public.characters, p_character) AS record
    RETURNING * INTO saved;
  ELSE
    SELECT * INTO saved FROM public.characters
    WHERE id = p_character_id AND creator_id = p_creator_id;

    IF saved.id IS NULL THEN
      RAISE EXCEPTION 'Character update returned no rows';
    END IF;

    UPDATE public.characters AS current
    SET
      is_public = record.is_public, is_deceased = record.is_deceased,
      hide_from_search = record.hide_from_search, auto_calculate = record.auto_calculate,
      name = record.name, class = record.class, vitality = record.vitality,
      might = record.might, resilience = record.resilience, spirit = record.spirit,
      arcane = record.arcane, will = record.will, sensory = record.sensory,
      reflex = record.reflex, vigor = record.vigor, skill = record.skill,
      intelligence = record.intelligence, luck = record.luck, mission_id = record.mission_id,
      level = record.level, completed_missions = record.completed_missions,
      commissary_reward = record.commissary_reward, appearance = record.appearance,
      additional_gear = record.additional_gear, image_url = record.image_url,
      image_crop = record.image_crop, flavor = record.flavor, ideas = record.ideas,
      background = record.background, perks = record.perks, private_notes = record.private_notes,
      class_id = record.class_id, common_items = record.common_items,
      quirks = record.quirks, accessories = record.accessories,
      creator_mode = record.creator_mode, created_at = record.created_at
    FROM jsonb_populate_record(saved, p_character) AS record
    WHERE current.id = p_character_id AND current.creator_id = p_creator_id
    RETURNING current.* INTO saved;

    IF saved.id IS NULL THEN
      RAISE EXCEPTION 'Character update returned no rows';
    END IF;
  END IF;

  -- Rows are paired by natural key plus an occurrence index rather than by key
  -- alone: N identical desired items must consume N existing rows FIFO instead
  -- of collapsing into one.
  WITH desired AS (
    SELECT
      trait_item->>'name' AS name,
      row_number() OVER (PARTITION BY trait_item->>'name' ORDER BY ord) AS occ
    FROM jsonb_array_elements(COALESCE(p_traits, '[]'::jsonb)) WITH ORDINALITY AS t(trait_item, ord)
  ),
  existing AS (
    SELECT id, name, row_number() OVER (PARTITION BY name ORDER BY id) AS occ
    FROM public.traits WHERE character_id = saved.id
  ),
  matched AS (
    SELECT e.id FROM existing e JOIN desired d USING (name, occ)
  ),
  deleted AS (
    DELETE FROM public.traits t
    WHERE t.character_id = saved.id
      AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.id = t.id)
  )
  INSERT INTO public.traits (character_id, name)
  SELECT saved.id, d.name FROM desired d
  WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.name = d.name AND e.occ = d.occ);

  IF p_gear IS NOT NULL THEN
    WITH desired AS (
      SELECT
        gear_item->>'name' AS name,
        (gear_item->>'class_id')::uuid AS class_id,
        gear_item->>'description' AS description,
        row_number() OVER (PARTITION BY (gear_item->>'class_id')::uuid, gear_item->>'name' ORDER BY ord) AS occ
      FROM jsonb_array_elements(p_gear) WITH ORDINALITY AS t(gear_item, ord)
    ),
    existing AS (
      SELECT id, name, class_id, row_number() OVER (PARTITION BY class_id, name ORDER BY id) AS occ
      FROM public.class_gear WHERE character_id = saved.id
    ),
    matched AS (
      SELECT e.id, d.description FROM existing e JOIN desired d USING (class_id, name, occ)
    ),
    deleted AS (
      DELETE FROM public.class_gear g
      WHERE g.character_id = saved.id
        AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.id = g.id)
    ),
    updated AS (
      UPDATE public.class_gear g SET description = m.description
      FROM matched m
      WHERE g.id = m.id AND g.description IS DISTINCT FROM m.description
    )
    INSERT INTO public.class_gear (character_id, name, class_id, description)
    SELECT saved.id, d.name, d.class_id, d.description FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM existing e WHERE e.class_id = d.class_id AND e.name = d.name AND e.occ = d.occ
    );
  END IF;

  IF p_abilities IS NOT NULL THEN
    WITH desired AS (
      SELECT
        ability_item->>'name' AS name,
        (ability_item->>'class_id')::uuid AS class_id,
        ability_item->>'description' AS description,
        row_number() OVER (PARTITION BY (ability_item->>'class_id')::uuid, ability_item->>'name' ORDER BY ord) AS occ
      FROM jsonb_array_elements(p_abilities) WITH ORDINALITY AS t(ability_item, ord)
    ),
    existing AS (
      SELECT id, name, class_id, row_number() OVER (PARTITION BY class_id, name ORDER BY id) AS occ
      FROM public.class_abilities WHERE character_id = saved.id
    ),
    matched AS (
      SELECT e.id, d.description FROM existing e JOIN desired d USING (class_id, name, occ)
    ),
    deleted AS (
      DELETE FROM public.class_abilities a
      WHERE a.character_id = saved.id
        AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.id = a.id)
    ),
    updated AS (
      UPDATE public.class_abilities a SET description = m.description
      FROM matched m
      WHERE a.id = m.id AND a.description IS DISTINCT FROM m.description
    )
    INSERT INTO public.class_abilities (character_id, name, class_id, description)
    SELECT saved.id, d.name, d.class_id, d.description FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM existing e WHERE e.class_id = d.class_id AND e.name = d.name AND e.occ = d.occ
    );
  END IF;

  IF p_perks IS NOT NULL THEN
    -- The ability id is resolved before keying because the natural key is
    -- (resolved ability id, position), not the raw payload value.
    WITH resolved AS (
      SELECT
        COALESCE(
          CASE WHEN perk_item->>'class_ability_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            THEN (perk_item->>'class_ability_id')::uuid END,
          (SELECT ca.id FROM public.class_abilities ca
            WHERE ca.character_id = saved.id AND ca.name = perk_item->>'ability_name'
            ORDER BY ca.id LIMIT 1)
        ) AS class_ability_id,
        perk_item->>'text' AS text,
        COALESCE((perk_item->>'position')::integer, 0) AS position,
        ord
      FROM jsonb_array_elements(p_perks) WITH ORDINALITY AS t(perk_item, ord)
    ),
    desired AS (
      SELECT
        class_ability_id, text, position,
        row_number() OVER (PARTITION BY class_ability_id, position ORDER BY ord) AS occ
      FROM resolved
    ),
    existing AS (
      SELECT id, class_ability_id, position,
        row_number() OVER (PARTITION BY class_ability_id, position ORDER BY id) AS occ
      FROM public.character_perks WHERE character_id = saved.id
    ),
    matched AS (
      SELECT e.id, d.text FROM existing e JOIN desired d USING (class_ability_id, position, occ)
    ),
    deleted AS (
      DELETE FROM public.character_perks cp
      WHERE cp.character_id = saved.id
        AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.id = cp.id)
    ),
    updated AS (
      UPDATE public.character_perks cp SET text = m.text
      FROM matched m
      WHERE cp.id = m.id AND cp.text IS DISTINCT FROM m.text
    )
    INSERT INTO public.character_perks (character_id, class_ability_id, text, position)
    SELECT saved.id, d.class_ability_id, d.text, d.position FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM existing e
      WHERE e.class_ability_id = d.class_ability_id AND e.position = d.position AND e.occ = d.occ
    );

    FOR item IN SELECT value FROM jsonb_array_elements(p_perks)
    LOOP
      IF item->>'compounds_with' LIKE 'position-%' THEN
        SELECT cp.id INTO source_perk_id
        FROM public.character_perks cp
        WHERE cp.character_id = saved.id
          AND cp.position = (item->>'position')::integer
          AND (item->>'ability_name' IS NULL OR cp.class_ability_id = (
            SELECT id FROM public.class_abilities WHERE character_id = saved.id AND name = item->>'ability_name' ORDER BY id LIMIT 1
          ));
        SELECT cp.id INTO target_perk_id
        FROM public.character_perks cp
        WHERE cp.character_id = saved.id
          AND cp.position = substring(item->>'compounds_with' FROM 'position-(.*)')::integer
          AND cp.class_ability_id = (SELECT class_ability_id FROM public.character_perks WHERE id = source_perk_id);
        UPDATE public.character_perks SET compounds_with = target_perk_id WHERE id = source_perk_id;
      END IF;
    END LOOP;
  END IF;

  RETURN saved;
END;$$;
