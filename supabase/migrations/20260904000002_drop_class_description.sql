-- The prose this held now lives in quote/overview/conduit_notes/grounding/
-- examples. Keeping an assembled copy beside them would drift the first time
-- an admin edited one and not the other.
ALTER TABLE public.classes DROP COLUMN IF EXISTS description;

-- DROP COLUMN does not rewrite a plpgsql body, so dup_class survives the ALTER
-- above still naming `description` and fails at call time. Recreated here with
-- the copy list corrected: the function names its columns explicitly and
-- omitted all thirteen structured prose columns, so duplicating a class
-- silently dropped every field the pre-release import wrote. Four non-prose
-- columns were missing too -- `teaser`, `tips`, `stat_spread` and
-- `visibility`. `stat_spread` is the costly one: a fork landing `{}` offers
-- zero stat points in the character wizard's step 2. `tips` was copied by the
-- baseline function and lost when 20260525000003 rewrote it.
--
-- pdf_storage_path/pdf_updated_at are deliberately NOT copied: class PDFs are
-- unlock-gated on the row's own id and this function sets created_by to the
-- duplicator, so copying the path would hand a fork's creator an
-- unconditional signed URL to a PDF they never unlocked.
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
        prerelease_section
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
        prerelease_section
    FROM classes
    WHERE id = base_id
    RETURNING id INTO new_class_id;

    RETURN new_class_id;
END;
$$;
