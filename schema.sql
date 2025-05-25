-- profile table
CREATE TABLE profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) UNIQUE,
  is_public BOOLEAN NULL DEFAULT FALSE,
  name TEXT NOT NULL,
  bio TEXT NULL,
  image_url TEXT NULL,
  timezone TEXT NULL DEFAULT 'UTC'
);

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
            EXISTS (
                SELECT 1 FROM auth.users 
                WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'
            )
        )
    );

CREATE POLICY "Classes can be created by admin or player"
    ON classes FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'
        ) OR
        is_player_created = true
    );

CREATE POLICY "Classes can be updated by owner or admin"
    ON classes FOR UPDATE
    USING (
        created_by = auth.uid() OR 
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'
        )
    );

-- RLS Policies for class_unlocks table
CREATE POLICY "Users can view their own unlocks"
    ON class_unlocks FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Only admins can create unlocks"
    ON class_unlocks FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'
        )
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
