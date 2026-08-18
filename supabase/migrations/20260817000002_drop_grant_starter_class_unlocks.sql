-- Starter class unlocks are no longer written: the starter Advent rulebook
-- grant confers its core roster on read (util/book-classes.js).
DROP FUNCTION IF EXISTS grant_starter_class_unlocks(uuid, uuid[], timestamptz);
