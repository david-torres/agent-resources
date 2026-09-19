-- ENCLAVE: Aspirant, pg. 3: two pluses may be spent outright for +1 Stat Cap.
-- A character's Cap for a Stat is therefore BASE_STAT_CAP, plus one per Trait
-- affiliated with that Stat, plus whatever was bought here
-- (util/stat-caps.js statCapFor).
--
-- One jsonb map rather than twelve more integer columns: util/enclave-consts.js
-- statList exists to paper over the twelve stat columns public.characters
-- already carries, and doubling them would widen every read and write site for
-- no gain.
--
-- The purchase SURFACE is not built in this slice -- spending needs a caller
-- that knows a character's mission-earned Merx, which the Merx slice's plan 2
-- still owes. This column is where that purchase will land, and it is what
-- makes the Cap derivation complete today.
ALTER TABLE public.characters
  ADD COLUMN stat_cap_purchases jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Both constraints must hold for EVERY storable value, including an empty
-- object and a key whose value is JSON null. A CHECK that evaluates to NULL
-- PASSES, so neither may be written as a bare comparison against
-- `value->>'key'`: that is exactly how a free Enchantment became storable in
-- 20260918000000, fixed in 20260918000002.
--
-- Postgres refuses ANY subquery inside a CHECK constraint, including
-- `NOT EXISTS (SELECT ... FROM jsonb_object_keys(...))` -- confirmed against
-- this database with `ERROR: cannot use subquery in check constraint
-- (SQLSTATE 0A000)`. Both constraints below are instead single expressions
-- built from jsonb operators and jsonb_path_exists(), which take the whole
-- column as one argument rather than selecting FROM it, so there is no
-- subquery to reject.
--
-- `stat_cap_purchases - ARRAY[...]` removes every allowed key from the
-- object; anything left over is an unrecognized key. Total by construction:
-- for any object jsonb value, including {}, `-` and `=` are ordinary
-- operators that always yield TRUE or FALSE, never NULL.
ALTER TABLE public.characters ADD CONSTRAINT characters_stat_cap_purchase_keys CHECK (
  jsonb_typeof(stat_cap_purchases) = 'object'
  AND (stat_cap_purchases - ARRAY[
    'vitality','might','resilience','spirit','arcane','will',
    'sensory','reflex','vigor','skill','intelligence','luck'
  ]::text[]) = '{}'::jsonb
);

-- jsonb_path_exists() reports whether any value in the object matches the
-- filter predicate -- true if any value is not a number, is negative, or is
-- not its own floor (i.e. not an integer). JSONPath's `@.type()` reports a
-- JSON null value's type as the string 'null', which is never equal to
-- 'number', so `{"might": null}` is caught here rather than slipping through
-- as SQL NULL the way `enchantment->>'source'` did.
ALTER TABLE public.characters ADD CONSTRAINT characters_stat_cap_purchase_values CHECK (
  NOT jsonb_path_exists(
    stat_cap_purchases,
    '$.* ? (@.type() != "number" || @ < 0 || @ != @.floor())'
  )
);
