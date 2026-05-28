-- v2 character extensions. Additive: v1 characters leave these at defaults
-- (0 and []) and the v1 form/view never reads or writes them.

ALTER TABLE public.characters
    ADD COLUMN IF NOT EXISTS conduit_credits INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quirks      JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS accessories JSONB NOT NULL DEFAULT '[]'::jsonb;
