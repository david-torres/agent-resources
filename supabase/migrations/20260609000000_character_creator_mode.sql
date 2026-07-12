-- creator_mode records which wizard ("advent", "aspiring", "aspirant")
-- produced the character. NULL for characters built in Expert Mode or
-- imported from older data.

ALTER TABLE public.characters
    ADD COLUMN IF NOT EXISTS creator_mode TEXT
        CHECK (creator_mode IS NULL OR creator_mode IN ('advent', 'aspiring', 'aspirant'));
