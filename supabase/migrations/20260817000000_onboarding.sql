-- First-time onboarding state and the free-quickstart access flag.
-- profiles.onboarding holds only what real data cannot answer:
--   path: 'new' | 'veteran'   dismissed: bool
--   read_rules: bool          redeemed: bool
ALTER TABLE profiles
    ADD COLUMN onboarding jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A free_access rules PDF is viewable by anyone, signed in or not
-- (the quickstart). All other PDFs keep the unlock requirement.
ALTER TABLE rules_pdfs
    ADD COLUMN free_access boolean NOT NULL DEFAULT false;
