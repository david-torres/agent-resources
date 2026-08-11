#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { readFile, copyFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = new Set(process.argv.slice(2));
const withAdmin = args.has("--with-admin");
const withClasses = args.has("--with-classes");
const skipInstall = args.has("--skip-install");
const skipSeed = args.has("--skip-seed");
const dryRun = args.has("--dry-run");
const nonInteractive = args.has("--yes") || !process.stdin.isTTY;

const log = (msg) => console.log(`\x1b[36m[setup]\x1b[0m ${msg}`);
const ok = (msg) => console.log(`\x1b[32m[setup] ✓\x1b[0m ${msg}`);
const warn = (msg) => console.warn(`\x1b[33m[setup] !\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[setup] ✗\x1b[0m ${msg}`);
  process.exit(1);
};

function parseEnvFile(path) {
  const text = readFileSync(path, "utf8");
  const env = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let key = line.slice(0, i).trim();
    let value = line.slice(i + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadDotenv() {
  if (!existsSync(join(root, ".env"))) return {};
  const env = parseEnvFile(join(root, ".env"));
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return env;
}

async function confirm(question) {
  if (nonInteractive) return true;
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function ensureBun() {
  if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0) {
    return;
  }
  fail(
    "Bun is required. Install it with:\n" +
      "    curl -fsSL https://bun.sh/install | bash\n" +
      "Then re-run this script.",
  );
}

async function ensureEnv() {
  const envPath = join(root, ".env");
  const distPath = join(root, ".env.dist");
  if (!existsSync(envPath)) {
    if (!existsSync(distPath)) {
      fail(".env.dist is missing — cannot scaffold a .env file.");
    }
    warn(".env not found — copying .env.dist → .env");
    await copyFile(distPath, envPath);
    ok("created .env from .env.dist");
    console.log(
      "\n[setup] Fill in the required values in .env, then re-run this script.\n" +
        "       Required: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_DB_PASS\n" +
        "       Optional: OPENAI_API_KEY, SYSTEM_MESSAGE_*\n",
    );
    fail("waiting for .env to be filled in");
  }
  const env = parseEnvFile(envPath);
  const required = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_DB_PASS",
  ];
  const missing = required.filter((k) => !env[k] || env[k].trim() === "");
  if (missing.length > 0) {
    fail(
      `Missing required .env values: ${missing.join(", ")}\n` +
        `       Open .env and fill them in, then re-run this script.`,
    );
  }
  loadDotenv();
  ok(".env loaded");
}

async function installDeps() {
  if (skipInstall) {
    log("skipping bun install (--skip-install)");
    return;
  }
  if (existsSync(join(root, "node_modules"))) {
    log("node_modules already present — skipping bun install");
    return;
  }
  log("running bun install …");
  const result = spawnSync("bun", ["install"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) fail("bun install failed");
  ok("dependencies installed");
}

async function makeClient() {
  // Keep the dry-run path dependency-free: it must not require an installed
  // driver merely to describe the work it would do.
  const { default: pg } = await import("pg");
  const raw = process.env.SUPABASE_URL;
  const password = process.env.SUPABASE_DB_PASS;
  const projectRef = extractProjectRef(raw);
  if (!projectRef) {
    fail(
      `Could not extract Supabase project ref from SUPABASE_URL=${JSON.stringify(raw)}.\n` +
        "       Expected formats: https://<ref>.supabase.co, db.<ref>.supabase.co, or just <ref>.",
    );
  }
  const region = process.env.SUPABASE_DB_REGION || "aws-0-us-east-1";
  return {
    projectRef,
    client: new pg.Client({
      host: `${region}.pooler.supabase.com`,
      port: 6543,
      user: `postgres.${projectRef}`,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    }),
  };
}

function extractProjectRef(url) {
  if (!url) return "";
  let u = String(url).trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  u = u.replace(/^db\./, "");
  u = u.replace(/\.supabase\.co.*$/, "");
  return u;
}

async function connect(client) {
  try {
    await client.connect();
  } catch (err) {
    fail(
      `Could not connect to ${client.host}: ${err.message}\n` +
        "       If your project is in another region, set SUPABASE_DB_REGION in .env\n" +
        "       (`bun run scripts/probe-region.mjs` detects it).",
    );
  }
  const { rows } = await client.query("select current_database() as db");
  ok(`connected to ${rows[0].db}`);
}

async function ensureTracking(client) {
  await client.query(
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[],
       name text,
       applied_at timestamptz not null default now()
     );`,
  );
}

async function isApplied(client, version) {
  const { rows } = await client.query(
    "select 1 from supabase_migrations.schema_migrations where version = $1",
    [version],
  );
  return rows.length > 0;
}

async function recordApplied(client, version, name) {
  await client.query(
    `insert into supabase_migrations.schema_migrations (version, statements, name)
     values ($1, $2, $3) on conflict (version) do nothing`,
    [version, [], name],
  );
}

async function applySql(client, label, sql, opts = {}) {
  const { allowNotices = true } = opts;
  if (dryRun) {
    log(`(dry-run) would apply ${label}`);
    return;
  }
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    ok(label || "applied");
  } catch (e) {
    await client.query("rollback");
    if (allowNotices && /already exists/i.test(e.message)) {
      warn(`${label} — already exists, continuing`);
      return;
    }
    fail(`${label} — ${e.message}`);
  }
}

async function applyMigrations(client) {
  const dir = join(root, "supabase", "migrations");
  if (!existsSync(dir)) {
    warn("supabase/migrations/ not found — skipping");
    return;
  }
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    log("no migration files");
    return;
  }
  let appliedCount = 0;
  let skippedCount = 0;
  for (const f of files) {
    const version = f.split("_")[0];
    if (await isApplied(client, version)) {
      skippedCount++;
      continue;
    }
    const sql = await readFile(join(dir, f), "utf8");
    log(`applying migration ${f} …`);
    try {
      await client.query("begin");
      await client.query(sql);
      await recordApplied(client, version, f);
      await client.query("commit");
      ok(`migration ${f}`);
      appliedCount++;
    } catch (e) {
      await client.query("rollback");
      fail(`migration ${f} — ${e.message}`);
    }
  }
  if (appliedCount === 0 && skippedCount > 0) {
    log(`all ${skippedCount} migrations already applied`);
  } else if (appliedCount === 0 && skippedCount === 0) {
    log("no migrations to apply");
  }
}

async function applySeed(client) {
  if (skipSeed) {
    log("skipping supabase/seed.sql (--skip-seed)");
    return;
  }
  const path = join(root, "supabase", "seed.sql");
  if (!existsSync(path)) {
    log("supabase/seed.sql not found — nothing to seed");
    return;
  }
  const { rows } = await client.query("select count(*)::int as n from nav_items");
  if (rows[0].n > 0) {
    log(`nav_items already has ${rows[0].n} rows — skipping seed`);
    return;
  }
  const sql = await readFile(path, "utf8");
  log("seeding nav_items from supabase/seed.sql …");
  await applySql(client, "supabase/seed.sql applied", sql, { allowNotices: false });
}

async function maybeSeedAdmin() {
  if (!withAdmin) {
    log("skipping admin seed (use --with-admin to enable)");
    return;
  }
  if (!nonInteractive) {
    const ok = await confirm(
      "[setup] seed:admin creates dummy@testing.com / dummypassword. Continue?",
    );
    if (!ok) {
      log("skipping admin seed");
      return;
    }
  } else {
    warn("seeding admin user dummy@testing.com (non-interactive mode)");
  }
  const result = spawnSync("bun", ["run", "seed:admin"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });
  if (result.status !== 0) fail("seed:admin failed");
}

async function maybeSeedClasses() {
  if (!withClasses) {
    log("skipping class seed (use --with-classes to enable)");
    return;
  }
  log("seeding classes …");
  const result = spawnSync("bun", ["run", "seed:classes"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) fail("seed:classes failed");
}

function printSummary() {
  console.log("");
  console.log("\x1b[32m========================================\x1b[0m");
  console.log("\x1b[32m  Setup complete!\x1b[0m");
  console.log("\x1b[32m========================================\x1b[0m");
  console.log("");
  console.log("Next steps:");
  console.log("  bun run dev          # start the app in dev mode");
  console.log("  bun run start        # start in production mode");
  console.log("  bun test             # run isolated unit tests");
  console.log("  bun run test:integration  # run local-Supabase integration tests");
  console.log("");
  if (!withAdmin) {
    console.log("Optional seeds (re-run with flags):");
    console.log("  bun run setup --with-admin    # seed dummy@testing.com admin user");
    console.log("  bun run setup --with-classes  # seed class definitions");
  }
  console.log("");
}

async function main() {
  console.log("\x1b[1mAgent Resources — first-time setup\x1b[0m");
  console.log("");
  await ensureBun();
  if (dryRun) {
    log('dry-run: would verify .env, install dependencies if needed, then apply pending cloud migrations and nav seed.');
    log('dry-run does not read or write the database, create .env, install packages, or run optional seeds.');
    return;
  }
  await ensureEnv();
  await installDeps();

  const { client } = await makeClient();
  try {
    await connect(client);
    await ensureTracking(client);
    await applyMigrations(client);
    await applySeed(client);
  } finally {
    await client.end();
  }

  await maybeSeedAdmin();
  await maybeSeedClasses();

  printSummary();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
