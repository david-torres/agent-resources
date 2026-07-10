#!/usr/bin/env bun
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const integrationFiles = new Set([
  'models/character-atomic.integration.test.js',
  'models/lfg-agent.test.js',
  'routes/bot-link.test.js'
]);
const httpFiles = new Set([
  'routes/badges.test.js',
  'routes/character-level-up.test.js',
  'routes/character-wizard.test.js',
  'routes/characters.test.js',
  'routes/classes-stat-spread.test.js',
  'routes/missions.test.js'
]);
const mode = process.argv[2] || 'unit';

const testFiles = (dir) => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? testFiles(`${dir}/${entry.name}`)
    : entry.name.endsWith('.test.js') ? [`${dir}/${entry.name}`] : []);

const allFiles = ['models', 'routes', 'util', 'views'].flatMap(testFiles).sort();
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

// Run one file per Bun process. Several older tests install process-global
// module mocks; isolation keeps unit tests deterministic and DB-free.
for (const file of files) {
  const result = spawnSync('bun', ['test', file], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
