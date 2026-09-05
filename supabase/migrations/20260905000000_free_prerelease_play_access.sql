-- The creator now publishes every class in the August 2026 pre-release
-- bundle as free, playable plaintext. This is deliberately narrower than a
-- class unlock: direct/book entitlements may also grant a class PDF, while a
-- pre-release grant never does.
ALTER TABLE public.classes
    ADD COLUMN IF NOT EXISTS free_play_access boolean NOT NULL DEFAULT false;

-- prerelease_section is stamped only by the reviewed bundle import. Keep the
-- policy on the individual rows so a future Aspirant/published fork does not
-- inherit free access through its version family.
UPDATE public.classes
SET free_play_access = true
WHERE prerelease_section IN ('pcc', 'exclusive', 'aspirant');
