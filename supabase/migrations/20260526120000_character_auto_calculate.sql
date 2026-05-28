-- Persist the user's "auto-calculate from mission log" preference per character.
-- Default false: existing characters keep their manually-entered values until the user opts in.
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS auto_calculate BOOLEAN NOT NULL DEFAULT FALSE;
