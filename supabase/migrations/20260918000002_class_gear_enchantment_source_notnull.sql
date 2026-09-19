-- `enchantment->>'source'` is SQL NULL when `enchantment` has no `source` key
-- or `source` is JSON null, and a CHECK that evaluates to NULL is treated as
-- satisfied rather than failed -- so `{}`, `{"name":"Foo"}` and
-- `{"source":null}` all passed class_gear_enchantment_source_check with no
-- source at all. class_gear_custom_enchantment_named_check leaked the same way
-- for `{}` and `{"source":null}`, but not for `{"name":"Foo"}`: that one
-- satisfies it outright on the name branch. coalesce() turns the NULL into a
-- plain string first so each comparison evaluates to TRUE or FALSE, never
-- NULL.
ALTER TABLE public.class_gear DROP CONSTRAINT class_gear_enchantment_source_check;
ALTER TABLE public.class_gear
  ADD CONSTRAINT class_gear_enchantment_source_check
  CHECK (
    enchantment IS NULL
    OR (
      jsonb_typeof(enchantment) = 'object'
      AND coalesce(enchantment->>'source', '') IN ('default', 'custom')
    )
  );

ALTER TABLE public.class_gear DROP CONSTRAINT class_gear_custom_enchantment_named_check;
ALTER TABLE public.class_gear
  ADD CONSTRAINT class_gear_custom_enchantment_named_check
  CHECK (
    enchantment IS NULL
    OR coalesce(enchantment->>'source', '') <> 'custom'
    OR length(btrim(coalesce(enchantment->>'name', ''))) > 0
  );
