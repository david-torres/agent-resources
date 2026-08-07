-- lfg_join_requests.character_id was declared as a bare
-- "REFERENCES characters(id)" in 20240101000000_baseline_schema.sql:222, with
-- no ON DELETE action -- the only FK to characters lacking one. Any character
-- that had ever joined a game therefore could not be deleted: Postgres raised
-- 23503 and the user saw a generic 500.
--
-- SET NULL, not CASCADE: a join request is the host's record that a player
-- joined their game. It carries its own join_type and status and remains
-- meaningful without the character. Cascading would silently remove players
-- from a host's roster and from the history of closed posts.
alter table lfg_join_requests
  drop constraint lfg_join_requests_character_id_fkey;

alter table lfg_join_requests
  add constraint lfg_join_requests_character_id_fkey
  foreign key (character_id) references characters(id) on delete set null;
