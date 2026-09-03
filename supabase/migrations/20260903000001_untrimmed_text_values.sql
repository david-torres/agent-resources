-- Backs util/whitespace-integrity.integration.test.js. There is no CHECK
-- constraint enforcing trimmed input -- normalization happens in the
-- application input layer only -- so this function, walked by the test on
-- every integration run, is the entire guard against a future write path
-- that skips it.
--
-- Walks information_schema exactly as Task 7's cleanup migration did, plus
-- the two JSONB item-name arrays that scalar-column scanning alone would
-- have missed (the defect that started this whole effort).
CREATE OR REPLACE FUNCTION public.untrimmed_text_values()
RETURNS TABLE(table_name text, column_name text, offending_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  cnt bigint;
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
      'SELECT count(*) FROM public.%I WHERE %I IS NOT NULL AND %I <> btrim(%I)',
      r.table_name, r.column_name, r.column_name, r.column_name)
      INTO cnt;
    IF cnt > 0 THEN
      table_name := r.table_name;
      column_name := r.column_name;
      offending_rows := cnt;
      RETURN NEXT;
    END IF;
  END LOOP;

  SELECT count(*) INTO cnt
  FROM public.classes cl, jsonb_array_elements(cl.abilities) e
  WHERE cl.abilities IS NOT NULL AND jsonb_typeof(cl.abilities) = 'array'
    AND jsonb_typeof(e) = 'object'
    AND (e->>'name') IS NOT NULL AND (e->>'name') <> btrim(e->>'name');
  IF cnt > 0 THEN
    table_name := 'classes';
    column_name := 'abilities';
    offending_rows := cnt;
    RETURN NEXT;
  END IF;

  SELECT count(*) INTO cnt
  FROM public.classes cl, jsonb_array_elements(cl.gear) e
  WHERE cl.gear IS NOT NULL AND jsonb_typeof(cl.gear) = 'array'
    AND jsonb_typeof(e) = 'object'
    AND (e->>'name') IS NOT NULL AND (e->>'name') <> btrim(e->>'name');
  IF cnt > 0 THEN
    table_name := 'classes';
    column_name := 'gear';
    offending_rows := cnt;
    RETURN NEXT;
  END IF;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.untrimmed_text_values() TO service_role;
