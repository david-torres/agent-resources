import { randomUUID } from "crypto";
import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

function confirmIsDevEnv() {
  const rl = readline.createInterface({
    input,
    output,
  });

  return new Promise((resolve) => {
    rl.question(
      "Do not run this script on Prod. Are you running this in a" +
        " development environment? (y/n) ",
      async (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === "y");
      },
    );
  });
}

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const ADMIN_EMAIL = "dummy@testing.com";
const ADMIN_PASSWORD = "dummypassword";

async function seedAdmin() {
  console.log(
    "This script will seed an admin user in your Supabase project with the " +
      "following credentials:",
  );
  console.log(`Email: ${ADMIN_EMAIL}`);
  console.log(`Password: ${ADMIN_PASSWORD}`);
  // Check if running in dev environment
  const isDevEnv = await confirmIsDevEnv();
  if (!isDevEnv) {
    console.log(
      "This script should only be run in a development environment. Exiting.",
    );
    process.exit(1);
  }

  console.log("Attempting to seed admin user...");

  try {
    // Step 1: Try to find existing user, create if not found
    let userId;

    const {
      data: { users },
      error: listError,
    } = await supabase.auth.admin.listUsers();
    if (listError) {
      throw new Error(`Failed to list users: ${listError.message}`);
    }

    const existingUser = users.find((u) => u.email === ADMIN_EMAIL);

    if (existingUser) {
      userId = existingUser.id;
      console.log(`✓ Found existing auth user with ID: ${userId}`);
    } else {
      const { data: authUser, error: createError } =
        await supabase.auth.admin.createUser({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          email_confirm: true,
        });

      if (createError) {
        throw new Error(`Failed to create auth user: ${createError.message}`);
      }

      userId = authUser.user.id;
      console.log(`✓ Created auth user with ID: ${userId}`);
    }

    // Step 2: Check if profile exists
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (!existingProfile) {
      // Only create if it doesn't exist
      const { error: profileError } = await supabase.from("profiles").insert({
        id: randomUUID(),
        user_id: userId,
        role: "admin",
        name: "Admin",
      });

      if (profileError) {
        throw new Error(`Profile creation failed: ${profileError.message}`);
      }
      console.log("✓ Created admin profile");
    } else {
      console.log("✓ Admin profile already exists");
    }

    console.log("\n✓ Admin user seeding complete!");
    console.log(`Email: ${ADMIN_EMAIL}`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
  } catch (error) {
    console.error("Error during admin seeding:", error.message);
    process.exit(1);
  }
}

seedAdmin();
