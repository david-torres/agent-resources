-- supabase/migrations/20260904000002_drop_class_description.sql
--
-- The prose this held now lives in quote/overview/conduit_notes/grounding/
-- examples. Keeping an assembled copy beside them would drift the first time
-- an admin edited one and not the other.
--
-- But only the 19 classes the pre-release loader writes have those columns
-- filled. Every one of the 47 pre-branch classes carries a non-empty
-- `description` and nothing else, so dropping the column without moving the
-- text first leaves 31 classes -- 30 of them public, 12 at status 'release',
-- Gunslinger and Librarian and Thunderbird among them -- with a NULL
-- `overview` and no prose at all: views/class-view.handlebars gates the whole
-- block on `{{#or ...}}`, so those pages render an empty card.
--
-- `overview` is the column that replaced the body of `description`, so that is
-- where the text goes. The other twelve stay NULL: an assembled description
-- cannot be split into quote/grounding/examples by a migration, and guessing
-- at the boundaries would be worse than leaving them empty for an admin to
-- fill in deliberately.
--
-- It has to live in THIS migration, before the ALTER, rather than in a
-- later-numbered one: on a fresh apply a later migration runs after the column
-- is already gone and has nothing left to copy.
--
-- `overview IS NULL` is the needs-changing predicate: a class the loader has
-- written, or an admin has since edited, is never overwritten. Re-running the
-- migration is safe -- the second run finds no NULL `overview` left to fill,
-- and the guard below means it does not even look once the column is gone. An
-- unguarded UPDATE naming a dropped column fails at parse time; it does not
-- quietly match nothing.
--
-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. This moves prose the class already had from one column
-- to another; it does not edit a class, so it must not bury real recent
-- activity under its own timestamp -- the same discipline
-- 20260904000001_backfill_gear_category.sql applies.
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;

DO $backfill$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'classes'
           AND column_name = 'description'
    ) THEN
        EXECUTE $sql$
            UPDATE public.classes
               SET overview = description
             WHERE overview IS NULL
               AND description IS NOT NULL
               AND btrim(description) <> ''
        $sql$;
    END IF;
END
$backfill$;

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;

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
