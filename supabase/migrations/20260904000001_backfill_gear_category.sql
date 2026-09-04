-- supabase/migrations/20260904000001_backfill_gear_category.sql
-- views/class-view.handlebars now splits Signature Gear into Base and Elective
-- by each item's `category` key. 186 gear items across 31 classes -- including
-- live `release` classes such as Gunslinger -- carry no `category` key at all,
-- so those pages render an empty Elective column.
--
-- Every one of the 31 has exactly six items, and the page used to split them
-- positionally (first three Base, last three Elective), so writing the category
-- by position reproduces byte-for-byte what those pages rendered before.

-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. This migration completes a data shape, it does not edit
-- a class, so it must not bury real recent activity under its own timestamp.
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;

-- The predicate is deliberately narrow: a row is rewritten only when EVERY one
-- of its six items is an uncategorised object. A row that already carries a
-- category anywhere -- or one whose gear is a different length -- is left
-- untouched rather than guessed at, because the positional split is only known
-- to be correct for the six-item shape it is reproducing.
--
-- Rebuilt with ORDINALITY and ORDER BY ord because order IS the semantic being
-- encoded here: jsonb_agg over an unordered scan would shuffle the items and
-- assign the categories to the wrong gear.
UPDATE public.classes SET gear = (
  SELECT jsonb_agg(
    e || jsonb_build_object('category',
      CASE WHEN ord <= 3 THEN 'default' ELSE 'elective' END)
    ORDER BY ord)
  FROM jsonb_array_elements(gear) WITH ORDINALITY AS t(e, ord))
WHERE gear IS NOT NULL
  AND jsonb_typeof(gear) = 'array'
  AND jsonb_array_length(gear) = 6
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(gear) e
    WHERE jsonb_typeof(e) <> 'object' OR jsonb_exists(e, 'category'));

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
