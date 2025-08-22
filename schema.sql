CREATE TABLE profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
    name TEXT NOT NULL,
    bio TEXT,
    image_url TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    timezone TEXT DEFAULT 'UTC',
    discord_id TEXT,
    discord_email TEXT,
    role public.roles,
    CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_discord_id ON profiles(discord_id) WHERE discord_id IS NOT NULL;

-- characters table
CREATE TABLE characters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES profiles(id),
  is_public BOOLEAN DEFAULT FALSE,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  vitality INTEGER NOT NULL,
  might INTEGER NOT NULL,
  resilience INTEGER NOT NULL,
  spirit INTEGER NOT NULL,
  arcane INTEGER NOT NULL,
  will INTEGER NOT NULL,
  sensory INTEGER NOT NULL,
  reflex INTEGER NOT NULL,
  vigor INTEGER NOT NULL,
  skill INTEGER NOT NULL,
  intelligence INTEGER NOT NULL,
  luck INTEGER NOT NULL,
  mission_id INTEGER NULL,
  level INTEGER NOT NULL,
  completed_missions INTEGER NOT NULL,
  commissary_reward INTEGER NOT NULL,
  appearance TEXT NULL,
  additional_gear TEXT NULL,
  image_url TEXT NULL,
  flavor TEXT NULL,
  ideas TEXT NULL,
  background TEXT NULL,
  perks TEXT NULL;
);

-- missions table
CREATE TABLE missions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  focus_words TEXT,
  statement TEXT,
  summary TEXT,
  outcome TEXT CHECK (status IN ('success', 'failure', 'pending')) NOT NULL DEFAULT 'pending',
  creator_id UUID NOT NULL REFERENCES profiles(id),
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  host_id UUID REFERENCES profiles(id),
  host_name TEXT
);

-- mission_log_characters junction table
CREATE TABLE mission_characters (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  mission_id UUID NOT NULL,
  character_id UUID NOT NULL,
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
  CONSTRAINT unique_mission_character UNIQUE (mission_id, character_id)
);

-- traits table
CREATE TABLE traits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  character_id UUID NOT NULL,
  name TEXT NOT NULL,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- class_gear table
CREATE TABLE class_gear (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  character_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- class_abilities table
CREATE TABLE class_abilities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  character_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  essence_cost TEXT,
  cooldown TEXT,
  duration TEXT,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- lfg_posts table
CREATE TABLE lfg_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  creator_id UUID REFERENCES profiles(id),
  host_id UUID REFERENCES profiles(id),
  max_characters INTEGER NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  status TEXT CHECK (status IN ('open', 'closed')) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT current_timestamp,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT current_timestamp
);

-- lfg_join_requests table
CREATE TABLE lfg_join_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lfg_post_id UUID NOT NULL REFERENCES lfg_posts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id),
  join_type TEXT CHECK (join_type IN ('player', 'conduit')) NOT NULL,
  character_id UUID REFERENCES characters(id),
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT current_timestamp,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT current_timestamp,
  CONSTRAINT unique_lfg_post_profile UNIQUE (lfg_post_id, profile_id)
);

drop function if exists increment_missions_count;
create function increment_missions_count (x int, character_id uuid) 
returns void as
$$
  update characters 
  set completed_missions = completed_missions + x
  where id = character_id
$$ 
language sql volatile;

-- Supabase Class Management Schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable Row Level Security
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_unlocks ENABLE ROW LEVEL SECURITY;

-- Classes table
CREATE TABLE IF NOT EXISTS classes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    visibility text NOT NULL CHECK (visibility IN ('public','private')) DEFAULT 'public',
    status text NOT NULL CHECK (status IN ('alpha','beta','release')) DEFAULT 'alpha',
    is_player_created bool NOT NULL DEFAULT false,
    rules_edition text NOT NULL (rules_edition IN ('advent', 'aspirant', 'adept', 'ace')) DEFAULT 'advent',
    rules_version text NOT NULL (rules_version IN ('v1', 'v2')),
    base_class_id uuid REFERENCES classes(id),
    created_by uuid REFERENCES auth.users(id),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
);

-- Class unlocks table
CREATE TABLE IF NOT EXISTS class_unlocks (
    user_id uuid REFERENCES auth.users(id),
    class_id uuid REFERENCES classes(id),
    unlocked_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, class_id)
);

-- Function to duplicate a class for new version
CREATE OR REPLACE FUNCTION dup_class(new_id uuid, base_id uuid, new_version text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_class_id uuid;
BEGIN
    INSERT INTO classes (
        id,
        name,
        description,
        visibility,
        status,
        is_player_created,
        rules_edition,
        rules_version,
        base_class_id,
        created_by
    )
    SELECT 
        new_id,
        name,
        description,
        visibility,
        status,
        is_player_created,
        rules_edition,
        new_version,
        id,
        auth.uid()
    FROM classes
    WHERE id = base_id
    RETURNING id INTO new_class_id;
    
    RETURN new_class_id;
END;
$$;

-- RLS Policies for classes table
CREATE POLICY "Public classes are viewable by everyone"
    ON classes FOR SELECT
    USING (visibility = 'public');

CREATE POLICY "Private classes are viewable by owner or admin"
    ON classes FOR SELECT
    USING (
        visibility = 'private' AND (
            created_by = auth.uid() OR 
            is_admin()
        )
    );

CREATE POLICY "Classes can be created by admin or player"
    ON classes FOR INSERT
    WITH CHECK (
        -- Admins can create any status
        is_admin() OR
        -- Non-admins may only create player-created classes that are not release
        (is_player_created = true AND status IN ('alpha','beta'))
    );

CREATE POLICY "Classes can be updated by owner or admin"
    ON classes FOR UPDATE
    USING (
        created_by = auth.uid() OR is_admin()
    )
    WITH CHECK (
        -- Preserve owner/admin requirement
        (created_by = auth.uid() OR is_admin())
        AND
        -- Only admins can set release
        (is_admin() OR status IN ('alpha','beta'))
    );

-- RLS Policies for class_unlocks table
CREATE POLICY "Users can view their own unlocks"
    ON class_unlocks FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Only admins can create unlocks" ON class_unlocks;
CREATE POLICY "Users can unlock eligible public player classes"
    ON class_unlocks FOR INSERT
    WITH CHECK (
        (
          user_id = auth.uid()
          AND EXISTS (
            SELECT 1 FROM classes c
            WHERE c.id = class_id
              AND c.visibility = 'public'
              AND c.is_player_created = true
              AND c.status IN ('alpha','beta')
          )
        )
        OR is_admin()
    );

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_classes_updated_at
    BEFORE UPDATE ON classes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security for application tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_gear ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_abilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE lfg_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lfg_join_requests ENABLE ROW LEVEL SECURITY;

-- Helper admin check used in policies (avoid selecting from auth.users in RLS)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((auth.jwt() ->> 'role') = 'admin', false)
$$;

-- Profiles policies
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_delete" ON profiles;

CREATE POLICY "profiles_select"
    ON profiles FOR SELECT
    USING (
        is_public = true
        OR user_id = auth.uid()
        OR is_admin()
    );

CREATE POLICY "profiles_insert"
    ON profiles FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        OR is_admin()
    );

CREATE POLICY "profiles_update"
    ON profiles FOR UPDATE
    USING (
        user_id = auth.uid()
        OR is_admin()
    )
    WITH CHECK (
        user_id = auth.uid()
        OR is_admin()
    );

CREATE POLICY "profiles_delete"
    ON profiles FOR DELETE
    USING (
        user_id = auth.uid()
        OR is_admin()
    );

-- Characters policies
DROP POLICY IF EXISTS "characters_public_select" ON characters;
DROP POLICY IF EXISTS "characters_owner_admin_select" ON characters;
DROP POLICY IF EXISTS "characters_insert" ON characters;
DROP POLICY IF EXISTS "characters_update" ON characters;
DROP POLICY IF EXISTS "characters_delete" ON characters;

CREATE POLICY "characters_public_select"
    ON characters FOR SELECT
    USING (is_public = true);

CREATE POLICY "characters_owner_admin_select"
    ON characters FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    );

CREATE POLICY "characters_insert"
    ON characters FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    );

CREATE POLICY "characters_update"
    ON characters FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    );

CREATE POLICY "characters_delete"
    ON characters FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id AND (
                p.user_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM auth.users u
                    WHERE u.id = auth.uid() AND u.raw_user_meta_data->>'role' = 'admin'
                )
            )
        )
    );

-- Traits policies
DROP POLICY IF EXISTS "traits_select" ON traits;
DROP POLICY IF EXISTS "traits_mutate" ON traits;

CREATE POLICY "traits_select"
    ON traits FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = traits.character_id
              AND (
                c.is_public = true OR p.user_id = auth.uid() OR is_admin()
              )
        )
    );

CREATE POLICY "traits_mutate"
    ON traits FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = traits.character_id
              AND (
                p.user_id = auth.uid() OR is_admin()
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = traits.character_id
              AND (
                p.user_id = auth.uid() OR is_admin()
              )
        )
    );

-- Class gear policies
DROP POLICY IF EXISTS "class_gear_select" ON class_gear;
DROP POLICY IF EXISTS "class_gear_mutate" ON class_gear;

CREATE POLICY "class_gear_select"
    ON class_gear FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = class_gear.character_id
              AND (
                c.is_public = true OR p.user_id = auth.uid() OR is_admin()
              )
        )
    );

CREATE POLICY "class_gear_mutate"
    ON class_gear FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = class_gear.character_id
              AND (
                p.user_id = auth.uid() OR is_admin()
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = class_gear.character_id
              AND (
                p.user_id = auth.uid() OR is_admin()
              )
        )
    );

-- Class abilities policies
DROP POLICY IF EXISTS "class_abilities_select" ON class_abilities;
DROP POLICY IF EXISTS "class_abilities_mutate" ON class_abilities;

CREATE POLICY "class_abilities_select"
    ON class_abilities FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = class_abilities.character_id
              AND (
                c.is_public = true OR p.user_id = auth.uid() OR is_admin()
              )
        )
    );

CREATE POLICY "class_abilities_mutate"
    ON class_abilities FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = class_abilities.character_id
              AND (
                p.user_id = auth.uid() OR is_admin()
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = class_abilities.character_id
              AND (
                p.user_id = auth.uid() OR is_admin()
              )
        )
    );

-- Missions policies
DROP POLICY IF EXISTS "missions_public_select" ON missions;
DROP POLICY IF EXISTS "missions_owner_host_admin_select" ON missions;
DROP POLICY IF EXISTS "missions_insert" ON missions;
DROP POLICY IF EXISTS "missions_update" ON missions;
DROP POLICY IF EXISTS "missions_delete" ON missions;

CREATE POLICY "missions_public_select"
    ON missions FOR SELECT
    USING (is_public = true);

CREATE POLICY "missions_owner_host_admin_select"
    ON missions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
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
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM auth.users u
                    WHERE u.id = auth.uid() AND u.raw_user_meta_data->>'role' = 'admin'
                )
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM auth.users u
                    WHERE u.id = auth.uid() AND u.raw_user_meta_data->>'role' = 'admin'
                )
            )
        )
    );

CREATE POLICY "missions_delete"
    ON missions FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM auth.users u
                    WHERE u.id = auth.uid() AND u.raw_user_meta_data->>'role' = 'admin'
                )
            )
        )
    );

-- Mission characters policies
DROP POLICY IF EXISTS "mission_characters_select" ON mission_characters;
DROP POLICY IF EXISTS "mission_characters_mutate" ON mission_characters;

CREATE POLICY "mission_characters_select"
    ON mission_characters FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM missions m
            JOIN characters c ON c.id = mission_characters.character_id
            JOIN profiles pm ON pm.id = m.creator_id
            JOIN profiles pc ON pc.id = c.creator_id
            WHERE m.id = mission_characters.mission_id
              AND (
                m.is_public = true OR pm.user_id = auth.uid() OR pc.user_id = auth.uid() OR is_admin()
              )
        )
    );

CREATE POLICY "mission_characters_mutate"
    ON mission_characters FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM missions m
            JOIN characters c ON c.id = mission_characters.character_id
            JOIN profiles pm ON pm.id = m.creator_id
            JOIN profiles pc ON pc.id = c.creator_id
            WHERE m.id = mission_characters.mission_id
              AND (
                pm.user_id = auth.uid() OR pc.user_id = auth.uid() OR is_admin()
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM missions m
            JOIN characters c ON c.id = mission_characters.character_id
            JOIN profiles pm ON pm.id = m.creator_id
            JOIN profiles pc ON pc.id = c.creator_id
            WHERE m.id = mission_characters.mission_id
              AND (
                pm.user_id = auth.uid() OR pc.user_id = auth.uid() OR is_admin()
              )
        )
    );

-- LFG posts policies
DROP POLICY IF EXISTS "lfg_posts_public_select" ON lfg_posts;
DROP POLICY IF EXISTS "lfg_posts_owner_host_admin_select" ON lfg_posts;
DROP POLICY IF EXISTS "lfg_posts_insert" ON lfg_posts;
DROP POLICY IF EXISTS "lfg_posts_update" ON lfg_posts;
DROP POLICY IF EXISTS "lfg_posts_delete" ON lfg_posts;

CREATE POLICY "lfg_posts_public_select"
    ON lfg_posts FOR SELECT
    USING (is_public = true);

CREATE POLICY "lfg_posts_owner_host_admin_select"
    ON lfg_posts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    );

CREATE POLICY "lfg_posts_insert"
    ON lfg_posts FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = creator_id AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    );

CREATE POLICY "lfg_posts_update"
    ON lfg_posts FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM auth.users u
                    WHERE u.id = auth.uid() AND u.raw_user_meta_data->>'role' = 'admin'
                )
            )
        )
    );

CREATE POLICY "lfg_posts_delete"
    ON lfg_posts FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM auth.users u
                    WHERE u.id = auth.uid() AND u.raw_user_meta_data->>'role' = 'admin'
                )
            )
        )
    );

-- LFG join requests policies
DROP POLICY IF EXISTS "lfg_join_requests_select" ON lfg_join_requests;
DROP POLICY IF EXISTS "lfg_join_requests_insert" ON lfg_join_requests;
DROP POLICY IF EXISTS "lfg_join_requests_update" ON lfg_join_requests;
DROP POLICY IF EXISTS "lfg_join_requests_delete" ON lfg_join_requests;

CREATE POLICY "lfg_join_requests_select"
    ON lfg_join_requests FOR SELECT
    USING (
        -- requester can see their own request
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = lfg_join_requests.profile_id AND p.user_id = auth.uid()
        )
        OR
        -- post owner (creator or host) can see requests
        EXISTS (
            SELECT 1
            FROM lfg_posts lp
            JOIN profiles p2 ON p2.id IN (lp.creator_id, lp.host_id)
            WHERE lp.id = lfg_join_requests.lfg_post_id
              AND p2.user_id = auth.uid()
        )
        OR
        -- admin can see everything
        is_admin()
    );

CREATE POLICY "lfg_join_requests_insert"
    ON lfg_join_requests FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = lfg_join_requests.profile_id AND (
                p.user_id = auth.uid() OR is_admin()
            )
        )
    );

CREATE POLICY "lfg_join_requests_update"
    ON lfg_join_requests FOR UPDATE
    USING (
        -- only the post owner (creator or host) or admin can update status
        EXISTS (
            SELECT 1
            FROM lfg_posts lp
            JOIN profiles p2 ON p2.id IN (lp.creator_id, lp.host_id)
            WHERE lp.id = lfg_join_requests.lfg_post_id
              AND (
                p2.user_id = auth.uid() OR is_admin()
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM lfg_posts lp
            JOIN profiles p2 ON p2.id IN (lp.creator_id, lp.host_id)
            WHERE lp.id = lfg_join_requests.lfg_post_id
              AND (
                p2.user_id = auth.uid() OR is_admin()
              )
        )
    );

CREATE POLICY "lfg_join_requests_delete"
    ON lfg_join_requests FOR DELETE
    USING (
        -- requester can cancel
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = lfg_join_requests.profile_id AND p.user_id = auth.uid()
        )
        OR
        -- post owner can remove
        EXISTS (
            SELECT 1
            FROM lfg_posts lp
            JOIN profiles p2 ON p2.id IN (lp.creator_id, lp.host_id)
            WHERE lp.id = lfg_join_requests.lfg_post_id
              AND p2.user_id = auth.uid()
        )
        OR
        -- admin can delete
        is_admin()
    );