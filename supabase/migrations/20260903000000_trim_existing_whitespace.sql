-- supabase/migrations/20260903000000_trim_existing_whitespace.sql
-- 242 values carry leading/trailing whitespace, and it is not cosmetic: the
-- character sheet joins its stored item names against classes.abilities/gear by
-- exact string, so `Training Weights ` in the class row and `Training Weights`
-- on the character row silently render 43 rows with no description at all.
-- Every affected value was inspected; none has meaningful leading whitespace.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text', 'character varying')
      AND c.is_updatable = 'YES'
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = btrim(%I) WHERE %I IS NOT NULL AND %I <> btrim(%I)',
      r.table_name, r.column_name, r.column_name,
      r.column_name, r.column_name, r.column_name);
  END LOOP;
END $$;

-- The JSONB item arrays are the ones that actually break rendering. Rebuilt
-- with ORDINALITY because gear order is load-bearing: positions 1-3 are Base
-- gear and 4-6 Elective.
UPDATE public.classes SET abilities = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN jsonb_typeof(e) = 'object'
      THEN e || jsonb_strip_nulls(jsonb_build_object(
             'name', btrim(e->>'name'), 'description', btrim(e->>'description')))
      ELSE e END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(abilities) WITH ORDINALITY AS t(e, ord))
WHERE abilities IS NOT NULL AND jsonb_typeof(abilities) = 'array';

UPDATE public.classes SET gear = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN jsonb_typeof(e) = 'object'
      THEN e || jsonb_strip_nulls(jsonb_build_object(
             'name', btrim(e->>'name'), 'description', btrim(e->>'description')))
      ELSE e END ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(gear) WITH ORDINALITY AS t(e, ord))
WHERE gear IS NOT NULL AND jsonb_typeof(gear) = 'array';
