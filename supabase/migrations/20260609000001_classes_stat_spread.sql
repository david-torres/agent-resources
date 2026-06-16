-- classes.stat_spread holds the { stat -> points } map the character wizard
-- uses to populate step 2. Storing it on the class row removes the need to
-- backfill it from util/enclave-consts at request time.

ALTER TABLE public.classes
    ADD COLUMN IF NOT EXISTS stat_spread JSONB NOT NULL DEFAULT '{}'::jsonb;
