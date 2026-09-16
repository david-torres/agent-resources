-- The wizard has always sent a core/advanced tag on every aspiring ability
-- (public/js/character-wizard.js:3225,3228) but all three write paths projected
-- it away, so the distinction -- and with it the 4-Perk economy -- was
-- unrecoverable from the database.
--
-- The backfill is corrective rather than a blanket default: aspirant-mode
-- characters draw their abilities from the class's advanced_abilities, so
-- DEFAULT 'core' alone would leave every one of them mislabeled.
ALTER TABLE public.class_abilities
    ADD COLUMN type text NOT NULL DEFAULT 'core'
    CHECK (type IN ('core', 'advanced'));

UPDATE public.class_abilities a
SET type = 'advanced'
FROM public.classes c
WHERE a.class_id = c.id
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(c.advanced_abilities) AS adv
    WHERE adv->>'name' = a.name
  );
