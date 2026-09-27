const { test, expect } = require('bun:test');

const { migrationConnectionConfig } = await import('../scripts/migration-connection.mjs');

test.each([
  'https://exampleproject.supabase.co',
  'https://db.exampleproject.supabase.co',
  'db.exampleproject.supabase.co'
])('hosted URL %s uses the project ref in the pooler username', (url) => {
  const config = migrationConnectionConfig(url, 'test-password', 'aws-0-us-west-2');

  expect(config).toEqual({
    host: 'aws-0-us-west-2.pooler.supabase.com',
    port: 6543,
    user: 'postgres.exampleproject',
    password: 'test-password',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });
});

test.each([
  ['http://localhost:54321', 'localhost'],
  ['http://127.0.0.1:54321/', '127.0.0.1'],
  ['http://192.168.1.25:54321', '192.168.1.25']
])('local URL %s uses the direct Postgres connection', (url, hostname) => {
  expect(migrationConnectionConfig(url, 'test-password')).toEqual({
    host: hostname,
    port: 54322,
    user: 'postgres',
    password: 'test-password',
    database: 'postgres',
    connectionTimeoutMillis: 10000
  });
});
