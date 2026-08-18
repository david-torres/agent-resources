-- Idempotence stamp for the starter (trial) grant. getProfile used to detect
-- a prior grant by probing class_unlocks, but starter classes now derive from
-- the rules_pdf_unlocks book row, so book-only users probed "empty" on every
-- request and the grant re-fired -- resurrecting admin-revoked starter books
-- with a fresh 30-day expiry. The guard now keys off this column alone:
-- grant once when null, stamp on success, never again.
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS starter_granted_at timestamptz;

-- Backfill: any user with a class or rules-PDF unlock row has already been
-- through a grant. Leaving them null would re-grant on their next request --
-- including users whose starter book an admin deliberately revoked.
UPDATE profiles
SET starter_granted_at = now()
WHERE starter_granted_at IS NULL
  AND (
    EXISTS (SELECT 1 FROM class_unlocks cu WHERE cu.user_id = profiles.user_id)
    OR EXISTS (SELECT 1 FROM rules_pdf_unlocks ru WHERE ru.user_id = profiles.user_id)
  );
