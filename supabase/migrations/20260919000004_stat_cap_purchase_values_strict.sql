-- 20260919000001's characters_stat_cap_purchase_values used a LAX JSONPath
-- (`$.*`, lax being the default). Lax mode unwraps an array before applying a
-- filter predicate, so `{"might": [1]}` was storable: the predicate saw only the
-- non-negative integer inside, and the array itself was never tested. Confirmed
-- against this database:
--
--   jsonb_path_exists('{"might":[1]}', '$.* ? (@.type() != "number" || ...)')        -> f
--   jsonb_path_exists('{"might":[1]}', 'strict $.* ? (@.type() != "number" || ...)') -> t
--
-- `strict` disables that unwrapping, so an array value is tested on its own
-- type and refused. Every shape the original constraint already caught is
-- unchanged: a JSON null, a negative, a fraction, a string and a nested object
-- all still match, and `{}` still matches nothing.
--
-- No live path writes this column today -- the purchase surface is still owed by
-- the Merx slice (see 20260919000001's header) -- and no stored row is
-- non-empty, so there is nothing to migrate. The constraint should mean what it
-- says regardless.
--
-- A new migration rather than an edit to 20260919000001: that file is already
-- applied, and editing an applied migration changes nothing.
--
-- The CASE is load-bearing. Strict mode RAISES on `$.*` over a non-object
-- ("jsonpath wildcard member accessor can only be applied to an object")
-- instead of returning false, which would turn a non-object write from an
-- ordinary check_violation into a jsonpath error. SQL does not guarantee the
-- evaluation order of OR's operands, so the type test has to be a construct
-- that does. A non-object is still refused, by
-- characters_stat_cap_purchase_keys, which requires jsonb_typeof = 'object'.
ALTER TABLE public.characters DROP CONSTRAINT characters_stat_cap_purchase_values;

ALTER TABLE public.characters ADD CONSTRAINT characters_stat_cap_purchase_values CHECK (
  CASE WHEN jsonb_typeof(stat_cap_purchases) = 'object' THEN
    NOT jsonb_path_exists(
      stat_cap_purchases,
      'strict $.* ? (@.type() != "number" || @ < 0 || @ != @.floor())'
    )
  ELSE true END
);
