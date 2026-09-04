-- The pre-release bundle carries far more per-class structure than three
-- markdown blobs can hold. These columns are the fields the document actually
-- prints; ability and signature metadata rides in the existing JSONB arrays.
ALTER TABLE public.classes
    ADD COLUMN IF NOT EXISTS challenge_level    text,
    ADD COLUMN IF NOT EXISTS stat_line          text,
    ADD COLUMN IF NOT EXISTS stat_note          text,
    ADD COLUMN IF NOT EXISTS quote              text,
    ADD COLUMN IF NOT EXISTS quote_source       text,
    ADD COLUMN IF NOT EXISTS overview           text,
    ADD COLUMN IF NOT EXISTS conduit_notes      text,
    ADD COLUMN IF NOT EXISTS grounding          text,
    ADD COLUMN IF NOT EXISTS examples_heading   text,
    ADD COLUMN IF NOT EXISTS examples           jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS tips_heading       text,
    ADD COLUMN IF NOT EXISTS designer           text,
    ADD COLUMN IF NOT EXISTS prerelease_section text;

ALTER TABLE public.classes
    DROP CONSTRAINT IF EXISTS classes_challenge_level_check;
ALTER TABLE public.classes
    ADD CONSTRAINT classes_challenge_level_check
    CHECK (challenge_level IS NULL OR challenge_level IN ('Low', 'Mid', 'High'));

-- The normalized enum, not the document's printed headings ('PCCs',
-- 'EXCLUSIVES', 'ASPIRANT CLASSES'). The loader maps heading to enum.
ALTER TABLE public.classes
    DROP CONSTRAINT IF EXISTS classes_prerelease_section_check;
ALTER TABLE public.classes
    ADD CONSTRAINT classes_prerelease_section_check
    CHECK (prerelease_section IS NULL OR prerelease_section IN ('pcc', 'exclusive', 'aspirant'));

-- Per-character ability metadata that nothing has ever read or written: a grep
-- for essence_cost across routes/ models/ services/ util/ views/ public/
-- returns no hits. The class-level `meters` array supersedes it and carries all
-- 49 labels the document uses, not three.
ALTER TABLE public.class_abilities
    DROP COLUMN IF EXISTS essence_cost,
    DROP COLUMN IF EXISTS cooldown,
    DROP COLUMN IF EXISTS duration;
