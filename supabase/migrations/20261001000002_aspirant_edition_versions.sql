-- Deploy edition-aware mechanics resolution before applying this metadata repair.
-- Version identifies the published edition, not its underlying mechanics.
BEGIN;
LOCK TABLE public.classes IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.classes WHERE rules_edition = 'aspirant'
    AND (rules_version NOT IN ('v1', 'v2') OR content_format NOT IN ('advent', 'aspirant'))) THEN
    RAISE EXCEPTION 'Unexpected Aspirant class identity; audit before migrating';
  END IF;
END $$;
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;
UPDATE public.classes SET rules_version = 'v1'
WHERE rules_edition = 'aspirant' AND rules_version = 'v2';
ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
-- Protect every writer, including dup_class and direct administrative inserts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_published_rules_identity'
    AND conrelid = 'public.classes'::regclass) THEN
    ALTER TABLE public.classes ADD CONSTRAINT classes_published_rules_identity
      CHECK ((rules_edition = 'advent' AND rules_version IN ('v1', 'v2'))
        OR (rules_edition = 'aspirant' AND rules_version = 'v1'));
  END IF;
END $$;
COMMIT;
