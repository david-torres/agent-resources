-- The six Aspirant core classes were created in production before
-- classes.rules_edition distinguished rulesets, so they carry the 'advent'
-- default. Retag them by id: the core-roster resolver (util/book-classes.js)
-- and version-family expansion (util/class-family.js) both key on
-- rules_edition, so a wrong tag would let an Aspirant book grant nothing and
-- let family expansion bridge the two rulesets through these rows.
-- No-op on databases without these rows (fresh local seeds already create
-- them tagged 'aspirant').
-- Any version fork made before this retag (dup_class copies the parent's
-- rules_edition by default) also carries 'advent'; retagging only the six
-- parents would sever those forks from their families, since family edges
-- require matching rules_edition on both ends. Walk the still-'advent'
-- descendant chains and retag them with their parents in one statement.
WITH RECURSIVE aspirant_family AS (
    SELECT id
    FROM classes
    WHERE id IN (
        '3c8f036f-06f0-4f72-9336-aa9c3fdd5541', -- Berserker
        '42d39b55-7db1-49a1-a53b-b1cd5fc9bc47', -- Freerunner
        'c687840c-a781-4d46-9570-b344e1b9be04', -- Infiltrator
        'f0726c9b-bfaf-4c22-9318-75c50c8e3cbf', -- Samaritan
        '3a863d9c-8454-4326-87ad-ed105fccbbd4', -- Vessel
        '79721ac8-378e-4b3e-b1e3-8266689da89e'  -- Witchhunter
    )
    UNION
    SELECT c.id
    FROM classes c
    JOIN aspirant_family f ON c.base_class_id = f.id
    WHERE c.rules_edition = 'advent'
)
UPDATE classes
SET rules_edition = 'aspirant'
WHERE id IN (SELECT id FROM aspirant_family);
