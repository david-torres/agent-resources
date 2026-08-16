-- Let a player correct their character's created_at. The value has to travel
-- through save_character_atomic, which is the only write path for the character
-- record -- an application-level UPDATE alongside the RPC would break atomicity.
--
-- The signature is unchanged: created_at rides in the existing p_character jsonb.
-- On UPDATE, jsonb_populate_record is seeded from `saved` (the pre-read row), so
-- an omitted created_at already resolves to the row's existing value.
--
-- This restates the whole function body rather than patching it. That is not
-- copy-paste drift: Postgres CREATE OR REPLACE FUNCTION has no partial form, so
-- redefining any part means redefining all of it, and every migration in this
-- repo that touches an RPC does the same.
--
-- The base for this restatement is 20260811000000_fix_save_character_atomic_update.sql,
-- NOT 20260710000000_atomic_character_writes.sql. 20260710000000 shipped a bug
-- in the UPDATE branch (`FROM jsonb_populate_record(current, p_character)`
-- referenced the UPDATE's own target alias, which Postgres rejects at
-- execution time), and 20260811000000 replaced the function to fix it. Copying
-- from 20260710000000 would silently re-latch that fixed function as the new
-- "latest" CREATE OR REPLACE and reintroduce the 500 on every character edit.
-- Exactly three lines differ from 20260811000000_fix_save_character_atomic_update.sql,
-- all of them created_at:
--   1. `created_at` appended to the INSERT column list
--   2. `COALESCE(record.created_at, now())` appended to the INSERT SELECT list
--   3. `created_at = record.created_at` appended to the UPDATE SET list
-- Everything else is byte-identical and must stay that way.

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

  DELETE FROM public.traits WHERE character_id = saved.id;
  INSERT INTO public.traits (character_id, name)
  SELECT saved.id, trait_item->>'name'
  FROM jsonb_array_elements(COALESCE(p_traits, '[]'::jsonb)) AS trait_item;

  IF p_gear IS NOT NULL THEN
    DELETE FROM public.class_gear WHERE character_id = saved.id;
    INSERT INTO public.class_gear (character_id, name, class_id, description)
    SELECT saved.id, gear_item->>'name', (gear_item->>'class_id')::uuid, gear_item->>'description'
    FROM jsonb_array_elements(p_gear) AS gear_item;
  END IF;

  IF p_abilities IS NOT NULL THEN
    DELETE FROM public.class_abilities WHERE character_id = saved.id;
    INSERT INTO public.class_abilities (character_id, name, class_id, description)
    SELECT saved.id, ability_item->>'name', (ability_item->>'class_id')::uuid, ability_item->>'description'
    FROM jsonb_array_elements(p_abilities) AS ability_item;
  END IF;

  IF p_perks IS NOT NULL THEN
    DELETE FROM public.character_perks WHERE character_id = saved.id;
    FOR item IN SELECT value FROM jsonb_array_elements(p_perks)
    LOOP
      ability_id := NULL;
      IF item ? 'class_ability_id' AND item->>'class_ability_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        ability_id := (item->>'class_ability_id')::uuid;
      END IF;
      IF ability_id IS NULL AND item ? 'ability_name' THEN
        SELECT id INTO ability_id FROM public.class_abilities
        WHERE character_id = saved.id AND name = item->>'ability_name'
        ORDER BY id LIMIT 1;
      END IF;
      INSERT INTO public.character_perks (character_id, class_ability_id, text, position)
      VALUES (saved.id, ability_id, item->>'text', COALESCE((item->>'position')::integer, 0));
    END LOOP;

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
