-- rules_pdfs.edition holds the VERSION ('v1', 'v2'); the ruleset a book
-- covers lived only inside its title string. Book-derived class unlocks need
-- the ruleset as data, so name it in its own column.
ALTER TABLE rules_pdfs
    ADD COLUMN IF NOT EXISTS rules_edition text NOT NULL
        CHECK (rules_edition IN ('advent', 'aspirant'))
        DEFAULT 'advent';

-- Backfill from the title for rows created before the column existed. The
-- DEFAULT already covers them as 'advent'; this only corrects Aspirant books.
UPDATE rules_pdfs
SET rules_edition = 'aspirant'
WHERE title ILIKE '%aspirant%';
