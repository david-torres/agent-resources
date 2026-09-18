-- A character's Enchantment and Mods on a Signature it owns
-- (ENCLAVE: Aspirant V1, pp. 8, 86, 87).
--
-- Columns rather than a child table because the book caps both: "A Signature
-- may only hold one Enchantment" (pg. 8) and "up to two Mods" (pg. 87).
-- Reconciliation matches a class_gear row by class_id + name, so a rename is a
-- delete plus an insert; a child table keyed on class_gear.id would lose a
-- paid-for Enchantment to a rename.
--
-- `enchantment` stores its source, not the Default's text. The text lives on
-- the class (classes.gear[].default_enchantment) and
-- services/character/repository.js mergeClassItems already merges class content
-- onto character rows at read time, so an errata to a class's Default reaches
-- every character who unlocked it. It also makes "Default or Custom?" -- a
-- pricing input -- a stored fact rather than a text comparison.
ALTER TABLE public.class_gear
  ADD COLUMN enchantment jsonb,
  ADD COLUMN mods jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Only the two sources are priced (pg. 85), so a third would be a silent 0.
ALTER TABLE public.class_gear
  ADD CONSTRAINT class_gear_enchantment_source_check
  CHECK (
    enchantment IS NULL
    OR (
      jsonb_typeof(enchantment) = 'object'
      AND enchantment->>'source' IN ('default', 'custom')
    )
  );

-- A Custom Enchantment "should be given a thematic name for easy reference
-- during play" (pg. 86), and an unnamed one cannot be referred to at the table.
-- A Default needs no name of its own: it inherits the class's.
ALTER TABLE public.class_gear
  ADD CONSTRAINT class_gear_custom_enchantment_named_check
  CHECK (
    enchantment IS NULL
    OR enchantment->>'source' <> 'custom'
    OR length(btrim(coalesce(enchantment->>'name', ''))) > 0
  );

ALTER TABLE public.class_gear
  ADD CONSTRAINT class_gear_mods_shape_check
  CHECK (
    jsonb_typeof(mods) = 'array'
    AND jsonb_array_length(mods) <= 2
  );
