-- The free_access column was introduced with a false default, but the
-- existing free Quickstart and Aspirant keyword glossary PDFs were never
-- marked free. The library and PDF viewer both rely on this flag for access
-- without an unlock.
UPDATE rules_pdfs
SET free_access = true
WHERE free_access = false
  AND (
    title ~* 'quick[[:space:]-]*start'
    OR title ~* 'keyword[[:space:]-]*glossary'
    OR (title ~* 'aspirant' AND title ~* 'glossary')
  );
