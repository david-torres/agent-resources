-- Profile badges: catalog + per-profile awards. Milestone badges are awarded
-- automatically from mission counters (insert-only => permanent); event and
-- personal badges are granted/revoked by admins.
-- Spec: docs/superpowers/specs/2026-06-06-profile-badges-design.md

CREATE TABLE IF NOT EXISTS badges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,            -- 'newcomer-3', 'veteran-player-12', 'enclave-day-7'
    name text NOT NULL,                   -- 'Newcomer III', 'Enclave Day 7'
    description text,
    category text NOT NULL CHECK (category IN ('milestone', 'event', 'personal')),
    track text CHECK (track IN ('newcomer', 'veteran_player', 'veteran_conduit')),
    rank int,                             -- 1..13 within a track (milestone only)
    threshold int,                        -- counter value that earns it (milestone only)
    image_path text NOT NULL,             -- path within the public 'badges' storage bucket
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_badges (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_id uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    awarded_at timestamptz NOT NULL DEFAULT now(),
    granted_by uuid REFERENCES profiles(id),   -- NULL = earned automatically
    PRIMARY KEY (profile_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_badges_badge ON profile_badges(badge_id);
CREATE INDEX IF NOT EXISTS idx_badges_category ON badges(category);

ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_badges ENABLE ROW LEVEL SECURITY;

-- Catalog and awards are public display data (badge shelves render on public
-- profiles). Writes go through the service-role client in the model layer;
-- the admin policies mirror rules_pdf_unlock_codes.
DROP POLICY IF EXISTS "badges_select_all" ON badges;
CREATE POLICY "badges_select_all" ON badges FOR SELECT USING (true);
DROP POLICY IF EXISTS "badges_admin_all" ON badges;
CREATE POLICY "badges_admin_all" ON badges FOR ALL USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "profile_badges_select_all" ON profile_badges;
CREATE POLICY "profile_badges_select_all" ON profile_badges FOR SELECT USING (true);
DROP POLICY IF EXISTS "profile_badges_admin_all" ON profile_badges;
CREATE POLICY "profile_badges_admin_all" ON profile_badges FOR ALL USING (is_admin()) WITH CHECK (is_admin());
