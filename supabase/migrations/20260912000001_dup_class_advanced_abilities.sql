-- dup_class names its columns explicitly, so every column added after it was
-- last rewritten is dropped by the fork. advanced_abilities (20260817000004)
-- and free_play_access (20260905000000) were both lost this way. Adding
-- content to advanced_abilities is what makes the loss visible, so both are
-- repaired together.
--
-- free_play_access is copied rather than reset: it is a property of the class
-- the creator published, and 20260905000000 set it per-row precisely so that a
-- fork would not inherit it through its version family. A fork of a free class
-- is still that class's content.
CREATE OR REPLACE FUNCTION dup_class(new_id uuid, base_id uuid, new_version text, new_edition text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_class_id uuid;
    v_profile_id uuid;
BEGIN
    SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid() LIMIT 1;

    INSERT INTO classes (
        id,
        name,
        is_public,
        status,
        is_player_created,
        rules_edition,
        rules_version,
        base_class_id,
        created_by,
        gear,
        abilities,
        image_url,
        image_crop,
        teaser,
        tips,
        stat_spread,
        visibility,
        challenge_level,
        stat_line,
        stat_note,
        quote,
        quote_source,
        overview,
        conduit_notes,
        grounding,
        examples_heading,
        examples,
        tips_heading,
        designer,
        prerelease_section,
        advanced_abilities,
        free_play_access
    )
    SELECT
        new_id,
        name,
        is_public,
        status,
        is_player_created,
        COALESCE(new_edition, rules_edition),
        new_version,
        id,
        v_profile_id,
        gear,
        abilities,
        image_url,
        image_crop,
        teaser,
        tips,
        stat_spread,
        visibility,
        challenge_level,
        stat_line,
        stat_note,
        quote,
        quote_source,
        overview,
        conduit_notes,
        grounding,
        examples_heading,
        examples,
        tips_heading,
        designer,
        prerelease_section,
        advanced_abilities,
        free_play_access
    FROM classes
    WHERE id = base_id
    RETURNING id INTO new_class_id;

    RETURN new_class_id;
END;
$$;
