-- supabase/migrations/20260928000000_advent_core_teaser.sql
-- The six Advent core classes take the teaser their ENCLAVE: Aspirant V1
-- counterpart carries -- the first sentence of the book's class description --
-- on every version of their Advent family.
--
-- Unlike the challenge_level backfill this replaces an existing teaser: the
-- hand-written ones predate the book and are superseded by its wording. A row
-- already carrying the book's sentence is skipped, so a second run changes
-- nothing. A stack without these classes matches no row.

-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. Re-copying a teaser is not an edit to these classes,
-- so it must not surface them as recent activity.
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;

UPDATE public.classes AS c
SET teaser = book.teaser
FROM (VALUES
    ('Gunslinger',  'You are a jaunty gunman whose cool-headed gravitas is backed up by deadly firepower.'),
    ('Illusionist', 'You are a poised deceiver whose subtle enchantments warp others’ view of reality.'),
    ('Librarian',   'You are a resourceful bibliophile with troves of knowledge at your fingertips.'),
    ('Thane',       'You are a steadfast marshal who thrives on the front lines, rallying and outfitting your allies.'),
    ('Thunderbird', 'You are a dynamic bringer of storms, who wields thunder in one hand and lightning in the other.'),
    ('Wanderer',    'You are an eclectic globetrotter who has seen more places and met more faces than you can remember.')
) AS book(name, teaser)
WHERE c.name = book.name
  AND c.rules_edition = 'advent'
  AND c.is_player_created IS NOT TRUE
  AND c.prerelease_section IS NULL
  AND c.teaser IS DISTINCT FROM book.teaser;

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
