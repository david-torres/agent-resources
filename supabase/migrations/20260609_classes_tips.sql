-- classes.tips holds optional play-tips text shown on the class page and
-- surfaced to the character wizard. Additive: existing rows get NULL.

ALTER TABLE public.classes
    ADD COLUMN IF NOT EXISTS tips text;
