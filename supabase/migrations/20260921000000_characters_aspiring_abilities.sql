-- An aspiring character lists two Core Abilities and one Advanced Ability at
-- creation (ENCLAVE: Aspirant V1 pg. 90 steps 3 and 4). Those three "are
-- treated as belonging to your Class" for pricing, but the character "does not
-- start with them, instead paying 1 Perk each, though you do not need to
-- acquire them immediately (or at all)".
--
-- So the picks must persist WITHOUT being owned abilities, exactly as
-- aspiring_signatures does for Signature Items. class_abilities rows record
-- what the character owns; this column records what counts as its Class.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS aspiring_abilities jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE characters DROP CONSTRAINT IF EXISTS characters_aspiring_abilities_check;

-- Three things this predicate is careful about, each learned from the
-- aspiring_signatures constraint:
--
-- 1. `.type() == "string"` guards precede every like_regex. In lax mode
--    like_regex on a non-string raises internally, the error is suppressed and
--    the element is DROPPED from the result -- so an unguarded predicate
--    accepts class_id: 123 rather than rejecting it.
-- 2. `NOT (creator_mode IS DISTINCT FROM 'aspiring')` rather than
--    `creator_mode = 'aspiring' OR ...`. A CHECK is satisfied by NULL as well
--    as TRUE, and 318 of 327 rows have a NULL creator_mode, so the naive form
--    evaporates for almost the whole table.
-- 3. `@."type"` is quoted. Unquoted, `type` collides with jsonpath's own
--    .type() method.
--
-- The exact 2-core-plus-1-advanced shape is a validator rule, not a
-- constraint: the column must tolerate an in-progress payload that the
-- validator rejects with a message a player can read.
ALTER TABLE characters ADD CONSTRAINT characters_aspiring_abilities_check CHECK (
  jsonb_typeof(aspiring_abilities) = 'array'
  AND jsonb_array_length(aspiring_abilities) <= 3
  AND ((NOT (creator_mode IS DISTINCT FROM 'aspiring')) OR jsonb_array_length(aspiring_abilities) = 0)
  AND NOT jsonb_path_exists(aspiring_abilities,
    '$[*] ? (!(@.class_id.type() == "string" && @.class_id like_regex "\\S"
           && @.name.type() == "string" && @.name like_regex "\\S"
           && @."type".type() == "string"
           && (@."type" == "core" || @."type" == "advanced")))')
);

COMMENT ON COLUMN characters.aspiring_abilities IS
  'An aspiring character''s two Core and one Advanced Ability picks (pg. 90). Selected at creation, acquired later or never; owned abilities live in class_abilities.';
