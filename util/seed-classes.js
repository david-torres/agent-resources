require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ClassModel = require('../models/class');
const { adventClassList, aspirantPreviewClassList, playerCreatedClassList } = require('./enclave-consts');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY // Use service key for admin operations
);

// build a list of classes from the consts
const hardcodedClasses = [
    ...adventClassList.map(cls => ({
        name: cls,
        description: '',
        is_public: true,
        status: 'release',
        is_player_created: false,
        rules_edition: 'advent',
        rules_version: 'v1',
        created_by: null
    })),
    ...aspirantPreviewClassList.map(cls => ({
        name: cls,
        description: '',
        is_public: true,
        status: 'release',
        is_player_created: false,
        rules_edition: 'advent',
        rules_version: 'v1',
        created_by: null
    })),
    ...playerCreatedClassList.map(cls => ({
        name: cls,
        description: '',
        is_public: true,
        status: 'release',
        is_player_created: true,
        rules_edition: 'advent',
        rules_version: 'v1',
        created_by: null
    }))
];


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
        const classesWithAdmin = hardcodedClasses.map(cls => ({
            ...cls,
            created_by: adminUser.user_id
        }));

        // Insert classes
        for (const classData of classesWithAdmin) {
            try {
                await ClassModel.createClass(classData);
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

// Run the seed function
seedClasses(); 