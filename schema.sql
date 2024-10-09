-- profile table
CREATE TABLE profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) UNIQUE,
  name TEXT NOT NULL,
  bio TEXT NULL,
  image_url TEXT NULL
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
  background TEXT NULL
);

-- missions table
CREATE TABLE missions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  focus_words TEXT,
  summary TEXT,
  outcome TEXT,
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  host_id UUID NOT NULL REFERENCES profiles(id)
);

-- mission_log_characters junction table
CREATE TABLE mission_characters (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  mission_id UUID NOT NULL,
  character_id UUID NOT NULL,
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
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
  description TEXT NOT NULL,
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

-- lfg_post_characters junction table
CREATE TABLE lfg_post_characters (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  lfg_post_id UUID NOT NULL,
  character_id UUID NOT NULL,
  status TEXT CHECK (status IN ('applied', 'accepted')) NOT NULL,
  FOREIGN KEY (lfg_post_id) REFERENCES lfg_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);
