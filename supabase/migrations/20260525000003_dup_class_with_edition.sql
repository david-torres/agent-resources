-- Extend dup_class to optionally retarget the rules_edition. Existing
-- callers that pass only (new_id, base_id, new_version) keep working.
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
        description,
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
        image_crop
    )
    SELECT
        new_id,
        name,
        description,
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
        image_crop
    FROM classes
    WHERE id = base_id
    RETURNING id INTO new_class_id;

    RETURN new_class_id;
END;
$$;
