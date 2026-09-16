-- dup_class names its columns explicitly, so every column added after it was
-- last rewritten is dropped by the fork. This revision adds content_format
-- (20260916000000) to both the INSERT and SELECT lists so a fork carries it.
--
-- content_format is copied unchanged, with no retarget parameter: forking a
-- class is a version fork, not a conversion of its content shape.
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
        content_format,
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
        content_format,
        free_play_access
    FROM classes
    WHERE id = base_id
    RETURNING id INTO new_class_id;

    RETURN new_class_id;
END;
$$;
