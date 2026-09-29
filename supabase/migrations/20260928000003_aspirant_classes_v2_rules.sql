-- classes.rules_version names the character-rules generation a class's
-- characters are built under. ENCLAVE: Aspirant V1 builds on Advent v2 -- its
-- characters carry a Defining Quirk, Accessories, Ability Perks and the v2
-- level curve -- so every aspirant-format class is 'v2'.
--
-- No unique index involves rules_version; the only constraint is the v1/v2
-- CHECK. save_character_atomic and level_up_character_atomic do not read it.
--
-- Matches only rows not already at 'v2', so a second run changes nothing.

-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. Recording which rules these classes follow is not an
-- edit to them, so it must not surface them as recent activity.
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;

UPDATE public.classes
SET rules_version = 'v2'
WHERE content_format = 'aspirant'
  AND rules_version IS DISTINCT FROM 'v2';

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
