-- supabase/migrations/20260922000000_prerelease_classes_v2.sql
-- A pre-release class (prerelease_section set) is the Enclave creator's teaser
-- of an upcoming product. It is released Advent-format content recorded at the
-- latest Advent version, so it carries rules_version 'v2' and status 'release';
-- alpha and beta belong only to unfinished player-created classes. A class the
-- pre-release document files under its PCC section is player-created.
--
-- Characters on these classes are not converted: their v1-only text
-- (characters.perks, characters.additional_gear) stays stored, hidden on the
-- sheet, and can only be cleared from the edit form.
--
-- Each UPDATE matches only rows not already in the target state, so a second
-- run changes nothing. A stack seeded by util/seed-classes.js carries no
-- prerelease_section, so there this matches no row at all.

-- updated_at is trigger-owned and services/home/recent-feed.js sorts the
-- homepage feeds by it. Recording what these classes already are is not an
-- edit to them, so it must not surface them as recent activity.
ALTER TABLE public.classes DISABLE TRIGGER update_classes_updated_at;

UPDATE public.classes
SET rules_version = 'v2', status = 'release'
WHERE prerelease_section IS NOT NULL
  AND (rules_version IS DISTINCT FROM 'v2' OR status IS DISTINCT FROM 'release');

UPDATE public.classes
SET is_player_created = true
WHERE prerelease_section = 'pcc'
  AND is_player_created IS NOT TRUE;

ALTER TABLE public.classes ENABLE TRIGGER update_classes_updated_at;
