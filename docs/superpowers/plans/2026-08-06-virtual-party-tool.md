# Virtual Party Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a top-level `/party` tool where anyone assembles a roster of characters held in the URL and sees that party's stat totals, coverage gaps, and per-character breakdown — with the same summary rendered on the LFG post page.

**Architecture:** Four layers, bottom-up. A pure `summarizeParty()` in `util/party-stats.js` does all the arithmetic with no I/O. One new RLS-scoped model function fetches character rows by id. A new `routes/party.js` parses the `?c=` query string, fetches, summarizes, renders. One shared `party-summary` partial is rendered by both `/party` and `lfg-post`, replacing the inline reduce in `routes/lfg.js`.

**Tech Stack:** Bun test runner, Express 4, express-handlebars 8 (Bulma classes), htmx 2, Supabase JS 2 (RLS-scoped clients), Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-06-virtual-party-tool-design.md`

## Global Constraints

- **Party cap is 8 members.** Ids past the eighth are dropped and reported, never silently truncated.
- **No migration, no new table.** Party membership lives only in the `?c=` query string.
- **RLS is the visibility gate.** `getPartyCharacters` passes `res.locals.supabase` and applies **no** `is_public` filter in JS. Never use `supabaseAdmin` in this feature.
- **Stat vocabulary is fixed.** Always iterate `statList` from `util/enclave-consts.js` (12 stats, in that order). Never hardcode a stat list. Blocks render through the existing `stat-blocks-readonly` partial with `max=5`.
- **Routes are `authOptional`.** Signing in adds My Characters; it is never required.
- **Run unit tests with** `bun run test:unit`. A single file: `bun test <path>`.
- **New HTTP-tier tests must be registered** in the `httpFiles` set in `scripts/run-tests.mjs`, or they run in the unit tier and fail.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `test:`, `fix:`, `docs:`).

## File Structure

| File | Responsibility |
|---|---|
| `util/party-stats.js` | **Create.** Pure `summarizeParty(characters)`. No I/O, no Handlebars, no Supabase. |
| `util/party-stats.test.js` | **Create.** Unit tests for the above. |
| `models/character.js` | **Modify.** Add + export `getPartyCharacters(ids, client)`. |
| `routes/party.js` | **Create.** `GET /party`, `GET /party/panel`, `GET /party/s`. Owns `?c=` parsing. |
| `routes/party.test.js` | **Create.** HTTP-tier tests. Registered in `scripts/run-tests.mjs`. |
| `views/party.handlebars` | **Create.** Page shell: left = My Characters + search, right = `#party-panel`. |
| `views/partials/party-panel.handlebars` | **Create.** Roster + summary + `#party-csv` hidden input + notices. |
| `views/partials/party-roster.handlebars` | **Create.** Member chips with Remove buttons and lock markers. |
| `views/partials/party-summary.handlebars` | **Create.** Totals + coverage + breakdown. Rendered by `/party` **and** `lfg-post`. |
| `views/partials/party-summary.test.js` | **Create.** Handlebars render tests. |
| `views/partials/party-search-results.handlebars` | **Create.** Dense result rows with Add buttons. |
| `routes/lfg.js` | **Modify.** Delete inline reduce (`:105-110`), call `summarizeParty`. |
| `views/lfg-post.handlebars` | **Modify.** Render `party-summary`; add "Open in party tool" link. |
| `views/lfg-post.test.js` | **Modify.** Re-point the assertion at the shared partial. |
| `app.js` | **Modify.** Mount `routes/party.js` at `/party`. |
| `util/seed-nav.js` | **Modify.** Add the Virtual Party nav item under Social. |
| `e2e/specs/17-virtual-party.spec.js` | **Create.** Add two, remove one, assert URL and totals. |

**Task order is bottom-up so every task's dependencies already exist:** 1 (pure core) → 2 (model) → 3 (route + parsing) → 4 (summary partial) → 5 (page + panel + search) → 6 (LFG adoption) → 7 (nav + e2e).

---

### Task 1: The pure summary core

**Files:**
- Create: `util/party-stats.js`
- Test: `util/party-stats.test.js`

**Interfaces:**
- Consumes: `statList` from `util/enclave-consts.js` — an array of 12 lowercase stat names in fixed order: `vitality, might, resilience, spirit, arcane, will, sensory, reflex, vigor, skill, intelligence, luck`.
- Produces: `summarizeParty(characters) -> summary`, where `characters` is an array of character rows (each has `id`, `name`, `is_public`, `is_deceased`, and the 12 stat columns as numbers) and `summary` is:

```js
{
  totals:      { vitality: 7, might: 3, /* ...all 12, always present */ },
  gaps:        ['arcane', 'luck'],          // stats whose total === 0
  strongest:   ['might', 'vigor', 'skill'], // up to 3, highest total first
  weakest:     ['spirit', 'will'],          // up to 3, lowest total first, gaps excluded
  breakdown:   [{ id, name, is_public, is_deceased, stats: { vitality: 3, ... } }],
  memberCount: 5
}
```

Tasks 3, 4, and 6 all depend on these exact key names.

- [ ] **Step 1: Write the failing tests**

Create `util/party-stats.test.js`:

```js
// The whole of the party summary arithmetic. This module is pure on purpose:
// routes/party.js and routes/lfg.js both call it, and neither should own a
// copy of the reduce that routes/lfg.js used to carry inline.
const { test, expect } = require('bun:test');
const { statList } = require('./enclave-consts');
const { summarizeParty } = require('./party-stats');

// Build a character row with every stat 0, then apply the overrides. Keeps
// each test's intent to the stats it actually cares about.
const member = (name, stats = {}) => ({
  id: `id-${name}`,
  name,
  is_public: true,
  is_deceased: false,
  ...Object.fromEntries(statList.map(stat => [stat, 0])),
  ...stats
});

test('an empty party totals zero everywhere and is all gaps', () => {
  const summary = summarizeParty([]);
  expect(summary.memberCount).toBe(0);
  expect(Object.keys(summary.totals).sort()).toEqual([...statList].sort());
  expect(Object.values(summary.totals).every(total => total === 0)).toBe(true);
  expect(summary.gaps).toEqual(statList);
  expect(summary.strongest).toEqual([]);
  expect(summary.weakest).toEqual([]);
  expect(summary.breakdown).toEqual([]);
});

test('a single member totals that member', () => {
  const summary = summarizeParty([member('Ash', { might: 4, luck: 2 })]);
  expect(summary.totals.might).toBe(4);
  expect(summary.totals.luck).toBe(2);
  expect(summary.memberCount).toBe(1);
});

test('multiple members sum per stat', () => {
  const summary = summarizeParty([
    member('Ash', { might: 4, luck: 2 }),
    member('Bee', { might: 3, luck: 1 })
  ]);
  expect(summary.totals.might).toBe(7);
  expect(summary.totals.luck).toBe(3);
});

test('missing or null stat values count as zero rather than NaN', () => {
  // Not hypothetical: a select that omits a column, or a nullable column,
  // yields undefined/null here. NaN would poison the total and every
  // ranking derived from it.
  const partial = { id: 'x', name: 'Partial', is_public: true, might: 3, luck: null };
  const summary = summarizeParty([partial]);
  expect(summary.totals.might).toBe(3);
  expect(summary.totals.luck).toBe(0);
  expect(Number.isNaN(summary.totals.vitality)).toBe(false);
  expect(summary.totals.vitality).toBe(0);
});

test('gaps are exactly the zero-total stats', () => {
  const summary = summarizeParty([member('Ash', { might: 2, luck: 1 })]);
  expect(summary.gaps).not.toContain('might');
  expect(summary.gaps).not.toContain('luck');
  expect(summary.gaps).toContain('arcane');
  expect(summary.gaps.length).toBe(statList.length - 2);
});

test('strongest lists the top three by total, highest first', () => {
  const summary = summarizeParty([
    member('Ash', { might: 9, vigor: 7, skill: 5, luck: 1 })
  ]);
  expect(summary.strongest).toEqual(['might', 'vigor', 'skill']);
});

test('weakest lists the lowest non-gap stats, lowest first', () => {
  const summary = summarizeParty([
    member('Ash', { might: 9, vigor: 7, skill: 5, luck: 1, spirit: 2, will: 3 })
  ]);
  // arcane and the rest are 0, so they are gaps and must not appear here.
  expect(summary.weakest).toEqual(['luck', 'spirit', 'will']);
  summary.weakest.forEach(stat => expect(summary.gaps).not.toContain(stat));
});

test('ties break by statList order so the output is deterministic', () => {
  // vitality, might, resilience all total 3. statList order decides.
  const summary = summarizeParty([
    member('Ash', { vitality: 3, might: 3, resilience: 3, spirit: 1 })
  ]);
  expect(summary.strongest).toEqual(['vitality', 'might', 'resilience']);
});

test('fewer than three non-gap stats yields a shorter list, not padding', () => {
  const summary = summarizeParty([member('Ash', { might: 2, luck: 1 })]);
  expect(summary.strongest).toEqual(['might', 'luck']);
  expect(summary.weakest).toEqual(['luck', 'might']);
});

test('breakdown carries one entry per member, in the order given', () => {
  const summary = summarizeParty([
    member('Ash', { might: 4 }),
    member('Bee', { might: 3 })
  ]);
  expect(summary.breakdown.map(row => row.name)).toEqual(['Ash', 'Bee']);
  expect(summary.breakdown[0].stats.might).toBe(4);
  expect(summary.breakdown[0].id).toBe('id-Ash');
  expect(summary.breakdown[0].is_public).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/party-stats.test.js`
Expected: FAIL — `Cannot find module './party-stats'`.

- [ ] **Step 3: Write the implementation**

Create `util/party-stats.js`:

```js
const { statList } = require('./enclave-consts');

// Every consumer of a party summary — routes/party.js and routes/lfg.js —
// goes through this function. It is pure so it can be tested without a
// database, and shared so the two pages cannot drift apart the way they
// would if each kept its own reduce.

const HIGHLIGHT_COUNT = 3;

// A stat column can arrive undefined (the select omitted it) or null (the
// column is nullable). Both mean "contributes nothing", not NaN.
const statValue = (character, stat) => Number(character?.[stat]) || 0;

const summarizeParty = (characters = []) => {
  const members = Array.isArray(characters) ? characters : [];

  const totals = Object.fromEntries(statList.map(stat => [
    stat,
    members.reduce((sum, member) => sum + statValue(member, stat), 0)
  ]));

  const gaps = statList.filter(stat => totals[stat] === 0);
  const covered = statList.filter(stat => totals[stat] > 0);

  // Sort a copy: statList's own order is the tiebreaker, and Array#sort is
  // stable in every engine we run on, so filtering it first and sorting by
  // total alone gives deterministic ties without a secondary comparator.
  const byTotalDesc = [...covered].sort((a, b) => totals[b] - totals[a]);
  const byTotalAsc = [...covered].sort((a, b) => totals[a] - totals[b]);

  return {
    totals,
    gaps,
    strongest: byTotalDesc.slice(0, HIGHLIGHT_COUNT),
    weakest: byTotalAsc.slice(0, HIGHLIGHT_COUNT),
    breakdown: members.map(member => ({
      id: member.id,
      name: member.name,
      is_public: member.is_public,
      is_deceased: member.is_deceased,
      stats: Object.fromEntries(statList.map(stat => [stat, statValue(member, stat)]))
    })),
    memberCount: members.length
  };
};

module.exports = { summarizeParty };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test util/party-stats.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add util/party-stats.js util/party-stats.test.js
git commit -m "feat: add the pure party summary core"
```

---

### Task 2: Fetching party members through RLS

**Files:**
- Modify: `models/character.js` (add function near `searchPublicCharacters` at `:244`; add to the `module.exports` block at `:445`)
- Test: `models/party-characters.test.js`

**Interfaces:**
- Consumes: `supabase` from `models/_base` (already imported at `models/character.js:1`), `statList` from `util/enclave-consts` (already imported at `:4`).
- Produces: `getPartyCharacters(ids, client) -> Promise<{ data, error }>` where `data` is an array of rows carrying `id, name, image_url, class, class_id, is_deceased, is_public` plus the 12 stat columns. **Row order is not guaranteed** — Task 3 reorders. Returns `{ data: [], error: null }` for an empty/absent id list without hitting the network.

The query itself is exercised through Task 3's HTTP tests against a fake client, and the RLS behaviour it relies on is enforced by the database — by the policies at `supabase/migrations/20240101000000_baseline_schema.sql:872-885`, not by this code. What this task tests directly is its one branch: the empty-list guard, which must short-circuit *without* touching the client.

- [ ] **Step 1: Write the failing test**

Create `models/party-characters.test.js`:

```js
// The empty-list guard on getPartyCharacters. It must return early rather
// than issuing .in('id', []) — a query that is both pointless and, on some
// PostgREST versions, malformed. The stub client throws on any use, so the
// test fails loudly if the guard ever stops short-circuiting.
const { test, expect } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const { getPartyCharacters } = require('./character');

const explodingClient = {
  from() { throw new Error('getPartyCharacters must not query for an empty id list'); }
};

test('an empty id list resolves to an empty party without querying', async () => {
  const { data, error } = await getPartyCharacters([], explodingClient);
  expect(data).toEqual([]);
  expect(error).toBeNull();
});

test('a missing or non-array id list is treated as an empty party', async () => {
  for (const input of [null, undefined, 'not-an-array']) {
    const { data, error } = await getPartyCharacters(input, explodingClient);
    expect(data).toEqual([]);
    expect(error).toBeNull();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test models/party-characters.test.js`
Expected: FAIL — `getPartyCharacters is not a function`.

- [ ] **Step 3: Add the function**

In `models/character.js`, immediately after `searchPublicCharacters` ends (before `getRandomPublicCharacters` at `:275`), insert:

```js
// Fetches the character rows for a virtual party (routes/party.js) or an LFG
// party. Deliberately applies NO is_public filter: the caller passes its
// request-scoped client, and the characters SELECT policies
// (characters_public_select OR characters_owner_admin_select) already resolve
// exactly "public, plus the ones you own" at the database. Filtering again in
// JS would drop the caller's own private characters, which the party tool
// specifically supports. Never pass supabaseAdmin here.
const getPartyCharacters = async (ids, client = supabase) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { data: [], error: null };
  }

  const { data, error } = await client
    .from('characters')
    .select(`id, name, image_url, class, class_id, is_deceased, is_public, ${statList.join(', ')}`)
    .in('id', ids);

  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};
```

- [ ] **Step 4: Export it**

In the `module.exports` block at `models/character.js:445`, add `getPartyCharacters,` on the line directly after `searchPublicCharacters,`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test models/party-characters.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verify nothing regressed**

Run: `bun run test:unit`
Expected: PASS. Confirms the edit did not break `models/character.js`'s existing consumers — a syntax error or a broken export surfaces here.

- [ ] **Step 7: Commit**

```bash
git add models/character.js models/party-characters.test.js
git commit -m "feat: add getPartyCharacters, resolved through RLS"
```

---

### Task 3: The party route and its membership parsing

**Files:**
- Create: `routes/party.js`
- Create: `routes/party.test.js`
- Modify: `app.js` (add require near `:17`, add `app.use` near `:77`)
- Modify: `scripts/run-tests.mjs` (add to the `httpFiles` set at `:14-24`)

This task builds the route and its parsing logic against **placeholder views** — three near-empty templates that Task 5 fills in. That keeps the parsing logic (which carries all the edge cases) reviewable on its own, and lets its tests assert on data rather than markup.

**Interfaces:**
- Consumes: `summarizeParty` (Task 1), `getPartyCharacters` (Task 2), `getOwnCharacters` and `searchPublicCharacters` from `models/character`, `isValidUuid` from `util/validate`, `authOptional` from `util/auth`, `sendError` from `util/http-error`.
- Produces: three routes, and this render context shape which Task 5's views consume:

```js
{
  members,        // resolved character rows, in URL order
  summary,        // the Task 1 summary object
  partyCsv,       // comma-joined ids of the resolved members
  droppedOverCap, // number of ids past the 8-member cap
  unresolved,     // number of requested ids that came back empty
  privateCount    // members with is_public === false
}
```

- [ ] **Step 1: Write the failing tests**

Create `routes/party.test.js`. This harness mirrors `routes/characters.test.js:1-150` — mock the data layer, boot a real Express app with the full Handlebars engine, hit it with `fetch`.

```js
// routes/party.test.js
//
// The virtual party tool's membership parsing: what ?c= accepts, how add and
// remove mutate it, and what the cap and RLS-invisible ids do. The view
// rendering is covered by views/partials/party-summary.test.js; these tests
// assert on the route's behaviour, reading ids back out of the rendered
// #party-csv input.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realCharacter = require('../models/character');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

const { statList } = require('../util/enclave-consts');

// Ten real-shaped UUIDs. The route drops anything that is not one, so the
// tests cannot use readable ids like 'a'.
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = Array.from({ length: 10 }, (_, i) => uuid(i + 1));

// Every id in ID is visible EXCEPT the one at index 9, which stands in for a
// character RLS will not return (someone else's private character).
const INVISIBLE = ID[9];

const characterRow = (id, overrides = {}) => ({
  id,
  name: `Character ${ID.indexOf(id) + 1}`,
  image_url: null,
  class: 'Tester',
  class_id: uuid(99),
  is_deceased: false,
  is_public: true,
  ...Object.fromEntries(statList.map(stat => [stat, 1])),
  ...overrides
});

const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      in() { return chain; },
      single() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(onF, onR) { return Promise.resolve({ data: [], error: null }).then(onF, onR); },
    };
    return chain;
  },
});

mock.module('../models/_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  createUserClient: () => makeClient(),
  anonKey: 'test-anon-key',
}));

// The model seam is mocked rather than the client, so these tests pin the
// route's behaviour and not PostgREST's. getPartyCharacters returns rows in a
// DELIBERATELY SHUFFLED order (reversed) — .in() makes no ordering promise, so
// the route must reorder, and a mock that returns them already-sorted would
// let that bug through.
mock.module('../models/character', () => ({
  getPartyCharacters: async (ids) => ({
    data: ids.filter(id => id !== INVISIBLE).map(id => characterRow(id)).reverse(),
    error: null
  }),
  getOwnCharacters: async () => ({ data: [], error: null }),
  searchPublicCharacters: async () => ({ data: [], error: null }),
}));

mock.module('../models/auth', () => ({ getUserFromToken: async () => false }));
mock.module('../models/profile', () => ({ getProfile: async () => null }));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
const exphbs = require('express-handlebars');
const hbsHelpers = require('handlebars-helpers')();
const range = require('handlebars-helper-range');
const path = require('path');
const {
  times, date_tz, calendar_link, getTotalV1MissionsNeeded, getTotalV2MissionsNeeded,
  setVariable, encodeURIComponentH, dump, videoEmbed, isSupportedVideoUrl,
  substring, concat, effectiveRulesVersion, wordCount, perksForAbility, nextPerkPosition, json
} = require('../util/handlebars');
const { renderMarkdown } = require('../util/markdown');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./party')];

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.engine('handlebars', exphbs.engine({
    layoutsDir: path.join(__dirname, '..', 'views', 'layouts'),
    partialsDir: path.join(__dirname, '..', 'views', 'partials'),
    defaultLayout: 'main',
    helpers: {
      ...hbsHelpers, times, range, date_tz, calendar_link, encodeURIComponentH,
      getTotalV1MissionsNeeded, getTotalV2MissionsNeeded, setVariable, dump,
      videoEmbed, isSupportedVideoUrl, substring, concat, effectiveRulesVersion,
      wordCount, perksForAbility, nextPerkPosition, json, markdown: renderMarkdown,
    },
  }));
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use((req, res, next) => {
    res.locals.supabaseUrl = process.env.SUPABASE_URL;
    res.locals.supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    next();
  });

  app.use('/party', require('./party'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/character', () => realCharacter);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./party')];
});

const get = (url) => fetch(`${baseUrl}${url}`, { headers: { Accept: 'text/html' } });

// The rendered #party-csv hidden input is the route's statement of what the
// party now holds — the same value the Add/Remove buttons hx-include.
const csvFrom = (html) => {
  const match = html.match(/id="party-csv"[^>]*value="([^"]*)"/);
  return match ? match[1] : null;
};

test('a bare /party renders an empty party without error', async () => {
  const res = await get('/party');
  expect(res.status).toBe(200);
  expect(csvFrom(await res.text())).toBe('');
});

test('duplicate ids dedupe, preserving first-seen order', async () => {
  const res = await get(`/party?c=${ID[0]},${ID[1]},${ID[0]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[1]}`);
});

test('non-UUID junk is dropped without a 500', async () => {
  const res = await get(`/party?c=not-a-uuid,${ID[0]},,%20,<script>`);
  expect(res.status).toBe(200);
  expect(csvFrom(await res.text())).toBe(ID[0]);
});

test('more than eight ids truncates to eight and reports the drop', async () => {
  const res = await get(`/party?c=${ID.slice(0, 9).join(',')}`);
  const html = await res.text();
  expect(csvFrom(html).split(',').length).toBe(8);
  expect(html).toContain('party is capped at 8');
});

test('ids that resolve to nothing are reported, not silently missing', async () => {
  const res = await get(`/party?c=${ID[0]},${INVISIBLE}`);
  const html = await res.text();
  // The invisible id leaves the party — it cannot be rendered — but the count
  // is surfaced so a link recipient knows why the totals look short.
  expect(csvFrom(html)).toBe(ID[0]);
  expect(html).toContain('could not be loaded');
});

test('members are ordered by URL position, not by what the database returned', async () => {
  // The mock reverses its rows on purpose; .in() promises no ordering.
  const res = await get(`/party?c=${ID[0]},${ID[1]},${ID[2]}`);
  const html = await res.text();
  // Read the ids off the rendered members specifically. A plain
  // html.indexOf(id) would pass even with a broken reorder, because
  // #party-csv already lists them in URL order further up the document.
  const rendered = [...html.matchAll(/data-member-id="([^"]+)"/g)].map(match => match[1]);
  expect(rendered).toEqual([ID[0], ID[1], ID[2]]);
});

test('the panel route adds an id to the party it was given', async () => {
  // The regression guard for the staleness trap: the Add buttons live in the
  // left column, which does not re-render on a panel swap, so they cannot
  // carry membership in their own URL. They send the id and hx-include the
  // current csv; the route combines them. If this returns only ID[1], adding
  // a second character silently discards the first.
  const res = await get(`/party/panel?c=${ID[0]}&add=${ID[1]}`);
  const html = await res.text();
  expect(csvFrom(html)).toBe(`${ID[0]},${ID[1]}`);
});

test('the panel route pushes the new party URL back to the browser', async () => {
  const res = await get(`/party/panel?c=${ID[0]}&add=${ID[1]}`);
  expect(res.headers.get('HX-Push-Url')).toBe(`/party?c=${ID[0]},${ID[1]}`);
});

test('adding an id already in the party is a no-op, not a duplicate', async () => {
  const res = await get(`/party/panel?c=${ID[0]},${ID[1]}&add=${ID[0]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[1]}`);
});

test('removing an id drops it and keeps the rest in order', async () => {
  const res = await get(`/party/panel?c=${ID[0]},${ID[1]},${ID[2]}&remove=${ID[1]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[2]}`);
});

test('removing an id that is not in the party leaves membership unchanged', async () => {
  const res = await get(`/party/panel?c=${ID[0]},${ID[1]}&remove=${ID[5]}`);
  expect(csvFrom(await res.text())).toBe(`${ID[0]},${ID[1]}`);
});

test('adding past the cap drops the addition rather than an existing member', async () => {
  const full = ID.slice(0, 8).join(',');
  const res = await get(`/party/panel?c=${full}&add=${ID[8]}`);
  const html = await res.text();
  expect(csvFrom(html)).toBe(full);
  expect(html).toContain('party is capped at 8');
});

// NOTE: the signed-out "no My Characters section" test deliberately lives in
// Task 5, not here. At this point /party renders a placeholder that has no
// such section for any visitor, so the assertion would pass without proving
// anything. Task 5 adds it against the real page, paired with its signed-in
// counterpart.
```

- [ ] **Step 2: Register the test in the HTTP tier**

In `scripts/run-tests.mjs`, add `'routes/party.test.js',` to the `httpFiles` set (the block at `:14-24`), keeping the list alphabetical — between `'routes/nav-manage-navbar.test.js'` and the closing bracket.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun run test:http`
Expected: FAIL — `Cannot find module './party'`.

- [ ] **Step 4: Create the placeholder views**

These three files are the minimum the route can render. **Task 5 replaces their contents entirely** — they exist now only so Task 3's tests can run against real renders.

Create `views/party.handlebars`:

```handlebars
{{> breadcrumbs}}
<h2 class="title is-2">Virtual Party</h2>
<div id="party-search-panel"></div>
{{> party-panel}}
```

Create `views/partials/party-panel.handlebars`:

```handlebars
<div id="party-panel">
  <input type="hidden" id="party-csv" name="c" value="{{partyCsv}}">
  {{#if droppedOverCap}}
  <div class="notification is-warning">A party is capped at 8 members. {{droppedOverCap}} dropped.</div>
  {{/if}}
  {{#if unresolved}}
  <div class="notification is-warning">{{unresolved}} could not be loaded.</div>
  {{/if}}
  {{#each members}}
  <p data-member-id="{{this.id}}">{{this.name}}</p>
  {{/each}}
</div>
```

Create `views/partials/party-search-results.handlebars`:

```handlebars
{{#each characters}}
<p data-result-id="{{this.id}}">{{this.name}}</p>
{{/each}}
```

- [ ] **Step 5: Write the route**

Create `routes/party.js`:

```js
const express = require('express');
const router = express.Router();
const {
  getPartyCharacters,
  getOwnCharacters,
  searchPublicCharacters
} = require('../models/character');
const { authOptional } = require('../util/auth');
const { sendError } = require('../util/http-error');
const { isValidUuid } = require('../util/validate');
const { summarizeParty } = require('../util/party-stats');

// A party lives entirely in the ?c= query string — there is no parties table.
// The cap keeps the URL short, the breakdown table readable, and the .in()
// below trivially small.
const PARTY_CAP = 8;

// Turn ?c= (plus an optional add/remove) into the id list the party should
// now hold. Pure and synchronous so the resolve step below stays readable.
const parseMembership = (query) => {
  const requested = String(query.c || '')
    .split(',')
    .map(id => id.trim())
    .filter(isValidUuid);

  // Dedupe, preserving first-seen order — that order is the roster order.
  let ids = [...new Set(requested)];

  const add = String(query.add || '').trim();
  if (isValidUuid(add) && !ids.includes(add)) ids.push(add);

  const remove = String(query.remove || '').trim();
  if (isValidUuid(remove)) ids = ids.filter(id => id !== remove);

  const droppedOverCap = Math.max(0, ids.length - PARTY_CAP);
  return { ids: ids.slice(0, PARTY_CAP), droppedOverCap };
};

// Fetch the requested ids and build the render context. Anything RLS will not
// return simply does not come back, which is the whole visibility mechanism —
// see the comment on getPartyCharacters.
const resolveParty = async (query, client) => {
  const { ids, droppedOverCap } = parseMembership(query);

  const { data: rows, error } = await getPartyCharacters(ids, client);
  if (error) return { error };

  // .in() makes no ordering promise, so impose the URL's order rather than
  // letting the roster shuffle between requests.
  const byId = new Map((rows || []).map(row => [row.id, row]));
  const members = ids.map(id => byId.get(id)).filter(Boolean);

  return {
    members,
    summary: summarizeParty(members),
    partyCsv: members.map(member => member.id).join(','),
    droppedOverCap,
    unresolved: ids.length - members.length,
    privateCount: members.filter(member => member.is_public === false).length
  };
};

router.get('/', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const party = await resolveParty(req.query, res.locals.supabase);
  if (party.error) return sendError(req, res, party.error);

  // Signed-out visitors get the public search only. getOwnCharacters is
  // RLS-scoped, so this is the one place private characters enter the page.
  let ownCharacters = [];
  if (profile) {
    const { data } = await getOwnCharacters(profile, res.locals.supabase);
    ownCharacters = data || [];
  }

  res.render('party', {
    profile,
    ...party,
    ownCharacters,
    authOptional: true,
    activeNav: 'party',
    breadcrumbs: [{ label: 'Virtual Party', href: '/party' }]
  });
});

router.get('/panel', authOptional, async (req, res) => {
  const party = await resolveParty(req.query, res.locals.supabase);
  if (party.error) return sendError(req, res, party.error);

  // The panel owns membership, so the browser learns the new URL from the
  // response rather than from the request — the Add/Remove buttons cannot
  // know it in advance. Same header routes/lfg.js:99 uses.
  res.header('HX-Push-Url', `/party?c=${party.partyCsv}`);
  res.render('partials/party-panel', { layout: false, ...party });
});

router.get('/s', authOptional, async (req, res) => {
  const { q, classId } = req.query;
  const hasQuery = q && q.trim().length >= 2;

  if (!hasQuery && !classId) {
    return res.render('partials/party-search-results', { layout: false, characters: [], q });
  }

  const options = {};
  if (classId) options.classId = classId;

  const { data: characters, error } = await searchPublicCharacters(hasQuery ? q : null, 12, options);
  if (error) return sendError(req, res, error);

  res.render('partials/party-search-results', { layout: false, characters, q });
});

module.exports = router;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test:http`
Expected: PASS, 12 new tests in `routes/party.test.js`, and the other HTTP-tier files unchanged.

- [ ] **Step 7: Mount the route**

In `app.js`, add after the `lfgRoutes` require (`:17`):

```js
const partyRoutes = require('./routes/party');
```

and after `app.use('/lfg', lfgRoutes);` (`:77`):

```js
  app.use('/party', partyRoutes);
```

- [ ] **Step 8: Verify the whole suite**

Run: `bun run test:unit && bun run test:http`
Expected: PASS both tiers.

- [ ] **Step 9: Commit**

```bash
git add routes/party.js routes/party.test.js app.js scripts/run-tests.mjs \
        views/party.handlebars views/partials/party-panel.handlebars \
        views/partials/party-search-results.handlebars
git commit -m "feat: add the /party route and its membership parsing"
```

---

### Task 4: The shared summary partial

**Files:**
- Create: `views/partials/party-summary.handlebars`
- Test: `views/partials/party-summary.test.js`

**Interfaces:**
- Consumes: the Task 1 summary object, passed as `summary`. Renders through the existing `stat-blocks-readonly` partial (`value`, `max`) and the `capitalize` helper from `handlebars-helpers`.
- Produces: a partial invoked as `{{> party-summary summary=partySummary}}` by Task 5 (`/party`) and Task 6 (`lfg-post`).

- [ ] **Step 1: Write the failing tests**

Create `views/partials/party-summary.test.js`, following the compile-the-source pattern in `views/lfg-post.test.js:1-25`:

```js
// party-summary is rendered by BOTH /party and the LFG post page. These tests
// are the contract between them: whatever changes here changes both pages.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../../util/handlebars');
const { summarizeParty } = require('../../util/party-stats');
const { statList } = require('../../util/enclave-consts');

const SUMMARY_SRC = fs.readFileSync(path.join(__dirname, 'party-summary.handlebars'), 'utf8');
const READONLY_SRC = fs.readFileSync(path.join(__dirname, 'stat-blocks-readonly.handlebars'), 'utf8');

const render = (summary) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerPartial('stat-blocks-readonly', READONLY_SRC);
  return hb.compile(SUMMARY_SRC)({ summary });
};

const member = (name, stats = {}) => ({
  id: `id-${name}`,
  name,
  is_public: true,
  is_deceased: false,
  ...Object.fromEntries(statList.map(stat => [stat, 0])),
  ...stats
});

const count = (html, needle) => (html.match(new RegExp(needle, 'g')) || []).length;

test('every stat gets a numeral and a block row', () => {
  const html = render(summarizeParty([member('Ash', { might: 3 })]));
  expect(count(html, 'stat-blocks')).toBe(statList.length);
  statList.forEach(stat => expect(html.toLowerCase()).toContain(stat));
});

test('a total above five prints the real number beside a full block row', () => {
  // Party totals routinely exceed 5. stat-blocks-readonly caps the row at
  // max; the numeral is what keeps the real value visible.
  const html = render(summarizeParty([
    member('Ash', { might: 5 }), member('Bee', { might: 5 }), member('Cy', { might: 4 })
  ]));
  expect(html).toContain('14');
});

test('gaps are named so a zero does not have to be spotted by eye', () => {
  const html = render(summarizeParty([member('Ash', { might: 3 })]));
  expect(html).toMatch(/No coverage/i);
  // Assert against the callout paragraph alone, not the whole document: the
  // totals grid above prints all 12 stat names regardless, so a
  // document-wide toContain('Arcane') would pass with the gaps list empty.
  // Bounded at the closing </p> because "Strongest: Might" follows it.
  const start = html.search(/No coverage/i);
  const callout = html.slice(start, html.indexOf('</p>', start));
  expect(callout).toContain('Arcane');
  expect(callout).not.toContain('Might');
});

test('a party with full coverage shows no gaps callout', () => {
  const full = member('Ash', Object.fromEntries(statList.map(stat => [stat, 2])));
  const html = render(summarizeParty([full]));
  expect(html).not.toMatch(/No coverage/i);
});

test('the breakdown has one row per member plus a totals row', () => {
  const html = render(summarizeParty([member('Ash', { might: 3 }), member('Bee', { might: 2 })]));
  expect(html).toContain('Ash');
  expect(html).toContain('Bee');
  expect(html).toMatch(/Total/i);
});

test('the breakdown scrolls rather than breaking the layout on narrow screens', () => {
  // 13 columns will not fit a phone. Bulma's .table-container is the scroll
  // affordance; without it the page itself scrolls sideways.
  const html = render(summarizeParty([member('Ash')]));
  expect(html).toContain('table-container');
});

test('an empty party renders no coverage or breakdown sections', () => {
  const html = render(summarizeParty([]));
  expect(html).not.toMatch(/No coverage/i);
  expect(html).not.toContain('table-container');
});

test('private members are marked so a lossy share link is visible', () => {
  const html = render(summarizeParty([member('Ash', { might: 3 }), { ...member('Bee'), is_public: false }]));
  expect(html).toContain('fa-lock');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/partials/party-summary.test.js`
Expected: FAIL — `ENOENT` reading `party-summary.handlebars`.

- [ ] **Step 3: Write the partial**

Create `views/partials/party-summary.handlebars`:

```handlebars
{{!-- The party stat summary, rendered by BOTH the /party tool and the LFG
      post page. Takes a summary object from util/party-stats.js — see
      views/partials/party-summary.test.js for the contract.

      Params:
        summary  { totals, gaps, strongest, weakest, breakdown, memberCount }
--}}
<div class="party-summary">
  <div class="columns is-multiline">
    {{#each summary.totals}}
    <div class="column is-3">
      <p class="mb-1"><strong>{{capitalize @key}}</strong> ({{this}})</p>
      {{> stat-blocks-readonly value=this max=5}}
    </div>
    {{/each}}
  </div>

  {{#if summary.memberCount}}
  <div class="content mt-4">
    {{#if summary.gaps.length}}
    <p class="has-text-danger">
      <span class="icon"><i class="fas fa-triangle-exclamation"></i></span>
      <strong>No coverage:</strong>
      {{#each summary.gaps}}{{capitalize this}}{{#unless @last}}, {{/unless}}{{/each}}
    </p>
    {{/if}}
    {{#if summary.strongest.length}}
    <p><strong>Strongest:</strong>
      {{#each summary.strongest}}{{capitalize this}}{{#unless @last}}, {{/unless}}{{/each}}
    </p>
    {{/if}}
    {{#if summary.weakest.length}}
    <p><strong>Weakest:</strong>
      {{#each summary.weakest}}{{capitalize this}}{{#unless @last}}, {{/unless}}{{/each}}
    </p>
    {{/if}}
  </div>

  {{!-- 13 columns will not fit a narrow screen. .table-container scrolls the
        table rather than the whole page. --}}
  <div class="table-container mt-4">
    <table class="table is-narrow is-striped is-fullwidth">
      <thead>
        <tr>
          <th>Member</th>
          {{#each summary.totals}}<th title="{{capitalize @key}}">{{substring (capitalize @key) 0 3}}</th>{{/each}}
        </tr>
      </thead>
      <tbody>
        {{#each summary.breakdown}}
        <tr>
          <td>
            {{this.name}}
            {{#unless this.is_public}}
            <span class="icon has-text-grey" title="Private — not visible to people you share this link with"><i class="fas fa-lock"></i></span>
            {{/unless}}
            {{#if this.is_deceased}}
            <span class="icon has-text-grey" title="Deceased"><i class="fas fa-skull"></i></span>
            {{/if}}
          </td>
          {{#each this.stats}}<td>{{this}}</td>{{/each}}
        </tr>
        {{/each}}
      </tbody>
      <tfoot>
        <tr>
          <th>Total</th>
          {{#each summary.totals}}<th>{{this}}</th>{{/each}}
        </tr>
      </tfoot>
    </table>
  </div>
  {{/if}}
</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test views/partials/party-summary.test.js`
Expected: PASS, 8 tests.

(`substring(str, start, end)` is `util/handlebars.js:78`, and `capitalize` comes from `handlebars-helpers` — both are registered by the test's `render()` and by the app engine in `app.js`.)

- [ ] **Step 5: Commit**

```bash
git add views/partials/party-summary.handlebars views/partials/party-summary.test.js
git commit -m "feat: add the shared party summary partial"
```

---

### Task 5: The party page — roster, search, and Add/Remove

**Files:**
- Modify: `views/party.handlebars` (replace the Task 3 placeholder)
- Modify: `views/partials/party-panel.handlebars` (replace the Task 3 placeholder)
- Modify: `views/partials/party-search-results.handlebars` (replace the Task 3 placeholder)
- Create: `views/partials/party-roster.handlebars`
- Modify: `routes/party.test.js` (add the two My Characters tests — see Step 5)

**Interfaces:**
- Consumes: the Task 3 render context (`members`, `summary`, `partyCsv`, `droppedOverCap`, `unresolved`, `privateCount`, `ownCharacters`, `profile`) and the Task 4 `party-summary` partial.
- Produces: no new module surface. Task 7's e2e spec depends on these DOM hooks: `#party-panel`, `#party-csv`, `[data-add-character]`, `[data-remove-character]`.

**The load-bearing detail:** Add and Remove must **not** bake membership into their own `hx-get` URL. The Add buttons live in the left column, which does not re-render when `#party-panel` swaps — a baked URL would still carry the party as it stood at page load, so adding a second character would discard the first. They send only their own id via `hx-vals` and `hx-include="#party-csv"` to pick up current membership. Task 3 already has the regression test for this.

- [ ] **Step 1: Write the roster partial**

Create `views/partials/party-roster.handlebars`:

```handlebars
{{!-- Member chips for the current party. Remove sends only this member's id
      and hx-includes #party-csv for the rest — see the note in
      views/partials/party-panel.handlebars. --}}
{{#if members.length}}
<div class="tags are-medium">
  {{#each members}}
  <span class="tag is-primary" data-member-id="{{this.id}}">
    {{this.name}}
    {{#unless this.is_public}}
    <span class="icon is-small" title="Private"><i class="fas fa-lock"></i></span>
    {{/unless}}
    {{#if this.is_deceased}}
    <span class="icon is-small" title="Deceased"><i class="fas fa-skull"></i></span>
    {{/if}}
    <button type="button" class="delete is-small"
      data-remove-character="{{this.id}}"
      aria-label="Remove {{this.name}} from the party"
      hx-get="/party/panel"
      hx-vals='{"remove": "{{this.id}}"}'
      hx-include="#party-csv"
      hx-target="#party-panel"
      hx-swap="outerHTML"></button>
  </span>
  {{/each}}
</div>
{{else}}
<p class="has-text-grey">No members yet. Add characters from the left to build a party.</p>
{{/if}}
```

- [ ] **Step 2: Write the panel partial**

Replace the entire contents of `views/partials/party-panel.handlebars`:

```handlebars
{{!-- The party panel owns the current membership. #party-csv is the single
      source of truth for it: every Add and Remove hx-includes this input
      rather than carrying membership in its own URL, because the Add buttons
      live in the left column, which does not re-render when this panel swaps.
      A baked-in URL would go stale after the first add. routes/party.js sets
      HX-Push-Url on the response so the address bar follows. --}}
<div id="party-panel" class="box">
  <input type="hidden" id="party-csv" name="c" value="{{partyCsv}}">

  <h3 class="title is-4">Party <span class="tag is-light">{{summary.memberCount}}/8</span></h3>

  {{#if droppedOverCap}}
  <div class="notification is-warning is-light">
    A party is capped at 8 members. {{droppedOverCap}} {{#if (eq droppedOverCap 1)}}character was{{else}}characters were{{/if}} left out.
  </div>
  {{/if}}

  {{#if unresolved}}
  <div class="notification is-warning is-light">
    {{unresolved}} {{#if (eq unresolved 1)}}character{{else}}characters{{/if}} could not be loaded. They may be private or no longer exist.
  </div>
  {{/if}}

  {{> party-roster members=members}}

  {{#if privateCount}}
  <div class="notification is-info is-light mt-3">
    <span class="icon"><i class="fas fa-lock"></i></span>
    {{privateCount}} {{#if (eq privateCount 1)}}member is private{{else}}members are private{{/if}}.
    Anyone you share this link with will see a {{subtract summary.memberCount privateCount}}-member party.
  </div>
  {{/if}}

  <hr>

  {{> party-summary summary=summary}}
</div>
```

- [ ] **Step 3: Write the search results partial**

Replace the entire contents of `views/partials/party-search-results.handlebars`:

```handlebars
{{!-- Dense rows, not character-search-results' 3-across image cards: you add
      up to eight of these, so browsing density beats card art. Add sends only
      this character's id and hx-includes #party-csv — see the note in
      views/partials/party-panel.handlebars. --}}
{{#if characters.length}}
<div class="menu-list-wrapper">
  {{#each characters}}
  <div class="is-flex is-justify-content-space-between is-align-items-center py-2 px-2 party-result-row">
    <span>
      <strong>{{this.name}}</strong>
      {{#if this.class}}<span class="has-text-grey is-size-7"> · {{this.class}}</span>{{/if}}
      {{#unless this.is_public}}
      <span class="icon is-small has-text-grey" title="Private"><i class="fas fa-lock"></i></span>
      {{/unless}}
      {{#if this.is_deceased}}
      <span class="icon is-small has-text-grey" title="Deceased"><i class="fas fa-skull"></i></span>
      {{/if}}
    </span>
    <button type="button" class="button is-small is-primary"
      data-add-character="{{this.id}}"
      aria-label="Add {{this.name}} to the party"
      hx-get="/party/panel"
      hx-vals='{"add": "{{this.id}}"}'
      hx-include="#party-csv"
      hx-target="#party-panel"
      hx-swap="outerHTML">Add</button>
  </div>
  {{/each}}
</div>
{{else}}
<div class="notification is-info is-light">
  {{#if q}}No characters found matching "{{q}}".{{else}}Type a name to search.{{/if}}
</div>
{{/if}}
```

- [ ] **Step 4: Write the page shell**

Replace the entire contents of `views/party.handlebars`:

```handlebars
{{> breadcrumbs}}
<h2 class="title is-2">Virtual Party</h2>
<p class="subtitle is-6 has-text-grey">
  Build a party from any public character — plus your own — and see its combined stats.
  The party lives in this page's address, so you can bookmark or share it.
</p>

<div class="columns">
  <div class="column is-5">
    {{#if profile}}
    <div class="box">
      <h3 class="title is-5">My Characters</h3>
      {{#if ownCharacters.length}}
      {{> party-search-results characters=ownCharacters}}
      {{else}}
      <p class="has-text-grey">You have no characters yet.</p>
      {{/if}}
    </div>
    {{/if}}

    <div class="box">
      <h3 class="title is-5">Find Characters</h3>
      <div class="field">
        <div class="control has-icons-left">
          <input class="input" type="text" name="q" placeholder="Enter character name..."
            hx-get="/party/s"
            hx-trigger="keyup changed delay:500ms, search"
            hx-target="#party-search-results">
          <span class="icon is-left"><i class="fas fa-search"></i></span>
        </div>
      </div>
      <div id="party-search-results" class="mt-3">
        {{> party-search-results characters=[]}}
      </div>
    </div>
  </div>

  <div class="column is-7">
    {{> party-panel}}
  </div>
</div>
```

- [ ] **Step 5: Add the My Characters tests**

These belong here rather than in Task 3: only now does the page have a My Characters section for them to assert about. They come as a pair — the negative alone would pass against any page that simply lacks the words.

In `routes/party.test.js`, replace the `// NOTE: the signed-out ...` comment block at the end of the file with:

```js
test('signed out, the page offers no My Characters section', async () => {
  // getProfile is mocked to null, so res.locals.profile is absent and the
  // page shows the public search only.
  const res = await get('/party');
  expect(await res.text()).not.toContain('My Characters');
});

test('signed in, the page lists your own characters, private ones included', async () => {
  // The pair to the test above: without this one, the negative would pass
  // against a page that has no My Characters section under any condition.
  // getOwnCharacters is RLS-scoped, which is how a private character — one
  // the public search at /party/s can never surface — enters the page.
  const res = await fetch(`${baseUrl}/party`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' }
  });
  const html = await res.text();
  expect(html).toContain('My Characters');
  expect(html).toContain('Private Character');
  expect(html).toContain(`data-add-character="${ID[7]}"`);
});
```

For the signed-in test to have a profile and characters, extend the two mocks at the top of the same file. Replace the `getOwnCharacters` line in the `../models/character` mock with:

```js
  getOwnCharacters: async () => ({
    data: [characterRow(ID[7], { name: 'Private Character', is_public: false })],
    error: null
  }),
```

and replace the `../models/auth` and `../models/profile` mocks with:

```js
// A bearer token routes authOptional down its signed-in branch; without one
// it short-circuits and never consults these.
mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token ? { id: 'test-user' } : false)
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'test-profile', timezone: 'UTC' })
}));
```

- [ ] **Step 6: Verify the route tests pass**

Run: `bun run test:http`
Expected: PASS, 14 tests in `routes/party.test.js`. Task 3's tests read `#party-csv` and the notice copy out of these real templates, so they are also the check that the placeholders were replaced compatibly. (`subtract` and `eq` both come from `handlebars-helpers`, already registered app-wide.)

- [ ] **Step 7: Verify the full suite**

Run: `bun run test:unit && bun run test:http`
Expected: PASS both tiers.

- [ ] **Step 8: Commit**

```bash
git add views/party.handlebars views/partials/party-panel.handlebars \
        views/partials/party-roster.handlebars views/partials/party-search-results.handlebars \
        routes/party.test.js
git commit -m "feat: build the virtual party page, roster, and search"
```

---

### Task 6: LFG adopts the shared summary

**Files:**
- Modify: `routes/lfg.js:105-110` (delete the inline reduce), `:117-118` (render context)
- Modify: `views/lfg-post.handlebars:174-187`
- Modify: `views/lfg-post.test.js:68-71`

**Interfaces:**
- Consumes: `summarizeParty` (Task 1), the `party-summary` partial (Task 4).
- Produces: nothing new. This task removes duplication.

**Per the no-dead-code rule:** the inline reduce is deleted, not left beside the new call. `statList` stays imported in `routes/lfg.js` only if another handler still uses it — check before removing the import.

- [ ] **Step 1: Update the LFG view test first**

In `views/lfg-post.test.js`, replace the test at `:68-71`:

```js
test('party stats keep their numeral, since totals routinely exceed five', () => {
  const partySection = LFG_SRC.slice(LFG_SRC.indexOf('Party Stats'));
  expect(partySection).toContain('({{lookup ../partyStats this}})');
});
```

with:

```js
test('the party stats box renders the shared summary partial', () => {
  // The numeral-beside-blocks assertion moved to
  // views/partials/party-summary.test.js, which now owns that contract for
  // both this page and /party. Keeping a copy here would let the two drift.
  const partySection = LFG_SRC.slice(LFG_SRC.indexOf('Party Stats'));
  expect(partySection).toContain('{{> party-summary');
  expect(LFG_SRC).not.toContain('lookup ../partyStats');
});

test('the post links out to the party tool with its approved members', () => {
  expect(LFG_SRC).toContain('/party?c=');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test views/lfg-post.test.js`
Expected: FAIL — the view still contains `lookup ../partyStats` and no `{{> party-summary`.

- [ ] **Step 3: Replace the view's party stats box**

In `views/lfg-post.handlebars`, replace lines 174-187 — the block from `<div class="box mt-4">` through the `{{/if}}` that closes the approved-count branch — with:

```handlebars
  <div class="box mt-4">
    <div class="is-flex is-justify-content-space-between is-align-items-center mb-3">
      <h4 class="title is-5 mb-0">Party Stats</h4>
      {{#if (gt approvedCount 0)}}
      <a class="button is-small is-light" href="/party?c={{partyCsv}}">
        <span class="icon"><i class="fas fa-users"></i></span>
        <span>Open in party tool</span>
      </a>
      {{/if}}
    </div>
    {{#if (gt approvedCount 0)}}
    {{> party-summary summary=partySummary}}
    {{else}}
    <p class="has-text-grey">No approved party members yet.</p>
    {{/if}}
```

Leave the closing `</div>` and everything after line 187 untouched.

- [ ] **Step 4: Replace the route's inline reduce**

In `routes/lfg.js`, delete lines 105-110 (the `const partyStats = party.reduce(...)` block) and replace with:

```js
    const partySummary = summarizeParty(party);
    const partyCsv = party.map(character => character.id).join(',');
```

Add the import beside the other `util/` requires (after `:24`):

```js
const { summarizeParty } = require('../util/party-stats');
```

In the `res.render('lfg-post', {...})` call, replace `partyStats,` with:

```js
      partySummary,
      partyCsv,
```

Then check whether `statList` is still used anywhere in `routes/lfg.js`. If it is not, remove both the `statList,` render-context entry and the `const { statList } = require('../util/enclave-consts');` import at `:24`. If another handler still uses it, leave the import and remove only the render-context entry.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test views/lfg-post.test.js`
Expected: PASS.

- [ ] **Step 6: Verify the full suite**

Run: `bun run test:unit && bun run test:http`
Expected: PASS both tiers. `routes/lfg.js` has no dedicated HTTP test, so the unit tier plus the view test is the coverage here; a broken import surfaces as a module load failure.

- [ ] **Step 7: Commit**

```bash
git add routes/lfg.js views/lfg-post.handlebars views/lfg-post.test.js
git commit -m "refactor: render LFG party stats through the shared summary"
```

---

### Task 7: Navigation and the end-to-end path

**Files:**
- Modify: `util/seed-nav.js` (after the Search Characters block at `:185-197`)
- Create: `e2e/specs/17-virtual-party.spec.js`

**Interfaces:**
- Consumes: the DOM hooks Task 5 produced — `#party-panel`, `#party-csv`, `[data-add-character]`, `[data-remove-character]` — and the e2e fixtures `seedClass`, `seedCharacter`, `profileForEmail`, `cleanupByPrefix` from `e2e/fixtures/`.
- Produces: nothing consumed by later tasks. This is the last task.

- [ ] **Step 1: Add the nav item**

In `util/seed-nav.js`, after the `searchChars` block ends (`:197`) and before `searchMissions` (`:199`), insert:

```js
        const virtualParty = await createNavItemDirect({
            label: 'Virtual Party',
            type: 'link',
            url: '/party',
            icon: 'fas fa-users',
            parent_id: socialId,
            position: 2,
            requires_auth: false,
            requires_admin: false,
            is_active: true
        });
        if (virtualParty.error) console.error('Error creating Virtual Party:', virtualParty.error);
        else console.log('Created Virtual Party');
```

Then bump the existing `searchMissions` block's `position: 2` to `position: 3`, so the two Social children do not collide on the same position.

- [ ] **Step 2: Write the e2e spec**

Create `e2e/specs/17-virtual-party.spec.js`:

```js
// The virtual party tool's one irreplaceable behaviour: membership survives
// across adds because Add/Remove read #party-csv at request time rather than
// carrying a URL baked at page load. routes/party.test.js pins that at the
// route; this pins it through real htmx in a real browser, which is where a
// stale hx-include selector or a missing HX-Push-Url would actually show up.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL } = require('../global-setup');

const prefix = newPrefix('party');
let db;
let alpha;
let beta;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  // is_public: 'on' — the literal string, not a boolean. createCharacter
  // defaults is_public to false and normalizeCharacterInput compares against
  // 'on' (see the note in e2e/specs/04-stats-editor.spec.js). Without it the
  // public search cannot find these characters.
  alpha = await seedCharacter(prefix, profile, classRow, { is_public: 'on', name: `${prefix}-alpha`, might: 3 });
  beta = await seedCharacter(prefix, profile, classRow, { is_public: 'on', name: `${prefix}-beta`, might: 2 });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('adding two characters keeps both, and removing one keeps the other', async ({ page }) => {
  await page.goto('/party');

  // pressSequentially, not fill: the search input's hx-trigger is
  // "keyup changed delay:500ms", and fill() sets the value without emitting
  // keyup, so the search would never fire.
  await page.locator('input[name="q"]').pressSequentially(prefix);
  await expect(page.locator(`[data-add-character="${alpha.id}"]`)).toBeVisible();

  await page.click(`[data-add-character="${alpha.id}"]`);
  await expect(page.locator(`#party-panel [data-member-id="${alpha.id}"]`)).toBeVisible();

  // The whole point: the second add must not discard the first.
  await page.click(`[data-add-character="${beta.id}"]`);
  await expect(page.locator(`#party-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator(`#party-panel [data-member-id="${alpha.id}"]`)).toBeVisible();

  // HX-Push-Url put both ids in the address bar, so the link is shareable.
  await expect(page).toHaveURL(new RegExp(`${alpha.id}.*${beta.id}`));

  // might: 3 + 2. The combined total is the reason the tool exists.
  await expect(page.locator('#party-panel')).toContainText('Might (5)');

  await page.click(`#party-panel [data-remove-character="${alpha.id}"]`);
  await expect(page.locator(`#party-panel [data-member-id="${alpha.id}"]`)).toHaveCount(0);
  await expect(page.locator(`#party-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator('#party-panel')).toContainText('Might (2)');
});

test('a party URL loads its members directly, so a shared link works', async ({ page }) => {
  await page.goto(`/party?c=${alpha.id},${beta.id}`);
  await expect(page.locator(`#party-panel [data-member-id="${alpha.id}"]`)).toBeVisible();
  await expect(page.locator(`#party-panel [data-member-id="${beta.id}"]`)).toBeVisible();
  await expect(page.locator('#party-panel')).toContainText('Might (5)');
});
```

- [ ] **Step 3: Run the e2e spec**

Run: `bun run test:e2e -- e2e/specs/17-virtual-party.spec.js`
Expected: PASS, 2 tests.

The e2e tier needs a local Supabase (`supabase start`) and the app's dev server per `playwright.config.js`. **If the environment cannot run e2e, say so explicitly rather than marking this step done** — do not delete or skip the spec to make a run go green.

- [ ] **Step 4: Verify the full suite**

Run: `bun run test:unit && bun run test:http`
Expected: PASS both tiers.

- [ ] **Step 5: Commit**

```bash
git add util/seed-nav.js e2e/specs/17-virtual-party.spec.js
git commit -m "feat: add the Virtual Party nav item and its e2e path"
```

- [ ] **Step 6: Note the deploy step**

The nav seed only runs on a fresh install — it bails when any nav row exists (`util/seed-nav.js:63-70`). Existing deployments need the **Virtual Party → `/party`** item added by an admin at `/nav/manage`, with "requires auth" off. Include this in the PR description; the route is reachable at `/party` without it, but nothing links to it.

---

## Verification

After Task 7, the whole branch:

```bash
bun run test:unit
bun run test:http
bun run check
```

All three must pass before the branch is offered for review. `bun run test:e2e` additionally requires local Supabase.

## Spec Coverage

| Spec section | Task |
|---|---|
| `summarizeParty` shape, ties, gaps, weakest-excludes-gaps | 1 |
| `getPartyCharacters`, RLS-as-gate, no `is_public` filter | 2 |
| `?c=` parse: UUID filter, dedupe, cap at 8, reorder, unresolved count | 3 |
| `/party`, `/party/panel`, `/party/s` routes, `authOptional` | 3 |
| `HX-Push-Url`, `add`/`remove` semantics | 3 |
| Totals + coverage + breakdown, `.table-container` | 4 |
| `party-summary` shared by both pages | 4, 6 |
| My Characters (signed in only) + public search | 3, 5 |
| Add/Remove read `#party-csv`, never bake membership | 3 (test), 5 (markup) |
| Private lock markers, lossy-share notice | 4, 5 |
| Deceased allowed, skull marker | 4, 5 |
| LFG inline reduce deleted, "Open in party tool" link | 6 |
| Nav item under Social, `/nav/manage` deploy note | 7 |
| e2e: add two, remove one, URL and totals follow | 7 |
