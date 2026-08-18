-- rules_edition says which ruleset a book BELONGS TO; it does not say that
-- the book confers that ruleset's six core classes. A supplement, GM screen,
-- or adventure module for Advent is legitimately rules_edition 'advent' and
-- must grant nothing. book_type separates those two facts: only 'core'
-- confers the roster (services/rules/repository.js#fetchActiveBooksForUser).
--
-- The 'supplement' default is load-bearing, not incidental: a book grants
-- nothing until someone marks it core, so this migration cannot hand out
-- classes to existing rows by accident.
ALTER TABLE rules_pdfs
    ADD COLUMN IF NOT EXISTS book_type text NOT NULL
        CHECK (book_type IN ('core', 'supplement'))
        DEFAULT 'supplement';

-- The starter Advent book is promoted by its production-pinned id
-- (util/starter-content.js#STARTER_RULES_PDF_ID) so a retitled row cannot
-- silently stay a supplement; titles are admin free text. Aspirant has no
-- pinned id, so exact title is the best available key — deliberately not
-- ILIKE, since over-matching would hand out classes.
UPDATE rules_pdfs
SET book_type = 'core'
WHERE id = 'a10948ac-5f78-481f-9e53-c582b59926cd'
   OR title IN ('Enclave: Advent', 'Enclave: Aspirant');
