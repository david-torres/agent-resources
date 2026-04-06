-- Fix: infinite recursion in mission_editors RLS policies
-- The SELECT and INSERT policies were self-referencing mission_editors,
-- causing Postgres to re-evaluate the same policy in an infinite loop.

DROP POLICY IF EXISTS "mission_editors_select" ON mission_editors;
DROP POLICY IF EXISTS "mission_editors_insert" ON mission_editors;

-- SELECT: use direct profile_id match for the "am I an editor" check
-- instead of joining back to mission_editors
CREATE POLICY "mission_editors_select"
    ON mission_editors FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM missions m
            WHERE m.id = mission_editors.mission_id
              AND (
                m.is_public = true
                OR EXISTS (
                    SELECT 1 FROM profiles p
                    WHERE (p.id = m.creator_id OR p.id = m.host_id)
                      AND p.user_id = auth.uid()
                )
                OR is_admin()
              )
        )
        -- Editors can see other editors on the same mission
        OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = mission_editors.profile_id
              AND p.user_id = auth.uid()
        )
    );

-- INSERT: only creator/host/admin can insert via RLS;
-- "existing editors can add editors" is enforced in application code
CREATE POLICY "mission_editors_insert"
    ON mission_editors FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM missions m
            WHERE m.id = mission_editors.mission_id
              AND (
                EXISTS (
                    SELECT 1 FROM profiles p
                    WHERE (p.id = m.creator_id OR p.id = m.host_id)
                      AND p.user_id = auth.uid()
                )
                OR is_admin()
              )
        )
    );
