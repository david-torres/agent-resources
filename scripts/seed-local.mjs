#!/usr/bin/env bun
// One-command local app-data seeding for Path B (local Supabase stack).
//
// `supabase db reset` applies migrations + supabase/seed.sql (nav_items). This
// script fills in everything else a working local environment needs, in the
// right dependency order, and is idempotent — each step is skipped when its
// table is already populated, so re-running is safe and never clobbers data.
//
//   nav_items  -> supabase/seed.sql            (if empty)
//   admin      -> seed:admin                   (if no admin profile)
//   classes    -> seed:classes                 (needs admin; if empty)
//   rules_pdfs -> seed:rules                    (needs admin; if empty)
//   badges     -> fetch-badge-art + seed-badges (if empty)
//
// Usage: bun run seed:local [--force]
//   --force  bypass the "must be a local Supabase URL" guard (dangerous).
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const force = process.argv.includes("--force");
const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const log = (m) => console.log(`\x1b[36m[seed:local]\x1b[0m ${m}`);
const ok = (m) => console.log(`\x1b[32m[seed:local] ✓\x1b[0m ${m}`);
const skip = (m) => console.log(`\x1b[90m[seed:local] ·\x1b[0m ${m}`);
const fail = (m) => {
  console.error(`\x1b[31m[seed:local] ✗\x1b[0m ${m}`);
  process.exit(1);
};

function parseEnvUrl() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return "";
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^SUPABASE_URL\s*=\s*(.*)$/);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }
  return "";
}

function assertLocal() {
  const url = parseEnvUrl();
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  if (isLocal) {
    ok(`target is local (${url})`);
    return;
  }
  if (force) {
    log(`--force: proceeding against non-local SUPABASE_URL (${url})`);
    return;
  }
  fail(
    `SUPABASE_URL is not local (${url || "unset"}).\n` +
      "       This script seeds a dev admin and is for the local stack only.\n" +
      "       Point .env at http://127.0.0.1:54321, or pass --force to override.",
  );
}

function run(label, cmd, extraEnv = {}) {
  log(`${label} …`);
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) fail(`${label} failed`);
  ok(label);
}

async function main() {
  console.log("\x1b[1mAgent Resources — local app-data seed\x1b[0m\n");
  assertLocal();

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: LOCAL_DB });
  try {
    await client.connect();
  } catch (e) {
    fail(
      `could not connect to the local database (${LOCAL_DB}).\n` +
        `       Is the stack running? Try 'supabase start'. (${e.message})`,
    );
  }

  const count = async (table) =>
    (await client.query(`select count(*)::int as n from ${table}`)).rows[0].n;

  try {
    // nav_items — normally seeded by `supabase db reset`; backfill if empty.
    if ((await count("nav_items")) > 0) {
      skip("nav_items already seeded");
    } else {
      const sql = await readFile(join(root, "supabase", "seed.sql"), "utf8");
      await client.query(sql);
      ok("nav_items seeded from supabase/seed.sql");
    }

    // admin — required before classes (classes.created_by references it).
    const adminCount = (
      await client.query("select count(*)::int as n from profiles where role = 'admin'")
    ).rows[0].n;
    if (adminCount > 0) {
      skip(`admin profile already present (${adminCount})`);
    } else {
      run("seeding admin (dummy@testing.com)", ["bun", "run", "seed:admin"], { CI: "1" });
    }

    // classes
    if ((await count("classes")) > 0) {
      skip("classes already seeded");
    } else {
      run("seeding classes", ["bun", "run", "seed:classes"]);
    }

    // rules PDFs — needs admin (created_by); the starter rules-PDF unlock
    // grant references this row's id, so it must exist before profiles do.
    if ((await count("rules_pdfs")) > 0) {
      skip("rules_pdfs already seeded");
    } else {
      run("seeding rules PDFs", ["bun", "run", "seed:rules"]);
    }

    // badges — fetch source art (from public prod bucket) then seed.
    if ((await count("badges")) > 0) {
      skip("badges already seeded");
    } else {
      run("fetching badge art", ["bun", "run", "fetch:badges"]);
      run("seeding badges", ["bun", "run", "seed:badges"]);
    }

    console.log("");
    ok("local seeding complete");
    for (const t of ["nav_items", "classes", "rules_pdfs", "badges", "profiles"]) {
      console.log(`      ${t.padEnd(12)} ${await count(t)} rows`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
