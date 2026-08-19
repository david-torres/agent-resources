-- Back-link from a mission log to the LFG post whose game it records.
--
-- "Log this game" pre-fills a mission draft from a past-dated post; this column
-- is how the post page later knows the game was already logged and links to the
-- log instead of offering the action a second time. Without it the only way to
-- pair the two would be guessing at matching names and dates.
--
-- ON DELETE SET NULL, not CASCADE: deleting the scheduling post must never
-- delete the log of the game that was played.
ALTER TABLE missions
    ADD COLUMN IF NOT EXISTS lfg_post_id uuid REFERENCES lfg_posts(id) ON DELETE SET NULL;

-- One log per post. Partial so the many missions with no post (imports, ad-hoc
-- logs, everything predating this column) don't sit in the index at all.
CREATE UNIQUE INDEX IF NOT EXISTS missions_lfg_post_id_key
    ON missions (lfg_post_id)
    WHERE lfg_post_id IS NOT NULL;
