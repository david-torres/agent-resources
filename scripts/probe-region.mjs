import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = await readFile(join(__dirname, "..", ".env.jm"), "utf8");
const env = Object.fromEntries(
  envText.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); let v = l.slice(i + 1); if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1); return [l.slice(0, i).trim(), v]; })
);
const host = env.SUPABASE_URL;
const password = env.SUPABASE_DB_PASS;
const projectRef = host.replace(/^db\./, "").replace(/\.supabase\.co$/, "");

const regions = ["us-east-1","us-west-1","eu-west-1","eu-west-2","eu-central-1","ap-southeast-1","ap-southeast-2","ap-northeast-1","ap-northeast-2","sa-east-1"];

for (const r of regions) {
  const c = new pg.Client({ host: `aws-0-${r}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}`, password, database: "postgres", ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    await c.query("select 1");
    console.log(`OK: ${r}`);
    await c.end();
  } catch (e) {
    console.log(`FAIL ${r}: ${(e.message || e).toString().split("\n")[0].slice(0, 80)}`);
  }
}
