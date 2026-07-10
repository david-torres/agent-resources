#!/usr/bin/env bun
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const sourceDirectories = ['models', 'routes', 'services', 'util', 'views'];

const sourceFiles = (directory) => readdirSync(join(root, directory), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? sourceFiles(`${directory}/${entry.name}`)
    : entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') ? [`${directory}/${entry.name}`] : []);

for (const file of sourceDirectories.flatMap(sourceFiles).sort()) {
  const result = spawnSync('node', ['--check', file], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
