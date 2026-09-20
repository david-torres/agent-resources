-- The three Signature Items an Aspiring character's invented Class is made of
-- (ENCLAVE: Aspirant V1, pg. 90: they "are treated as belonging to your Class
-- for the purposes of acquisition and improvement").
--
-- A pool on the character rather than a flag on class_gear. Reconciliation is
-- name-keyed, so a rename is a delete plus an insert and a per-row flag would
-- die with the row. More importantly the two facts differ: this is what the
-- character may buy at the own-class rate, not what it currently owns. Selling
-- a pick and buying it back must not reprice it from 2 Merx to 3.
--
-- Empty for every other character. The creator_mode clause is what stops this
-- becoming a second, contradictory answer to "is this Signature own-class?"
-- for a character that already has a class_id.
ALTER TABLE public.characters
  ADD COLUMN aspiring_signatures jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.characters
  ADD CONSTRAINT characters_aspiring_signatures_check
  CHECK (
    jsonb_typeof(aspiring_signatures) = 'array'
    AND jsonb_array_length(aspiring_signatures) <= 3
    AND (creator_mode IS NOT DISTINCT FROM 'aspiring' OR jsonb_array_length(aspiring_signatures) = 0)
    -- The .type() == "string" checks are load-bearing, not redundant: in lax
    -- jsonpath mode, like_regex against a non-string value errors internally
    -- and that error is suppressed rather than raised, which silently drops
    -- the offending array element from the filter instead of flagging it.
    -- Without the type guard a numeric class_id would pass this check.
    AND NOT jsonb_path_exists(
      aspiring_signatures,
      '$[*] ? (!(@.class_id.type() == "string" && @.class_id like_regex "\\S"
             && @.name.type() == "string" && @.name like_regex "\\S"))'
    )
  );
