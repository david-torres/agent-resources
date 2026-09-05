require('./env');
const { createClient } = require('@supabase/supabase-js');
const ClassModel = require('../models/class');
const { SYSTEM_ACTOR } = require('./actor');
const { adventClassList, aspirantPreviewClassList, playerCreatedClassList, classStatSpread, classGearList, classAbilityList } = require('./enclave-consts');
const { STARTER_CLASS_UNLOCKS } = require('./starter-content');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);



async function seedClasses() {
    try {
        // Get system admin user ID
        const { data: adminUser, error: adminError } = await supabase
            .from('profiles')
            .select('id', 'user_id')
            .eq('role', 'admin')
            .single();

        console.log(adminUser);

        if (adminError) {
            throw new Error('Failed to find admin user: ' + adminError.message);
        }

        // Set created_by to admin user ID
        const classesWithAdmin = buildHardcodedClasses().map(cls => ({
            ...cls,
            created_by: adminUser.user_id
        }));

        // Insert classes
        for (const classData of classesWithAdmin) {
            try {
                await ClassModel.createClass(SYSTEM_ACTOR, classData);
                console.log(`Successfully seeded class: ${classData.name}`);
            } catch (error) {
                console.error(`Failed to seed class ${classData.name}:`, error.message);
            }
        }

        console.log('Class seeding completed');
    } catch (error) {
        console.error('Error during seeding:', error);
        process.exit(1);
    }
}

// Building the row list must be import-safe (no network, no side effects) so
// it can be unit tested.
const buildRow = (cls, is_player_created) => {
    const row = {
        name: cls,
        description: '',
        is_public: true,
        status: 'release',
        is_player_created,
        rules_edition: 'advent',
        rules_version: 'v1',
        stat_spread: classStatSpread[cls] || {},
        gear: (classGearList[cls] || []).map(name => ({ name, description: '' })),
        abilities: (classAbilityList[cls] || []).map(name => ({ name, description: '' })),
        advanced_abilities: [],
        created_by: null
    };
    if (Object.prototype.hasOwnProperty.call(STARTER_CLASS_UNLOCKS, cls)) {
        row.id = STARTER_CLASS_UNLOCKS[cls];
    }
    return row;
};

const buildHardcodedClasses = () => [
    ...adventClassList.map(cls => buildRow(cls, false)),
    ...aspirantPreviewClassList.map(cls => buildRow(cls, false)),
    ...playerCreatedClassList.map(cls => buildRow(cls, true)),
];

module.exports = { buildHardcodedClasses };

// Run the seed function — only when invoked directly (`bun run seed:classes`),
// never as a side effect of require().
if (require.main === module) {
  seedClasses();
} 