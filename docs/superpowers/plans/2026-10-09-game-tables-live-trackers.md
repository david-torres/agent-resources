# Game Tables Live Trackers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every member of a game table gets a live tracker for Stamina, Essence, per-source use counts, Cooldowns and Conduit-imposed Limiters. Changes reach everyone at the table within seconds.

**Architecture:**
- **Rules:** all rule arithmetic lives in two pure modules. `util/source-meters.js` parses an ability's or Signature's printed meters. `util/exertion.js` holds the budgets, the auto-dropping spend/restore and `applyAction`.
- **Storage:** a new `game_table_member_state` row per member. A trigger creates it when the member is seated. Participants read it under RLS; owners and managers write it.
- **The service:** `GameTableService` builds each tracker view and applies actions through the caller's RLS client with a version check. It runs "New session" with the service-role client.
- **Live updates:** participants get Supabase Realtime pings, and each ping makes htmx re-fetch one tracker fragment. Everyone else polls each tracker every 5 seconds; an unchanged tracker answers 204.

**Tech Stack:** Express 4, express-handlebars, htmx 2 (hx-boost on body), Alpine 3, Bulma, Supabase (PostgREST, RLS, Realtime via supabase-js@2 already loaded in `views/partials/head.handlebars`), bun:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-game-tables-design.md`. This plan covers section 2's `game_table_member_state` table, section 3 ("Exertion arithmetic") and section 5 ("Live trackers"). It is sub-project 3 of 5.

**Branch:** stack on `game-tables-core`, which already has tables, members, `GameTableService`, `routes/tables.js` and the table views.

## Global Constraints

- **Thresholds:** 0 Green, 1 Yellow, 2 Red, 3 Below Red. Every mission starts at Green with nothing spent.
- **Cost units:** Low 1, Mid 3, High 6.
- **Budget per Threshold by pluses:**
  - Will governs Essence and Vigor governs Stamina.
  - The values are **6, 7, 9, 12, 15, 18, 24** for 0–6 pluses. Each plus beyond 6 adds 6 more, and those budgets are flagged approximate.
- **Overflow auto-drops:** when spent reaches the budget, the pool drops a Threshold and the remainder carries into the next. That repeats as needed and stops at Below Red, with spent reset to 0. Restore climbs the same way and stops at Green with nothing spent. A full-Threshold restore restores exactly one budget's worth of units.
- **Range costs:** a cost like `Low–High` (EN DASH, U+2013) needs the user to pick one level within the range before the action is sent. Some stored values end in `+` (`High+`, `Mid–High+`), and the `+` is ignored.
- **Finite Uses:** an exact `Nx`, or `A–Bx` (meaning at most B), shows the number remaining. A rating shows the count against an approximation: Low ≈ 10, Mid ≈ 25, High ≈ 50.
- **Fixed mechanics, in order:** Pitch, Inference, Deduction, Intuition, Happenstance, Manifestation, Heartening, Defiance, Turning Point, Energywork.
- **Source keys:** `ability:<class_abilities.id>`, `gear:<class_gear.id>` and `mechanic:<slug>`. The slugs are `pitch, inference, deduction, intuition, happenstance, manifestation, heartening, defiance, turning-point, energywork`.
- **Who may change a tracker:**
  - The seated character's owner, or the table's creator or Conduit (`canManage`).
  - Guests: `canManage` only.
  - **Only the Conduit** (or an admin) may impose or lift Limiters.
  - Everyone with the link can view.
- **Durations aren't modelled.**
- **New session:** creator or Conduit only, behind a confirm. It resets every member to Green with nothing spent, clears counts, cooldowns, imposed Limiters and undo, and stamps `session_started_at`. It can't be undone.
- **Undo:** each write saves the prior state in `undo`. An undo carries the version the client last saw. When the row has moved past it, the undo is refused with a toast: "Changed by <name> since — undo unavailable."
- **Concurrent writes:** every write is conditional on `version`. On a conflict the server re-reads and re-applies once.
- **Live updates:** participants (creator, Conduit, owners of seated characters) use Realtime, falling back to 5-second polling while disconnected. Everyone else polls every 5 seconds.
- **Database safety:** never run `supabase db reset`; the local database holds data the user restored. Apply migrations with `supabase migration up`, or with `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <file>`. Production is applied by the user (`supabase db push --linked`); never apply to production yourself.
- **Tests:**
  - Use `bun test <file>`, plus the tier scripts `bun run test:unit` / `test:http` / `test:integration`, and Playwright with `--workers=1`.
  - Known reds: unit has only "loader refuses an unsupported explicit Aspirant publication version before insert"; http has none.
  - jsdom/Alpine view tests contaminate each other when run in one `bun test` call, so run them individually.
- **Processes and commits:**
  - Never `pkill`/`killall`; stop servers you start by their PID.
  - Commit only the files you touched (explicit `git add`; never `git commit -a`), ending each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Comments:** describe the code as it is; explain only the non-obvious why.

## Review Focus

1. **A seated character's class changes, or an ability is renamed or removed between sessions.** Its old key stays in `use_counts`/`cooldowns`/`imposed_limiters` but no longer matches a source. It must render without error and simply not show. *Pinned in Task 3 (`a stale source key is ignored`).*
2. **A tap that hits a version conflict twice in a row** (two phones spamming Spend) must answer with a clear 409 toast, not a 500 and not a lost update. *Pinned in Task 3 (`a second conflict gives up with a 409`).*
3. **A guest's tracker:** the Will/Vigor budget comes from `guest_stats`, and only mechanics appear as sources. *Pinned in Task 3 (`a guest tracks pools and mechanics only`).*
4. **A tracker fragment polled for a member that was just removed** must answer 404 quietly. htmx then leaves the old element, and the next full panel swap removes it. It must not throw. *Pinned in Task 4 (`polling a removed member is a 404`).*
5. **A non-ASCII source name** (curly apostrophes are common in class text) carried in the `HX-Trigger` header must not crash Node's header validation. *Pinned in Task 4 (`the toast header survives a curly apostrophe`).*

---

### Task 1: Rules arithmetic

**Files:**
- Create: `util/source-meters.js`
- Create: `util/source-meters.test.js`
- Create: `util/exertion.js`
- Create: `util/exertion.test.js`

**Interfaces:**
- Produces, from `util/source-meters.js`:
  - `levelsIn(value: string) → ('Low'|'Mid'|'High')[]`
  - `parseUses(value: string) → { label, max?: number, approx?: number } | null`
  - `parseMeters(meters: {label, value}[]) → { essenceOptions: string[], staminaOptions: string[], hasCooldown: boolean, uses: object | null, printed: {label, value}[] }`
  - `sourcesFor(character | null) → Source[]`, where `Source = { key, name, kind: 'Ability'|'Signature'|'Mechanic', ...parseMeters }`
  - `MECHANICS: [slug, name][]`
- Produces, from `util/exertion.js`:
  - `THRESHOLDS`, `COST_UNITS`
  - `budgetFor(pluses) → { budget, approximate }`
  - `emptyState() → State`
  - `stateFromRow(row) → State`
  - `stateToColumns(state) → row columns`
  - `snapshotOf(state) → plain object`
  - `applyAction(state, action, { stats, sources }) → { state } | { error: string }`
  - `State = { stamina: {threshold, spent}, essence: {threshold, spent}, useCounts: {}, cooldowns: {}, imposedLimiters: {} }`
  - `Action` types: `use {source, level?}`, `spend {pool, amount}`, `restore {pool, amount: 'Low'|'Mid'|'High'|'Threshold'}`, `set {pool, threshold, spent}`, `toggle_cooldown {source}`, `impose {source, kind, rating}`, `lift {source, index}`.

- [ ] **Step 1: Write the failing meter tests**

`util/source-meters.test.js`:

```js
// Printed ability/Signature meters, read the way the trackers need them.
const { test, expect } = require('bun:test');
const { levelsIn, parseUses, parseMeters, sourcesFor, MECHANICS } = require('./source-meters');

test('a cost is one level, or every level in a range; a trailing + is ignored', () => {
  expect(levelsIn('Mid')).toEqual(['Mid']);
  expect(levelsIn('Low–High')).toEqual(['Low', 'Mid', 'High']);
  expect(levelsIn('Mid–High+')).toEqual(['Mid', 'High']);
  expect(levelsIn('High+')).toEqual(['High']);
  expect(levelsIn('Varies')).toEqual([]);
  expect(levelsIn(undefined)).toEqual([]);
});

test('uses are exact counts, ranges capped at the top, or rating approximations', () => {
  expect(parseUses('3x')).toEqual({ label: '3x', max: 3 });
  expect(parseUses('2–4x')).toEqual({ label: '2–4x', max: 4 });
  expect(parseUses('Low')).toEqual({ label: 'Low', approx: 10 });
  expect(parseUses('Mid')).toEqual({ label: 'Mid', approx: 25 });
  expect(parseUses('High')).toEqual({ label: 'High', approx: 50 });
  expect(parseUses('lots')).toBeNull();
});

test('meters become cost options, a cooldown flag, uses, and the printed limiters to show', () => {
  const parsed = parseMeters([
    { label: 'Essence Cost', value: 'Low–Mid' },
    { label: 'Cooldown', value: 'Mid' },
    { label: 'Uses', value: '3x' },
    { label: 'Range', value: 'High' },
  ]);
  expect(parsed.essenceOptions).toEqual(['Low', 'Mid']);
  expect(parsed.staminaOptions).toEqual([]);
  expect(parsed.hasCooldown).toBe(true);
  expect(parsed.uses).toEqual({ label: '3x', max: 3 });
  expect(parsed.printed).toEqual([
    { label: 'Essence Cost', value: 'Low–Mid' },
    { label: 'Cooldown', value: 'Mid' },
    { label: 'Uses', value: '3x' },
  ]);
});

test('sources list abilities, then Signatures, then the fixed mechanics', () => {
  const sources = sourcesFor({
    abilities: [{ id: 'a1', name: 'Lightning Bolt', meters: [{ label: 'Essence Cost', value: 'Mid' }] }],
    gear: [{ id: 'g1', name: 'Thunder Hammer', meters: [] }],
  });
  expect(sources.slice(0, 2).map((s) => [s.key, s.kind])).toEqual([['ability:a1', 'Ability'], ['gear:g1', 'Signature']]);
  expect(sources.slice(2).map((s) => s.key)).toEqual(MECHANICS.map(([slug]) => `mechanic:${slug}`));
  expect(sourcesFor(null).every((s) => s.kind === 'Mechanic')).toBe(true);
});
```

Run: `bun test util/source-meters.test.js`
Expected: FAIL, `Cannot find module './source-meters'`.

- [ ] **Step 2: Write `util/source-meters.js`**

```js
// Reads the printed meters on an ability or Signature (class JSON, merged onto
// the character's rows by services/character/repository.js) into what a live
// tracker needs: which cost levels a use can take, whether it has a Cooldown,
// and how many Finite Uses it has.
const LEVELS = ['Low', 'Mid', 'High'];
const USES_APPROX = { Low: 10, Mid: 25, High: 50 };

const MECHANICS = [
  ['pitch', 'Pitch'], ['inference', 'Inference'], ['deduction', 'Deduction'], ['intuition', 'Intuition'],
  ['happenstance', 'Happenstance'], ['manifestation', 'Manifestation'], ['heartening', 'Heartening'],
  ['defiance', 'Defiance'], ['turning-point', 'Turning Point'], ['energywork', 'Energywork'],
];

const PRINTED_LABELS = new Set(['Essence Cost', 'Stamina Cost', 'Cooldown', 'Uses']);

// Ranges print with an en dash; a trailing "+" means "or a little more" and
// does not change which levels a player chooses between.
const levelsIn = (value) => {
  const [from, to] = String(value ?? '').replace(/\+/g, '').trim().split(/\s*[–-]\s*/);
  const start = LEVELS.indexOf(from);
  const end = LEVELS.indexOf(to ?? from);
  if (start < 0 || end < 0) return [];
  return LEVELS.slice(Math.min(start, end), Math.max(start, end) + 1);
};

const parseUses = (value) => {
  const label = String(value ?? '').trim();
  const counted = label.match(/^(\d+)(?:\s*[–-]\s*(\d+))?x$/);
  if (counted) return { label, max: Number(counted[2] ?? counted[1]) };
  if (USES_APPROX[label]) return { label, approx: USES_APPROX[label] };
  return null;
};

const parseMeters = (meters = []) => {
  const byLabel = new Map((Array.isArray(meters) ? meters : []).map((m) => [m.label, m.value]));
  return {
    essenceOptions: levelsIn(byLabel.get('Essence Cost')),
    staminaOptions: levelsIn(byLabel.get('Stamina Cost')),
    hasCooldown: byLabel.has('Cooldown'),
    uses: byLabel.has('Uses') ? parseUses(byLabel.get('Uses')) : null,
    printed: (Array.isArray(meters) ? meters : []).filter((m) => PRINTED_LABELS.has(m.label)),
  };
};

const sourcesFor = (character) => [
  ...(character?.abilities || []).map((a) => ({ key: `ability:${a.id}`, name: a.name, kind: 'Ability', ...parseMeters(a.meters) })),
  ...(character?.gear || []).map((g) => ({ key: `gear:${g.id}`, name: g.name, kind: 'Signature', ...parseMeters(g.meters) })),
  ...MECHANICS.map(([slug, name]) => ({ key: `mechanic:${slug}`, name, kind: 'Mechanic', ...parseMeters([]) })),
];

module.exports = { levelsIn, parseUses, parseMeters, sourcesFor, MECHANICS, LEVELS };
```

Run: `bun test util/source-meters.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 3: Write the failing exertion tests**

`util/exertion.test.js`:

```js
// The Stamina/Essence arithmetic and every tracker action
// (docs/superpowers/specs/2026-10-08-game-tables-design.md §3).
const { test, expect } = require('bun:test');
const { budgetFor, emptyState, applyAction, stateFromRow, stateToColumns, snapshotOf } = require('./exertion');
const { sourcesFor } = require('./source-meters');

const ctx = (stats = { will: 0, vigor: 0 }, character = null) => ({ stats, sources: sourcesFor(character) });
const BOLT = { abilities: [{ id: 'a1', name: 'Bolt', meters: [{ label: 'Essence Cost', value: 'Low–High' }, { label: 'Cooldown', value: 'Low' }] }], gear: [] };
const run = (state, action, context = ctx()) => {
  const result = applyAction(state, action, context);
  if (result.error) throw new Error(result.error);
  return result.state;
};

test('the budget follows the Will row: 6, 7, 9, 12, 15, 18, 24, then +6 a plus, approximate past six', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map((p) => budgetFor(p).budget)).toEqual([6, 7, 9, 12, 15, 18, 24]);
  expect(budgetFor(6).approximate).toBe(false);
  expect(budgetFor(8)).toEqual({ budget: 36, approximate: true });
  expect(budgetFor(null).budget).toBe(6);
});

test('spending past the budget drops a Threshold and carries the rest', () => {
  const state = run(emptyState(), { type: 'spend', pool: 'essence', amount: 'High' });
  expect(state.essence).toEqual({ threshold: 1, spent: 0 });
  const twice = run(run(emptyState(), { type: 'spend', pool: 'essence', amount: 'Mid' }), { type: 'spend', pool: 'essence', amount: 'High' });
  expect(twice.essence).toEqual({ threshold: 1, spent: 3 });
});

test('a big spend can drop more than one Threshold and stops at Below Red', () => {
  let state = emptyState();
  for (let i = 0; i < 4; i += 1) state = run(state, { type: 'spend', pool: 'stamina', amount: 'High' });
  expect(state.stamina).toEqual({ threshold: 3, spent: 0 });
  expect(run(state, { type: 'spend', pool: 'stamina', amount: 'Low' }).stamina).toEqual({ threshold: 3, spent: 0 });
});

test('restore climbs back up and stops at Green with nothing spent', () => {
  const low = { ...emptyState(), essence: { threshold: 1, spent: 1 } };
  expect(run(low, { type: 'restore', pool: 'essence', amount: 'Mid' }).essence).toEqual({ threshold: 0, spent: 4 });
  expect(run(low, { type: 'restore', pool: 'essence', amount: 'Threshold' }).essence).toEqual({ threshold: 0, spent: 1 });
  expect(run(emptyState(), { type: 'restore', pool: 'essence', amount: 'High' }).essence).toEqual({ threshold: 0, spent: 0 });
});

test('Will widens the Essence budget and Vigor the Stamina budget', () => {
  const strong = ctx({ will: 2, vigor: 0 });
  expect(run(emptyState(), { type: 'spend', pool: 'essence', amount: 'High' }, strong).essence).toEqual({ threshold: 0, spent: 6 });
  expect(run(emptyState(), { type: 'spend', pool: 'stamina', amount: 'High' }, strong).stamina).toEqual({ threshold: 1, spent: 0 });
});

test('using a source counts it, spends its chosen cost, and starts its Cooldown', () => {
  const state = run(emptyState(), { type: 'use', source: 'ability:a1', level: 'Mid' }, ctx(undefined, BOLT));
  expect(state.useCounts['ability:a1']).toBe(1);
  expect(state.essence).toEqual({ threshold: 0, spent: 3 });
  expect(state.cooldowns['ability:a1']).toBe(true);
});

test('a range cost needs a level inside the range', () => {
  expect(applyAction(emptyState(), { type: 'use', source: 'ability:a1' }, ctx(undefined, BOLT)).error)
    .toBe('Choose Low, Mid or High for this cost.');
  const single = { abilities: [{ id: 'a2', name: 'Spark', meters: [{ label: 'Essence Cost', value: 'Low–Mid' }] }], gear: [] };
  expect(applyAction(emptyState(), { type: 'use', source: 'ability:a2', level: 'High' }, ctx(undefined, single)).error)
    .toBe('Choose Low or Mid for this cost.');
});

test('a Conduit-imposed cost adds to the printed one, and an imposed Cooldown starts on use', () => {
  let state = run(emptyState(), { type: 'impose', source: 'mechanic:pitch', kind: 'Essence Cost', rating: 'Low' });
  state = run(state, { type: 'impose', source: 'mechanic:pitch', kind: 'Cooldown', rating: 'Mid' });
  state = run(state, { type: 'use', source: 'mechanic:pitch' });
  expect(state.essence.spent).toBe(1);
  expect(state.cooldowns['mechanic:pitch']).toBe(true);
  state = run(state, { type: 'lift', source: 'mechanic:pitch', index: 0 });
  expect(state.imposedLimiters['mechanic:pitch']).toEqual([{ kind: 'Cooldown', rating: 'Mid' }]);
});

test('cooldowns toggle, and set clamps to the pool', () => {
  const on = run(emptyState(), { type: 'toggle_cooldown', source: 'mechanic:pitch' });
  expect(run(on, { type: 'toggle_cooldown', source: 'mechanic:pitch' }).cooldowns['mechanic:pitch']).toBe(false);
  expect(run(emptyState(), { type: 'set', pool: 'stamina', threshold: 2, spent: 4 }).stamina).toEqual({ threshold: 2, spent: 4 });
  expect(applyAction(emptyState(), { type: 'set', pool: 'stamina', threshold: 4, spent: 0 }, ctx()).error).toBe('Pick a Threshold from Green to Below Red.');
  expect(applyAction(emptyState(), { type: 'set', pool: 'stamina', threshold: 1, spent: 6 }, ctx()).error).toBe('Spent must be from 0 to 5.');
});

test('bad input names its problem instead of changing anything', () => {
  expect(applyAction(emptyState(), { type: 'spend', pool: 'mana', amount: 'Low' }, ctx()).error).toBe('Unknown pool.');
  expect(applyAction(emptyState(), { type: 'spend', pool: 'essence', amount: 'Huge' }, ctx()).error).toBe('Pick Low, Mid or High.');
  expect(applyAction(emptyState(), { type: 'use', source: 'ability:nope' }, ctx()).error).toBe('That source is not on this sheet.');
  expect(applyAction(emptyState(), { type: 'impose', source: 'mechanic:pitch', kind: 'Range', rating: 'Low' }, ctx()).error).toBe('Pick a Limiter kind.');
  expect(applyAction(emptyState(), { type: 'dance' }, ctx()).error).toBe('Unknown action.');
});

test('state round-trips through table columns, and a snapshot holds no undo of its own', () => {
  const state = run(emptyState(), { type: 'spend', pool: 'essence', amount: 'Mid' });
  const columns = stateToColumns(state);
  expect(columns).toMatchObject({ essence_threshold: 0, essence_spent: 3, stamina_threshold: 0, stamina_spent: 0 });
  expect(stateFromRow({ ...columns, undo: { x: 1 }, version: 4 })).toEqual(state);
  expect(snapshotOf(state)).toEqual(columns);
});
```

Run: `bun test util/exertion.test.js`
Expected: FAIL, `Cannot find module './exertion'`.

- [ ] **Step 4: Write `util/exertion.js`**

```js
// Stamina and Essence arithmetic and every tracker action (spec §3). Pure: the
// state in, the next state out. Every number here is the book's rule of thumb
// (Advent pp. 33–36, Aspirant p. 4), so the page always offers a manual
// override beside it.
const { LEVELS } = require('./source-meters');

const THRESHOLDS = ['Green', 'Yellow', 'Red', 'Below Red'];
const BELOW_RED = THRESHOLDS.length - 1;
const COST_UNITS = { Low: 1, Mid: 3, High: 6 };
const BUDGET_BY_PLUSES = [6, 7, 9, 12, 15, 18, 24];
const POOL_STAT = { stamina: 'vigor', essence: 'will' };
const IMPOSABLE = { 'Essence Cost': 'essence', 'Stamina Cost': 'stamina', Cooldown: null };

const budgetFor = (pluses) => {
  const p = Number.isInteger(pluses) && pluses > 0 ? pluses : 0;
  if (p < BUDGET_BY_PLUSES.length) return { budget: BUDGET_BY_PLUSES[p], approximate: false };
  const last = BUDGET_BY_PLUSES.length - 1;
  return { budget: BUDGET_BY_PLUSES[last] + 6 * (p - last), approximate: true };
};

const emptyState = () => ({
  stamina: { threshold: 0, spent: 0 },
  essence: { threshold: 0, spent: 0 },
  useCounts: {},
  cooldowns: {},
  imposedLimiters: {},
});

const stateFromRow = (row) => ({
  stamina: { threshold: row.stamina_threshold ?? 0, spent: row.stamina_spent ?? 0 },
  essence: { threshold: row.essence_threshold ?? 0, spent: row.essence_spent ?? 0 },
  useCounts: { ...(row.use_counts || {}) },
  cooldowns: { ...(row.cooldowns || {}) },
  imposedLimiters: structuredClone(row.imposed_limiters || {}),
});

const stateToColumns = (state) => ({
  stamina_threshold: state.stamina.threshold,
  stamina_spent: state.stamina.spent,
  essence_threshold: state.essence.threshold,
  essence_spent: state.essence.spent,
  use_counts: state.useCounts,
  cooldowns: state.cooldowns,
  imposed_limiters: state.imposedLimiters,
});

const snapshotOf = (state) => structuredClone(stateToColumns(state));

const spendUnits = (pool, units, budget) => {
  let { threshold, spent } = pool;
  if (threshold >= BELOW_RED) return { threshold: BELOW_RED, spent: 0 };
  spent += units;
  while (spent >= budget && threshold < BELOW_RED) {
    spent -= budget;
    threshold += 1;
  }
  return threshold >= BELOW_RED ? { threshold: BELOW_RED, spent: 0 } : { threshold, spent };
};

const restoreUnits = (pool, units, budget) => {
  let { threshold, spent } = pool;
  spent -= units;
  while (spent < 0 && threshold > 0) {
    threshold -= 1;
    spent += budget;
  }
  return { threshold, spent: Math.max(0, spent) };
};

const levelList = (options) => (options.length === 2 ? options.join(' or ') : `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}`);

// The level a use spends at: the printed cost's only level, or the one the
// player chose inside a range. Returns { units } or { error }.
const costFor = (options, level) => {
  if (!options.length) return { units: 0 };
  if (options.length === 1) return { units: COST_UNITS[options[0]] };
  if (!options.includes(level)) return { error: `Choose ${levelList(options)} for this cost.` };
  return { units: COST_UNITS[level] };
};

const applyAction = (current, action = {}, { stats = {}, sources = [] } = {}) => {
  const state = structuredClone(current);
  const budgets = {
    stamina: budgetFor(stats[POOL_STAT.stamina]).budget,
    essence: budgetFor(stats[POOL_STAT.essence]).budget,
  };
  const sourceFor = (key) => sources.find((s) => s.key === key);
  const needPool = () => (POOL_STAT[action.pool] ? null : 'Unknown pool.');

  switch (action.type) {
    case 'spend':
    case 'restore': {
      const poolError = needPool();
      if (poolError) return { error: poolError };
      const restoringThreshold = action.type === 'restore' && action.amount === 'Threshold';
      if (!restoringThreshold && !COST_UNITS[action.amount]) return { error: 'Pick Low, Mid or High.' };
      const units = restoringThreshold ? budgets[action.pool] : COST_UNITS[action.amount];
      const move = action.type === 'spend' ? spendUnits : restoreUnits;
      state[action.pool] = move(state[action.pool], units, budgets[action.pool]);
      return { state };
    }
    case 'set': {
      const poolError = needPool();
      if (poolError) return { error: poolError };
      const threshold = Number(action.threshold);
      const spent = Number(action.spent ?? 0);
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > BELOW_RED) return { error: 'Pick a Threshold from Green to Below Red.' };
      const max = budgets[action.pool] - 1;
      if (!Number.isInteger(spent) || spent < 0 || spent > max) return { error: `Spent must be from 0 to ${max}.` };
      state[action.pool] = threshold === BELOW_RED ? { threshold, spent: 0 } : { threshold, spent };
      return { state };
    }
    case 'use': {
      const source = sourceFor(action.source);
      if (!source) return { error: 'That source is not on this sheet.' };
      const imposed = state.imposedLimiters[source.key] || [];
      for (const [optionsKey, pool, kind] of [['essenceOptions', 'essence', 'Essence Cost'], ['staminaOptions', 'stamina', 'Stamina Cost']]) {
        const printed = costFor(source[optionsKey], action.level);
        if (printed.error) return { error: printed.error };
        const extra = imposed.filter((l) => l.kind === kind).reduce((sum, l) => sum + COST_UNITS[l.rating], 0);
        if (printed.units + extra > 0) state[pool] = spendUnits(state[pool], printed.units + extra, budgets[pool]);
      }
      state.useCounts[source.key] = (state.useCounts[source.key] || 0) + 1;
      if (source.hasCooldown || imposed.some((l) => l.kind === 'Cooldown')) state.cooldowns[source.key] = true;
      return { state };
    }
    case 'toggle_cooldown': {
      const source = sourceFor(action.source);
      if (!source) return { error: 'That source is not on this sheet.' };
      state.cooldowns[source.key] = !state.cooldowns[source.key];
      return { state };
    }
    case 'impose': {
      const source = sourceFor(action.source);
      if (!source) return { error: 'That source is not on this sheet.' };
      if (!(action.kind in IMPOSABLE)) return { error: 'Pick a Limiter kind.' };
      if (!LEVELS.includes(action.rating)) return { error: 'Pick Low, Mid or High.' };
      state.imposedLimiters[source.key] = [...(state.imposedLimiters[source.key] || []), { kind: action.kind, rating: action.rating }];
      return { state };
    }
    case 'lift': {
      const list = state.imposedLimiters[action.source] || [];
      const index = Number(action.index);
      if (!Number.isInteger(index) || index < 0 || index >= list.length) return { error: 'That Limiter is already gone.' };
      list.splice(index, 1);
      if (list.length) state.imposedLimiters[action.source] = list;
      else delete state.imposedLimiters[action.source];
      return { state };
    }
    default:
      return { error: 'Unknown action.' };
  }
};

module.exports = {
  THRESHOLDS, BELOW_RED, COST_UNITS, budgetFor, emptyState, stateFromRow, stateToColumns, snapshotOf, applyAction,
};
```

- [ ] **Step 5: Run the tests**

Run: `bun test util/exertion.test.js util/source-meters.test.js`
Expected: PASS, 15 tests. If an expected value in a test disagrees with the Global Constraints, the Global Constraints win. Fix the code, or fix the test's arithmetic, and record which in your report.

- [ ] **Step 6: Commit**

```bash
git add util/source-meters.js util/source-meters.test.js util/exertion.js util/exertion.test.js
git commit -m "feat: Stamina and Essence arithmetic and printed-meter parsing for trackers"
```

---

### Task 2: Tracker state table

**Files:**
- Create: `supabase/migrations/20261010000000_game_table_member_state.sql`
- Modify: `models/game-tables-rls.integration.test.js` (new tests at the end, reusing its `setup()` users and helpers)

**Interfaces:**
- Consumes: `public.game_table_members`, `public.game_tables`, and the helpers `can_manage_game_table(uuid)`, `owns_character(uuid)` and `is_game_table_participant(uuid)` from `20261009000000_game_tables.sql`.
- Produces: `public.game_table_member_state` with these columns:
  - `member_id` (PK)
  - `table_id`
  - `stamina_threshold`, `stamina_spent`, `essence_threshold`, `essence_spent`
  - `use_counts`, `cooldowns`, `imposed_limiters` (jsonb objects)
  - `undo` (jsonb)
  - `version`, `updated_at`, `updated_by` (→ profiles)

  A state row is created for every member: by a trigger on future inserts, and by a backfill for existing members. The table is published on `supabase_realtime`.

- [ ] **Step 1: Write the migration**

```sql
-- Live tracker state: one row per seated member (Stamina, Essence, use
-- counts, cooldowns, Conduit-imposed Limiters, and the state before the last
-- action for undo). Participants read it -- and receive its Realtime changes --
-- under RLS; the character's owner or the table's creator/Conduit writes it.
-- Rows are created by trigger when a member is seated and go with the member.

create table if not exists public.game_table_member_state (
  member_id uuid primary key references public.game_table_members(id) on delete cascade,
  table_id uuid not null references public.game_tables(id) on delete cascade,
  stamina_threshold smallint not null default 0 check (stamina_threshold between 0 and 3),
  stamina_spent smallint not null default 0 check (stamina_spent >= 0),
  essence_threshold smallint not null default 0 check (essence_threshold between 0 and 3),
  essence_spent smallint not null default 0 check (essence_spent >= 0),
  use_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(use_counts) = 'object'),
  cooldowns jsonb not null default '{}'::jsonb check (jsonb_typeof(cooldowns) = 'object'),
  imposed_limiters jsonb not null default '{}'::jsonb check (jsonb_typeof(imposed_limiters) = 'object'),
  undo jsonb,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_game_table_member_state_table on public.game_table_member_state(table_id);

create or replace function public.create_game_table_member_state()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into game_table_member_state (member_id, table_id)
  values (new.id, new.table_id)
  on conflict (member_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_game_table_member_state() from public, anon, authenticated;

drop trigger if exists game_table_members_create_state on public.game_table_members;
create trigger game_table_members_create_state
  after insert on public.game_table_members
  for each row
  execute function public.create_game_table_member_state();

insert into public.game_table_member_state (member_id, table_id)
select id, table_id from public.game_table_members
on conflict (member_id) do nothing;

alter table public.game_table_member_state enable row level security;

drop policy if exists "game_table_member_state_participant_select" on public.game_table_member_state;
create policy "game_table_member_state_participant_select"
  on public.game_table_member_state for select
  using (is_game_table_participant(table_id));

-- The owner of the seated character, or the table's creator/Conduit (guests
-- have no owner, so only they). updated_by can only name the caller.
drop policy if exists "game_table_member_state_tracker_update" on public.game_table_member_state;
create policy "game_table_member_state_tracker_update"
  on public.game_table_member_state for update
  using (exists (
    select 1 from game_table_members m
    where m.id = member_id
      and (can_manage_game_table(m.table_id) or (m.character_id is not null and owns_character(m.character_id)))
  ))
  with check (
    exists (
      select 1 from game_table_members m
      where m.id = member_id
        and (can_manage_game_table(m.table_id) or (m.character_id is not null and owns_character(m.character_id)))
    )
    and (updated_by is null or exists (select 1 from profiles p where p.id = updated_by and p.user_id = auth.uid()))
  );

revoke all on public.game_table_member_state from anon, authenticated;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.game_table_member_state to authenticated';
    execute 'grant update (stamina_threshold, stamina_spent, essence_threshold, essence_spent, use_counts, cooldowns, imposed_limiters, undo, version, updated_at, updated_by) on public.game_table_member_state to authenticated';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_table_member_state'
     ) then
    execute 'alter publication supabase_realtime add table public.game_table_member_state';
  end if;
end
$do$;
```

- [ ] **Step 2: Apply it locally**

Run: `supabase migration up`
Expected: it applies with no error. If the CLI refuses, use the `psql -f` command from Global Constraints. **Never `supabase db reset`.**

Check: `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -Atc "select count(*) from game_table_member_state; select count(*) from game_table_members; select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='game_table_member_state'"`
Expected: the two counts are equal, and the table name is listed.

- [ ] **Step 3: Write the failing RLS tests**

Append to `models/game-tables-rls.integration.test.js`. Reuse its `setup()`, `makeUser` and `makeCharacter` helpers, with a fresh table so the earlier tests' state doesn't matter:

```js
test('seating a member creates its tracker state', async () => {
  const { creator } = await setup();
  const tableId = crypto.randomUUID();
  await creator.client.from('game_tables').insert({ id: tableId, name: `GT state ${suffix}`, creator_id: creator.profile.id, conduit_id: creator.profile.id });
  created.tableIds.push(tableId);
  await creator.client.from('game_table_members').insert({ table_id: tableId, guest_name: `State ${suffix}`, guest_stats: {} });
  const { data: rows } = await supabaseAdmin.from('game_table_member_state').select('table_id, essence_threshold, version').eq('table_id', tableId);
  expect(rows).toEqual([{ table_id: tableId, essence_threshold: 0, version: 0 }]);
});

test('an owner updates their seat\'s tracker; a stranger and anon cannot read or write it', async () => {
  const { creator, player, stranger } = await setup();
  const tableId = crypto.randomUUID();
  await creator.client.from('game_tables').insert({ id: tableId, name: `GT state2 ${suffix}`, creator_id: creator.profile.id, conduit_id: creator.profile.id });
  created.tableIds.push(tableId);
  const ownChar = await makeCharacter(player.profile.id, { isPublic: false });
  await player.client.from('game_table_members').insert({ table_id: tableId, character_id: ownChar });
  const { data: [member] } = await supabaseAdmin.from('game_table_members').select('id').eq('character_id', ownChar);

  const mine = await player.client.from('game_table_member_state')
    .update({ essence_spent: 3, version: 1, updated_by: player.profile.id }).eq('member_id', member.id).select('version');
  expect(mine.data).toEqual([{ version: 1 }]);

  expect((await stranger.client.from('game_table_member_state').select('member_id').eq('member_id', member.id)).data).toEqual([]);
  expect((await anonClient.from('game_table_member_state').select('member_id').eq('member_id', member.id)).data || []).toEqual([]);
  const theirs = await stranger.client.from('game_table_member_state').update({ essence_spent: 5 }).eq('member_id', member.id).select('version');
  expect(theirs.data || []).toEqual([]);
  const { data: [row] } = await supabaseAdmin.from('game_table_member_state').select('essence_spent').eq('member_id', member.id);
  expect(row.essence_spent).toBe(3);
});

test('a tracker write cannot move its row or claim another author', async () => {
  const { creator, player } = await setup();
  const { data: [row] } = await supabaseAdmin.from('game_table_member_state').select('member_id, table_id').limit(1);
  const moved = await creator.client.from('game_table_member_state').update({ table_id: crypto.randomUUID() }).eq('member_id', row.member_id);
  expect(moved.error?.code).toBe('42501');
  const forged = await creator.client.from('game_table_member_state')
    .update({ updated_by: player.profile.id }).eq('member_id', row.member_id).select('member_id');
  expect(forged.error?.code === '42501' || (forged.data || []).length === 0).toBe(true);
});
```

For the forged-author test, if `row` comes from a table the creator doesn't manage, the update matches nothing either way. Pick the row from a table this test file's creator made: filter by one of `created.tableIds`.

Run: `bun test models/game-tables-rls.integration.test.js`
Expected: the new tests pass (the migration is already applied). Check they can fail: drop the update policy with `psql -c 'drop policy "game_table_member_state_tracker_update" on public.game_table_member_state'`. The owner test should go red. Then re-apply the migration file with `psql -f`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261010000000_game_table_member_state.sql models/game-tables-rls.integration.test.js
git commit -m "feat: live tracker state per seat, Realtime-published and RLS-guarded"
```

---

### Task 3: Tracker service

**Files:**
- Create: `services/game-tables/tracker-view.js`
- Create: `services/game-tables/tracker-view.test.js`
- Modify: `services/game-tables/repository.js` (add `listStates`, `getState`, `updateState`)
- Modify: `services/game-tables/service.js` (constructor option `loadCharacter`; methods `trackers`, `tracker`, `act`, `newSession`; `capabilitiesFor` gains `isConduit`)
- Modify: `services/game-tables/policy.js` (`capabilitiesFor` returns `isConduit`)
- Modify: `services/game-tables/policy.test.js`, `services/game-tables/service.test.js`
- Modify: `models/game-tables.js` (pass `loadCharacter: (id) => getCharacter(id, supabaseAdmin)`)

**Interfaces:**
- Consumes: Task 1's `sourcesFor`, `budgetFor`, `THRESHOLDS`, `stateFromRow`, `stateToColumns`, `snapshotOf`, `applyAction` and `emptyState`; Task 2's table; `getCharacter(id, client) → { data: { abilities, gear }, error }` from `models/character.js`.
- Produces:
  - `capabilitiesFor(table, actor) → { signedIn, isCreator, canManage, isConduit }`. `isConduit` is the admin flag, or `table.conduit_id === actor.profileId`.
  - `buildTrackerView({ state, version, sources, stats, canTrack, isConduit, actionUrl }) → TrackerView`.
  - `TrackerView = { version, canTrack, isConduit, actionUrl, pools: PoolView[], sources: SourceView[] }`.
  - `PoolView = { name, label, threshold, thresholdLabel, spent, budget, approximate, segments: boolean[], thresholdOptions: {value, label, selected}[], spendAmounts, restoreAmounts, actionUrl, canTrack }`.
  - `SourceView = { key, name, kind, used, heavyUse, cooldownOn, hasCooldown, uses, remaining, printed, imposed: {kind, rating, index}[], levels: string[], needsLevel, actionUrl, canTrack, isConduit }`.
  - `GameTableService` additions:
    - `trackers(view, actor) → { data: Map<memberId, TrackerView>, error }`, for a table view from `load`.
    - `tracker(actor, tableId, memberId) → { data: { tracker: TrackerView, member, tableId }, error }`.
    - `act(actor, tableId, memberId, action, client) → { data: { tracker, member, tableId, acted: { message, undoable, version } }, error }`.
    - `newSession(actor, tableId) → { data: null, error }`.
  - Repository additions:
    - `listStates(tableId, client)`
    - `getState(memberId, client)`, which embeds `updater:updated_by (name)`
    - `updateState(memberId, expectedVersion, patch, client)`, which returns the rows updated, `select('version')`
    - `setSessionStarted(tableId, at, client)`

- [ ] **Step 1: Write the failing view-model tests**

`services/game-tables/tracker-view.test.js`:

```js
// What a tracker shows: pool bars sized to the member's budget, and each
// source's count, cooldown, uses left and Limiters.
const { test, expect } = require('bun:test');
const { buildTrackerView } = require('./tracker-view');
const { emptyState } = require('../../util/exertion');
const { sourcesFor } = require('../../util/source-meters');

const HAMMER = { abilities: [], gear: [{ id: 'g1', name: 'Hammer', meters: [{ label: 'Uses', value: '3x' }, { label: 'Cooldown', value: 'Low' }] }] };

test('pool bars are segmented into the budget, filled up to spent', () => {
  const state = { ...emptyState(), essence: { threshold: 1, spent: 2 } };
  const view = buildTrackerView({ state, version: 4, sources: sourcesFor(null), stats: { will: 1 }, canTrack: true, isConduit: false, actionUrl: '/a' });
  const essence = view.pools.find((p) => p.name === 'essence');
  expect(essence).toMatchObject({ label: 'Essence', threshold: 1, thresholdLabel: 'Yellow', spent: 2, budget: 7, approximate: false });
  expect(essence.segments).toEqual([true, true, false, false, false, false, false]);
  expect(view.version).toBe(4);
});

test('a source shows its count, uses left and cooldown', () => {
  const state = { ...emptyState(), useCounts: { 'gear:g1': 2 }, cooldowns: { 'gear:g1': true } };
  const view = buildTrackerView({ state, version: 0, sources: sourcesFor(HAMMER), stats: {}, canTrack: true, isConduit: false, actionUrl: '/a' });
  expect(view.sources[0]).toMatchObject({ key: 'gear:g1', used: 2, remaining: 1, cooldownOn: true, hasCooldown: true });
});

test('a rated use shows the count against its approximation', () => {
  const rated = { abilities: [], gear: [{ id: 'g2', name: 'Salt', meters: [{ label: 'Uses', value: 'Low' }] }] };
  const view = buildTrackerView({ state: { ...emptyState(), useCounts: { 'gear:g2': 4 } }, version: 0, sources: sourcesFor(rated), stats: {}, canTrack: false, isConduit: false, actionUrl: '/a' });
  expect(view.sources[0].remaining).toBe('about 6');
});

test('imposed Limiters are listed with their index so they can be lifted', () => {
  const state = { ...emptyState(), imposedLimiters: { 'mechanic:pitch': [{ kind: 'Cooldown', rating: 'Mid' }] } };
  const view = buildTrackerView({ state, version: 0, sources: sourcesFor(null), stats: {}, canTrack: true, isConduit: true, actionUrl: '/a' });
  expect(view.sources.find((s) => s.key === 'mechanic:pitch').imposed).toEqual([{ kind: 'Cooldown', rating: 'Mid', index: 0 }]);
});

test('a stale source key is ignored', () => {
  const state = { ...emptyState(), useCounts: { 'ability:gone': 3 }, cooldowns: { 'ability:gone': true } };
  const view = buildTrackerView({ state, version: 0, sources: sourcesFor(null), stats: {}, canTrack: true, isConduit: false, actionUrl: '/a' });
  expect(view.sources.some((s) => s.key === 'ability:gone')).toBe(false);
});
```

Run: `bun test services/game-tables/tracker-view.test.js`
Expected: FAIL, `Cannot find module './tracker-view'`.

- [ ] **Step 2: Write `services/game-tables/tracker-view.js`**

```js
// Turns a member's tracker state and sources into what the table-tracker
// partial renders. Pure; every rule number comes from util/exertion.js.
const { budgetFor, THRESHOLDS } = require('../../util/exertion');

const POOLS = [['stamina', 'Stamina', 'vigor'], ['essence', 'Essence', 'will']];

const remainingFor = (uses, used) => {
  if (!uses) return null;
  if (uses.max !== undefined) return Math.max(0, uses.max - used);
  return `about ${Math.max(0, uses.approx - used)}`;
};

const buildTrackerView = ({ state, version, sources, stats = {}, canTrack, isConduit, actionUrl }) => ({
  version,
  canTrack,
  isConduit,
  actionUrl,
  pools: POOLS.map(([name, label, stat]) => {
    const { budget, approximate } = budgetFor(stats[stat]);
    const { threshold, spent } = state[name];
    return {
      name,
      label,
      threshold,
      thresholdLabel: THRESHOLDS[threshold],
      spent,
      budget,
      approximate,
      segments: Array.from({ length: budget }, (_, i) => i < spent),
      thresholdOptions: THRESHOLDS.map((value, index) => ({ value: index, label: value, selected: index === threshold })),
      spendAmounts: ['Low', 'Mid', 'High'],
      restoreAmounts: ['Low', 'Mid', 'High', 'Threshold'],
      actionUrl,
      canTrack,
    };
  }),
  sources: sources.map((source) => {
    const used = state.useCounts[source.key] || 0;
    const levels = [...new Set([...source.essenceOptions, ...source.staminaOptions])];
    return {
      key: source.key,
      name: source.name,
      kind: source.kind,
      used,
      heavyUse: used >= 3,
      cooldownOn: Boolean(state.cooldowns[source.key]),
      hasCooldown: source.hasCooldown,
      uses: source.uses,
      remaining: remainingFor(source.uses, used),
      printed: source.printed,
      imposed: (state.imposedLimiters[source.key] || []).map((limiter, index) => ({ ...limiter, index })),
      levels,
      needsLevel: source.essenceOptions.length > 1 || source.staminaOptions.length > 1,
      actionUrl,
      canTrack,
      isConduit,
    };
  }),
});

module.exports = { buildTrackerView };
```

Run: `bun test services/game-tables/tracker-view.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 3: Add the repository functions**

Append to `services/game-tables/repository.js`'s exports:

```js
  listStates: (tableId, client) => withResult(client.from('game_table_member_state').select('*').eq('table_id', tableId)),
  getState: (memberId, client) => withResult(client.from('game_table_member_state')
    .select('*, updater:updated_by (name)').eq('member_id', memberId).maybeSingle()),
  // Conditional on the version the caller read; an empty result means someone
  // else wrote first (or RLS refused the row).
  updateState: (memberId, expectedVersion, patch, client) => withResult(client.from('game_table_member_state')
    .update(patch).eq('member_id', memberId).eq('version', expectedVersion).select('version')),
  setSessionStarted: (tableId, at, client) => withResult(client.from('game_tables')
    .update({ session_started_at: at }).eq('id', tableId)),
```

Add `'listStates', 'getState', 'updateState', 'setSessionStarted'` to `REQUIRED_REPOSITORY_METHODS` in `service.js`, and matching recorders to the fake repository in `service.test.js`.

- [ ] **Step 4: Write the failing service tests**

Extend the fake repository in `services/game-tables/service.test.js`:
- `listStates`/`getState` read from `state.trackerRows` (keyed by member id; `getState` returns `{ ...row, updater: { name: row.updaterName } }`).
- `updateState` records the call and returns `{ data: state.updateResults?.shift() ?? [{ version: patch.version }] }`, which lets a test script conflicts.

Construct the service with `loadCharacter: async (id) => ({ data: state.characters?.[id] ?? { abilities: [], gear: [] } })`. Then add:

```js
const row = (memberId, extra = {}) => ({
  member_id: memberId, table_id: 't1', stamina_threshold: 0, stamina_spent: 0, essence_threshold: 0, essence_spent: 0,
  use_counts: {}, cooldowns: {}, imposed_limiters: {}, undo: null, version: 3, updaterName: 'Ash', ...extra,
});

test('the owner or a manager may track a seat; anyone else may not', async () => {
  const { svc } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: row('m1') } });
  expect((await svc.act(USER, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error).toBeUndefined();
  expect((await svc.act(CREATOR, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error).toBeUndefined();
  expect((await svc.act(STRANGER, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error.status).toBe(403);
});

test('a write goes through the caller\'s client, bumps the version, and saves the prior state for undo', async () => {
  const { svc, repo } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: row('m1') } });
  const { data } = await svc.act(USER, 't1', 'm1', { type: 'spend', pool: 'essence', amount: 'Mid' }, USER_CLIENT);
  const [memberId, expectedVersion, patch, client] = repo.calls.find((c) => c.name === 'updateState').args;
  expect([memberId, expectedVersion, client]).toEqual(['m1', 3, USER_CLIENT]);
  expect(patch).toMatchObject({ essence_spent: 3, version: 4, updated_by: 'player', undo: { essence_spent: 0 } });
  expect(data.acted).toMatchObject({ undoable: true, version: 4 });
});

test('only the Conduit imposes or lifts Limiters', async () => {
  const conduitTable = { ...TABLE, conduit_id: 'conduit' };
  const { svc } = service({ table: conduitTable, members: [guest('g1')], trackerRows: { g1: row('g1') } });
  const impose = { type: 'impose', source: 'mechanic:pitch', kind: 'Cooldown', rating: 'Low' };
  expect((await svc.act(CREATOR, 't1', 'g1', impose, USER_CLIENT)).error.status).toBe(403);
  expect((await svc.act({ profileId: 'conduit' }, 't1', 'g1', impose, USER_CLIENT)).error).toBeUndefined();
});

test('a version conflict is retried once against the fresh row', async () => {
  const { svc, repo } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') }, updateResults: [[], [{ version: 4 }]] });
  const { error } = await svc.act(CREATOR, 't1', 'g1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT);
  expect(error).toBeUndefined();
  expect(repo.calls.filter((c) => c.name === 'updateState')).toHaveLength(2);
});

test('a second conflict gives up with a 409', async () => {
  const { svc } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') }, updateResults: [[], []] });
  expect((await svc.act(CREATOR, 't1', 'g1', { type: 'spend', pool: 'essence', amount: 'Low' }, USER_CLIENT)).error.status).toBe(409);
});

test('undo restores the snapshot only while nobody has changed the row since', async () => {
  const snapshot = { stamina_threshold: 0, stamina_spent: 0, essence_threshold: 0, essence_spent: 0, use_counts: {}, cooldowns: {}, imposed_limiters: {} };
  const { svc, repo } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1', { essence_spent: 3, undo: snapshot }) } });
  const stale = await svc.act(CREATOR, 't1', 'g1', { type: 'undo', version: 2 }, USER_CLIENT);
  expect(stale.error.status).toBe(409);
  expect(stale.error.message).toBe('Changed by Ash since — undo unavailable.');
  await svc.act(CREATOR, 't1', 'g1', { type: 'undo', version: 3 }, USER_CLIENT);
  const [, , patch] = repo.calls.find((c) => c.name === 'updateState').args;
  expect(patch).toMatchObject({ essence_spent: 0, undo: null, version: 4 });
});

test('bad tracker input is a 400 naming the problem', async () => {
  const { svc } = service({ table: TABLE, members: [guest('g1')], trackerRows: { g1: row('g1') } });
  const { error } = await svc.act(CREATOR, 't1', 'g1', { type: 'spend', pool: 'mana', amount: 'Low' }, USER_CLIENT);
  expect(error).toMatchObject({ status: 400, message: 'Unknown pool.' });
});

test('a guest tracks pools and mechanics only, budgeted from its own stats', async () => {
  const g = { ...guest('g1'), guest_stats: { will: 2 } };
  const { svc } = service({ table: TABLE, members: [g], trackerRows: { g1: row('g1') } });
  const { data } = await svc.tracker(CREATOR, 't1', 'g1');
  expect(data.tracker.sources.every((s) => s.kind === 'Mechanic')).toBe(true);
  expect(data.tracker.pools.find((p) => p.name === 'essence').budget).toBe(9);
});

test('a seated character\'s abilities and Signatures come from its sheet', async () => {
  const characters = { c1: { abilities: [{ id: 'a1', name: 'Bolt', meters: [{ label: 'Essence Cost', value: 'Mid' }] }], gear: [] } };
  const { svc } = service({ table: TABLE, members: [seat('m1', 'c1', 'player')], trackerRows: { m1: row('m1') }, characters });
  const { data } = await svc.tracker(USER, 't1', 'm1');
  expect(data.tracker.sources[0]).toMatchObject({ key: 'ability:a1', name: 'Bolt', kind: 'Ability' });
});

test('a new session resets every seat through the system client; only a manager may start one', async () => {
  const { svc, repo } = service({ table: TABLE, members: [guest('g1'), guest('g2')], trackerRows: { g1: row('g1', { essence_spent: 2 }), g2: row('g2', { use_counts: { 'mechanic:pitch': 3 } }) } });
  expect((await svc.newSession(USER, 't1')).error.status).toBe(403);
  await svc.newSession(CREATOR, 't1');
  const updates = repo.calls.filter((c) => c.name === 'updateState');
  expect(updates).toHaveLength(2);
  for (const [, , patch, client] of updates.map((c) => c.args)) {
    expect(patch).toMatchObject({ essence_spent: 0, use_counts: {}, cooldowns: {}, imposed_limiters: {}, undo: null, version: 4 });
    expect(client).toBe(SYSTEM);
  }
  expect(repo.calls.find((c) => c.name === 'setSessionStarted').args[2]).toBe(SYSTEM);
});
```

Add to `services/game-tables/policy.test.js`:

```js
test('the Conduit is the table\'s conduit_id, or an admin', () => {
  const table = { creator_id: 'creator', conduit_id: 'conduit' };
  expect(capabilitiesFor(table, { profileId: 'conduit' }).isConduit).toBe(true);
  expect(capabilitiesFor(table, { profileId: 'creator' }).isConduit).toBe(false);
  expect(capabilitiesFor(table, { profileId: 'x', role: 'admin' }).isConduit).toBe(true);
});
```

and update the existing capability test's expected objects to include `isConduit`.

Run: `bun test services/game-tables/service.test.js services/game-tables/policy.test.js`
Expected: FAIL. `svc.act` is not a function, and `isConduit` is missing.

- [ ] **Step 5: Implement**

In `policy.js` `capabilitiesFor`, add `isConduit: isAdmin || (Boolean(profileId) && table.conduit_id === profileId)` to the returned object.

In `service.js`:
- add requires for `{ applyAction, stateFromRow, stateToColumns, snapshotOf, emptyState }` from `../../util/exertion`, `{ sourcesFor }` from `../../util/source-meters` and `{ buildTrackerView }` from `./tracker-view`;
- add a `conflict` error helper;
- accept `loadCharacter` in the constructor (default `async () => ({ data: null })`).

Then add these methods to the class:

```js
  // Who may change a member's tracker: its character's owner, or the
  // table's creator/Conduit (the only ones who can for a guest).
  canTrack(capabilities, member, actor) {
    return capabilities.canManage || (Boolean(actor?.profileId) && member.ownerId === actor.profileId);
  }

  async trackerContext(member) {
    if (member.isGuest) return { stats: member, sources: sourcesFor(null) };
    const { data: character } = await this.loadCharacter(member.id);
    return { stats: member, sources: sourcesFor(character) };
  }

  trackerViewFor(view, member, row, context, actor) {
    return buildTrackerView({
      state: row ? stateFromRow(row) : emptyState(),
      version: row?.version ?? 0,
      sources: context.sources,
      stats: context.stats,
      canTrack: this.canTrack(view.capabilities, member, actor),
      isConduit: view.capabilities.isConduit,
      actionUrl: `/tables/${view.table.id}/members/${member.memberId}/actions`,
    });
  }

  async trackers(view, actor) {
    const { data: rows, error } = await this.repo.listStates(view.table.id, this.system);
    if (error) return { data: null, error };
    const byMember = new Map((rows || []).map((row) => [row.member_id, row]));
    const entries = await Promise.all(view.members.map(async (member) => {
      const context = await this.trackerContext(member);
      return [member.memberId, this.trackerViewFor(view, member, byMember.get(member.memberId), context, actor)];
    }));
    return { data: new Map(entries), error: undefined };
  }

  async tracker(actor, tableId, memberId) {
    const loaded = await this.load(tableId, actor);
    if (loaded.error) return loaded;
    const member = loaded.data.members.find((m) => m.memberId === memberId);
    if (!member) return { data: null, error: notFound() };
    const { data: row, error } = await this.repo.getState(memberId, this.system);
    if (error) return { data: null, error };
    const context = await this.trackerContext(member);
    return { data: { tracker: this.trackerViewFor(loaded.data, member, row, context, actor), member, tableId }, error: undefined };
  }

  async act(actor, tableId, memberId, action, client) {
    const loaded = await this.load(tableId, actor);
    if (loaded.error) return loaded;
    const view = loaded.data;
    const member = view.members.find((m) => m.memberId === memberId);
    if (!member) return { data: null, error: notFound() };
    if (!this.canTrack(view.capabilities, member, actor)) {
      return { data: null, error: forbidden('Only the character\'s owner or the table\'s creator or Conduit can change this tracker.') };
    }
    if ((action.type === 'impose' || action.type === 'lift') && !view.capabilities.isConduit) {
      return { data: null, error: forbidden('Only the Conduit imposes or lifts Limiters.') };
    }
    const context = await this.trackerContext(member);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data: row, error } = await this.repo.getState(memberId, this.system);
      if (error) return { data: null, error };
      if (!row) return { data: null, error: notFound() };
      const current = stateFromRow(row);

      let next;
      if (action.type === 'undo') {
        if (Number(action.version) !== row.version) {
          return { data: null, error: conflict(`Changed by ${row.updater?.name || 'someone else'} since — undo unavailable.`) };
        }
        if (!row.undo) return { data: null, error: invalid('Nothing to undo.') };
        next = stateFromRow(row.undo);
      } else {
        const result = applyAction(current, action, context);
        if (result.error) return { data: null, error: invalid(result.error) };
        next = result.state;
      }

      const version = row.version + 1;
      const patch = {
        ...stateToColumns(next),
        undo: action.type === 'undo' ? null : snapshotOf(current),
        version,
        updated_by: actor.profileId,
        updated_at: new Date().toISOString(),
      };
      const updated = await this.repo.updateState(memberId, row.version, patch, client);
      if (updated.error) return { data: null, error: updated.error };
      if (updated.data?.length) {
        const fresh = { ...row, ...patch };
        return {
          data: {
            tracker: this.trackerViewFor(view, member, fresh, context, actor),
            member,
            tableId,
            acted: { message: describeAction(action, context.sources, member), undoable: action.type !== 'undo', version },
          },
          error: undefined,
        };
      }
      if (action.type === 'undo') break;
    }
    return { data: null, error: conflict('Someone else changed this tracker at the same moment. Try again.') };
  }

  async newSession(actor, tableId) {
    const loaded = await this.load(tableId, actor);
    if (loaded.error) return loaded;
    if (!loaded.data.capabilities.canManage) return { data: null, error: forbidden('Only the table\'s creator or Conduit can start a new session.') };
    const { data: rows, error } = await this.repo.listStates(tableId, this.system);
    if (error) return { data: null, error };
    const reset = { ...stateToColumns(emptyState()), undo: null, updated_by: actor.profileId, updated_at: new Date().toISOString() };
    for (const row of rows || []) {
      const updated = await this.repo.updateState(row.member_id, row.version, { ...reset, version: row.version + 1 }, this.system);
      if (updated.error) return { data: null, error: updated.error };
    }
    const stamped = await this.repo.setSessionStarted(tableId, new Date().toISOString(), this.system);
    return { data: null, error: stamped.error || undefined };
  }
```

Add these helpers above the class:

```js
const conflict = (message) => ({ status: 409, code: 'conflict', title: 'Changed elsewhere', message });

// The toast after an action: short, and naming what changed.
const describeAction = (action, sources, member) => {
  const source = sources.find((s) => s.key === action.source);
  const who = member.name;
  switch (action.type) {
    case 'use': return `${who} used ${source?.name || 'a source'}${action.level ? ` (${action.level})` : ''}.`;
    case 'spend': return `${who} spent ${action.amount} ${action.pool === 'essence' ? 'Essence' : 'Stamina'}.`;
    case 'restore': return `${who} restored ${action.amount === 'Threshold' ? 'a Threshold of' : action.amount} ${action.pool === 'essence' ? 'Essence' : 'Stamina'}.`;
    case 'set': return `${who}'s ${action.pool === 'essence' ? 'Essence' : 'Stamina'} set.`;
    case 'toggle_cooldown': return `${source?.name || 'Cooldown'} cooldown toggled.`;
    case 'impose': return `Limiter imposed on ${source?.name || 'a source'}.`;
    case 'lift': return `Limiter lifted from ${source?.name || 'a source'}.`;
    case 'undo': return 'Undone.';
    default: return 'Updated.';
  }
};
```

A guest's display member has no `will`/`vigor` keys only if the guest has no stats. `toDisplayMember` already spreads `pickStats`, so they are there, at 0 when missing.

In `models/game-tables.js`, require `{ getCharacter }` from `./character` and pass `loadCharacter: (id) => getCharacter(id, supabaseAdmin)`. `models/character.js` does not require `models/game-tables`, so there's no require cycle. Confirm with `grep -n "game-tables" models/character.js`, which should print nothing.

- [ ] **Step 6: Run the tests**

Run: `bun test services/game-tables/service.test.js services/game-tables/policy.test.js services/game-tables/tracker-view.test.js`
Expected: PASS.

Then check `getCharacter` against local Supabase with a throwaway read-only script in your scratch directory. Run it with `bun --env-file=.env`. Call `getCharacter('<any local character id with abilities>', supabaseAdmin)` and print `abilities.map(a => [a.name, a.meters])`. Expected: meters arrays are present on merged abilities. Record the output.

- [ ] **Step 7: Run the unit tier and commit**

Run: `bun run test:unit`
Expected: only the known red.

```bash
git add services/game-tables/ models/game-tables.js
git commit -m "feat: tracker views, versioned tracker actions with undo, and new sessions"
```

---

### Task 4: Tracker routes and views

**Files:**
- Create: `views/partials/table-tracker.handlebars`
- Modify: `views/partials/table-roster.handlebars` (render the tracker inside each member box when `trackers` is given)
- Modify: `views/partials/table-panel.handlebars` (pass `trackers` down)
- Modify: `views/table.handlebars` (New session button for managers; live-mode data attributes; the table-live script tag)
- Modify: `routes/tables.js` (`panelContext` includes trackers; add `GET /:id/members/:memberId/tracker`, `POST /:id/members/:memberId/actions` and `POST /:id/session`)
- Modify: `routes/tables.test.js`
- Modify: `public/js/app.js` (`App.showToast(message, { type, action })`)
- Modify: `public/css/styles.css` (tracker bar and threshold colours)

**Interfaces:**
- Consumes:
  - Task 3: `gameTables.trackers(view, actor)`, `tracker(actor, tableId, memberId)`, `act(actor, tableId, memberId, action, client)` and `newSession(actor, tableId)`.
  - The TrackerView shape.
- Produces:
  - Tracker element `#tracker-<memberId>` with `data-version`.
  - `GET /tables/:id/members/:memberId/tracker?v=<version>`, which answers 204 when the version is unchanged.
  - An `HX-Trigger: {"trackerActed": {memberId, actionUrl, version, message, undoable}}` header on successful actions.
  - `App.showToast(message, { type?, action?: { label, run } })`.
  - The `views/table.handlebars` root element carries `data-table-live="<tableId>"` and `data-live-mode="realtime|poll"`.

- [ ] **Step 1: Write the failing route tests**

In `routes/tables.test.js`, give `fake` default `trackers: async () => ({ data: new Map() })`. Then add:

```js
const TRACKER = {
  version: 5, canTrack: true, isConduit: false, actionUrl: `/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`,
  pools: [{ name: 'essence', label: 'Essence', threshold: 1, thresholdLabel: 'Yellow', spent: 2, budget: 6, approximate: false,
    segments: [true, true, false, false, false, false], thresholdOptions: [], actionUrl: `/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`, canTrack: true }],
  sources: [],
};

test('an action renders the new tracker and announces it for the undo toast', async () => {
  let received;
  fake.act = async (actor, tableId, memberId, action, client) => {
    received = { actor, tableId, memberId, action, client };
    return { data: { tracker: TRACKER, member: { memberId: MEMBER_ID }, tableId, acted: { message: 'Mira spent Low Essence.', undoable: true, version: 5 } } };
  };
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=spend&pool=essence&amount=Low',
  });
  expect(res.status).toBe(200);
  expect(received.action).toMatchObject({ type: 'spend', pool: 'essence', amount: 'Low' });
  expect(received.client).toBeDefined();
  expect(await res.text()).toContain(`id="tracker-${MEMBER_ID}"`);
  const trigger = JSON.parse(res.headers.get('HX-Trigger'));
  expect(trigger.trackerActed).toMatchObject({ memberId: MEMBER_ID, version: 5, undoable: true });
});

test('the toast header survives a curly apostrophe', async () => {
  fake.act = async (actor, tableId) => ({ data: { tracker: TRACKER, member: { memberId: MEMBER_ID }, tableId, acted: { message: 'Mira used Harrow’s Mark.', undoable: true, version: 5 } } });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=use&source=mechanic%3Apitch',
  });
  expect(res.status).toBe(200);
  expect(JSON.parse(res.headers.get('HX-Trigger')).trackerActed.message).toBe('Mira used Harrow’s Mark.');
});

test('a refused action is a toast', async () => {
  fake.act = async () => ({ error: { status: 409, code: 'conflict', title: 'Changed elsewhere', message: 'Changed by Ash since — undo unavailable.' } });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/members/${MEMBER_ID}/actions`, {
    method: 'POST', headers: { ...hx, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'type=undo&version=2',
  });
  expect(res.status).toBe(409);
  expect(res.headers.get('HX-Retarget')).toBe('#alerts');
});

test('polling an unchanged tracker is a 204; a changed one renders', async () => {
  fake.tracker = async () => ({ data: { tracker: TRACKER, member: { memberId: MEMBER_ID }, tableId: TABLE_ID } });
  expect((await get(`/tables/${TABLE_ID}/members/${MEMBER_ID}/tracker?v=5`)).status).toBe(204);
  const res = await get(`/tables/${TABLE_ID}/members/${MEMBER_ID}/tracker?v=4`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('data-version="5"');
});

test('polling a removed member is a 404', async () => {
  fake.tracker = async () => ({ error: { status: 404, code: 'not_found', message: "We couldn't find that, or you don't have access to it." } });
  expect((await get(`/tables/${TABLE_ID}/members/${MEMBER_ID}/tracker?v=1`)).status).toBe(404);
});

test('starting a new session refreshes the page', async () => {
  fake.newSession = async () => ({ data: null });
  const res = await fetch(`${baseUrl}/tables/${TABLE_ID}/session`, { method: 'POST', headers: hx });
  expect(res.headers.get('HX-Refresh')).toBe('true');
});

test('the table page renders each member\'s tracker', async () => {
  fake.load = async () => ({ data: view() });
  fake.trackers = async () => ({ data: new Map([[MEMBER_ID, TRACKER]]) });
  const html = await (await get(`/tables/${TABLE_ID}`)).text();
  expect(html).toContain(`id="tracker-${MEMBER_ID}"`);
  expect(html).toContain('Yellow');
});
```

Run: `bun test routes/tables.test.js`
Expected: FAIL on the new tests.

- [ ] **Step 2: Write `views/partials/table-tracker.handlebars`**

```handlebars
{{!-- One member's live tracker (docs/superpowers/specs/2026-10-08-game-tables-design.md §5).
      Every button posts one action and swaps this element with the answer;
      non-participants (and participants while Realtime is down) re-fetch it
      every 5 seconds, which answers 204 while nothing changed. --}}
<div id="tracker-{{memberId}}" class="table-tracker mt-2" data-tracker data-version="{{tracker.version}}"
  hx-get="/tables/{{tableId}}/members/{{memberId}}/tracker?v={{tracker.version}}"
  hx-trigger="every 5s [window.TableLive && window.TableLive.shouldPoll()]"
  hx-target="this" hx-swap="outerHTML">
  {{#each tracker.pools}}
  <div class="tracker-pool is-flex is-align-items-center is-flex-wrap-wrap mb-1" data-pool="{{this.name}}">
    <strong class="tracker-pool-label mr-2">{{this.label}}</strong>
    <span class="tag tracker-threshold is-threshold-{{this.threshold}} mr-2" data-threshold="{{this.threshold}}">{{this.thresholdLabel}}</span>
    <span class="tracker-bar mr-2" title="{{this.spent}} of {{this.budget}} Low-cost units{{#if this.approximate}} (approximate){{/if}}">{{#each this.segments}}<span class="tracker-seg{{#if this}} is-filled{{/if}}"></span>{{/each}}</span>
    {{#if this.canTrack}}
    <div class="buttons are-small mb-0">
      {{#each this.spendAmounts}}
      <button type="button" class="button" hx-post="{{../actionUrl}}" hx-vals='{"type":"spend","pool":"{{../name}}","amount":"{{this}}"}' aria-label="Spend {{this}} {{../label}}">−{{this}}</button>
      {{/each}}
      {{#each this.restoreAmounts}}
      <button type="button" class="button is-light" hx-post="{{../actionUrl}}" hx-vals='{"type":"restore","pool":"{{../name}}","amount":"{{this}}"}' aria-label="Restore {{this}} {{../label}}">+{{this}}</button>
      {{/each}}
      <form class="is-inline-flex" hx-post="{{this.actionUrl}}">
        <input type="hidden" name="type" value="set"><input type="hidden" name="pool" value="{{this.name}}"><input type="hidden" name="spent" value="0">
        <div class="select is-small"><select name="threshold" aria-label="Set {{this.label}} Threshold" onchange="this.form.requestSubmit()">
          {{#each this.thresholdOptions}}<option value="{{this.value}}"{{#if this.selected}} selected{{/if}}>{{this.label}}</option>{{/each}}
        </select></div>
      </form>
    </div>
    {{/if}}
  </div>
  {{/each}}

  <details class="tracker-sources mt-1">
    <summary class="is-size-7 has-text-link">Abilities, Signatures &amp; mechanics</summary>
    {{#each tracker.sources}}
    <div class="tracker-source is-flex is-align-items-center is-flex-wrap-wrap py-1" data-source="{{this.key}}">
      <span class="mr-2"><strong>{{this.name}}</strong> <span class="has-text-grey is-size-7">{{this.kind}}</span></span>
      {{#if this.used}}<span class="tag is-light mr-1{{#if this.heavyUse}} is-warning{{/if}}">Used ×{{this.used}} this session</span>{{/if}}
      {{#if this.uses}}<span class="tag is-light mr-1" title="Finite Uses {{this.uses.label}}">{{this.remaining}} left</span>{{/if}}
      {{#each this.printed}}<span class="tag is-white mr-1">{{this.label}}: {{this.value}}</span>{{/each}}
      {{#each this.imposed}}
      <span class="tag is-danger is-light mr-1" title="Conduit-imposed">{{this.kind}}: {{this.rating}}
        {{#if ../isConduit}}<button type="button" class="delete is-small" hx-post="{{../actionUrl}}" hx-vals='{"type":"lift","source":"{{../key}}","index":"{{this.index}}"}' aria-label="Lift this Limiter"></button>{{/if}}
      </span>
      {{/each}}
      {{#if this.canTrack}}
      <div class="buttons are-small mb-0 ml-auto">
        {{#if this.needsLevel}}
        {{#each this.levels}}
        <button type="button" class="button is-primary is-light" hx-post="{{../actionUrl}}" hx-vals='{"type":"use","source":"{{../key}}","level":"{{this}}"}'>Use ({{this}})</button>
        {{/each}}
        {{else}}
        <button type="button" class="button is-primary is-light" hx-post="{{this.actionUrl}}" hx-vals='{"type":"use","source":"{{this.key}}"}'>Use</button>
        {{/if}}
        {{#if (or this.hasCooldown this.cooldownOn)}}
        <button type="button" class="button{{#if this.cooldownOn}} is-warning{{/if}}" hx-post="{{this.actionUrl}}" hx-vals='{"type":"toggle_cooldown","source":"{{this.key}}"}'>{{#if this.cooldownOn}}On cooldown{{else}}Cooldown{{/if}}</button>
        {{/if}}
        {{#if this.isConduit}}
        <form class="is-inline-flex" hx-post="{{this.actionUrl}}">
          <input type="hidden" name="type" value="impose"><input type="hidden" name="source" value="{{this.key}}">
          <div class="select is-small"><select name="kind" aria-label="Limiter kind"><option>Essence Cost</option><option>Stamina Cost</option><option>Cooldown</option></select></div>
          <div class="select is-small"><select name="rating" aria-label="Limiter rating"><option>Low</option><option>Mid</option><option>High</option></select></div>
          <button class="button" type="submit">Impose</button>
        </form>
        {{/if}}
      </div>
      {{/if}}
    </div>
    {{/each}}
  </details>
</div>
```

`or` comes from handlebars-helpers, which the engine spreads. If the route-test harness lacks it, the harness is missing `hbsHelpers`; add that, not a new helper. On a phone the `<details>` keeps sources collapsed, so pools stay thumb-reachable at the top.

- [ ] **Step 3: Wire the tracker into the roster and page**

`views/partials/table-roster.handlebars`: inside each member box, after the level row and before `#member-details-…`, add:

```handlebars
    {{#if (lookup ../trackers this.memberId)}}
    {{> table-tracker tracker=(lookup ../trackers this.memberId) tableId=../tableId memberId=this.memberId}}
    {{/if}}
```

`lookup` on a `Map` does not work in Handlebars, so `routes/tables.js` passes `trackers` as a plain object (`Object.fromEntries(map)`).

`views/partials/table-panel.handlebars`: pass `trackers=trackers` in the `{{> table-roster …}}` call.

`views/table.handlebars`:
- Wrap the page body (below the breadcrumbs) in `<div data-table-live="{{table.id}}" data-live-mode="{{liveMode}}">…</div>`. Only on saved tables: wrap it in `{{#unless draft}}`, or put the attributes on an element that exists only when `table` is set.
- In the header's manager controls, add:

```handlebars
{{#if capabilities.canManage}}
<button type="button" class="button is-small is-warning is-light"
  hx-post="/tables/{{table.id}}/session"
  hx-confirm="Start a new session? Every tracker resets to Green with nothing spent, and counts, cooldowns and Limiters clear. This cannot be undone.">New session</button>
{{/if}}
```

- At the bottom: `{{#unless draft}}<script src="/js/table-live.js" defer></script>{{/unless}}`. Task 5 creates that file.

- [ ] **Step 4: Add the routes**

In `routes/tables.js`:

```js
// Node rejects header values outside Latin-1, and class text is full of
// curly apostrophes; JSON allows \u escapes for exactly this.
const asciiJson = (value) => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const isParticipantView = (view, profile) =>
  Boolean(profile) && (view.capabilities.canManage || view.members.some((m) => m.ownerId === profile.id));

const actionFrom = (body = {}) => ({
  type: String(body.type || ''),
  pool: body.pool === undefined ? undefined : String(body.pool),
  amount: body.amount === undefined ? undefined : String(body.amount),
  level: body.level === undefined ? undefined : String(body.level),
  source: body.source === undefined ? undefined : String(body.source),
  threshold: body.threshold === undefined ? undefined : Number(body.threshold),
  spent: body.spent === undefined ? undefined : Number(body.spent),
  kind: body.kind === undefined ? undefined : String(body.kind),
  rating: body.rating === undefined ? undefined : String(body.rating),
  index: body.index === undefined ? undefined : Number(body.index),
  version: body.version === undefined ? undefined : Number(body.version),
});

const renderTracker = (res, { tracker, tableId, member }) =>
  res.render('partials/table-tracker', { layout: false, tracker, tableId, memberId: member.memberId });
```

Give `panelContext(view, profile, trackers)` a `trackers` parameter and include `trackers: trackers ? Object.fromEntries(trackers) : {}`.

Change the full-page `GET /:id` handler to call `gameTables.trackers(view, actor)` after `load` (passing errors to `sendRouteError`). Pass the result into `panelContext`, and pass `liveMode: isParticipantView(view, res.locals.profile) ? 'realtime' : 'poll'` to the render.

Do the same in `renderPanel`. Every member endpoint re-renders the panel, so it must include trackers. Make `renderPanel` async: call `gameTables.trackers(data, actorFromLocals(res.locals))` before rendering. Then change every call site to `return renderPanel(...)` (or `await`) so an error inside it reaches `asyncHandler` instead of escaping as an unhandled rejection.

Add the routes, placed with the other `/:id/members/:memberId` routes:

```js
router.get('/:id/members/:memberId/tracker', authOptional, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data, error } = await gameTables.tracker(actorFromLocals(res.locals), req.params.id, req.params.memberId);
  if (error) return sendRouteError(req, res, error);
  if (req.query.v !== undefined && Number(req.query.v) === data.tracker.version) return res.status(204).send();
  renderTracker(res, data);
}));

router.post('/:id/members/:memberId/actions', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data, error } = await gameTables.act(
    actorFromLocals(res.locals), req.params.id, req.params.memberId, actionFrom(req.body), res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  res.header('HX-Trigger', asciiJson({
    trackerActed: { memberId: data.member.memberId, actionUrl: data.tracker.actionUrl, ...data.acted },
  }));
  renderTracker(res, data);
}));

router.post('/:id/session', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { error } = await gameTables.newSession(actorFromLocals(res.locals), req.params.id);
  if (error) return sendRouteError(req, res, error);
  res.header('HX-Refresh', 'true').send();
}));
```

- [ ] **Step 5: Add `App.showToast`**

In `public/js/app.js`, change `_displayNotification(alertType, message)` to `_displayNotification(alertType, message, { action } = {})`. After the text node is appended, add:

```js
    if (action && action.label && typeof action.run === 'function') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button is-small is-light ml-3';
      button.textContent = action.label;
      button.addEventListener('click', () => { notification.remove(); action.run(); });
      notification.appendChild(button);
    }
```

Export it on the returned `App` object:

```js
    showToast: (message, { type = 'info', action } = {}) => _displayNotification(type, message, { action }),
```

Existing callers pass two arguments and are unaffected. If `test/notification-toast.test.js` pins the notification's child count, extend it rather than loosen it. Add one test that an action button runs its callback and dismisses the toast.

- [ ] **Step 6: Style the tracker**

Append to `public/css/styles.css`:

```css
/* Live trackers: a threshold tag coloured Green→Below Red and a bar of
   Low-cost segments. Segments shrink to fit large budgets. */
.tracker-threshold.is-threshold-0 { background: hsl(141, 53%, 53%); color: #fff; }
.tracker-threshold.is-threshold-1 { background: hsl(48, 100%, 67%); color: rgba(0, 0, 0, 0.7); }
.tracker-threshold.is-threshold-2 { background: hsl(348, 86%, 61%); color: #fff; }
.tracker-threshold.is-threshold-3 { background: hsl(0, 0%, 21%); color: #fff; }
.tracker-bar { display: inline-flex; gap: 2px; max-width: 12rem; flex-wrap: wrap; }
.tracker-seg { width: 0.6rem; height: 0.8rem; border-radius: 2px; background: hsl(0, 0%, 86%); }
.tracker-seg.is-filled { background: hsl(204, 71%, 39%); }
.tracker-source + .tracker-source { border-top: 1px solid hsl(0, 0%, 93%); }
```

- [ ] **Step 7: Run the tests**

Run: `bun test routes/tables.test.js`, then `bun test test/notification-toast.test.js`, then `bun run test:http` and `bun run test:unit`.
Expected: all pass, apart from the known unit red.

- [ ] **Step 8: Commit**

```bash
git add views/partials/table-tracker.handlebars views/partials/table-roster.handlebars views/partials/table-panel.handlebars views/table.handlebars routes/tables.js routes/tables.test.js public/js/app.js public/css/styles.css test/notification-toast.test.js
git commit -m "feat: per-seat live trackers on the table page, with undo toasts and new sessions"
```

---

### Task 5: Live updates

**Files:**
- Create: `public/js/table-live.js`
- Modify: `public/js/app.js` (export `getSupabaseClient`)
- Modify: `e2e/specs/17-game-tables.spec.js` (a tracker test)

**Interfaces:**
- Consumes:
  - The `data-table-live`/`data-live-mode` root attributes, `#tracker-<memberId>` with `data-version`, and the `trackerActed` event detail `{ memberId, actionUrl, version, message, undoable }` (all Task 4).
  - `App.showToast` (Task 4).
- Produces:
  - `window.TableLive = { shouldPoll(): boolean, scan(): void }`.
  - `App.getSupabaseClient(): SupabaseClient | null`.

- [ ] **Step 1: Export the browser Supabase client**

In `public/js/app.js`'s returned object, add `getSupabaseClient: () => supabaseClient || null,`. It is the client that already holds the signed-in session, so its Realtime connection authenticates as the viewer, and RLS decides which rows' changes they receive.

- [ ] **Step 2: Write `public/js/table-live.js`**

```js
// Live trackers on a game table page. Participants (data-live-mode="realtime")
// subscribe to their table's tracker rows; each change is only a ping that
// re-fetches that member's tracker fragment. Everyone else -- and a
// participant whose Realtime connection is down -- falls back to the
// tracker's own hx-trigger poll, which consults shouldPoll().
//
// window-assigned and idempotent: hx-boost re-executes this script on every
// navigation to a table page.
window.TableLive = window.TableLive || (function () {
  let connected = false;
  let channel = null;
  let tableId = null;
  const pending = new Map();

  const refresh = (memberId) => {
    clearTimeout(pending.get(memberId));
    pending.set(memberId, setTimeout(() => {
      const el = document.getElementById(`tracker-${memberId}`);
      if (!el) return;
      htmx.ajax('GET', `/tables/${tableId}/members/${memberId}/tracker?v=${el.dataset.version}`, { target: el, swap: 'outerHTML' });
    }, 250));
  };

  const stop = () => {
    const client = window.App && App.getSupabaseClient();
    if (channel && client) client.removeChannel(channel);
    channel = null;
    connected = false;
  };

  const start = (root) => {
    const nextTable = root.dataset.tableLive;
    if (channel && nextTable === tableId) return;
    stop();
    tableId = nextTable;
    if (root.dataset.liveMode !== 'realtime') return;
    const client = window.App && App.getSupabaseClient();
    if (!client) return;
    channel = client
      .channel(`game-table-${tableId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_table_member_state', filter: `table_id=eq.${tableId}` },
        (payload) => refresh(payload.new.member_id))
      .subscribe((status) => { connected = status === 'SUBSCRIBED'; });
  };

  const scan = () => {
    const root = document.querySelector('[data-table-live]');
    if (root) start(root);
    else stop();
  };

  document.addEventListener('DOMContentLoaded', scan);
  document.body.addEventListener('htmx:afterSettle', scan);

  document.body.addEventListener('trackerActed', (event) => {
    const detail = event.detail || {};
    if (!window.App) return;
    App.showToast(detail.message || 'Updated.', {
      type: 'info',
      action: detail.undoable ? {
        label: 'Undo',
        run: () => htmx.ajax('POST', detail.actionUrl, {
          target: `#tracker-${detail.memberId}`,
          swap: 'outerHTML',
          values: { type: 'undo', version: detail.version },
        }),
      } : null,
    });
  });

  return { shouldPoll: () => !connected, scan };
})();

// On a boosted navigation this script runs long after DOMContentLoaded, and
// the guard above skips re-creating the module; scan for this page's table.
if (document.readyState !== 'loading') window.TableLive.scan();
```

`htmx:afterSettle` fires for every swap, including tracker swaps. `start` returns early when it is already subscribed to the same table, so the scan is cheap. The final line is load-bearing: when hx-boost swaps the body in, `DOMContentLoaded` has long passed.

- [ ] **Step 3: Add the e2e tracker test**

In `e2e/specs/17-game-tables.spec.js`, add a test that reuses the file's sign-in and cleanup prefix:
1. Signed in as the admin, create a table through the draft's Save form, named `${prefix} trackers`.
2. Add a guest with all stats 0, so the Essence budget is 6.
3. In the guest's tracker, click "−High" on Essence. Expect the tracker's Essence threshold tag to read `Yellow`, and expect a toast with an `Undo` button.
4. Click Undo. Expect `Green`.
5. Open the table URL in a second, **signed-out** browser context, which polls. In the first context click "−High" again.
6. In the second context, expect the guest's Essence tag to read `Yellow` within 8 seconds (`expect(locator).toHaveText('Yellow', { timeout: 8000 })`).

The existing cleanup deletes tables by prefix; tracker rows cascade.

Run: `bunx playwright test e2e/specs/17-game-tables.spec.js --workers=1`
Expected: all tests pass.

- [ ] **Step 4: Browser check of the Realtime path**

Use the `run` skill or a headless Playwright script in your scratch directory. Start the app on a free port and stop it by PID; never `pkill`. Use the local stack only. Confirm and screenshot each item:
1. **Realtime between participants.** Sign in as the same table's creator in two contexts. Confirm `window.TableLive.shouldPoll()` is `false` in both once subscribed. A spend in one context appears in the other within 2 seconds, faster than the 5-second poll.
2. **Polling for a signed-out viewer** catches up within about 5 seconds, and the network panel shows 204s while idle.
3. **Range costs.** A seated character with a `Low–High` Essence ability shows three Use buttons. Using one at Mid moves the bar by 3 segments.
4. **Limiters.** As Conduit, impose a Cooldown on Pitch. It shows as "Conduit-imposed", and lifting it removes it. A non-Conduit manager sees no Impose control.
5. **New session** resets every tracker after the confirm.
6. **At 375px width**, pool rows wrap without horizontal page scroll, and sources stay collapsed.

Report the results and screenshot paths. Fix failures, re-run the affected tests, and commit the fixes.

- [ ] **Step 5: Run the tiers and commit**

Run: `bun run test:unit`, `bun run test:http`, then `bun test models/game-tables-rls.integration.test.js`.
Expected: the known unit red only; everything else passes.

```bash
git add public/js/table-live.js public/js/app.js e2e/specs/17-game-tables.spec.js
git commit -m "feat: live tracker updates over Realtime with polling fallback and undo toasts"
```
