-- Extensions and shared types must exist before any table that references them.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'roles') THEN
        CREATE TYPE public.roles AS ENUM ('user', 'admin');
    END IF;
END$$;

CREATE TABLE profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
    name TEXT NOT NULL,
    bio TEXT,
    image_url TEXT,
    image_crop JSONB,
    is_public BOOLEAN DEFAULT FALSE,
    timezone TEXT DEFAULT 'UTC',
    discord_id TEXT,
    discord_email TEXT,
    conduit_briefing TEXT,
    role public.roles NOT NULL DEFAULT 'user'
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_discord_id ON profiles(discord_id) WHERE discord_id IS NOT NULL;

-- characters table
CREATE TABLE characters (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES profiles(id),
  is_public BOOLEAN DEFAULT FALSE,
  is_deceased BOOLEAN NOT NULL DEFAULT FALSE,
  hide_from_search BOOLEAN NOT NULL DEFAULT FALSE,
  auto_calculate BOOLEAN NOT NULL DEFAULT FALSE,
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
  image_crop JSONB,
  flavor TEXT NULL,
  ideas TEXT NULL,
  background TEXT NULL,
  perks TEXT NULL,
  private_notes TEXT NULL,
  class_id UUID NULL,
  common_items JSONB DEFAULT '[]'::jsonb,
  quirks JSONB NOT NULL DEFAULT '[]'::jsonb,
  accessories JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- missions table
CREATE TABLE missions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  focus_words TEXT,
  statement TEXT,
  summary TEXT,
  outcome TEXT CHECK (outcome IN ('success', 'failure', 'pending')) NOT NULL DEFAULT 'pending',
  creator_id UUID REFERENCES profiles(id),
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  host_id UUID REFERENCES profiles(id),
  host_name TEXT,
  media_url TEXT,
  unregistered_character_names TEXT[] DEFAULT '{}'
);

-- mission_log_characters junction table
CREATE TABLE mission_characters (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  mission_id UUID NOT NULL,
  character_id UUID NOT NULL,
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  CONSTRAINT unique_mission_character UNIQUE (mission_id, character_id)
);

-- mission_editors junction table for collaborative editing
CREATE TABLE mission_editors (
    mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    added_by UUID REFERENCES profiles(id),
    added_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (mission_id, profile_id)
);

-- traits table
CREATE TABLE traits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  character_id UUID NOT NULL,
  name TEXT NOT NULL,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- classes table (must exist before class_gear / class_abilities reference it)
CREATE TABLE IF NOT EXISTS classes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    is_public BOOLEAN DEFAULT FALSE,
    status text NOT NULL CHECK (status IN ('alpha','beta','release')) DEFAULT 'alpha',
    is_player_created bool NOT NULL DEFAULT false,
    rules_edition text NOT NULL CHECK (rules_edition IN ('advent', 'aspirant')) DEFAULT 'advent',
    rules_version text NOT NULL CHECK (rules_version IN ('v1', 'v2')),
    base_class_id uuid REFERENCES classes(id),
    image_url text,
    image_crop JSONB,
    teaser text,
    visibility text,
    gear JSONB DEFAULT '[]'::jsonb,
    abilities JSONB DEFAULT '[]'::jsonb,
    created_by uuid REFERENCES profiles(id),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    pdf_storage_path text,
    pdf_updated_at timestamptz
);

-- Deferred FK now that classes exists
ALTER TABLE characters
    ADD CONSTRAINT characters_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id);

CREATE TABLE IF NOT EXISTS class_unlocks (
    user_id uuid REFERENCES auth.users(id),
    class_id uuid REFERENCES classes(id),
    unlocked_at timestamp NOT NULL DEFAULT now(),
    expires_at timestamptz,
    PRIMARY KEY (user_id, class_id)
);

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_unlocks ENABLE ROW LEVEL SECURITY;

-- class_gear table
CREATE TABLE class_gear (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  character_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  class_id uuid NOT NULL REFERENCES classes(id),
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
  class_id uuid NOT NULL REFERENCES classes(id),
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

-- character_perks: structured Ability Perks for v2 characters
CREATE TABLE IF NOT EXISTS character_perks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    class_ability_id UUID NOT NULL REFERENCES class_abilities(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    compounds_with UUID REFERENCES character_perks(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_character_perks_character ON character_perks(character_id);
CREATE INDEX IF NOT EXISTS idx_character_perks_ability   ON character_perks(class_ability_id);

-- lfg_posts table
CREATE TABLE lfg_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  creator_id UUID NOT NULL REFERENCES profiles(id),
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

-- Helper admin check used in policies (avoid selecting from auth.users in RLS).
-- Defined here so RLS policies below can reference it.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  SELECT role = 'admin'
    INTO v_is_admin
  FROM profiles
  WHERE user_id = auth.uid();

  RETURN COALESCE(v_is_admin, false);
END;
$$;

-- Helper functions to break RLS recursion between missions/mission_editors/mission_characters
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

-- Backfill for existing deployments where some columns may be missing.
-- (No-ops on a fresh database since the canonical CREATE statements above
-- already include these columns.)
ALTER TABLE characters ADD COLUMN IF NOT EXISTS image_crop JSONB;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS image_crop JSONB;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS teaser text;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS gear JSONB DEFAULT '[]'::jsonb;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS abilities JSONB DEFAULT '[]'::jsonb;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS visibility text;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS class_id UUID;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS common_items JSONB DEFAULT '[]'::jsonb;

-- Offscreen missions: per-character log entries created by spending a Conduit credit.
CREATE TABLE IF NOT EXISTS offscreen_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  merx_gained INTEGER NOT NULL DEFAULT 0,
  source_mission_id UUID NULL REFERENCES missions(id) ON DELETE SET NULL,
  source_mission_name TEXT NOT NULL,
  source_mission_date DATE NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offscreen_missions_character_id_idx
  ON offscreen_missions (character_id, source_mission_date DESC);

ALTER TABLE offscreen_missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offscreen_missions_select" ON offscreen_missions;
DROP POLICY IF EXISTS "offscreen_missions_mutate" ON offscreen_missions;

CREATE POLICY "offscreen_missions_select"
  ON offscreen_missions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (c.is_public = true OR p.user_id = auth.uid() OR is_admin())
    )
  );

CREATE POLICY "offscreen_missions_mutate"
  ON offscreen_missions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (p.user_id = auth.uid() OR is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM characters c
      JOIN profiles p ON p.id = c.creator_id
      WHERE c.id = offscreen_missions.character_id
        AND (p.user_id = auth.uid() OR is_admin())
    )
  );

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Adjust commissary_reward by a signed delta, clamped at 0.
-- General signed adjustment; currently used by offscreen-mission updates.
CREATE OR REPLACE FUNCTION adjust_commissary_reward(p_character_id UUID, p_delta INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET commissary_reward = GREATEST(commissary_reward + COALESCE(p_delta, 0), 0)
   WHERE id = p_character_id;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS offscreen_missions_source_unique_idx
  ON offscreen_missions (source_mission_id)
  WHERE source_mission_id IS NOT NULL;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Bumps completed_missions +1 and commissary_reward + p_merx. Used by createOffscreenMission.
CREATE OR REPLACE FUNCTION apply_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = completed_missions + 1,
         commissary_reward = commissary_reward + COALESCE(p_merx, 0)
   WHERE id = p_character_id;
$$;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Reverses apply_offscreen_mission_progress, clamped at 0. Used by removeOffscreenMission.
CREATE OR REPLACE FUNCTION revert_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = GREATEST(completed_missions - 1, 0),
         commissary_reward = GREATEST(commissary_reward - COALESCE(p_merx, 0), 0)
   WHERE id = p_character_id;
$$;

ALTER TABLE characters ADD COLUMN IF NOT EXISTS quirks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS accessories JSONB NOT NULL DEFAULT '[]'::jsonb;

-- One-time unlock codes for classes
CREATE TABLE IF NOT EXISTS class_unlock_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES profiles(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone,
    max_uses int NOT NULL DEFAULT 1,
    used_count int NOT NULL DEFAULT 0,
    last_redeemed_by uuid REFERENCES auth.users(id),
    last_redeemed_at timestamp with time zone
);

ALTER TABLE class_unlock_codes ENABLE ROW LEVEL SECURITY;

-- Long-lived personal access tokens for agent integrations
CREATE TABLE IF NOT EXISTS agent_api_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    token_hint text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_api_tokens_user_profile
    ON agent_api_tokens(user_id, profile_id, created_at DESC);

ALTER TABLE agent_api_tokens ENABLE ROW LEVEL SECURITY;

-- Rules PDF catalog
CREATE TABLE IF NOT EXISTS rules_pdfs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    edition text NOT NULL,
    storage_path text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (edition, title)
);

-- Track per-user unlocks for rules PDFs
CREATE TABLE IF NOT EXISTS rules_pdf_unlocks (
    user_id uuid NOT NULL REFERENCES auth.users(id),
    profile_id uuid NOT NULL REFERENCES profiles(id),
    rules_pdf_id uuid NOT NULL REFERENCES rules_pdfs(id) ON DELETE CASCADE,
    granted_by uuid REFERENCES profiles(id),
    unlocked_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    PRIMARY KEY (user_id, rules_pdf_id)
);

ALTER TABLE rules_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules_pdf_unlocks ENABLE ROW LEVEL SECURITY;

-- One-time unlock codes for rules PDFs, mirroring class_unlock_codes
CREATE TABLE IF NOT EXISTS rules_pdf_unlock_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    rules_pdf_id uuid NOT NULL REFERENCES rules_pdfs(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    max_uses int NOT NULL DEFAULT 1,
    used_count int NOT NULL DEFAULT 0,
    last_redeemed_by uuid REFERENCES auth.users(id),
    last_redeemed_at timestamptz
);

ALTER TABLE rules_pdf_unlock_codes ENABLE ROW LEVEL SECURITY;

-- Function to duplicate a class for new version
-- Extend dup_class to optionally retarget the rules_edition. Existing
-- callers that pass only (new_id, base_id, new_version) keep working.
CREATE OR REPLACE FUNCTION dup_class(new_id uuid, base_id uuid, new_version text, new_edition text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_class_id uuid;
    v_profile_id uuid;
BEGIN
    SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid() LIMIT 1;

    INSERT INTO classes (
        id,
        name,
        description,
        is_public,
        status,
        is_player_created,
        rules_edition,
        rules_version,
        base_class_id,
        created_by,
        gear,
        abilities,
        image_url,
        image_crop
    )
    SELECT
        new_id,
        name,
        description,
        is_public,
        status,
        is_player_created,
        COALESCE(new_edition, rules_edition),
        new_version,
        id,
        v_profile_id,
        gear,
        abilities,
        image_url,
        image_crop
    FROM classes
    WHERE id = base_id
    RETURNING id INTO new_class_id;

    RETURN new_class_id;
END;
$$;

-- RLS Policies for classes table
CREATE POLICY "Public classes are viewable by everyone"
    ON classes FOR SELECT
    USING (is_public = true);

CREATE POLICY "Private classes are viewable by owner or admin"
    ON classes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = classes.created_by
              AND p.user_id = auth.uid()
        ) OR is_admin()
    );

CREATE POLICY "Classes can be created by admin or player"
    ON classes FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = classes.created_by
              AND (p.user_id = auth.uid() OR is_admin())
        )
        AND
        (is_admin() OR (is_player_created = true AND status IN ('alpha','beta')))
    );

CREATE POLICY "Classes can be updated by owner or admin"
    ON classes FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = classes.created_by
              AND (p.user_id = auth.uid() OR is_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = classes.created_by
              AND (p.user_id = auth.uid() OR is_admin())
        )
        AND
        (is_admin() OR status IN ('alpha','beta'))
    );

CREATE POLICY "Classes can be deleted by owner or admin"
    ON classes FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = classes.created_by
              AND (p.user_id = auth.uid() OR is_admin())
        )
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
              AND c.is_public = true
              AND c.is_player_created = true
              AND c.status IN ('alpha','beta')
          )
        )
        OR is_admin()
    );

-- Admin-only policy for managing unlock codes
DROP POLICY IF EXISTS "class_unlock_codes_admin_all" ON class_unlock_codes;
CREATE POLICY "class_unlock_codes_admin_all"
    ON class_unlock_codes FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "rules_pdf_unlock_codes_admin_all" ON rules_pdf_unlock_codes;
CREATE POLICY "rules_pdf_unlock_codes_admin_all"
    ON rules_pdf_unlock_codes FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Users can manage own agent tokens" ON agent_api_tokens;
CREATE POLICY "Users can manage own agent tokens"
    ON agent_api_tokens FOR ALL
    USING (user_id = auth.uid() OR is_admin())
    WITH CHECK (user_id = auth.uid() OR is_admin());

-- Secure, atomic redemption function for unlock codes
CREATE OR REPLACE FUNCTION redeem_class_code(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
BEGIN
    SELECT *
    INTO v_code
    FROM class_unlock_codes
    WHERE code = p_code
      AND (expires_at IS NULL OR expires_at > now())
      AND used_count < max_uses
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired code';
    END IF;

    INSERT INTO class_unlocks(user_id, class_id, unlocked_at, expires_at)
    VALUES (auth.uid(), v_code.class_id, now(), NULL)
    ON CONFLICT (user_id, class_id) DO UPDATE
    SET expires_at = NULL,
        unlocked_at = LEAST(class_unlocks.unlocked_at, EXCLUDED.unlocked_at);

    UPDATE class_unlock_codes
    SET used_count = used_count + 1,
        last_redeemed_by = auth.uid(),
        last_redeemed_at = now()
    WHERE id = v_code.id;

    RETURN v_code.class_id;
END;
$$;

-- Variant that allows server-side to specify the target user explicitly
CREATE OR REPLACE FUNCTION redeem_class_code_for_user(p_code text, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
BEGIN
    SELECT *
    INTO v_code
    FROM class_unlock_codes
    WHERE code = p_code
      AND (expires_at IS NULL OR expires_at > now())
      AND used_count < max_uses
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired code';
    END IF;

    INSERT INTO class_unlocks(user_id, class_id, unlocked_at, expires_at)
    VALUES (p_user_id, v_code.class_id, now(), NULL)
    ON CONFLICT (user_id, class_id) DO UPDATE
    SET expires_at = NULL,
        unlocked_at = LEAST(class_unlocks.unlocked_at, EXCLUDED.unlocked_at);

    UPDATE class_unlock_codes
    SET used_count = used_count + 1,
        last_redeemed_by = p_user_id,
        last_redeemed_at = now()
    WHERE id = v_code.id;

    RETURN v_code.class_id;
END;
$$;

-- Atomic redemption. Always grants a permanent unlock: upserts over any
-- existing row (e.g. an expired starter-trial unlock) by clearing expires_at
-- and keeping the earlier unlocked_at.
CREATE OR REPLACE FUNCTION redeem_rules_pdf_code_for_user(p_code text, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
    v_profile_id uuid;
BEGIN
    SELECT *
    INTO v_code
    FROM rules_pdf_unlock_codes
    WHERE code = p_code
      AND (expires_at IS NULL OR expires_at > now())
      AND used_count < max_uses
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired code';
    END IF;

    -- rules_pdf_unlocks.profile_id is NOT NULL; resolve it explicitly.
    SELECT id INTO v_profile_id FROM profiles WHERE user_id = p_user_id LIMIT 1;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'No profile found for user';
    END IF;

    INSERT INTO rules_pdf_unlocks(user_id, profile_id, rules_pdf_id, unlocked_at, expires_at)
    VALUES (p_user_id, v_profile_id, v_code.rules_pdf_id, now(), NULL)
    ON CONFLICT (user_id, rules_pdf_id) DO UPDATE
    SET expires_at = NULL,
        unlocked_at = LEAST(rules_pdf_unlocks.unlocked_at, EXCLUDED.unlocked_at);

    UPDATE rules_pdf_unlock_codes
    SET used_count = used_count + 1,
        last_redeemed_by = p_user_id,
        last_redeemed_at = now()
    WHERE id = v_code.id;

    RETURN v_code.rules_pdf_id;
END;
$$;

-- Function to grant starter class unlocks (server-side, bypasses RLS)
CREATE OR REPLACE FUNCTION grant_starter_class_unlocks(p_user_id uuid, p_class_ids uuid[], p_expires_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_class_id uuid;
BEGIN
    FOREACH v_class_id IN ARRAY p_class_ids
    LOOP
        INSERT INTO class_unlocks(user_id, class_id, expires_at)
        VALUES (p_user_id, v_class_id, p_expires_at)
        ON CONFLICT (user_id, class_id) DO NOTHING;
    END LOOP;
END;
$$;

-- Function to grant starter rules PDF unlock (server-side, bypasses RLS)
CREATE OR REPLACE FUNCTION grant_starter_rules_unlock(p_user_id uuid, p_profile_id uuid, p_rules_pdf_id uuid, p_expires_at timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO rules_pdf_unlocks(user_id, profile_id, rules_pdf_id, expires_at)
    VALUES (p_user_id, p_profile_id, p_rules_pdf_id, p_expires_at)
    ON CONFLICT (user_id, rules_pdf_id) DO NOTHING;
END;
$$;

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

CREATE TRIGGER update_rules_pdfs_updated_at
    BEFORE UPDATE ON rules_pdfs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security for application tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_editors ENABLE ROW LEVEL SECURITY;
ALTER TABLE traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_gear ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_abilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_perks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lfg_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lfg_join_requests ENABLE ROW LEVEL SECURITY;

-- (is_admin / is_mission_* helpers are defined earlier so the policies below
-- can reference them at CREATE POLICY time.)

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
                OR is_admin()
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

-- character_perks policies
DROP POLICY IF EXISTS "character_perks_select" ON character_perks;
DROP POLICY IF EXISTS "character_perks_mutate" ON character_perks;

CREATE POLICY "character_perks_select"
    ON character_perks FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (c.is_public = true OR p.user_id = auth.uid() OR is_admin())
        )
    );

CREATE POLICY "character_perks_mutate"
    ON character_perks FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM characters c
            JOIN profiles p ON p.id = c.creator_id
            WHERE c.id = character_perks.character_id
              AND (p.user_id = auth.uid() OR is_admin())
        )
    );

-- Missions policies
DROP POLICY IF EXISTS "missions_public_select" ON missions;
DROP POLICY IF EXISTS "missions_owner_host_admin_select" ON missions;
DROP POLICY IF EXISTS "missions_owner_host_editor_admin_select" ON missions;
DROP POLICY IF EXISTS "missions_insert" ON missions;
DROP POLICY IF EXISTS "missions_update" ON missions;
DROP POLICY IF EXISTS "missions_delete" ON missions;

CREATE POLICY "missions_public_select"
    ON missions FOR SELECT
    USING (is_public = true);

-- Owners, hosts, editors, and admins can view private missions
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

-- Owners, hosts, editors, and admins can update missions
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

-- Mission characters policies
DROP POLICY IF EXISTS "mission_characters_select" ON mission_characters;
DROP POLICY IF EXISTS "mission_characters_mutate" ON mission_characters;

CREATE POLICY "mission_characters_select"
    ON mission_characters FOR SELECT
    USING (
        is_mission_public(mission_id)
        OR is_mission_owner_or_host(mission_id)
        OR is_mission_editor(mission_id)
        OR EXISTS (
            SELECT 1 FROM characters c
            JOIN profiles pc ON pc.id = c.creator_id
            WHERE c.id = mission_characters.character_id
              AND pc.user_id = auth.uid()
        )
        OR is_admin()
    );

-- Creators, hosts, editors, and character owners can mutate mission_characters
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

-- Mission editors policies
DROP POLICY IF EXISTS "mission_editors_select" ON mission_editors;
DROP POLICY IF EXISTS "mission_editors_insert" ON mission_editors;
DROP POLICY IF EXISTS "mission_editors_delete" ON mission_editors;

-- Anyone can see editors of public missions, or missions they're involved with
-- Uses SECURITY DEFINER helpers to avoid infinite recursion with missions policies
CREATE POLICY "mission_editors_select"
    ON mission_editors FOR SELECT
    USING (
        is_mission_public(mission_id)
        OR is_mission_owner_or_host(mission_id)
        OR is_mission_editor(mission_id)
        OR is_admin()
    );

-- Mission creator or host can add editors
-- "existing editors can add" is enforced in application code
CREATE POLICY "mission_editors_insert"
    ON mission_editors FOR INSERT
    WITH CHECK (
        is_mission_owner_or_host(mission_id)
        OR is_admin()
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
                p.user_id = auth.uid() OR is_admin()
            )
        )
    );

CREATE POLICY "lfg_posts_delete"
    ON lfg_posts FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE (p.id = creator_id OR p.id = host_id) AND (
                p.user_id = auth.uid() OR is_admin()
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

-- Rules PDFs policies
CREATE POLICY "Rules PDFs viewable publicly"
    ON rules_pdfs FOR SELECT
    USING (is_active = true);

CREATE POLICY "Rules PDFs admin manage"
    ON rules_pdfs FOR ALL
    USING (
        auth.uid() IS NULL 
        OR EXISTS (
            SELECT 1 FROM profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    )
    WITH CHECK (
        auth.uid() IS NULL 
        OR EXISTS (
            SELECT 1 FROM profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Rules PDF unlocks policies
CREATE POLICY "Users view own rules unlocks"
    ON rules_pdf_unlocks FOR SELECT
    USING (user_id = auth.uid() OR auth.uid() IS NULL);

CREATE POLICY "Admins manage rules unlocks"
    ON rules_pdf_unlocks FOR ALL
    USING (
        auth.uid() IS NULL 
        OR EXISTS (
            SELECT 1 FROM profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    )
    WITH CHECK (
        auth.uid() IS NULL 
        OR EXISTS (
            SELECT 1 FROM profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Storage bucket for rules PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('rules-pdfs', 'rules-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for rules-pdfs bucket
CREATE POLICY "Admins can upload rules PDFs"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'rules-pdfs'
        AND EXISTS (
            SELECT 1 FROM profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can update rules PDFs"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'rules-pdfs'
        AND EXISTS (
            SELECT 1 FROM profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can delete rules PDFs"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'rules-pdfs'
        AND EXISTS (
            SELECT 1 FROM profiles 
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Authenticated users can read rules PDFs"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'rules-pdfs'
        AND auth.role() = 'authenticated'
    );

-- CMS Pages table
CREATE TABLE IF NOT EXISTS pages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    slug text NOT NULL UNIQUE,
    content text NOT NULL DEFAULT '',
    access_level text NOT NULL CHECK (access_level IN ('public', 'authenticated', 'admin')) DEFAULT 'public',
    is_published boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
CREATE INDEX IF NOT EXISTS idx_pages_published ON pages(is_published);
CREATE INDEX IF NOT EXISTS idx_pages_access_level ON pages(access_level);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies for pages table
CREATE POLICY "Public pages are viewable by everyone"
    ON pages FOR SELECT
    USING (
        is_published = true
        AND access_level = 'public'
    );

CREATE POLICY "Authenticated pages are viewable by authenticated users"
    ON pages FOR SELECT
    USING (
        is_published = true
        AND access_level IN ('public', 'authenticated')
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Admin pages are viewable by admins"
    ON pages FOR SELECT
    USING (
        is_published = true
        AND access_level = 'admin'
        AND is_admin()
    );

CREATE POLICY "Admins can view unpublished pages"
    ON pages FOR SELECT
    USING (
        is_published = false
        AND is_admin()
    );

CREATE POLICY "Only admins can create pages"
    ON pages FOR INSERT
    WITH CHECK (is_admin());

CREATE POLICY "Only admins can update pages"
    ON pages FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "Only admins can delete pages"
    ON pages FOR DELETE
    USING (is_admin());

-- Navigation Items table
CREATE TABLE IF NOT EXISTS nav_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label text NOT NULL,
    type text NOT NULL CHECK (type IN ('link', 'page', 'dropdown')) DEFAULT 'link',
    url text,  -- For 'link' type (can be internal or external)
    page_id uuid REFERENCES pages(id) ON DELETE SET NULL,  -- For 'page' type
    icon text,  -- FontAwesome icon class (e.g., 'fas fa-home')
    parent_id uuid REFERENCES nav_items(id) ON DELETE CASCADE,  -- For dropdown sub-items
    position integer NOT NULL DEFAULT 0,  -- Ordering within same parent
    requires_auth boolean NOT NULL DEFAULT false,  -- Show only when authenticated
    requires_admin boolean NOT NULL DEFAULT false,  -- Show only for admins
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nav_items_parent ON nav_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_nav_items_position ON nav_items(parent_id, position);
CREATE INDEX IF NOT EXISTS idx_nav_items_active ON nav_items(is_active);

ALTER TABLE nav_items ENABLE ROW LEVEL SECURITY;

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_nav_items_updated_at
    BEFORE UPDATE ON nav_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies for nav_items table
CREATE POLICY "Everyone can view active nav items"
    ON nav_items FOR SELECT
    USING (is_active = true);

CREATE POLICY "Only admins can create nav items"
    ON nav_items FOR INSERT
    WITH CHECK (is_admin());

CREATE POLICY "Only admins can update nav items"
    ON nav_items FOR UPDATE
    USING (is_admin())
    WITH CHECK (is_admin());

CREATE POLICY "Only admins can delete nav items"
    ON nav_items FOR DELETE
    USING (is_admin());
