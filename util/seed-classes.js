require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ClassModel = require('../models/class');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY // Use service key for admin operations
);

// Example hard-coded classes (replace with your actual classes)
const hardcodedClasses = [
    {
        name: "Enforcer",
        description: "A tough, combat-focused class that excels in close-quarters combat.",
        visibility: "public",
        status: "release",
        is_player_created: false,
        rules_edition: "v1",
        rules_version: "1.0",
        created_by: null // Will be set to system admin
    },
    {
        name: "Hacker",
        description: "A tech-savvy class that specializes in digital infiltration and control.",
        visibility: "public",
        status: "release",
        is_player_created: false,
        rules_edition: "v1",
        rules_version: "1.0",
        created_by: null
    },
    // Add more classes as needed
];

async function seedClasses() {
    try {
        // Get system admin user ID
        const { data: adminUser, error: adminError } = await supabase
            .from('profiles')
            .select('id')
            .eq('role', 'admin')
            .single();

        if (adminError) {
            throw new Error('Failed to find admin user: ' + adminError.message);
        }

        // Set created_by to admin user ID
        const classesWithAdmin = hardcodedClasses.map(cls => ({
            ...cls,
            created_by: adminUser.id
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