-- A character holds at most one Defining Quirk, shaped { name, downside, upside? }.
-- A legacy quirk with no description keeps its name as the downside so it stays valid.
UPDATE characters
SET quirks = jsonb_build_array(
  jsonb_build_object(
    'name', quirks->0->>'name',
    'downside', COALESCE(NULLIF(TRIM(quirks->0->>'description'), ''), quirks->0->>'name')
  )
)
WHERE jsonb_array_length(quirks) > 0;
