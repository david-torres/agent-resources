import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envText = await readFile(join(__dirname, "..", ".env.jm"), "utf8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1);
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    })
);

const host = env.SUPABASE_URL;
const password = env.SUPABASE_DB_PASS;
if (!host || !password) {
  console.error("Missing SUPABASE_URL or SUPABASE_DB_PASS in .env.jm");
  process.exit(1);
}

const projectRef = host.replace(/^db\./, "").replace(/\.supabase\.co$/, "");
const client = new pg.Client({
  host: "aws-0-us-east-1.pooler.supabase.com",
  port: 6543,
  user: `postgres.${projectRef}`,
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

await client.connect();
console.log(`connected to ${host}`);

await client.query(
  'create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);'
);

const { rows: applied } = await client.query(
  "select version from supabase_migrations.schema_migrations"
);
const appliedSet = new Set(applied.map((r) => r.version));
console.log(`already applied: ${applied.size}`);

const migDir = join(__dirname, "..", "supabase", "migrations");
const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort();
console.log(`found ${files.length} migration files`);

const versionOf = (f) => f.split("_")[0];

const pending = files.filter((f) => !appliedSet.has(versionOf(f)));
console.log(`pending: ${pending.length}`);
for (const f of pending) console.log(`  - ${f}`);

if (process.argv.includes("--dry-run")) {
  await client.end();
  process.exit(0);
}

if (pending.length === 0) {
  await client.end();
  console.log("nothing to do");
  process.exit(0);
}

for (const f of pending) {
  const version = versionOf(f);
  const sql = await readFile(join(migDir, f), "utf8");
  console.log(`applying ${f} ...`);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query(
      "insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)",
      [version, [], f]
    );
    await client.query("commit");
    console.log(`  ok`);
  } catch (e) {
    await client.query("rollback");
    console.error(`  FAILED: ${e.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("done");
