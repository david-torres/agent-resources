require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role key to bypass RLS
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

/**
 * Clear all navigation items
 * Use with caution - this will delete all nav items!
 */
async function clearNavItems() {
    console.log('Clearing all navigation items...');

    const { error } = await supabase
        .from('nav_items')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all (using a condition that's always true)

    if (error) {
        console.error('Error clearing nav items:', error);
        throw error;
    }

    console.log('✅ All navigation items cleared successfully!');
}

// Run if called directly
if (require.main === module) {
    clearNavItems()
        .then(() => {
            console.log('Clear completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Error clearing nav items:', error);
            process.exit(1);
        });
}

module.exports = { clearNavItems };
