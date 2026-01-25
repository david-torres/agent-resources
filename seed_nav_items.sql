-- Seed navigation items with the existing navigation structure
-- Run this after creating the nav_items table
-- Note: UUIDs will be auto-generated, so parent_id references use subqueries

-- Game Info dropdown (parent)
INSERT INTO nav_items (label, type, icon, position, requires_auth, requires_admin, is_active)
VALUES ('Game Info', 'dropdown', NULL, 0, false, false, true)
RETURNING id;

-- Store the Game Info ID (you'll need to replace these with actual IDs after first insert)
-- For now, we'll use a subquery approach

-- Rules Library (child of Game Info)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Rules Library',
    'link',
    '/rules',
    'fas fa-scroll',
    (SELECT id FROM nav_items WHERE label = 'Game Info' AND type = 'dropdown' LIMIT 1),
    0,
    false,
    false,
    true
);

-- Classes (child of Game Info)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Classes',
    'link',
    '/classes',
    'fas fa-chess-knight',
    (SELECT id FROM nav_items WHERE label = 'Game Info' AND type = 'dropdown' LIMIT 1),
    1,
    false,
    false,
    true
);

-- My PCCs (child of Game Info, requires auth)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'My PCCs',
    'link',
    '/classes/my',
    'fas fa-chess',
    (SELECT id FROM nav_items WHERE label = 'Game Info' AND type = 'dropdown' LIMIT 1),
    2,
    true,
    false,
    true
);

-- Redeem Unlock Codes (child of Game Info)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Redeem Unlock Codes',
    'link',
    '/classes/redeem/bulk',
    'fas fa-ticket',
    (SELECT id FROM nav_items WHERE label = 'Game Info' AND type = 'dropdown' LIMIT 1),
    3,
    false,
    false,
    true
);

-- Social dropdown (parent)
INSERT INTO nav_items (label, type, icon, position, requires_auth, requires_admin, is_active)
VALUES ('Social', 'dropdown', NULL, 1, false, false, true);

-- Looking for Game (child of Social, requires auth)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Looking for Game',
    'link',
    '/lfg',
    'fas fa-people-group',
    (SELECT id FROM nav_items WHERE label = 'Social' AND type = 'dropdown' LIMIT 1),
    0,
    true,
    false,
    true
);

-- Search Characters (child of Social)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Search Characters',
    'link',
    '/characters/search',
    'fas fa-search',
    (SELECT id FROM nav_items WHERE label = 'Social' AND type = 'dropdown' LIMIT 1),
    1,
    false,
    false,
    true
);

-- Search Mission Logs (child of Social)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Search Mission Logs',
    'link',
    '/missions/search',
    'fas fa-scroll',
    (SELECT id FROM nav_items WHERE label = 'Social' AND type = 'dropdown' LIMIT 1),
    2,
    false,
    false,
    true
);

-- Characters (top level, requires auth)
INSERT INTO nav_items (label, type, url, icon, position, requires_auth, requires_admin, is_active)
VALUES (
    'Characters',
    'link',
    '/characters',
    'fas fa-masks-theater',
    2,
    true,
    false,
    true
);

-- Mission Log (top level, requires auth)
INSERT INTO nav_items (label, type, url, icon, position, requires_auth, requires_admin, is_active)
VALUES (
    'Mission Log',
    'link',
    '/missions',
    'fas fa-book',
    3,
    true,
    false,
    true
);

-- Admin dropdown (requires admin role)
INSERT INTO nav_items (label, type, icon, position, requires_auth, requires_admin, is_active)
VALUES ('Admin', 'dropdown', 'fas fa-cog', 4, true, true, true);

-- Manage Pages (child of Admin, requires admin)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Manage Pages',
    'link',
    '/pages/manage',
    'fas fa-file-alt',
    (SELECT id FROM nav_items WHERE label = 'Admin' AND type = 'dropdown' LIMIT 1),
    0,
    true,
    true,
    true
);

-- Manage Navigation (child of Admin, requires admin)
INSERT INTO nav_items (label, type, url, icon, parent_id, position, requires_auth, requires_admin, is_active)
VALUES (
    'Manage Navigation',
    'link',
    '/nav/manage',
    'fas fa-bars',
    (SELECT id FROM nav_items WHERE label = 'Admin' AND type = 'dropdown' LIMIT 1),
    1,
    true,
    true,
    true
);
