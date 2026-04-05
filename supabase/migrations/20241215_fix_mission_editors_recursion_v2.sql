-- Fix: break mutual recursion between missions and mission_editors RLS policies
-- missions policies reference mission_editors, and mission_editors policies reference missions.
-- SECURITY DEFINER functions bypass RLS, breaking the cycle.

-- Helper: check if current user is an editor of a mission (bypasses RLS)
CREATE OR REPLACE FUNCTION is_mission_editor(p_mission_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM mission_editors me
    JOIN profiles p ON p.id = me.profile_id
    WHERE me.mission_id = p_mission_id
      AND p.user_id = auth.uid()
  );
$$;

-- Helper: check if current user is creator or host of a mission (bypasses RLS)
CREATE OR REPLACE FUNCTION is_mission_owner_or_host(p_mission_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM missions m
    JOIN profiles p ON (p.id = m.creator_id OR p.id = m.host_id)
    WHERE m.id = p_mission_id
      AND p.user_id = auth.uid()
  );
$$;

-- Helper: check if a mission is public (bypasses RLS)
CREATE OR REPLACE FUNCTION is_mission_public(p_mission_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM missions m
    WHERE m.id = p_mission_id
      AND m.is_public = true
  );
$$;

-- 1. Fix missions policies: replace mission_editors subquery with function call
DROP POLICY IF EXISTS "missions_public_select" ON missions;
DROP POLICY IF EXISTS "missions_owner_host_editor_admin_select" ON missions;
DROP POLICY IF EXISTS "missions_update" ON missions;
DROP POLICY IF EXISTS "missions_delete" ON missions;
DROP POLICY IF EXISTS "missions_insert" ON missions;

CREATE POLICY "missions_public_select"
    ON missions FOR SELECT
    USING (is_public = true);

CREATE POLICY "missions_owner_host_editor_admin_select"
    ON missions FOR SELECT
    USING (
        is_mission_owner_or_host(id)
        OR is_mission_editor(id)
        OR is_admin()
    );

CREATE POLICY "missions_insert"
    ON missions FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    );

CREATE POLICY "missions_update"
    ON missions FOR UPDATE
    USING (
        is_mission_owner_or_host(id)
        OR is_mission_editor(id)
        OR is_admin()
    )
    WITH CHECK (
        is_mission_owner_or_host(id)
        OR is_mission_editor(id)
        OR is_admin()
    );

CREATE POLICY "missions_delete"
    ON missions FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    );

-- 2. Fix mission_editors policies: use helper functions instead of direct table queries
DROP POLICY IF EXISTS "mission_editors_select" ON mission_editors;
DROP POLICY IF EXISTS "mission_editors_insert" ON mission_editors;
DROP POLICY IF EXISTS "mission_editors_delete" ON mission_editors;

CREATE POLICY "mission_editors_select"
    ON mission_editors FOR SELECT
    USING (
        is_mission_public(mission_id)
        OR is_mission_owner_or_host(mission_id)
        OR is_mission_editor(mission_id)
        OR is_admin()
    );

CREATE POLICY "mission_editors_insert"
    ON mission_editors FOR INSERT
    WITH CHECK (
        is_mission_owner_or_host(mission_id)
        OR is_admin()
    );

CREATE POLICY "mission_editors_delete"
    ON mission_editors FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM missions m
            JOIN profiles p ON p.id = m.creator_id
            WHERE m.id = mission_editors.mission_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    );

-- 3. Fix mission_characters policies: same issue, use helper functions
DROP POLICY IF EXISTS "mission_characters_select" ON mission_characters;
DROP POLICY IF EXISTS "mission_characters_mutate" ON mission_characters;

CREATE POLICY "mission_characters_select"
    ON mission_characters FOR SELECT
    USING (
        is_mission_public(mission_id)
        OR is_mission_owner_or_host(mission_id)
        OR is_mission_editor(mission_id)
        -- Character owner can see their own character's mission entries
        OR EXISTS (
            SELECT 1 FROM characters c
            JOIN profiles pc ON pc.id = c.creator_id
            WHERE c.id = mission_characters.character_id
              AND pc.user_id = auth.uid()
        )
        OR is_admin()
    );

CREATE POLICY "mission_characters_mutate"
    ON mission_characters FOR ALL
    USING (
        is_mission_owner_or_host(mission_id)
        OR is_mission_editor(mission_id)
        OR EXISTS (
            SELECT 1 FROM characters c
            JOIN profiles pc ON pc.id = c.creator_id
            WHERE c.id = mission_characters.character_id
              AND pc.user_id = auth.uid()
        )
        OR is_admin()
    )
    WITH CHECK (
        is_mission_owner_or_host(mission_id)
        OR is_mission_editor(mission_id)
        OR EXISTS (
            SELECT 1 FROM characters c
            JOIN profiles pc ON pc.id = c.creator_id
            WHERE c.id = mission_characters.character_id
              AND pc.user_id = auth.uid()
        )
        OR is_admin()
    );
