// SUPABASE_URL points at the API gateway, not the SQL endpoint. Hosted projects
// use the pooler; local stacks use their direct Postgres port.
export function migrationConnectionConfig(supabaseUrl, password, region = "aws-0-us-east-1") {
  const hostname = supabaseUrl.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .split(":")[0];
  const isLocal = !/(^|\.)(supabase\.co|pooler\.supabase\.com)$/.test(hostname);

  if (isLocal) {
    return {
      host: hostname,
      port: 54322,
      user: "postgres",
      password,
      database: "postgres",
      connectionTimeoutMillis: 10000,
    };
  }

  const projectRef = hostname.replace(/^db\./, "").replace(/\.supabase\.co$/, "");
  return {
    host: `${region}.pooler.supabase.com`,
    port: 6543,
    user: `postgres.${projectRef}`,
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  };
}
