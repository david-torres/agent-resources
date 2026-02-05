require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role key to bypass RLS
// Use SUPABASE_SERVICE_ROLE_KEY if available, otherwise fall back to SUPABASE_KEY
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

/**
 * Create a nav item directly using the service role client
 */
async function createNavItemDirect(payload) {
    // If no position specified, get the next position for this parent
    if (payload.position === undefined || payload.position === null) {
        const { data: siblings } = await supabase
            .from('nav_items')
            .select('position')
            .eq('parent_id', payload.parent_id || null)
            .order('position', { ascending: false })
            .limit(1);
        
        payload.position = siblings && siblings.length > 0 
            ? siblings[0].position + 1 
            : 0;
    }

    const { data, error } = await supabase
        .from('nav_items')
        .insert(payload)
        .select()
        .single();
    
    if (error) {
        console.error('Error creating nav item:', error);
        return { data: null, error };
    }
    return { data, error: null };
}

/**
 * Seed the navigation items table with the existing navigation structure
 * Run this once after creating the nav_items table
 * 
 * Usage: node util/seed-nav.js
 * 
 * Set CLEAR_EXISTING=true to clear existing items before seeding
 */
async function seedNavItems() {
    // Check if we should clear existing items first
    if (process.env.CLEAR_EXISTING === 'true') {
        const { clearNavItems } = require('./clear-nav');
        console.log('Clearing existing navigation items...');
        await clearNavItems();
    }

    // Check if nav items already exist
    const { data: existingItems } = await supabase
        .from('nav_items')
        .select('id')
        .limit(1);

    if (existingItems && existingItems.length > 0) {
        console.log('⚠️  Navigation items already exist!');
        console.log('   To re-seed, either:');
        console.log('   1. Run: CLEAR_EXISTING=true bun util/seed-nav.js');
        console.log('   2. Or manually delete items at /nav/manage');
        console.log('   3. Or run: bun util/clear-nav.js then bun util/seed-nav.js');
        return;
    }

    console.log('Seeding navigation items...');

    try {
        // Game Info dropdown
        const gameInfo = await createNavItemDirect({
            label: 'Game Info',
            type: 'dropdown',
            icon: null,
            position: 0,
            requires_auth: false,
            requires_admin: false,
            is_active: true
        });

        if (gameInfo.error) {
            console.error('Error creating Game Info dropdown:', gameInfo.error);
            throw gameInfo.error;
        }

        const gameInfoId = gameInfo.data.id;
        console.log('Created Game Info dropdown');

        // Game Info children
        const rulesLib = await createNavItemDirect({
            label: 'Rules Library',
            type: 'link',
            url: '/rules',
            icon: 'fas fa-scroll',
            parent_id: gameInfoId,
            position: 0,
            requires_auth: false,
            requires_admin: false,
            is_active: true
        });
        if (rulesLib.error) console.error('Error creating Rules Library:', rulesLib.error);
        else console.log('Created Rules Library');

        const classes = await createNavItemDirect({
            label: 'Classes',
            type: 'link',
            url: '/classes',
            icon: 'fas fa-chess-knight',
            parent_id: gameInfoId,
            position: 1,
            requires_auth: false,
            requires_admin: false,
            is_active: true
        });
        if (classes.error) console.error('Error creating Classes:', classes.error);
        else console.log('Created Classes');

        const myPCCs = await createNavItemDirect({
            label: 'My PCCs',
            type: 'link',
            url: '/classes/my',
            icon: 'fas fa-chess',
            parent_id: gameInfoId,
            position: 2,
            requires_auth: true,
            requires_admin: false,
            is_active: true
        });
        if (myPCCs.error) console.error('Error creating My PCCs:', myPCCs.error);
        else console.log('Created My PCCs');

        const redeem = await createNavItemDirect({
            label: 'Redeem Unlock Codes',
            type: 'link',
            url: '/classes/redeem/bulk',
            icon: 'fas fa-ticket',
            parent_id: gameInfoId,
            position: 3,
            requires_auth: false,
            requires_admin: false,
            is_active: true
        });
        if (redeem.error) console.error('Error creating Redeem Unlock Codes:', redeem.error);
        else console.log('Created Redeem Unlock Codes');

        // Social dropdown
        const social = await createNavItemDirect({
            label: 'Social',
            type: 'dropdown',
            icon: null,
            position: 1,
            requires_auth: false,
            requires_admin: false,
            is_active: true
        });

        if (social.error) {
            console.error('Error creating Social dropdown:', social.error);
            throw social.error;
        }

        const socialId = social.data.id;
        console.log('Created Social dropdown');

        // Social children
        const lfg = await createNavItemDirect({
            label: 'Looking for Game',
            type: 'link',
            url: '/lfg',
            icon: 'fas fa-people-group',
            parent_id: socialId,
            position: 0,
            requires_auth: true,
            requires_admin: false,
            is_active: true
        });
        if (lfg.error) console.error('Error creating Looking for Game:', lfg.error);
        else console.log('Created Looking for Game');

        const searchChars = await createNavItemDirect({
            label: 'Search Characters',
            type: 'link',
            url: '/characters/search',
            icon: 'fas fa-search',
            parent_id: socialId,
            position: 1,
            requires_auth: false,
            requires_admin: false,
            is_active: true
        });
        if (searchChars.error) console.error('Error creating Search Characters:', searchChars.error);
        else console.log('Created Search Characters');

        const searchMissions = await createNavItemDirect({
            label: 'Search Mission Logs',
            type: 'link',
            url: '/missions/search',
            icon: 'fas fa-scroll',
            parent_id: socialId,
            position: 2,
            requires_auth: false,
            requires_admin: false,
            is_active: true
        });
        if (searchMissions.error) console.error('Error creating Search Mission Logs:', searchMissions.error);
        else console.log('Created Search Mission Logs');

        // Characters (top level, requires auth)
        const characters = await createNavItemDirect({
            label: 'Characters',
            type: 'link',
            url: '/characters',
            icon: 'fas fa-masks-theater',
            position: 2,
            requires_auth: true,
            requires_admin: false,
            is_active: true
        });
        if (characters.error) console.error('Error creating Characters:', characters.error);
        else console.log('Created Characters');

        // Mission Log (top level, requires auth)
        const missions = await createNavItemDirect({
            label: 'Mission Log',
            type: 'link',
            url: '/missions',
            icon: 'fas fa-book',
            position: 3,
            requires_auth: true,
            requires_admin: false,
            is_active: true
        });
        if (missions.error) console.error('Error creating Mission Log:', missions.error);
        else console.log('Created Mission Log');

        // Admin dropdown (requires admin role)
        const admin = await createNavItemDirect({
            label: 'Admin',
            type: 'dropdown',
            icon: 'fas fa-cog',
            position: 4,
            requires_auth: true,
            requires_admin: true,
            is_active: true
        });

        if (admin.error) {
            console.error('Error creating Admin dropdown:', admin.error);
            throw admin.error;
        }

        const adminId = admin.data.id;
        console.log('Created Admin dropdown');

        // Admin children
        const pagesManage = await createNavItemDirect({
            label: 'Manage Pages',
            type: 'link',
            url: '/pages/manage',
            icon: 'fas fa-file-alt',
            parent_id: adminId,
            position: 0,
            requires_auth: true,
            requires_admin: true,
            is_active: true
        });
        if (pagesManage.error) console.error('Error creating Manage Pages:', pagesManage.error);
        else console.log('Created Manage Pages');

        const navManage = await createNavItemDirect({
            label: 'Manage Navigation',
            type: 'link',
            url: '/nav/manage',
            icon: 'fas fa-bars',
            parent_id: adminId,
            position: 1,
            requires_auth: true,
            requires_admin: true,
            is_active: true
        });
        if (navManage.error) console.error('Error creating Manage Navigation:', navManage.error);
        else console.log('Created Manage Navigation');

        console.log('\n✅ Navigation items seeded successfully!');
        console.log('Note: Profile and Sign Out buttons are still hardcoded in the nav partial.');
    } catch (error) {
        console.error('Error seeding navigation items:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    seedNavItems()
        .then(() => {
            console.log('Seed completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Error seeding nav items:', error);
            process.exit(1);
        });
}

module.exports = { seedNavItems };
