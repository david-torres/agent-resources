-- supabase/migrations/20260927000000_advent_core_challenge_level.sql
-- The six Advent core classes came in without a challenge_level. Each takes
-- the rating its ENCLAVE: Aspirant V1 counterpart carries, on every version
-- of its Advent family.
--
-- Only unrated rows are touched, so an admin's own rating survives and a
-- second run changes nothing. A stack without these classes matches no row.

-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. Backfilling a rating is not an edit to these classes,
-- so it must not surface them as recent activity.
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;

UPDATE public.classes AS c
SET challenge_level = rated.challenge_level
FROM (VALUES
    ('Gunslinger',  'Low'),
    ('Illusionist', 'Low'),
    ('Librarian',   'Mid'),
    ('Thane',       'Low'),
    ('Thunderbird', 'Low'),
    ('Wanderer',    'Mid')
) AS rated(name, challenge_level)
WHERE c.name = rated.name
  AND c.rules_edition = 'advent'
  AND c.is_player_created IS NOT TRUE
  AND c.challenge_level IS NULL;

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
