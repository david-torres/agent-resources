-- Aspiring is the class-less creator mode: the player invents a one-off
-- pseudo-class rather than picking from the catalog. Its name goes in
-- characters.class -- already NOT NULL, and already the denormalized display
-- name every render path reads -- so only the other two fields need columns.
--
-- Both are null for every advent and aspirant character; that nullability is
-- the signal, and creator_mode already records the mode.
ALTER TABLE public.characters
    ADD COLUMN pseudo_class_tagline text,
    ADD COLUMN pseudo_class_description text;
