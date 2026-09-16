-- rules_edition answers which book grants a class. It has been doing double
-- duty as the answer to what shape that class's content is, which held only
-- while the two coincided. The six pre-release Aspirant classes are where they
-- diverge: 20260818000000_retag_aspirant_classes.sql tagged them 'aspirant' so
-- the unlock resolver and the family firewall would reach them, but their
-- content is the Advent six-Signature shape.
--
-- 'advent' is six Signatures and three Abilities. 'aspirant' is twelve
-- Signatures, three Core and three Advanced Abilities, Enchantments and Sample
-- Perks. The default makes every existing row correct with no backfill.
ALTER TABLE public.classes
    ADD COLUMN content_format text NOT NULL DEFAULT 'advent'
        CHECK (content_format IN ('advent', 'aspirant'));
