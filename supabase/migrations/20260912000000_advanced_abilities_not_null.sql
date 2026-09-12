-- 20260817000000 added advanced_abilities nullable. Every other class-content
-- column (`examples`, `stat_spread`, `gear`, `abilities`) is NOT NULL with an
-- empty default, and the divergence is invisible at runtime because a null
-- normalizes to [] on the way out -- so it can only be caught here.
--
-- The column now holds the same contract as `abilities`, not the
-- {name, description}[] the original comment described: an Aspirant class's
-- three Advanced Abilities carry paired actions, meters, notes and sample
-- perks exactly as its Core Abilities do.
UPDATE public.classes
SET advanced_abilities = '[]'::jsonb
WHERE advanced_abilities IS NULL;

ALTER TABLE public.classes
    ALTER COLUMN advanced_abilities SET DEFAULT '[]'::jsonb,
    ALTER COLUMN advanced_abilities SET NOT NULL;
