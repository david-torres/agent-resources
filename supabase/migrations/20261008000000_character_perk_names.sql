-- An Ability Perk may carry an optional name: a short label shown with the
-- Perk. It is separate from the Perk text, so it never counts toward the
-- word limit, and is capped at 60 characters (PERK_NAME_MAX_LENGTH in
-- util/perk-economy.js) so a name cannot carry the Perk's mechanics.
--
-- save_character_atomic is restated from
-- 20260929000000_class_abilities_unique_name.sql and level_up_character_atomic
-- from 20260728000000_level_up_character_atomic.sql; only their perk writes
-- change, to carry the name. Both signatures are unchanged, so CREATE OR
-- REPLACE keeps the service_role-only grants set by the earlier migrations.

ALTER TABLE public.character_perks
  ADD COLUMN name text
  CONSTRAINT character_perks_name_length CHECK (name IS NULL OR char_length(name) <= 60);

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
      class_id, common_items, quirks, accessories, creator_mode, created_at,
      pseudo_class_tagline, pseudo_class_description, aspiring_signatures, aspiring_abilities
    )
    SELECT
      record.creator_id, COALESCE(record.is_public, false), COALESCE(record.is_deceased, false), COALESCE(record.hide_from_search, false), COALESCE(record.auto_calculate, false),
      record.name, record.class, record.vitality, record.might, record.resilience, record.spirit, record.arcane, record.will, record.sensory,
      record.reflex, record.vigor, record.skill, record.intelligence, record.luck, record.mission_id, record.level,
      record.completed_missions, record.commissary_reward, record.appearance, record.additional_gear,
      record.image_url, record.image_crop, record.flavor, record.ideas, record.background, record.perks, record.private_notes,
      record.class_id, COALESCE(record.common_items, '[]'::jsonb), COALESCE(record.quirks, '[]'::jsonb), COALESCE(record.accessories, '[]'::jsonb), record.creator_mode, COALESCE(record.created_at, now()),
      record.pseudo_class_tagline, record.pseudo_class_description, COALESCE(record.aspiring_signatures, '[]'::jsonb), COALESCE(record.aspiring_abilities, '[]'::jsonb)
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
      creator_mode = record.creator_mode, created_at = record.created_at,
      pseudo_class_tagline = record.pseudo_class_tagline,
      pseudo_class_description = record.pseudo_class_description,
      aspiring_signatures = record.aspiring_signatures,
      aspiring_abilities = record.aspiring_abilities
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
      trait_item->>'stat' AS stat,
      row_number() OVER (PARTITION BY trait_item->>'name' ORDER BY ord) AS occ
    FROM jsonb_array_elements(COALESCE(p_traits, '[]'::jsonb)) WITH ORDINALITY AS t(trait_item, ord)
  ),
  existing AS (
    SELECT id, name, row_number() OVER (PARTITION BY name ORDER BY id) AS occ
    FROM public.traits WHERE character_id = saved.id
  ),
  matched AS (
    SELECT e.id, d.stat FROM existing e JOIN desired d USING (name, occ)
  ),
  deleted AS (
    DELETE FROM public.traits t
    WHERE t.character_id = saved.id
      AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.id = t.id)
  ),
  updated AS (
    UPDATE public.traits t SET stat = m.stat
    FROM matched m
    WHERE t.id = m.id AND t.stat IS DISTINCT FROM m.stat
  )
  INSERT INTO public.traits (character_id, name, stat)
  SELECT saved.id, d.name, d.stat FROM desired d
  WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.name = d.name AND e.occ = d.occ);

  IF p_gear IS NOT NULL THEN
    WITH desired AS (
      SELECT
        gear_item->>'name' AS name,
        (gear_item->>'class_id')::uuid AS class_id,
        gear_item->>'description' AS description,
        gear_item->'enchantment' AS enchantment,
        gear_item->'mods' AS mods,
        row_number() OVER (PARTITION BY (gear_item->>'class_id')::uuid, gear_item->>'name' ORDER BY ord) AS occ
      FROM jsonb_array_elements(p_gear) WITH ORDINALITY AS t(gear_item, ord)
    ),
    existing AS (
      SELECT id, name, class_id, row_number() OVER (PARTITION BY class_id, name ORDER BY id) AS occ
      FROM public.class_gear WHERE character_id = saved.id
    ),
    matched AS (
      SELECT e.id, d.description, d.enchantment, d.mods
      FROM existing e JOIN desired d USING (class_id, name, occ)
    ),
    deleted AS (
      DELETE FROM public.class_gear g
      WHERE g.character_id = saved.id
        AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.id = g.id)
    ),
    updated AS (
      UPDATE public.class_gear g SET
        description = m.description,
        enchantment = CASE WHEN m.enchantment IS NULL THEN g.enchantment ELSE NULLIF(m.enchantment, 'null'::jsonb) END,
        mods = COALESCE(m.mods, g.mods)
      FROM matched m
      WHERE g.id = m.id
        AND (g.description IS DISTINCT FROM m.description
          OR (m.enchantment IS NOT NULL AND g.enchantment IS DISTINCT FROM NULLIF(m.enchantment, 'null'::jsonb))
          OR (m.mods IS NOT NULL AND g.mods IS DISTINCT FROM m.mods))
    )
    INSERT INTO public.class_gear (character_id, name, class_id, description, enchantment, mods)
    SELECT saved.id, d.name, d.class_id, d.description,
           NULLIF(d.enchantment, 'null'::jsonb),
           COALESCE(d.mods, '[]'::jsonb)
    FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM existing e WHERE e.class_id = d.class_id AND e.name = d.name AND e.occ = d.occ
    );
  END IF;

  IF p_abilities IS NOT NULL THEN
    WITH desired AS (
      SELECT
        ability_item->>'name' AS name,
        (ability_item->>'class_id')::uuid AS class_id,
        row_number() OVER (PARTITION BY (ability_item->>'class_id')::uuid, ability_item->>'name' ORDER BY ord) AS occ
      FROM jsonb_array_elements(p_abilities) WITH ORDINALITY AS t(ability_item, ord)
    ),
    existing AS (
      SELECT id, name, class_id, row_number() OVER (PARTITION BY class_id, name ORDER BY id) AS occ
      FROM public.class_abilities WHERE character_id = saved.id
    )
    DELETE FROM public.class_abilities a
    WHERE a.character_id = saved.id
      AND NOT EXISTS (
        SELECT 1 FROM existing e JOIN desired d USING (class_id, name, occ) WHERE e.id = a.id
      );

    WITH desired AS (
      SELECT
        ability_item->>'name' AS name,
        (ability_item->>'class_id')::uuid AS class_id,
        ability_item->>'description' AS description,
        ability_item->>'type' AS type,
        row_number() OVER (PARTITION BY (ability_item->>'class_id')::uuid, ability_item->>'name' ORDER BY ord) AS occ
      FROM jsonb_array_elements(p_abilities) WITH ORDINALITY AS t(ability_item, ord)
    ),
    existing AS (
      SELECT id, name, class_id, row_number() OVER (PARTITION BY class_id, name ORDER BY id) AS occ
      FROM public.class_abilities WHERE character_id = saved.id
    ),
    matched AS (
      SELECT e.id, d.description, d.type FROM existing e JOIN desired d USING (class_id, name, occ)
    ),
    updated AS (
      UPDATE public.class_abilities a SET description = m.description, type = COALESCE(m.type, a.type)
      FROM matched m
      WHERE a.id = m.id
        AND (a.description IS DISTINCT FROM m.description
          OR (m.type IS NOT NULL AND a.type IS DISTINCT FROM m.type))
    )
    INSERT INTO public.class_abilities (character_id, name, class_id, description, type)
    SELECT saved.id, d.name, d.class_id, d.description, COALESCE(d.type, 'core') FROM desired d
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
        NULLIF(btrim(perk_item->>'name'), '') AS name,
        perk_item->>'text' AS text,
        COALESCE((perk_item->>'position')::integer, 0) AS position,
        ord
      FROM jsonb_array_elements(p_perks) WITH ORDINALITY AS t(perk_item, ord)
    ),
    desired AS (
      SELECT
        class_ability_id, name, text, position,
        row_number() OVER (PARTITION BY class_ability_id, position ORDER BY ord) AS occ
      FROM resolved
    ),
    existing AS (
      SELECT id, class_ability_id, position,
        row_number() OVER (PARTITION BY class_ability_id, position ORDER BY id) AS occ
      FROM public.character_perks WHERE character_id = saved.id
    ),
    matched AS (
      SELECT e.id, d.name, d.text FROM existing e JOIN desired d USING (class_ability_id, position, occ)
    ),
    deleted AS (
      DELETE FROM public.character_perks cp
      WHERE cp.character_id = saved.id
        AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.id = cp.id)
    ),
    updated AS (
      UPDATE public.character_perks cp SET text = m.text, name = m.name
      FROM matched m
      WHERE cp.id = m.id AND (cp.text IS DISTINCT FROM m.text OR cp.name IS DISTINCT FROM m.name)
    )
    INSERT INTO public.character_perks (character_id, class_ability_id, name, text, position)
    SELECT saved.id, d.class_ability_id, d.name, d.text, d.position FROM desired d
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
      INSERT INTO public.character_perks (character_id, class_ability_id, name, text, position)
      VALUES (
        saved.id,
        (item->>'class_ability_id')::uuid,
        NULLIF(btrim(item->>'name'), ''),
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
