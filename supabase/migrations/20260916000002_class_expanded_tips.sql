-- The Expanded Tips page is a per-class section separate from the cover's Quick
-- Tips, which continues to fill classes.tips. One list is addressed to the
-- player and one to the Conduit, so folding them together would lose the
-- distinction that gives the section its purpose.
--
-- NOT NULL with a shaped default, matching advanced_abilities: no class-content
-- column is nullable, and a reader should never have to decide what a null list
-- means.
ALTER TABLE public.classes
    ADD COLUMN expanded_tips jsonb NOT NULL
        DEFAULT '{"player": [], "conduit": []}'::jsonb;
