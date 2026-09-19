// scripts/run-tests.mjs exited on the FIRST failing file, so a tier stopped
// before reaching anything that sorted after a known failure -- which is how
// util/stat-caps-integrity.integration.test.js came to be registered in the
// integration allowlist without the tier ever being able to run it (three
// pre-existing failures sort before it).
//
// The runner's two testable halves are exported for this file: which files a
// tier selects, and how a run over them is reported. Everything else in that
// script is argv, env and process.exit, guarded behind `import.meta.main` so
// importing it here neither scans nor spawns anything.
const { test, expect } = require('bun:test');

const runner = () => import('../scripts/run-tests.mjs');

const FILES = ['a.test.js', 'b.test.js', 'c.test.js'];

test('every selected file runs even after one of them fails', async () => {
  const { runSelected } = await runner();
  const ran = [];
  const failed = runSelected(FILES, {
    spawn: (_cmd, args) => {
      ran.push(args[1]);
      return { status: args[1] === 'a.test.js' ? 1 : 0 };
    },
    log: () => {}
  });

  expect(ran).toEqual(FILES);
  expect(failed).toEqual(['a.test.js']);
});

test('the summary names every failing file', async () => {
  const { runSelected } = await runner();
  const lines = [];
  const failed = runSelected(FILES, {
    spawn: (_cmd, args) => ({ status: args[1] === 'b.test.js' ? 0 : 1 }),
    log: (line) => lines.push(line)
  });

  expect(failed).toEqual(['a.test.js', 'c.test.js']);
  const summary = lines.join('\n');
  expect(summary).toContain('a.test.js');
  expect(summary).toContain('c.test.js');
  expect(summary).not.toContain('b.test.js');
});

test('a clean run reports no failures and prints no summary', async () => {
  const { runSelected } = await runner();
  const lines = [];
  expect(runSelected(FILES, { spawn: () => ({ status: 0 }), log: (l) => lines.push(l) }))
    .toEqual([]);
  expect(lines).toEqual([]);
});

// A failure must never be downgraded to a warning: the exit code the script
// uses is derived from this list, so an empty list is the only green.
test('a null spawn status counts as a failure', async () => {
  const { runSelected } = await runner();
  expect(runSelected(['a.test.js'], { spawn: () => ({ status: null }), log: () => {} }))
    .toEqual(['a.test.js']);
});

// Which files each tier selects is unchanged by the fix above; pinned so a
// later edit to the reporting cannot quietly move a file between tiers.
test('tier selection is unchanged: three disjoint tiers over the same scan', async () => {
  const { selectFiles } = await runner();
  const all = [
    'models/character-atomic.integration.test.js',
    'routes/characters.test.js',
    'services/character/input.test.js',
    'util/stat-caps-integrity.integration.test.js',
    'util/stat-caps.test.js'
  ];

  expect(selectFiles('integration', all)).toEqual([
    'models/character-atomic.integration.test.js',
    'util/stat-caps-integrity.integration.test.js'
  ]);
  expect(selectFiles('http', all)).toEqual(['routes/characters.test.js']);
  expect(selectFiles('unit', all)).toEqual([
    'services/character/input.test.js',
    'util/stat-caps.test.js'
  ]);
});
