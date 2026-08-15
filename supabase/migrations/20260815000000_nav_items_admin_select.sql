-- nav_items: let admins SELECT deactivated items.
--
-- The original policy set (20260609000100_nav_items.sql) gave nav_items a
-- single SELECT policy, USING (is_active = true). Admins therefore could not
-- read a deactivated item at all, which broke two things:
--
--   1. Deactivating an item was impossible. models/nav.js updates with a
--      trailing .select(), and Postgres applies SELECT policies to an
--      UPDATE ... RETURNING. Flipping is_active to false makes the *new* row
--      invisible under USING (is_active = true), so the statement aborts with
--      42501 -- the same error code as a WITH CHECK failure, which made this
--      look like the is_admin() write policy rejecting an admin.
--   2. Once an item was deactivated out of band, it was unrecoverable through
--      the UI: /nav/manage omitted it and /nav/:id/edit 404'd on it, because
--      neither getAllNavItems nor getNavItem could see the row.
--
-- Widening SELECT for admins fixes both. It leaks nothing to the public navbar:
-- getNavItems() filters .eq('is_active', true) in the query itself, and
-- is_admin() is false for anon and for non-admin users.

DROP POLICY IF EXISTS "Everyone can view active nav items" ON nav_items;
CREATE POLICY "Everyone can view active nav items"
    ON nav_items FOR SELECT
    USING (is_active = true OR is_admin());
