-- Migration: Collaborative Missions
-- Adds mission_editors table and updates RLS policies to support collaborative editing

-- 1. Create mission_editors junction table
CREATE TABLE IF NOT EXISTS mission_editors (
    mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    added_by UUID REFERENCES profiles(id),
    added_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (mission_id, profile_id)
);

-- 2. Enable RLS on mission_editors
ALTER TABLE mission_editors ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing missions policies
DROP POLICY IF EXISTS "missions_public_select" ON missions;
DROP POLICY IF EXISTS "missions_owner_host_admin_select" ON missions;
DROP POLICY IF EXISTS "missions_owner_host_editor_admin_select" ON missions;
DROP POLICY IF EXISTS "missions_insert" ON missions;
DROP POLICY IF EXISTS "missions_update" ON missions;
DROP POLICY IF EXISTS "missions_delete" ON missions;

-- 4. Create updated missions policies
CREATE POLICY "missions_public_select"
    ON missions FOR SELECT
    USING (is_public = true);

-- Owners, hosts, editors, and admins can view private missions
CREATE POLICY "missions_owner_host_editor_admin_select"
    ON missions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id)
              AND (p.user_id = auth.uid() OR is_admin())
        )
        OR EXISTS (
            SELECT 1 FROM mission_editors me
            JOIN profiles p ON p.id = me.profile_id
            WHERE me.mission_id = missions.id
              AND p.user_id = auth.uid()
        )
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

-- Owners, hosts, editors, and admins can update missions
CREATE POLICY "missions_update"
    ON missions FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id)
              AND (p.user_id = auth.uid() OR is_admin())
        )
        OR EXISTS (
            SELECT 1 FROM mission_editors me
            JOIN profiles p ON p.id = me.profile_id
            WHERE me.mission_id = missions.id
              AND p.user_id = auth.uid()
        )
        OR is_admin()
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id)
              AND (p.user_id = auth.uid() OR is_admin())
        )
        OR EXISTS (
            SELECT 1 FROM mission_editors me
            JOIN profiles p ON p.id = me.profile_id
            WHERE me.mission_id = missions.id
              AND p.user_id = auth.uid()
        )
        OR is_admin()
    );

-- Only creator can delete missions (not editors or host)
CREATE POLICY "missions_delete"
    ON missions FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    );

-- 5. Drop and recreate mission_characters policies
DROP POLICY IF EXISTS "mission_characters_select" ON mission_characters;
DROP POLICY IF EXISTS "mission_characters_mutate" ON mission_characters;

CREATE POLICY "mission_characters_select"
    ON mission_characters FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM missions m
            WHERE m.id = mission_characters.mission_id
              AND (
                m.is_public = true
                OR EXISTS (
                    SELECT 1 FROM profiles pm
                    WHERE (pm.id = m.creator_id OR pm.id = m.host_id)
                      AND pm.user_id = auth.uid()
                )
                OR EXISTS (
                    SELECT 1 FROM mission_editors me
                    JOIN profiles pe ON pe.id = me.profile_id
                    WHERE me.mission_id = m.id
                      AND pe.user_id = auth.uid()
                )
                OR EXISTS (
                    SELECT 1 FROM characters c
                    JOIN profiles pc ON pc.id = c.creator_id
                    WHERE c.id = mission_characters.character_id
                      AND pc.user_id = auth.uid()
                )
                OR is_admin()
              )
        )
    );

-- Creators, hosts, editors, and character owners can mutate mission_characters
CREATE POLICY "mission_characters_mutate"
    ON mission_characters FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM missions m
            WHERE m.id = mission_characters.mission_id
              AND (
                -- Creator or host can mutate
                EXISTS (
                    SELECT 1 FROM profiles pm
                    WHERE (pm.id = m.creator_id OR pm.id = m.host_id)
                      AND pm.user_id = auth.uid()
                )
                -- Editor can mutate
                OR EXISTS (
                    SELECT 1 FROM mission_editors me
                    JOIN profiles pe ON pe.id = me.profile_id
                    WHERE me.mission_id = m.id
                      AND pe.user_id = auth.uid()
                )
                -- Character owner can mutate their own character's entry
                OR EXISTS (
                    SELECT 1 FROM characters c
                    JOIN profiles pc ON pc.id = c.creator_id
                    WHERE c.id = mission_characters.character_id
                      AND pc.user_id = auth.uid()
                )
                OR is_admin()
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM missions m
            WHERE m.id = mission_characters.mission_id
              AND (
                -- Creator or host can mutate
                EXISTS (
                    SELECT 1 FROM profiles pm
                    WHERE (pm.id = m.creator_id OR pm.id = m.host_id)
                      AND pm.user_id = auth.uid()
                )
                -- Editor can mutate
                OR EXISTS (
                    SELECT 1 FROM mission_editors me
                    JOIN profiles pe ON pe.id = me.profile_id
                    WHERE me.mission_id = m.id
                      AND pe.user_id = auth.uid()
                )
                -- Character owner can mutate their own character's entry
                OR EXISTS (
                    SELECT 1 FROM characters c
                    JOIN profiles pc ON pc.id = c.creator_id
                    WHERE c.id = mission_characters.character_id
                      AND pc.user_id = auth.uid()
                )
                OR is_admin()
              )
        )
    );

-- 6. Create mission_editors policies
DROP POLICY IF EXISTS "mission_editors_select" ON mission_editors;
DROP POLICY IF EXISTS "mission_editors_insert" ON mission_editors;
DROP POLICY IF EXISTS "mission_editors_delete" ON mission_editors;

-- Anyone can see editors of public missions, or missions they're involved with
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
                OR EXISTS (
                    SELECT 1 FROM mission_editors me2
                    JOIN profiles p ON p.id = me2.profile_id
                    WHERE me2.mission_id = m.id
                      AND p.user_id = auth.uid()
                )
                OR is_admin()
              )
        )
    );

-- Mission creator, host, or existing editors can add new editors
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
                OR EXISTS (
                    SELECT 1 FROM mission_editors me2
                    JOIN profiles p ON p.id = me2.profile_id
                    WHERE me2.mission_id = m.id
                      AND p.user_id = auth.uid()
                )
                OR is_admin()
              )
        )
    );

-- Only mission creator can remove editors
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

-- 7. Auto-populate editors from existing character owners
-- This adds all profile owners of characters on each mission as editors
INSERT INTO mission_editors (mission_id, profile_id, added_by, added_at)
SELECT DISTINCT m.id, c.creator_id, m.creator_id, m.date
FROM missions m
JOIN mission_characters mc ON mc.mission_id = m.id
JOIN characters c ON c.id = mc.character_id
WHERE c.creator_id != m.creator_id
  AND c.creator_id != COALESCE(m.host_id, '00000000-0000-0000-0000-000000000000')
ON CONFLICT DO NOTHING;

