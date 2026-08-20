#!/usr/bin/env bun
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const integrationFiles = new Set([
  'models/character-atomic.integration.test.js',
  'models/character-level-up.integration.test.js',
  'models/nav-rls.integration.test.js',
  'models/lfg-agent.test.js',
  'routes/bot-link.test.js',
  'util/core-roster.integration.test.js'
]);
const httpFiles = new Set([
  'routes/badges.test.js',
  'routes/bot-link-confirm.test.js',
  'routes/character-details.test.js',
  'routes/character-level-up.test.js',
  'routes/character-offscreen.test.js',
  'routes/character-wizard.test.js',
  'routes/characters.test.js',
  'routes/class-view-unlock-resolution.test.js',
  'routes/classes-stat-spread.test.js',
  'routes/lfg-conduit-join.test.js',
  'routes/lfg-log-game.test.js',
  'routes/library-book-type.test.js',
  'routes/missions-log-game.test.js',
  'routes/missions.test.js',
  'routes/nav-manage-navbar.test.js',
  'routes/open-graph.test.js',
  'routes/pages.test.js',
  'routes/party.test.js',
  'routes/sitemap.test.js'
]);
const mode = process.argv[2] || 'unit';

const testFiles = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? testFiles(`${dir}/${entry.name}`)
    : entry.name.endsWith('.test.js') ? [`${dir}/${entry.name}`] : []);

const allFiles = ['models', 'routes', 'services', 'test', 'util', 'views'].flatMap(testFiles).sort();
const files = mode === 'integration'
  ? allFiles.filter(file => integrationFiles.has(file))
  : mode === 'http'
    ? allFiles.filter(file => httpFiles.has(file))
    : allFiles.filter(file => !integrationFiles.has(file) && !httpFiles.has(file));

if (!['unit', 'http', 'integration'].includes(mode)) {
  console.error('Usage: bun scripts/run-tests.mjs <unit|http|integration>');
  process.exit(1);
}

if (mode === 'integration') {
  const url = process.env.SUPABASE_URL || '';
  if (!/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(url)) {
    console.error('Integration tests require local Supabase: set SUPABASE_URL=http://127.0.0.1:54321 after `supabase start`.');
    process.exit(1);
  }
}

// Unit and HTTP tests must be runnable from a clean checkout. A few legacy
// modules construct their Supabase clients at import time even when the test
// exercises only pure functions, so provide inert placeholder credentials to
// child test processes. Integration tests intentionally use only the caller's
// local-Supabase credentials.
//
// OPENAI_API_KEY is here for the same reason: util/class-import.js:7 builds an
// OpenAIChatApi at import time and llm-api throws when the key is unset, so
// every test that reaches routes/classes.js -- which requires class-import at
// the top -- died on a clean checkout. Never a real key: nothing under test
// calls the model, and the placeholder only has to be non-empty.
const testEnv = mode === 'integration'
  ? process.env
  : {
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL || 'https://test.invalid',
      SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key',
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || 'test-secret-key',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'test-openai-key'
    };

// Run one file per Bun process. Several older tests install process-global
// module mocks; isolation keeps unit tests deterministic and DB-free.
for (const file of files) {
  const result = spawnSync('bun', ['test', file], { cwd: root, stdio: 'inherit', env: testEnv });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
