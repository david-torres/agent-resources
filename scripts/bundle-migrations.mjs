import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migDir = join(__dirname, "..", "supabase", "migrations");
const out = "/tmp/opencode/apply-unapplied.sql";

const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort();
const versionOf = (f) => f.split("_")[0];

const parts = [];
parts.push(`-- Supabase migration bundle (paste into the Supabase SQL editor)`);
parts.push(`-- Target project: iqqdsoiyevwbetozmwal (from .env.jm)`);
parts.push(`-- Generated: ${new Date().toISOString()}`);
parts.push(`-- Migration count: ${files.length}`);
parts.push(``);
parts.push(`-- These migrations have NOT been applied to the target database.`);
parts.push(`-- Run the entire script in one go. If any statement fails, the`);
parts.push(`-- editor may stop; the tracking inserts at the end will not run`);
parts.push(`-- for any migration whose effects did not commit.`);
parts.push(``);
parts.push(`-- Ensure the supabase CLI tracking table exists.`);
parts.push(`create schema if not exists supabase_migrations;`);
parts.push(`create table if not exists supabase_migrations.schema_migrations (`);
parts.push(`  version text primary key,`);
parts.push(`  statements text[],`);
parts.push(`  name text`);
parts.push(`);`);
parts.push(``);

for (const f of files) {
  const sql = await readFile(join(migDir, f), "utf8");
  parts.push(``);
  parts.push(`-- ============================================================`);
  parts.push(`-- ${f}`);
  parts.push(`-- ============================================================`);
  parts.push(sql.trimEnd());
}

parts.push(``);
parts.push(`-- Mark all migrations as applied (supabase CLI tracking).`);
parts.push(`-- Idempotent: safe to re-run.`);
for (const f of files) {
  const v = versionOf(f);
  const n = f.replace(/'/g, "''");
  parts.push(
    `insert into supabase_migrations.schema_migrations (version, statements, name) values ('${v}', '{}', '${n}') on conflict (version) do nothing;`
  );
}
parts.push(``);

const body = parts.join("\n");
await writeFile(out, body);
const s = await stat(out);
console.log(`wrote ${out} (${s.size} bytes, ${files.length} migrations)`);
for (const f of files) console.log(`  - ${f}`);
