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
  'routes/mcp-oauth.integration.test.js',
  'util/class-ability-type.integration.test.js',
  'util/character-content-integrity.integration.test.js',
  'util/character-equipment.integration.test.js',
  'util/class-description-dropped.integration.test.js',
  'util/class-duplicate.integration.test.js',
  'util/class-form-round-trip.integration.test.js',
  'util/class-structured-columns.integration.test.js',
  'util/core-roster.integration.test.js',
  'util/image-crop-integrity.integration.test.js',
  'util/prerelease-classes.integration.test.js',
  'util/stat-caps-integrity.integration.test.js',
  'util/whitespace-integrity.integration.test.js'
]);
const httpFiles = new Set([
  'routes/badges.test.js',
  'routes/agent-read.test.js',
  'routes/bot-link-confirm.test.js',
  'routes/character-details.test.js',
  'routes/character-level-up.test.js',
  'routes/character-offscreen.test.js',
  'routes/character-wizard-aspiring.test.js',
  'routes/character-wizard.test.js',
  'routes/characters.test.js',
  'routes/class-view-unlock-resolution.test.js',
  'routes/classes-stat-spread.test.js',
  'routes/classes-structured-fields.test.js',
  'routes/feedback.test.js',
  'routes/lfg-conduit-join.test.js',
  'routes/lfg-log-game.test.js',
  'routes/mcp.test.js',
  'routes/mcp-class-access.test.js',
  'routes/mcp-transport-failure.test.js',
  'routes/library-book-type.test.js',
  'routes/missions-log-game.test.js',
  'routes/missions.test.js',
  'routes/nav-manage-navbar.test.js',
  'routes/oauth-consent.test.js',
  'routes/oauth-metadata.test.js',
  'routes/open-graph.test.js',
  'routes/pages.test.js',
  'routes/party.test.js',
  'routes/sitemap.test.js'
]);
const TIERS = ['unit', 'http', 'integration'];

// Which tier a file belongs to, over an already-sorted scan. Exported so the
// partition can be pinned by test without running anything.
export const selectFiles = (mode, allFiles) => (
  mode === 'integration'
    ? allFiles.filter(file => integrationFiles.has(file))
    : mode === 'http'
      ? allFiles.filter(file => httpFiles.has(file))
      : allFiles.filter(file => !integrationFiles.has(file) && !httpFiles.has(file))
);

const testFiles = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? testFiles(`${dir}/${entry.name}`)
    : entry.name.endsWith('.test.js') ? [`${dir}/${entry.name}`] : []);

// Run one file per Bun process. Several older tests install process-global
// module mocks; isolation keeps unit tests deterministic and DB-free.
//
// Every selected file runs, and the failures are collected rather than exited
// on. A `process.exit` inside this loop meant a tier stopped at its first
// failing file: three pre-existing failures sort alphabetically before
// util/stat-caps-integrity.integration.test.js, so registering that file in the
// integration allowlist satisfied the requirement in letter while the tier could
// never reach it. A non-zero or absent status is a failure, never a warning --
// the caller's exit code is derived from the returned list.
export const runSelected = (files, { env, spawn = spawnSync, log = console.log } = {}) => {
  const failed = [];
  for (const file of files) {
    const result = spawn('bun', ['test', file], { cwd: root, stdio: 'inherit', env });
    if (result.status !== 0) failed.push(file);
  }
  if (failed.length > 0) {
    log(`\n${failed.length} of ${files.length} test file(s) FAILED:`);
    for (const file of failed) log(`  ${file}`);
  }
  return failed;
};

const main = () => {
  const mode = process.argv[2] || 'unit';

  if (!TIERS.includes(mode)) {
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
  //
  // The placeholders OVERRIDE rather than default. This file is itself run by bun,
  // which loads .env before any of this executes, so `process.env.SUPABASE_URL ||
  // placeholder` never reached the placeholder -- it handed every unit and HTTP
  // test whatever .env held, which on a deploy machine is production and its
  // service key. An integration test that someone forgets to register in
  // integrationFiles at the top of this file then runs against production
  // instead of failing to connect.
  const testEnv = mode === 'integration'
    ? process.env
    : {
        ...process.env,
        SUPABASE_URL: 'https://test.invalid',
        SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
        SUPABASE_SECRET_KEY: 'test-secret-key',
        OPENAI_API_KEY: 'test-openai-key'
      };

  const files = selectFiles(mode, ['models', 'routes', 'services', 'test', 'util', 'views'].flatMap(testFiles).sort());
  process.exit(runSelected(files, { env: testEnv }).length > 0 ? 1 : 0);
};

// Guarded so importing this module for its two exports above neither scans the
// tree, reads argv, spawns a child, nor exits the importing process.
if (import.meta.main) main();
