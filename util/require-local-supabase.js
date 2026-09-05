// Integration tests write real rows with the service key. Required at the top of
// every file in `integrationFiles` (scripts/run-tests.mjs) so the check happens
// at import time, before any fixture is created.
//
// scripts/run-tests.mjs guards `bun run test:integration`, but it is not the only
// way in: `bun test <file>` runs a file directly, and bun loads .env first, so on
// a machine whose .env holds production credentials the test suite pointed itself
// at production. That is how 211 auth users, 211 profiles and 212 characters were
// created there. The guard belongs in the files that do the writing, where no
// invocation route can skip it.
const LOCAL_API = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):54321\/?$/;
const LOCAL_DB = /^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost|\[::1\]):54322\//;

const refuse = (name, value) => {
  throw new Error(
    `Refusing to run integration tests: ${name} is not the local Supabase stack.\n` +
    `  ${name}=${value || '(unset)'}\n` +
    'These tests create and delete real rows with the service key. Run `supabase start`,\n' +
    'then set SUPABASE_URL=http://127.0.0.1:54321 (and SUPABASE_DB_URL, if set, to the\n' +
    'local database on port 54322).'
  );
};

const url = process.env.SUPABASE_URL || '';
if (!LOCAL_API.test(url)) refuse('SUPABASE_URL', url);

// Only when set: the fixtures fall back to a hardcoded local DSN otherwise.
const dbUrl = process.env.SUPABASE_DB_URL;
if (dbUrl && !LOCAL_DB.test(dbUrl)) refuse('SUPABASE_DB_URL', dbUrl);
