-- classes.advanced_abilities holds the {name, description}[] list of advanced
-- abilities shown by the character wizard's step 3 primer in aspirant and
-- aspiring modes (advent mode keeps using the existing `abilities` column).
-- Additive: existing rows default to an empty array, matching the shape of
-- the sibling `abilities` column.

ALTER TABLE public.classes
    ADD COLUMN IF NOT EXISTS advanced_abilities JSONB DEFAULT '[]'::jsonb;