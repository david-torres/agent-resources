-- Homepage dashboard recency: characters and missions carry no timestamps, so
-- the homepage feeds have nothing to sort by. Add them, backfill what history
-- allows, and let the existing update_updated_at_column() trigger maintain
-- updated_at from here on. A trigger rather than application writes because
-- character writes go through save_character_atomic / level_up_character_atomic,
-- which application code does not intercept.

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Missions carry their own session date. It can be in the future (a scheduled
-- session), so clamp: a row must never claim to have been created later than now.
UPDATE public.missions
SET created_at = LEAST(date, now()),
    updated_at = LEAST(date, now());

-- Characters have no date of their own. Derive a plausible span from the
-- missions they appear in: first mission ~ when they were made, last mission ~
-- when they were last touched. Characters with no missions keep the DEFAULT now().
WITH span AS (
  SELECT mc.character_id,
         LEAST(min(m.date), now()) AS first_seen,
         LEAST(max(m.date), now()) AS last_seen
  FROM public.mission_characters mc
  JOIN public.missions m ON m.id = mc.mission_id
  GROUP BY mc.character_id
)
UPDATE public.characters c
SET created_at = span.first_seen,
    updated_at = GREATEST(span.first_seen, span.last_seen)
FROM span
WHERE span.character_id = c.id;

DROP TRIGGER IF EXISTS update_characters_updated_at ON public.characters;
CREATE TRIGGER update_characters_updated_at
    BEFORE UPDATE ON public.characters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_missions_updated_at ON public.missions;
CREATE TRIGGER update_missions_updated_at
    BEFORE UPDATE ON public.missions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Access patterns for the four homepage feeds. Partial indexes because the
-- community feeds only ever read public, non-hidden rows.
CREATE INDEX IF NOT EXISTS idx_characters_public_recent
    ON public.characters (updated_at DESC)
    WHERE is_public AND NOT hide_from_search;

CREATE INDEX IF NOT EXISTS idx_missions_public_recent
    ON public.missions (updated_at DESC)
    WHERE is_public;

CREATE INDEX IF NOT EXISTS idx_characters_creator_recent
    ON public.characters (creator_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_missions_creator_recent
    ON public.missions (creator_id, updated_at DESC);

-- News reuses the pages CMS rather than growing a parallel table: pages already
-- has markdown content, is_published, access_level, timestamps, an admin editor,
-- slug routing, and RLS.
ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS is_news boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pages_news_recent
    ON public.pages (created_at DESC)
    WHERE is_news AND is_published;
