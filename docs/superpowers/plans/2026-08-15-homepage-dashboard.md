# Homepage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage calendar with a dashboard showing a returning player's recent work, upcoming games, news, and recent public community activity, and relocate the calendar to a tab on the LFG page.

**Architecture:** A migration adds `created_at`/`updated_at` to `characters` and `missions` (backfilled from linked mission dates, clamped to `now()`) and an `is_news` flag to `pages`. Thin per-domain model queries feed a pure merge module that normalizes characters, missions, and classes into one sorted feed shape. A section loader runs those queries concurrently, each wrapped so that a rejection or an `{ error }` response degrades only its own section to empty instead of blanking the page. Handlebars partials render each section.

**Tech Stack:** Bun, Express 4, express-handlebars, Supabase (Postgres + RLS), moment-timezone, Bulma, htmx, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-15-homepage-dashboard-design.md`

## Global Constraints

- Runtime is Bun. Tests run via `bun run test:unit`, `bun run test:http`, `bun run test:integration`. `bun run check` must pass before any commit.
- Every model query function takes the caller's Supabase client as its last parameter, defaulting to the `supabase` anon singleton from `models/_base.js`. RLS performs access control — never reach for `supabaseAdmin` in this work.
- Model functions return `{ data, error }`. They log with `console.error(error)` and never throw.
- Templates use Bulma classes, matching the surrounding markup.
- No dead code: when something is replaced, the replaced thing is deleted in the same commit.
- TDD (red → green → refactor) applies to every task except Tasks 1, 9, 11, and 13, which are exempt by name. Task 1 and the migration half of Task 12 are schema changes, which the repo's TDD policy exempts. Task 9 is a local-development seed script. Task 11 is a four-line route delegating to a service that Task 8 tests exhaustively, rendering a template that Task 10 tests. Task 13 moves an existing template block and retargets one trigger string. All four carry explicit manual verification steps instead; the absence of automated tests in them is intended, not an oversight.
- Commit at the end of every task. All commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Feed item limits: 6 for "recent mine", 6 for "community", 3 for "upcoming games", 2 for news.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260815000001_home_recency.sql` | Timestamps, backfill, triggers, indexes, `is_news` |
| `supabase/migrations/20260815000002_character_created_at_editable.sql` | `created_at` through `save_character_atomic` |
| `services/home/recent-feed.js` | Pure normalize + merge + sort + truncate |
| `services/home/recent-feed.test.js` | Tests for the above |
| `services/home/excerpt.js` | Pure markdown → plain-text excerpt |
| `services/home/excerpt.test.js` | Tests for the above |
| `services/home/sections.js` | Composes model queries with per-section failure isolation |
| `services/home/sections.test.js` | Tests for the above, including degradation |
| `views/partials/home-feed-item.handlebars` | One normalized feed row |
| `views/partials/home-recent-mine.handlebars` | "Pick up where you left off" |
| `views/partials/home-upcoming-games.handlebars` | "Your upcoming games" |
| `views/partials/home-news.handlebars` | "News" |
| `views/partials/home-community.handlebars` | "Recent from the community" |
| `views/partials/lfg-calendar.handlebars` | The relocated `#calendar` container |
| `views/home.test.js` | Homepage template tests |
| `util/handlebars.test.js` | Tests for `time_ago` |
| `test/helpers/supabase-query-stub.js` | Chainable Supabase-builder stub shared by the model tests |

**Modified:** `models/character.js`, `models/mission.js`, `models/class.js`, `models/pages.js`, `models/lfg.js`, `util/handlebars.js`, `app.js`, `routes/home.js`, `routes/lfg.js`, `views/home.handlebars`, `views/lfg.handlebars`, `views/character-form.handlebars`, `services/character/input.js`, `services/character/input.test.js`, `models/character-atomic.integration.test.js`, `public/js/app.js`, `scripts/seed-local.mjs`.

---

### Task 1: Recency migration

Adds the columns, backfills them, installs triggers and indexes, and adds the news flag. No TDD — migrations are exempt per the repo policy. Verification is the rehearsal script plus explicit assertion queries.

**Files:**
- Create: `supabase/migrations/20260815000001_home_recency.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `characters.created_at`, `characters.updated_at`, `missions.created_at`, `missions.updated_at`, `pages.is_news` — all `NOT NULL`. Every later task depends on these.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260815000001_home_recency.sql`:

```sql
-- Homepage dashboard recency: characters and missions carry no timestamps, so
-- the homepage feeds have nothing to sort by. Add them, backfill what history
-- allows, and let the existing update_updated_at_column() trigger maintain
-- updated_at from here on. A trigger rather than application writes because
-- character writes go through save_character_atomic / level_up_character_atomic,
-- which application code does not intercept.

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.missions
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Missions carry their own session date. It can be in the future (a scheduled
-- session), so clamp: a row must never claim to have been created later than now.
UPDATE public.missions
SET created_at = LEAST(date, now()),
    updated_at = LEAST(date, now());

-- Characters have no date of their own. Derive a plausible span from the
-- missions they appear in: first mission ~ when they were made, last mission ~
-- when they were last touched. Characters with no missions keep the DEFAULT now().
WITH span AS (
  SELECT mc.character_id,
         LEAST(min(m.date), now()) AS first_seen,
         LEAST(max(m.date), now()) AS last_seen
  FROM public.mission_characters mc
  JOIN public.missions m ON m.id = mc.mission_id
  GROUP BY mc.character_id
)
UPDATE public.characters c
SET created_at = span.first_seen,
    updated_at = GREATEST(span.first_seen, span.last_seen)
FROM span
WHERE span.character_id = c.id;

DROP TRIGGER IF EXISTS update_characters_updated_at ON public.characters;
CREATE TRIGGER update_characters_updated_at
    BEFORE UPDATE ON public.characters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_missions_updated_at ON public.missions;
CREATE TRIGGER update_missions_updated_at
    BEFORE UPDATE ON public.missions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Access patterns for the four homepage feeds. Partial indexes because the
-- community feeds only ever read public, non-hidden rows.
CREATE INDEX IF NOT EXISTS idx_characters_public_recent
    ON public.characters (updated_at DESC)
    WHERE is_public AND NOT hide_from_search;

CREATE INDEX IF NOT EXISTS idx_missions_public_recent
    ON public.missions (updated_at DESC)
    WHERE is_public;

CREATE INDEX IF NOT EXISTS idx_characters_creator_recent
    ON public.characters (creator_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_missions_creator_recent
    ON public.missions (creator_id, updated_at DESC);

-- News reuses the pages CMS rather than growing a parallel table: pages already
-- has markdown content, is_published, access_level, timestamps, an admin editor,
-- slug routing, and RLS.
ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS is_news boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pages_news_recent
    ON public.pages (created_at DESC)
    WHERE is_news AND is_published;
```

- [ ] **Step 2: Rehearse the migration against a copy of the real database**

Run: `bun run rehearse:migrations`
Expected: the rehearsal applies the migration without error and reports success.

- [ ] **Step 3: Assert the three backfill invariants**

Against the rehearsal database, run:

```sql
-- 1. No row is dated in the future.
SELECT count(*) FROM public.characters WHERE created_at > now() OR updated_at > now();
SELECT count(*) FROM public.missions   WHERE created_at > now() OR updated_at > now();

-- 2. No row is updated before it was created.
SELECT count(*) FROM public.characters WHERE updated_at < created_at;
SELECT count(*) FROM public.missions   WHERE updated_at < created_at;

-- 3. Characters with no linked missions fell back to the migration time,
--    and characters with missions did not.
SELECT count(*) FILTER (WHERE mc.character_id IS NULL) AS no_missions,
       count(*) FILTER (WHERE mc.character_id IS NOT NULL) AS with_missions
FROM public.characters c
LEFT JOIN (SELECT DISTINCT character_id FROM public.mission_characters) mc
  ON mc.character_id = c.id;
```

Expected: every `count(*)` in assertions 1 and 2 returns `0`. Assertion 3 is informational — record both numbers so the day-one feed shape is a known quantity, not a surprise.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260815000001_home_recency.sql
git commit -m "feat: add recency timestamps to characters and missions

Adds created_at/updated_at with triggers, backfilled from linked mission
dates and clamped to now(), plus an is_news flag on pages and partial
indexes for the four homepage feeds.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Feed normalization and merge

The pure core. No database, no request context — a function over arrays, so its tests are exhaustive and fast.

**Files:**
- Create: `services/home/recent-feed.js`
- Test: `services/home/recent-feed.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `toFeedItem(type, row)` → `{ type, id, name, href, meta, updated_at }`, where `type` is `'character' | 'mission' | 'class'`. Returns `null` for an unknown type or a falsy row.
  - `mergeRecent(groups, limit)` → array of feed items. `groups` is an array of arrays. Sorted by `updated_at` descending, ties broken by `name` ascending, truncated to `limit`.

- [ ] **Step 1: Write the failing tests**

Create `services/home/recent-feed.test.js`:

```js
const { test, expect } = require('bun:test');
const { toFeedItem, mergeRecent } = require('./recent-feed');

test('toFeedItem normalizes a character row', () => {
  const item = toFeedItem('character', {
    id: 'c1', name: 'Vex', class: 'Gunslinger', level: 3,
    updated_at: '2026-08-01T00:00:00+00:00'
  });
  expect(item).toEqual({
    type: 'character',
    id: 'c1',
    name: 'Vex',
    href: '/characters/c1',
    meta: 'Level 3 Gunslinger',
    updated_at: '2026-08-01T00:00:00+00:00'
  });
});

test('toFeedItem normalizes a mission row, capitalizing the outcome', () => {
  const item = toFeedItem('mission', {
    id: 'm1', name: 'The Long Dark', outcome: 'success',
    date: '2026-07-04T00:00:00+00:00', updated_at: '2026-07-05T00:00:00+00:00'
  });
  expect(item.type).toBe('mission');
  expect(item.href).toBe('/missions/m1');
  expect(item.meta).toBe('Success · Jul 4, 2026');
});

test('toFeedItem normalizes a class row', () => {
  const item = toFeedItem('class', {
    id: 'k1', name: 'Tinkerer', status: 'beta', rules_edition: 'advent',
    updated_at: '2026-06-01T00:00:00+00:00'
  });
  expect(item.href).toBe('/classes/k1');
  expect(item.meta).toBe('Beta · Advent');
});

test('toFeedItem returns null for an unknown type or a falsy row', () => {
  expect(toFeedItem('badge', { id: 'b1' })).toBeNull();
  expect(toFeedItem('character', null)).toBeNull();
});

test('mergeRecent sorts across types by updated_at descending', () => {
  const characters = [toFeedItem('character', {
    id: 'c1', name: 'Vex', class: 'Gunslinger', level: 3,
    updated_at: '2026-08-01T00:00:00+00:00'
  })];
  const classes = [toFeedItem('class', {
    id: 'k1', name: 'Tinkerer', status: 'beta', rules_edition: 'advent',
    updated_at: '2026-08-09T00:00:00+00:00'
  })];
  expect(mergeRecent([characters, classes], 6).map(i => i.id)).toEqual(['k1', 'c1']);
});

test('mergeRecent compares instants, not strings, across UTC offsets', () => {
  // 13:00+02:00 is 11:00Z, which is EARLIER than 12:00Z. A lexical string
  // sort would get this backwards.
  const a = [{ type: 'character', id: 'later', name: 'A', href: '/x', meta: '', updated_at: '2026-08-01T12:00:00+00:00' }];
  const b = [{ type: 'character', id: 'earlier', name: 'B', href: '/y', meta: '', updated_at: '2026-08-01T13:00:00+02:00' }];
  expect(mergeRecent([a, b], 6).map(i => i.id)).toEqual(['later', 'earlier']);
});

test('mergeRecent breaks ties by name so ordering is deterministic', () => {
  const at = '2026-08-01T00:00:00+00:00';
  const rows = [
    { type: 'character', id: '1', name: 'Zara', href: '/1', meta: '', updated_at: at },
    { type: 'character', id: '2', name: 'Alba', href: '/2', meta: '', updated_at: at }
  ];
  expect(mergeRecent([rows], 6).map(i => i.name)).toEqual(['Alba', 'Zara']);
});

test('mergeRecent truncates to the limit and tolerates empty or missing groups', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map(n => ({
    type: 'character', id: String(n), name: `C${n}`, href: `/${n}`, meta: '',
    updated_at: `2026-08-0${n > 6 ? 1 : n}T00:00:00+00:00`
  }));
  expect(mergeRecent([rows, [], null], 6)).toHaveLength(6);
});

test('mergeRecent drops nulls left by unknown types', () => {
  expect(mergeRecent([[null, null]], 6)).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test services/home/recent-feed.test.js`
Expected: FAIL — `Cannot find module './recent-feed'`.

- [ ] **Step 3: Write the implementation**

Create `services/home/recent-feed.js`:

```js
const moment = require('moment-timezone');

// The homepage shows characters, mission logs, and classes in one list, so all
// three collapse to a single shape here rather than each template growing its
// own per-type branches.
//
// meta is a finished display string. Mission dates format in UTC: the column is
// day-granularity in practice, and a fixed zone keeps this module pure and its
// tests deterministic.

const capitalize = (value) => {
  if (typeof value !== 'string' || !value) return '';
  return value[0].toUpperCase() + value.slice(1);
};

const BUILDERS = {
  character: (row) => ({
    href: `/characters/${row.id}`,
    meta: `Level ${row.level} ${row.class}`
  }),
  mission: (row) => ({
    href: `/missions/${row.id}`,
    meta: `${capitalize(row.outcome)} · ${moment.utc(row.date).format('ll')}`
  }),
  class: (row) => ({
    href: `/classes/${row.id}`,
    meta: `${capitalize(row.status)} · ${capitalize(row.rules_edition)}`
  })
};

const toFeedItem = (type, row) => {
  const build = BUILDERS[type];
  if (!build || !row) return null;
  const { href, meta } = build(row);
  return {
    type,
    id: row.id,
    name: row.name,
    href,
    meta,
    updated_at: row.updated_at
  };
};

const mergeRecent = (groups, limit) => (groups || [])
  .filter(Array.isArray)
  .flat()
  .filter(Boolean)
  .sort((a, b) => {
    const delta = Date.parse(b.updated_at) - Date.parse(a.updated_at);
    if (delta !== 0) return delta;
    return String(a.name).localeCompare(String(b.name));
  })
  .slice(0, limit);

module.exports = { toFeedItem, mergeRecent };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test services/home/recent-feed.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add services/home/recent-feed.js services/home/recent-feed.test.js
git commit -m "feat: normalize characters, missions, and classes into one feed shape

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: News excerpt builder

**Files:**
- Create: `services/home/excerpt.js`
- Test: `services/home/excerpt.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildExcerpt(markdown, maxLength = 160)` → plain-text string, truncated on a word boundary with a trailing `…` when shortened.

- [ ] **Step 1: Write the failing tests**

Create `services/home/excerpt.test.js`:

```js
const { test, expect } = require('bun:test');
const { buildExcerpt } = require('./excerpt');

test('buildExcerpt strips common markdown syntax', () => {
  const md = '## Patch 3\n\nWe shipped **badges** and [profiles](/profiles) today.';
  expect(buildExcerpt(md)).toBe('Patch 3 We shipped badges and profiles today.');
});

test('buildExcerpt collapses whitespace and newlines into single spaces', () => {
  expect(buildExcerpt('one\n\n\ntwo   three')).toBe('one two three');
});

test('buildExcerpt truncates on a word boundary and appends an ellipsis', () => {
  const md = 'alpha bravo charlie delta echo foxtrot';
  const out = buildExcerpt(md, 20);
  expect(out).toBe('alpha bravo charlie…');
  expect(out.length).toBeLessThanOrEqual(21);
});

test('buildExcerpt leaves short content untouched, with no ellipsis', () => {
  expect(buildExcerpt('short note', 160)).toBe('short note');
});

test('buildExcerpt returns an empty string for empty or non-string input', () => {
  expect(buildExcerpt('')).toBe('');
  expect(buildExcerpt(null)).toBe('');
  expect(buildExcerpt(undefined)).toBe('');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test services/home/excerpt.test.js`
Expected: FAIL — `Cannot find module './excerpt'`.

- [ ] **Step 3: Write the implementation**

Create `services/home/excerpt.js`:

```js
// News posts are markdown (pages.content). The homepage shows a one-line teaser,
// so strip the syntax to plain text rather than rendering and then stripping
// HTML — cheaper, and it keeps this module free of the markdown renderer.

const buildExcerpt = (markdown, maxLength = 160) => {
  if (typeof markdown !== 'string' || !markdown) return '';

  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')        // fenced code blocks
    .replace(/`([^`]*)`/g, '$1')            // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')  // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')// links -> their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')     // headings
    .replace(/^\s{0,3}>\s?/gm, '')          // blockquotes
    .replace(/^\s*[-*+]\s+/gm, '')          // list bullets
    .replace(/(\*\*|__|\*|_|~~)/g, '')      // emphasis
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};

module.exports = { buildExcerpt };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test services/home/excerpt.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add services/home/excerpt.js services/home/excerpt.test.js
git commit -m "feat: build plain-text excerpts from markdown news content

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `time_ago` template helper

`util/handlebars.js` formats absolute dates only (`date_tz`, line 18). The feed rows need relative time. `util/handlebars.js` has no test file yet; this creates one.

**Files:**
- Modify: `util/handlebars.js`
- Modify: `app.js:5-8` (destructured import) and `app.js:40-60` (helpers object)
- Test: `util/handlebars.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `time_ago(datetime)` → relative string such as `"3 days ago"`. Empty string for falsy or unparseable input. Registered as the `time_ago` Handlebars helper.

- [ ] **Step 1: Write the failing tests**

Create `util/handlebars.test.js`:

```js
const { test, expect } = require('bun:test');
const moment = require('moment-timezone');
const { time_ago } = require('./handlebars');

test('time_ago renders a past timestamp as a relative phrase', () => {
  const threeDaysAgo = moment.utc().subtract(3, 'days').toISOString();
  expect(time_ago(threeDaysAgo)).toBe('3 days ago');
});

test('time_ago renders a recent timestamp in minutes', () => {
  const tenMinutesAgo = moment.utc().subtract(10, 'minutes').toISOString();
  expect(time_ago(tenMinutesAgo)).toBe('10 minutes ago');
});

test('time_ago returns an empty string for falsy input', () => {
  expect(time_ago(null)).toBe('');
  expect(time_ago(undefined)).toBe('');
  expect(time_ago('')).toBe('');
});

test('time_ago returns an empty string for an unparseable value', () => {
  expect(time_ago('not-a-date')).toBe('');
});

test('time_ago ignores the Handlebars options object passed as a second argument', () => {
  const oneHourAgo = moment.utc().subtract(1, 'hour').toISOString();
  expect(time_ago(oneHourAgo, { hash: {}, data: {} })).toBe('an hour ago');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/handlebars.test.js`
Expected: FAIL — `time_ago is not a function`.

- [ ] **Step 3: Add the helper**

In `util/handlebars.js`, add directly below `date_tz` (which ends at line 26):

```js
// Feed rows read better as "3 days ago" than as an absolute stamp. Unparseable
// input renders as nothing rather than moment's "Invalid date" leaking into a page.
const time_ago = function (datetime) {
  if (!datetime) return '';
  const parsed = moment.utc(datetime);
  if (!parsed.isValid()) return '';
  return parsed.fromNow();
};
```

Add `time_ago` to the `module.exports` object at the bottom of the file, beside `date_tz`.

- [ ] **Step 4: Register the helper**

In `app.js`, add `time_ago` to the destructured require from `./util/handlebars` (line 5-8), and add a `time_ago,` line to the `helpers` object beside `date_tz,` (line 43).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test util/handlebars.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify the whole suite still passes**

Run: `bun run test:unit && bun run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add util/handlebars.js util/handlebars.test.js app.js
git commit -m "feat: add a time_ago handlebars helper for relative timestamps

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Character and mission recency queries

**Files:**
- Create: `test/helpers/supabase-query-stub.js`
- Modify: `models/character.js` (add functions; extend `module.exports` at line 451)
- Modify: `models/mission.js` (add functions; extend `module.exports` at line 645)
- Test: `models/character.test.js`, `models/mission.test.js` (append)

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces:
  - `getRecentCharactersByCreator(profileId, { limit = 6 } = {}, client = supabase)` → `{ data, error }`, rows `{ id, name, class, level, updated_at }`
  - `getRecentPublicCharacters({ limit = 6, excludeProfileId = null } = {}, client = supabase)` → same row shape
  - `getRecentMissionsByCreator(profileId, { limit = 6 } = {}, client = supabase)` → rows `{ id, name, outcome, date, updated_at }`
  - `getRecentPublicMissions({ limit = 6, excludeProfileId = null } = {}, client = supabase)` → same row shape

Names are type-qualified rather than the bare `getRecentByCreator` because `services/home/sections.js` imports from both modules at once, and the codebase already reads this way (`getRandomPublicCharacters`, `getPublicCharactersByCreator`).

- [ ] **Step 1: Write the shared query stub**

Four test files across Tasks 5 and 6 need the same chainable Supabase-builder
stub, so it lives in `test/helpers/` beside the existing `alpine-dom.js` and
`http-server.js` rather than being copied per file.

Create `test/helpers/supabase-query-stub.js`:

```js
// A chainable stand-in for the Supabase query builder. Every call records
// itself, so tests can assert the FILTERS were applied — a stub that only
// returned rows would pass even if a filter like hide_from_search were dropped.
//
// The chain resolves when `limit` is called, which is where every homepage
// recency query terminates.
const clientStub = (rows) => {
  const calls = [];
  const builder = {
    select: (...a) => { calls.push(['select', ...a]); return builder; },
    eq: (...a) => { calls.push(['eq', ...a]); return builder; },
    neq: (...a) => { calls.push(['neq', ...a]); return builder; },
    order: (...a) => { calls.push(['order', ...a]); return builder; },
    limit: (...a) => { calls.push(['limit', ...a]); return Promise.resolve({ data: rows, error: null }); }
  };
  const client = {
    from: (table) => { calls.push(['from', table]); return builder; }
  };
  return { client, builder: { calls } };
};

module.exports = { clientStub };
```

- [ ] **Step 2: Write the failing tests**

Append to `models/character.test.js`, requiring the shared stub at the top of
the file:

```js
const { clientStub } = require('../test/helpers/supabase-query-stub');

test('getRecentCharactersByCreator filters to the creator and sorts by updated_at desc', async () => {
  const { getRecentCharactersByCreator } = require('./character');
  const { client, builder } = clientStub([{ id: 'c1' }]);
  const { data, error } = await getRecentCharactersByCreator('p1', { limit: 6 }, client);

  expect(error).toBeNull();
  expect(data).toEqual([{ id: 'c1' }]);
  expect(builder.calls).toContainEqual(['from', 'characters']);
  expect(builder.calls).toContainEqual(['eq', 'creator_id', 'p1']);
  expect(builder.calls).toContainEqual(['order', 'updated_at', { ascending: false }]);
  expect(builder.calls).toContainEqual(['limit', 6]);
});

test('getRecentPublicCharacters excludes private and search-hidden characters', async () => {
  const { getRecentPublicCharacters } = require('./character');
  const { client, builder } = clientStub([]);
  await getRecentPublicCharacters({ limit: 6 }, client);

  expect(builder.calls).toContainEqual(['eq', 'is_public', true]);
  expect(builder.calls).toContainEqual(['eq', 'hide_from_search', false]);
});

test('getRecentPublicCharacters excludes the viewer own rows when given a profile id', async () => {
  const { getRecentPublicCharacters } = require('./character');
  const { client, builder } = clientStub([]);
  await getRecentPublicCharacters({ limit: 6, excludeProfileId: 'p1' }, client);

  expect(builder.calls).toContainEqual(['neq', 'creator_id', 'p1']);
});

test('getRecentPublicCharacters excludes nothing for a signed-out caller', async () => {
  const { getRecentPublicCharacters } = require('./character');
  const { client, builder } = clientStub([]);
  await getRecentPublicCharacters({ limit: 6 }, client);

  expect(builder.calls.some(call => call[0] === 'neq')).toBe(false);
});
```

Append the mirrored set to `models/mission.test.js`, requiring the same shared
stub (`const { clientStub } = require('../test/helpers/supabase-query-stub');`):

```js
test('getRecentMissionsByCreator filters to the creator and sorts by updated_at desc', async () => {
  const { getRecentMissionsByCreator } = require('./mission');
  const { client, builder } = clientStub([{ id: 'm1' }]);
  const { data, error } = await getRecentMissionsByCreator('p1', { limit: 6 }, client);

  expect(error).toBeNull();
  expect(data).toEqual([{ id: 'm1' }]);
  expect(builder.calls).toContainEqual(['from', 'missions']);
  expect(builder.calls).toContainEqual(['eq', 'creator_id', 'p1']);
  expect(builder.calls).toContainEqual(['order', 'updated_at', { ascending: false }]);
});

test('getRecentPublicMissions filters to public missions only', async () => {
  const { getRecentPublicMissions } = require('./mission');
  const { client, builder } = clientStub([]);
  await getRecentPublicMissions({ limit: 6 }, client);

  expect(builder.calls).toContainEqual(['eq', 'is_public', true]);
});

test('getRecentPublicMissions excludes the viewer own rows when given a profile id', async () => {
  const { getRecentPublicMissions } = require('./mission');
  const { client, builder } = clientStub([]);
  await getRecentPublicMissions({ limit: 6, excludeProfileId: 'p1' }, client);

  expect(builder.calls).toContainEqual(['neq', 'creator_id', 'p1']);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test models/character.test.js models/mission.test.js`
Expected: FAIL — `getRecentCharactersByCreator is not a function`.

- [ ] **Step 4: Implement the character queries**

In `models/character.js`, add beside the other public-character readers (near `getPublicCharactersByCreator`, line 76):

```js
// Homepage feeds. These select only the columns the feed row renders — the
// homepage has six sections competing for one request, so none of them pull
// full character records.
const getRecentCharactersByCreator = async (profileId, { limit = 6 } = {}, client = supabase) => {
  const { data, error } = await client
    .from('characters')
    .select('id, name, class, level, updated_at')
    .eq('creator_id', profileId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
}

// hide_from_search is deliberately honored here as well as in search: opting out
// of discovery means opting out of the homepage too.
const getRecentPublicCharacters = async ({ limit = 6, excludeProfileId = null } = {}, client = supabase) => {
  let query = client
    .from('characters')
    .select('id, name, class, level, updated_at')
    .eq('is_public', true)
    .eq('hide_from_search', false);
  if (excludeProfileId) query = query.neq('creator_id', excludeProfileId);

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
}
```

Add both names to `module.exports` (line 451).

- [ ] **Step 5: Implement the mission queries**

In `models/mission.js`, add near the other public readers:

```js
const getRecentMissionsByCreator = async (profileId, { limit = 6 } = {}, client = supabase) => {
  const { data, error } = await client
    .from('missions')
    .select('id, name, outcome, date, updated_at')
    .eq('creator_id', profileId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
}

const getRecentPublicMissions = async ({ limit = 6, excludeProfileId = null } = {}, client = supabase) => {
  let query = client
    .from('missions')
    .select('id, name, outcome, date, updated_at')
    .eq('is_public', true);
  if (excludeProfileId) query = query.neq('creator_id', excludeProfileId);

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
}
```

Add both names to `module.exports` (line 645).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test models/character.test.js models/mission.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add test/helpers/supabase-query-stub.js \
        models/character.js models/character.test.js models/mission.js models/mission.test.js
git commit -m "feat: add recency queries for characters and mission logs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Class recency and news queries

**Files:**
- Modify: `models/class.js` (add function; extend `module.exports` at line 406)
- Modify: `models/pages.js` (add function; extend `module.exports` at line 228)
- Test: `models/class.test.js`, `models/pages.test.js` (append)

**Interfaces:**
- Consumes: `pages.is_news` from Task 1.
- Produces:
  - `getRecentClassesByCreator(profileId, { limit = 6 } = {}, client = supabase)` → rows `{ id, name, status, rules_edition, updated_at }`
  - `getRecentNews({ limit = 2 } = {}, client = supabase)` → rows `{ id, title, slug, content, created_at }`

`classes` already carries `created_at`/`updated_at` with a trigger (`20240101000000_baseline_schema.sql:143-144,800`), so no migration was needed for it.

- [ ] **Step 1: Write the failing tests**

Append to `models/class.test.js`, requiring the shared stub Task 5 created
(`const { clientStub } = require('../test/helpers/supabase-query-stub');`):

```js
test('getRecentClassesByCreator keys off created_by and sorts by updated_at desc', async () => {
  const { getRecentClassesByCreator } = require('./class');
  const { client, builder } = clientStub([{ id: 'k1' }]);
  const { data, error } = await getRecentClassesByCreator('p1', { limit: 6 }, client);

  expect(error).toBeNull();
  expect(data).toEqual([{ id: 'k1' }]);
  expect(builder.calls).toContainEqual(['from', 'classes']);
  expect(builder.calls).toContainEqual(['eq', 'created_by', 'p1']);
  expect(builder.calls).toContainEqual(['order', 'updated_at', { ascending: false }]);
});
```

Append to `models/pages.test.js` (same shared stub):

```js
test('getRecentNews returns only published news, newest first', async () => {
  const { getRecentNews } = require('./pages');
  const { client, builder } = clientStub([{ id: 'n1' }]);
  const { data, error } = await getRecentNews({ limit: 2 }, client);

  expect(error).toBeNull();
  expect(data).toEqual([{ id: 'n1' }]);
  expect(builder.calls).toContainEqual(['from', 'pages']);
  expect(builder.calls).toContainEqual(['eq', 'is_news', true]);
  expect(builder.calls).toContainEqual(['eq', 'is_published', true]);
  expect(builder.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
  expect(builder.calls).toContainEqual(['limit', 2]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/class.test.js models/pages.test.js`
Expected: FAIL — `getRecentClassesByCreator is not a function`.

- [ ] **Step 3: Implement the class query**

In `models/class.js`:

```js
const getRecentClassesByCreator = async (profileId, { limit = 6 } = {}, client = supabase) => {
    const { data, error } = await client
        .from('classes')
        .select('id, name, status, rules_edition, updated_at')
        .eq('created_by', profileId)
        .order('updated_at', { ascending: false })
        .limit(limit);
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
}
```

Add the name to `module.exports` (line 406).

- [ ] **Step 4: Implement the news query**

In `models/pages.js`:

```js
/**
 * Latest published news posts for the homepage.
 *
 * Ordered by created_at, so a post drafted early and published later carries
 * the draft date. Acceptable while posts are written and published in one
 * sitting; a published_at column is the fix if that stops being true.
 *
 * The caller's client applies the pages RLS SELECT policies, so access_level
 * gating comes for free — an anon caller sees only access_level='public'.
 */
const getRecentNews = async ({ limit = 2 } = {}, client = supabase) => {
    const { data, error } = await client
        .from('pages')
        .select('id, title, slug, content, created_at')
        .eq('is_news', true)
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};
```

Add the name to `module.exports` (line 228).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test models/class.test.js models/pages.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add models/class.js models/class.test.js models/pages.js models/pages.test.js
git commit -m "feat: add recency queries for classes and news pages

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Upcoming games query

**Files:**
- Modify: `models/lfg.js` (add function; extend `module.exports`)
- Test: `models/lfg.test.js` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `getUpcomingForProfile(profileId, { limit = 3 } = {}, client = supabase)` → `{ data, error }` where each row is `{ id, title, date, role, characterName }`. `role` is `'host'` when the viewer created the post, otherwise `'player'`. `characterName` is the name of the character the viewer joined with, or `null`. Sorted by `date` ascending.

**Deviation from the spec, deliberate:** the spec said to compose `getLfgPostsByCreator` and `getLfgJoinedPosts`. Both run an N+1 — a profile fetch and a join-request fetch per post (`models/lfg.js:85-105,227-252`) — which on a landing page is roughly twenty extra round trips for a section showing three rows. This is a lean pair of queries instead. The pending-request badge needs no query at all: `util/auth.js:63-64` already puts `res.locals.pendingLfgRequests` on every authenticated request.

- [ ] **Step 1: Write the failing tests**

Append to `models/lfg.test.js`:

```js
// Two-query stub: `from('lfg_posts')` returns hosted rows, `from('lfg_join_requests')`
// returns joined rows. Each builder resolves when awaited.
const upcomingClientStub = ({ hosted = [], joined = [] }) => {
  const calls = [];
  const make = (rows) => {
    const builder = {
      select: (...a) => { calls.push(['select', ...a]); return builder; },
      eq: (...a) => { calls.push(['eq', ...a]); return builder; },
      gte: (...a) => { calls.push(['gte', ...a]); return builder; },
      order: (...a) => { calls.push(['order', ...a]); return builder; },
      then: (resolve) => resolve({ data: rows, error: null })
    };
    return builder;
  };
  return {
    calls,
    client: { from: (table) => { calls.push(['from', table]); return make(table === 'lfg_posts' ? hosted : joined); } }
  };
};

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const past = (days) => new Date(Date.now() - days * 86400000).toISOString();

test('getUpcomingForProfile labels created posts as host and joined posts as player', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const { client } = upcomingClientStub({
    hosted: [{ id: 'a', title: 'Hosted Run', date: future(2), creator_id: 'p1' }],
    joined: [{
      character: { name: 'Vex' },
      lfg_posts: { id: 'b', title: 'Joined Run', date: future(1), creator_id: 'p2' }
    }]
  });

  const { data, error } = await getUpcomingForProfile('p1', { limit: 3 }, client);

  expect(error).toBeNull();
  expect(data).toEqual([
    { id: 'b', title: 'Joined Run', date: data[0].date, role: 'player', characterName: 'Vex' },
    { id: 'a', title: 'Hosted Run', date: data[1].date, role: 'host', characterName: null }
  ]);
});

test('getUpcomingForProfile drops posts whose date has passed', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const { client } = upcomingClientStub({
    hosted: [],
    joined: [{ character: null, lfg_posts: { id: 'old', title: 'Last Week', date: past(3), creator_id: 'p2' } }]
  });

  const { data } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(data).toEqual([]);
});

test('getUpcomingForProfile lists a post once when the viewer both created and joined it', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const when = future(2);
  const { client } = upcomingClientStub({
    hosted: [{ id: 'a', title: 'My Run', date: when, creator_id: 'p1' }],
    joined: [{ character: { name: 'Vex' }, lfg_posts: { id: 'a', title: 'My Run', date: when, creator_id: 'p1' } }]
  });

  const { data } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(data).toHaveLength(1);
  expect(data[0].role).toBe('host');
  expect(data[0].characterName).toBe('Vex');
});

test('getUpcomingForProfile truncates to the limit', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const { client } = upcomingClientStub({
    hosted: [1, 2, 3, 4].map(n => ({ id: `h${n}`, title: `Run ${n}`, date: future(n), creator_id: 'p1' })),
    joined: []
  });

  const { data } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(data.map(p => p.id)).toEqual(['h1', 'h2', 'h3']);
});

test('getUpcomingForProfile skips join requests whose post was deleted', async () => {
  const { getUpcomingForProfile } = require('./lfg');
  const { client } = upcomingClientStub({ hosted: [], joined: [{ character: null, lfg_posts: null }] });

  const { data, error } = await getUpcomingForProfile('p1', { limit: 3 }, client);
  expect(error).toBeNull();
  expect(data).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test models/lfg.test.js`
Expected: FAIL — `getUpcomingForProfile is not a function`.

- [ ] **Step 3: Write the implementation**

In `models/lfg.js`, add beside `getLfgJoinedPosts`:

```js
// Homepage "your upcoming games".
//
// Deliberately NOT built on getLfgPostsByCreator/getLfgJoinedPosts: both run a
// profile fetch and a join-request fetch per post, which is ~20 round trips on a
// landing page rendering three rows. Two flat queries instead, selecting only
// what the row shows. The pending-request badge is not fetched here at all --
// util/auth.js already exposes res.locals.pendingLfgRequests.
const getUpcomingForProfile = async (profileId, { limit = 3 } = {}, client = supabase) => {
  const now = moment().toISOString();
  // Compared as an instant below, not as a string: '...T21:44+02:00' sorts
  // after '...T20:14Z' lexically while being the earlier moment.
  const nowMs = Date.parse(now);

  const { data: hosted, error: hostedError } = await client
    .from('lfg_posts')
    .select('id, title, date, creator_id')
    .eq('creator_id', profileId)
    .gte('date', now)
    .order('date', { ascending: true });
  if (hostedError) {
    console.error(hostedError);
    return { data: null, error: hostedError };
  }

  const { data: joined, error: joinedError } = await client
    .from('lfg_join_requests')
    .select('character:characters(name), lfg_posts:lfg_post_id(id, title, date, creator_id)')
    .eq('profile_id', profileId)
    .eq('status', 'approved');
  if (joinedError) {
    console.error(joinedError);
    return { data: null, error: joinedError };
  }

  const byId = new Map();
  for (const post of hosted || []) {
    byId.set(post.id, { id: post.id, title: post.title, date: post.date, role: 'host', characterName: null });
  }
  for (const request of joined || []) {
    const post = request.lfg_posts;
    // A join request outlives its post only if the post was deleted mid-flight.
    if (!post || Date.parse(post.date) < nowMs) continue;
    const existing = byId.get(post.id);
    const characterName = request.character ? request.character.name : null;
    if (existing) {
      // Created it AND joined it: keep the host label, keep the character.
      existing.characterName = characterName;
      continue;
    }
    byId.set(post.id, {
      id: post.id,
      title: post.title,
      date: post.date,
      role: post.creator_id === profileId ? 'host' : 'player',
      characterName
    });
  }

  const data = [...byId.values()]
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0, limit);

  return { data, error: null };
}
```

Add `getUpcomingForProfile` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test models/lfg.test.js`
Expected: PASS, 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add models/lfg.js models/lfg.test.js
git commit -m "feat: add an upcoming-games query for the homepage

Two flat queries rather than composing the existing readers, which run a
profile and join-request fetch per post.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Section loader with failure isolation

**Files:**
- Create: `services/home/sections.js`
- Test: `services/home/sections.test.js`

**Interfaces:**
- Consumes: every model function from Tasks 5–7, plus `toFeedItem`/`mergeRecent` (Task 2) and `buildExcerpt` (Task 3).
- Produces: `loadHomeSections({ profile, client }, deps = defaultDeps)` → `Promise<{ recentMine, upcomingGames, news, community }>`. Never rejects. Every key is always an array. `deps` is an injection seam for tests, defaulting to the real model functions.

Deps are injected rather than mocked through `mock.module` because `mock.module` is process-global in bun and leaks across test files — `routes/missions.test.js:70-79` has to hand-restore seven modules in `afterAll` to work around it.

- [ ] **Step 1: Write the failing tests**

Create `services/home/sections.test.js`:

```js
const { test, expect } = require('bun:test');
const { loadHomeSections } = require('./sections');

const ok = (rows) => async () => ({ data: rows, error: null });
const failsWith = (message) => async () => ({ data: null, error: new Error(message) });
const throws = (message) => async () => { throw new Error(message); };

const CHARACTER = { id: 'c1', name: 'Vex', class: 'Gunslinger', level: 3, updated_at: '2026-08-10T00:00:00+00:00' };
const MISSION = { id: 'm1', name: 'The Long Dark', outcome: 'success', date: '2026-08-01T00:00:00+00:00', updated_at: '2026-08-09T00:00:00+00:00' };
const KLASS = { id: 'k1', name: 'Tinkerer', status: 'beta', rules_edition: 'advent', updated_at: '2026-08-08T00:00:00+00:00' };
const NEWS = { id: 'n1', title: 'Patch 3', slug: 'patch-3', content: '## Patch 3\n\nBadges **shipped**.', created_at: '2026-08-07T00:00:00+00:00' };
const GAME = { id: 'g1', title: 'Saturday Run', date: '2026-08-20T18:00:00+00:00', role: 'host', characterName: null };

const allGood = () => ({
  getRecentCharactersByCreator: ok([CHARACTER]),
  getRecentPublicCharacters: ok([CHARACTER]),
  getRecentMissionsByCreator: ok([MISSION]),
  getRecentPublicMissions: ok([MISSION]),
  getRecentClassesByCreator: ok([KLASS]),
  getRecentNews: ok([NEWS]),
  getUpcomingForProfile: ok([GAME])
});

const profile = { id: 'p1' };
const client = {};

test('loadHomeSections merges the signed-in feed across all three types', async () => {
  const result = await loadHomeSections({ profile, client }, allGood());
  expect(result.recentMine.map(i => i.id)).toEqual(['c1', 'm1', 'k1']);
  expect(result.recentMine[0].href).toBe('/characters/c1');
});

test('loadHomeSections attaches an excerpt to each news post', async () => {
  const result = await loadHomeSections({ profile, client }, allGood());
  expect(result.news).toHaveLength(1);
  expect(result.news[0].slug).toBe('patch-3');
  expect(result.news[0].excerpt).toBe('Patch 3 Badges shipped.');
});

test('loadHomeSections returns upcoming games unchanged', async () => {
  const result = await loadHomeSections({ profile, client }, allGood());
  expect(result.upcomingGames).toEqual([GAME]);
});

test('loadHomeSections skips personalized sections for a signed-out visitor', async () => {
  let personalCalls = 0;
  const deps = {
    ...allGood(),
    getRecentCharactersByCreator: async () => { personalCalls++; return { data: [], error: null }; },
    getUpcomingForProfile: async () => { personalCalls++; return { data: [], error: null }; }
  };

  const result = await loadHomeSections({ profile: null, client }, deps);

  expect(personalCalls).toBe(0);
  expect(result.recentMine).toEqual([]);
  expect(result.upcomingGames).toEqual([]);
  expect(result.news).toHaveLength(1);
  expect(result.community).not.toHaveLength(0);
});

test('loadHomeSections excludes the viewer own rows from the community feed', async () => {
  let excluded;
  const deps = {
    ...allGood(),
    getRecentPublicCharacters: async (opts) => { excluded = opts.excludeProfileId; return { data: [], error: null }; }
  };

  await loadHomeSections({ profile, client }, deps);
  expect(excluded).toBe('p1');
});

test('one section returning an error empties that section and leaves the rest intact', async () => {
  const deps = { ...allGood(), getRecentNews: failsWith('news table exploded') };
  const result = await loadHomeSections({ profile, client }, deps);

  expect(result.news).toEqual([]);
  expect(result.recentMine).not.toHaveLength(0);
  expect(result.upcomingGames).not.toHaveLength(0);
  expect(result.community).not.toHaveLength(0);
});

test('one section throwing empties that section and leaves the rest intact', async () => {
  const deps = { ...allGood(), getUpcomingForProfile: throws('connection reset') };
  const result = await loadHomeSections({ profile, client }, deps);

  expect(result.upcomingGames).toEqual([]);
  expect(result.recentMine).not.toHaveLength(0);
  expect(result.news).not.toHaveLength(0);
});

test('every section failing still resolves with four empty arrays', async () => {
  const deps = Object.fromEntries(Object.keys(allGood()).map(key => [key, throws('down')]));
  const result = await loadHomeSections({ profile, client }, deps);

  expect(result).toEqual({ recentMine: [], upcomingGames: [], news: [], community: [] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test services/home/sections.test.js`
Expected: FAIL — `Cannot find module './sections'`.

- [ ] **Step 3: Write the implementation**

Create `services/home/sections.js`:

```js
const { getRecentCharactersByCreator, getRecentPublicCharacters } = require('../../models/character');
const { getRecentMissionsByCreator, getRecentPublicMissions } = require('../../models/mission');
const { getRecentClassesByCreator } = require('../../models/class');
const { getRecentNews } = require('../../models/pages');
const { getUpcomingForProfile } = require('../../models/lfg');
const { toFeedItem, mergeRecent } = require('./recent-feed');
const { buildExcerpt } = require('./excerpt');

const MINE_LIMIT = 6;
const COMMUNITY_LIMIT = 6;
const UPCOMING_LIMIT = 3;
const NEWS_LIMIT = 2;

const defaultDeps = {
  getRecentCharactersByCreator,
  getRecentPublicCharacters,
  getRecentMissionsByCreator,
  getRecentPublicMissions,
  getRecentClassesByCreator,
  getRecentNews,
  getUpcomingForProfile
};

// The homepage runs six independent reads. All-or-nothing failure would mean one
// sick table blanks the landing page, so each read is isolated: a rejection or an
// { error } response degrades that section to empty and the page still renders.
const settle = async (label, run) => {
  try {
    const { data, error } = await run();
    if (error) {
      console.error(`home section "${label}" failed:`, error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error(`home section "${label}" threw:`, err);
    return [];
  }
};

const loadHomeSections = async ({ profile, client }, deps = defaultDeps) => {
  const signedIn = Boolean(profile);

  const [
    myCharacters, myMissions, myClasses,
    upcomingGames, newsRows, publicCharacters, publicMissions
  ] = await Promise.all([
    signedIn ? settle('my-characters', () => deps.getRecentCharactersByCreator(profile.id, { limit: MINE_LIMIT }, client)) : [],
    signedIn ? settle('my-missions', () => deps.getRecentMissionsByCreator(profile.id, { limit: MINE_LIMIT }, client)) : [],
    signedIn ? settle('my-classes', () => deps.getRecentClassesByCreator(profile.id, { limit: MINE_LIMIT }, client)) : [],
    signedIn ? settle('upcoming-games', () => deps.getUpcomingForProfile(profile.id, { limit: UPCOMING_LIMIT }, client)) : [],
    settle('news', () => deps.getRecentNews({ limit: NEWS_LIMIT }, client)),
    settle('public-characters', () => deps.getRecentPublicCharacters({ limit: COMMUNITY_LIMIT, excludeProfileId: signedIn ? profile.id : null }, client)),
    settle('public-missions', () => deps.getRecentPublicMissions({ limit: COMMUNITY_LIMIT, excludeProfileId: signedIn ? profile.id : null }, client))
  ]);

  const asFeed = (type) => (rows) => rows.map(row => toFeedItem(type, row));

  return {
    recentMine: mergeRecent([
      asFeed('character')(myCharacters),
      asFeed('mission')(myMissions),
      asFeed('class')(myClasses)
    ], MINE_LIMIT),
    upcomingGames,
    news: newsRows.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      created_at: row.created_at,
      excerpt: buildExcerpt(row.content)
    })),
    community: mergeRecent([
      asFeed('character')(publicCharacters),
      asFeed('mission')(publicMissions)
    ], COMMUNITY_LIMIT)
  };
};

module.exports = { loadHomeSections, defaultDeps };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test services/home/sections.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add services/home/sections.js services/home/sections.test.js
git commit -m "feat: compose homepage sections with per-section failure isolation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Seed news and public activity locally

Without this, Tasks 10–11 are built and reviewed against four empty sections.

**Note:** the spec named `util/starter-content.js` for this. That file holds the starter class and rules-PDF ids granted to each new profile — it is not a seeding entry point. `scripts/seed-local.mjs` is, and it already has the idempotent "skip if the table is populated" step structure this needs.

**Files:**
- Modify: `scripts/seed-local.mjs`

**Interfaces:**
- Consumes: `pages.is_news` from Task 1.
- Produces: nothing consumed by later tasks — a local-development affordance only.

- [ ] **Step 1: Add the news seeding step**

In `scripts/seed-local.mjs`, add after the badges step and before the closing summary (around line 137):

```js
    // news — two published posts so the homepage news section renders locally.
    // Authored by the admin profile, which the step above guarantees exists.
    const newsCount = (
      await client.query("select count(*)::int as n from pages where is_news")
    ).rows[0].n;
    if (newsCount > 0) {
      skip("news pages already seeded");
    } else {
      const { rows: [admin] } = await client.query(
        "select id from profiles where role = 'admin' order by id limit 1"
      );
      await client.query(
        `insert into pages (title, slug, content, access_level, is_published, is_news, created_by, created_at)
         values
           ($1, 'welcome-to-agent-resources',
            '## Welcome, Agent' || chr(10) || chr(10) ||
            'Agent Resources is where you build Enclave characters, find games, and log missions.',
            'public', true, true, $3, now() - interval '9 days'),
           ($2, 'mission-logs-are-live',
            '## Mission logs are live' || chr(10) || chr(10) ||
            'Log a mission, tag the characters who ran it, and it shows up on their sheets.',
            'public', true, true, $3, now() - interval '2 days')`,
        ["Welcome to Agent Resources", "Mission logs are live", admin.id]
      );
      ok("news pages seeded (2)");
    }
```

Add `"pages"` to the summary table list at line 141 so the row count prints.

- [ ] **Step 2: Update the header comment**

The comment block at lines 4-14 lists what the script seeds. Add a line matching the existing alignment:

```js
//   news       -> 2 published news pages      (needs admin; if empty)
```

- [ ] **Step 3: Verify the seed runs and is idempotent**

Run: `bun run seed:local`
Expected: `✓ news pages seeded (2)` and a `pages 2 rows` line in the summary.

Run: `bun run seed:local`
Expected: `news pages already seeded` — the second run must not insert duplicates.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-local.mjs
git commit -m "chore: seed local news pages so the homepage renders with content

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Homepage template and section partials

Templates first, wiring second: the view tests compile Handlebars directly against a supplied context, so they need no route.

**Files:**
- Create: `views/partials/home-feed-item.handlebars`, `views/partials/home-recent-mine.handlebars`, `views/partials/home-upcoming-games.handlebars`, `views/partials/home-news.handlebars`, `views/partials/home-community.handlebars`
- Modify: `views/home.handlebars`
- Test: `views/home.test.js`

**Interfaces:**
- Consumes: the `loadHomeSections` output shape (Task 8), `time_ago` (Task 4).
- Produces: a template expecting `{ profile, hasCharacters, recentMine, upcomingGames, news, community, pendingLfgRequests }`.

This task also deletes the `#calendar` block at `views/home.handlebars:51-53`. Task 11 gives it its new home; the two land close together, and the app is never in a state where the calendar renders in two places.

- [ ] **Step 1: Write the failing tests**

Create `views/home.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { time_ago } = require('../util/handlebars');
// The real app spreads handlebars-helpers into its helper set (app.js:41), and
// home-upcoming-games.handlebars uses `eq` as a subexpression. Register the real
// one rather than a stand-in, so a change in its semantics surfaces here.
const packagedHelpers = require('handlebars-helpers')();

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper('eq', packagedHelpers.eq);
  hb.registerHelper('time_ago', time_ago);
  hb.registerHelper('date_tz', (value, format) => `[${value}|${format}]`);
  for (const name of ['home-feed-item', 'home-recent-mine', 'home-upcoming-games', 'home-news', 'home-community']) {
    hb.registerPartial(name, read('partials', `${name}.handlebars`));
  }
  return hb.compile(read('home.handlebars'))(context);
};

const FEED = [
  { type: 'character', id: 'c1', name: 'Vex', href: '/characters/c1', meta: 'Level 3 Gunslinger', updated_at: '2026-08-14T00:00:00+00:00' }
];
const NEWS = [{ id: 'n1', title: 'Patch 3', slug: 'patch-3', created_at: '2026-08-07T00:00:00+00:00', excerpt: 'Badges shipped.' }];
const GAMES = [{ id: 'g1', title: 'Saturday Run', date: '2026-08-20T18:00:00+00:00', role: 'host', characterName: null }];

const empty = { recentMine: [], upcomingGames: [], news: [], community: [] };

test('signed-in homepage greets the player and renders their recent work', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true, recentMine: FEED });
  expect(html).toContain('Welcome, Agent: Dave');
  expect(html).toContain('Pick up where you left off');
  expect(html).toContain('href="/characters/c1"');
  expect(html).toContain('Level 3 Gunslinger');
});

test('signed-in homepage does not render the marketing hero or the video', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true });
  expect(html).not.toContain('youtube.com/embed');
  expect(html).not.toContain('hero is-medium');
});

test('signed-out homepage renders the hero and video but no personalized sections', () => {
  const html = render({ ...empty, profile: null, news: NEWS, community: FEED });
  expect(html).toContain('youtube.com/embed');
  expect(html).toContain('Please <a href="/auth">sign in</a>');
  expect(html).not.toContain('Pick up where you left off');
  expect(html).not.toContain('Your upcoming games');
});

test('signed-out homepage still renders news and community activity', () => {
  const html = render({ ...empty, profile: null, news: NEWS, community: FEED });
  expect(html).toContain('Patch 3');
  expect(html).toContain('Recent from the community');
  expect(html).toContain('href="/characters/c1"');
});

test('the get-started callout shows only when the player has no characters', () => {
  const withNone = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: false });
  expect(withNone).toContain('Get started with Agent Resources');

  const withSome = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true, recentMine: FEED });
  expect(withSome).not.toContain('Get started with Agent Resources');
});

test('upcoming games render the role badge and the joined character', () => {
  const html = render({
    ...empty,
    profile: { name: 'Dave' },
    hasCharacters: true,
    upcomingGames: [
      { id: 'g1', title: 'Saturday Run', date: '2026-08-20T18:00:00+00:00', role: 'host', characterName: null },
      { id: 'g2', title: 'Sunday Run', date: '2026-08-21T18:00:00+00:00', role: 'player', characterName: 'Vex' }
    ]
  });
  expect(html).toContain('href="/lfg/g1"');
  expect(html).toContain('Host');
  expect(html).toContain('Player');
  expect(html).toContain('Vex');
});

test('the pending-request badge renders only when the player hosts pending requests', () => {
  const withPending = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true, upcomingGames: GAMES, pendingLfgRequests: 2 });
  expect(withPending).toContain('2 pending');

  const withNone = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true, upcomingGames: GAMES, pendingLfgRequests: 0 });
  expect(withNone).not.toContain('pending');
});

test('empty sections are omitted entirely rather than rendering empty headings', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true });
  expect(html).not.toContain('Your upcoming games');
  expect(html).not.toContain('Latest news');
  expect(html).not.toContain('Recent from the community');
  expect(html).not.toContain('Pick up where you left off');
});

test('the FullCalendar container is gone from the homepage', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true });
  expect(html).not.toContain('id="calendar"');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/home.test.js`
Expected: FAIL — `ENOENT` reading `partials/home-feed-item.handlebars`.

- [ ] **Step 3: Write the partials**

`views/partials/home-feed-item.handlebars`:

```handlebars
<li class="is-flex is-justify-content-space-between is-align-items-baseline py-2">
  <span>
    <span class="tag is-light mr-2">{{type}}</span>
    <a href="{{href}}">{{name}}</a>
    <span class="has-text-grey is-size-7 ml-2">{{meta}}</span>
  </span>
  <span class="has-text-grey is-size-7">{{time_ago updated_at}}</span>
</li>
```

`views/partials/home-recent-mine.handlebars`:

```handlebars
{{#if recentMine.length}}
<section class="block">
  <h2 class="title is-5">Pick up where you left off</h2>
  <ul class="mb-3">
    {{#each recentMine}}{{> home-feed-item this}}{{/each}}
  </ul>
  <p class="is-size-7">
    <a href="/characters">All characters</a> ·
    <a href="/missions">All mission logs</a> ·
    <a href="/classes/mine">My classes</a>
  </p>
</section>
{{/if}}
```

`views/partials/home-upcoming-games.handlebars`:

```handlebars
{{#if upcomingGames.length}}
<section class="block">
  <h2 class="title is-5">
    Your upcoming games
    {{#if pendingLfgRequests}}<a href="/lfg" class="tag is-danger ml-2">{{pendingLfgRequests}} pending</a>{{/if}}
  </h2>
  <ul>
    {{#each upcomingGames}}
    <li class="is-flex is-justify-content-space-between is-align-items-baseline py-2">
      <span>
        <span class="tag is-light mr-2">{{#if (eq role "host")}}Host{{else}}Player{{/if}}</span>
        <a href="/lfg/{{id}}">{{title}}</a>
        {{#if characterName}}<span class="has-text-grey is-size-7 ml-2">as {{characterName}}</span>{{/if}}
      </span>
      <span class="has-text-grey is-size-7">{{date_tz date "lll"}}</span>
    </li>
    {{/each}}
  </ul>
</section>
{{/if}}
```

`views/partials/home-news.handlebars`:

```handlebars
{{#if news.length}}
<section class="block">
  <h2 class="title is-5">Latest news</h2>
  {{#each news}}
  <article class="mb-4">
    <h3 class="is-size-6 has-text-weight-semibold mb-1">
      <a href="/pages/{{slug}}">{{title}}</a>
      <span class="has-text-grey has-text-weight-normal is-size-7 ml-2">{{date_tz created_at "ll"}}</span>
    </h3>
    <p class="is-size-7">{{excerpt}}</p>
  </article>
  {{/each}}
</section>
{{/if}}
```

`views/partials/home-community.handlebars`:

```handlebars
{{#if community.length}}
<section class="block">
  <h2 class="title is-5">Recent from the community</h2>
  <ul>
    {{#each community}}{{> home-feed-item this}}{{/each}}
  </ul>
</section>
{{/if}}
```

`eq` comes from the `handlebars-helpers` package already spread into the helpers object at `app.js:41`.

- [ ] **Step 4: Rewrite the homepage**

Replace the entire contents of `views/home.handlebars`:

```handlebars
<div id="block">
  {{#if profile}}
  <p class="title is-4">Welcome, Agent: {{profile.name}}</p>
  {{#unless hasCharacters}}
  <div class="notification is-info is-light">
    <div class="columns is-vcentered">
      <div class="column">
        <p class="is-size-5 has-text-weight-semibold mb-1">Get started with Agent Resources</p>
        <p>Create your first Enclave character, find a game, or browse available classes.</p>
      </div>
      <div class="column is-narrow">
        <div class="buttons">
          <a href="/characters/new" class="button is-primary">Create a Character</a>
          <a href="/lfg" class="button is-link is-outlined">Find a Game</a>
          <a href="/classes" class="button is-light">Browse Classes</a>
        </div>
      </div>
    </div>
  </div>
  {{/unless}}
  {{else}}
  <p>Please <a href="/auth">sign in</a> or <a href="/auth">sign up</a>.</p>
  {{/if}}
  <hr />

  {{#unless profile}}
  <section class="hero is-medium is-dark">
    <div class="hero-body">
      <p class="title">Agent Resources is a tool for Enclave players to create and share Enclave characters, look for
        games, and log missions.</p>
    </div>
  </section>

  <div class="block has-text-centered">
    <p class="mt-4">New to the Enclave? Watch the video:</p>
    <div class="video-container">
      <iframe src="https://www.youtube.com/embed/aBVeIi6s6rE?si=kT7MA-dEjunuU8Aq"
        title="YouTube video player" frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe>
    </div>
    <div class="mt-4">
      <a class="button is-primary"
        href="https://www.kickstarter.com/projects/757240159/enclave-a-tableless-roleplaying-game">Learn more about the
        Enclave</a>
    </div>
  </div>
  {{/unless}}

  {{#if profile}}
  {{> home-recent-mine}}
  {{> home-upcoming-games}}
  {{/if}}
  {{> home-news}}
  {{> home-community}}
</div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test views/home.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add views/home.handlebars views/home.test.js views/partials/home-*.handlebars
git commit -m "feat: render the homepage as a dashboard of sections

Replaces the FullCalendar container with recent work, upcoming games,
news, and community activity.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Wire the homepage route

**Files:**
- Modify: `routes/home.js:6-14`

**Interfaces:**
- Consumes: `loadHomeSections` (Task 8), the template from Task 10.
- Produces: nothing consumed by later tasks.

No new route test: the behavior worth testing — per-section degradation — lives in `services/home/sections.test.js`, and the render shape lives in `views/home.test.js`. A third test booting an HTTP server would re-cover both and would need `routes/home.test.js` added to the `httpFiles` allowlist in `scripts/run-tests.mjs:15-26`.

- [ ] **Step 1: Update the handler**

In `routes/home.js`, add the require beside the existing ones at the top:

```js
const { loadHomeSections } = require('../services/home/sections');
```

Replace the `/` handler (lines 6-14) with:

```js
router.get('/', authOptional, async (req, res) => {
  const { profile } = res.locals;
  let hasCharacters = false;
  if (profile) {
    const { data } = await getOwnCharacters(profile, res.locals.supabase);
    hasCharacters = data && data.length > 0;
  }

  const sections = await loadHomeSections({ profile, client: res.locals.supabase });

  res.render('home', {
    profile,
    authOptional: true,
    hasCharacters,
    ...sections
  });
});
```

`pendingLfgRequests` needs no plumbing — `util/auth.js:63-64` already puts it on `res.locals`, which handlebars exposes to the template.

- [ ] **Step 2: Verify the full suite passes**

Run: `bun run test:unit && bun run check`
Expected: PASS.

- [ ] **Step 3: Verify the page in a browser**

Run: `bun run dev`, then load `http://localhost:3000/` signed out and signed in.
Expected signed out: hero, video, Latest news with the two seeded posts, Recent from the community.
Expected signed in: greeting, Pick up where you left off, and any section with data. No `#calendar` element in the DOM, and no request to `cdn.jsdelivr.net` in the network panel.

- [ ] **Step 4: Commit**

```bash
git add routes/home.js
git commit -m "feat: load dashboard sections on the homepage route

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Editable character creation date

The backfill is a guess, and characters — unlike missions, which have a user-editable `date` — have no other date to correct it with.

**Files:**
- Create: `supabase/migrations/20260815000002_character_created_at_editable.sql`
- Modify: `services/character/input.js` (in `normalizeCharacterInput`, line 79)
- Modify: `views/character-form.handlebars` (the Visibility block, lines 367-381)
- Test: `services/character/input.test.js`, `models/character-atomic.integration.test.js` (append)

**Interfaces:**
- Consumes: `characters.created_at` (Task 1).
- Produces: `normalizeCharacterInput` accepts `created_at` as `'YYYY-MM-DD'` or ISO-8601 and returns it normalized to an ISO string, or returns `{ data: null, childData: null, error: <message> }`.

`updated_at` stays trigger-owned. If both dates were editable neither would mean anything, and a row could be pinned to the top of a feed permanently.

- [ ] **Step 1: Write the failing validation tests**

Append to `services/character/input.test.js`:

```js
test('normalizeCharacterInput accepts a YYYY-MM-DD created_at and normalizes it to ISO', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: '2026-03-04' }, {});
  expect(error).toBeNull();
  expect(data.created_at).toBe('2026-03-04T00:00:00.000Z');
});

test('normalizeCharacterInput accepts a full ISO created_at', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: '2026-03-04T09:30:00.000Z' }, {});
  expect(error).toBeNull();
  expect(data.created_at).toBe('2026-03-04T09:30:00.000Z');
});

test('normalizeCharacterInput rejects an unparseable created_at', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: 'last tuesday' }, {});
  expect(data).toBeNull();
  expect(error).toBe('Invalid created date.');
});

test('normalizeCharacterInput rejects a future created_at', () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: tomorrow }, {});
  expect(data).toBeNull();
  expect(error).toBe('Created date cannot be in the future.');
});

test('normalizeCharacterInput drops an empty created_at rather than sending null', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex', created_at: '' }, {});
  expect(error).toBeNull();
  expect('created_at' in data).toBe(false);
});

test('normalizeCharacterInput leaves created_at absent when it was never submitted', () => {
  const { data, error } = normalizeCharacterInput({ name: 'Vex' }, {});
  expect(error).toBeNull();
  expect('created_at' in data).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test services/character/input.test.js`
Expected: FAIL — `created_at` passes through unvalidated, so the ISO normalization and both rejections fail.

- [ ] **Step 3: Add the validation**

In `services/character/input.js`, add `const moment = require('moment-timezone');` to the requires at the top. Then inside `normalizeCharacterInput`, add directly above the closing `return { data, childData, error: null };`:

```js
  // created_at is editable because the backfill that seeded it was a guess and
  // characters carry no other date a player could correct it with. Only this
  // column is editable -- updated_at stays trigger-owned, or a row could be
  // pinned to the top of the homepage feeds indefinitely.
  if ('created_at' in data) {
    const raw = typeof data.created_at === 'string' ? data.created_at.trim() : data.created_at;
    if (!raw) {
      delete data.created_at;
    } else {
      const parsed = moment.utc(raw, ['YYYY-MM-DD', moment.ISO_8601], true);
      if (!parsed.isValid()) {
        return { data: null, childData: null, error: 'Invalid created date.' };
      }
      if (parsed.isAfter(moment.utc())) {
        return { data: null, childData: null, error: 'Created date cannot be in the future.' };
      }
      data.created_at = parsed.toISOString();
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test services/character/input.test.js`
Expected: PASS.

- [ ] **Step 5: Write the RPC migration**

Create `supabase/migrations/20260815000002_character_created_at_editable.sql`:

```sql
-- Let a player correct their character's created_at. The value has to travel
-- through save_character_atomic, which is the only write path for the character
-- record -- an application-level UPDATE alongside the RPC would break atomicity.
--
-- The signature is unchanged: created_at rides in the existing p_character jsonb.
-- On UPDATE, jsonb_populate_record is seeded from `current`, so an omitted
-- created_at already resolves to the row's existing value.
--
-- This restates the whole function body rather than patching it. That is not
-- copy-paste drift: Postgres CREATE OR REPLACE FUNCTION has no partial form, so
-- redefining any part means redefining all of it, and every migration in this
-- repo that touches an RPC does the same. Exactly three lines differ from
-- 20260710000000_atomic_character_writes.sql, all of them created_at:
--   1. `created_at` appended to the INSERT column list
--   2. `COALESCE(record.created_at, now())` appended to the INSERT SELECT list
--   3. `created_at = record.created_at` appended to the UPDATE SET list
-- Everything else is byte-identical and must stay that way.

CREATE OR REPLACE FUNCTION public.save_character_atomic(
  p_character_id uuid,
  p_creator_id uuid,
  p_character jsonb,
  p_traits jsonb,
  p_gear jsonb,
  p_abilities jsonb,
  p_perks jsonb
)
RETURNS public.characters
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved public.characters;
  item jsonb;
  perk_id uuid;
  ability_id uuid;
  source_perk_id uuid;
  target_perk_id uuid;
BEGIN
```

Then copy the remainder of the existing function body verbatim from
**`supabase/migrations/20260811000000_fix_save_character_atomic_update.sql`** —
NOT from `20260710000000_atomic_character_writes.sql`, which is superseded. The
later migration repaired an UPDATE branch that referenced its own target alias
from a non-`LATERAL` FROM item, which Postgres rejects at execution and which
500'd every character edit. Copying the older file would silently reintroduce
that bug. Verify with `grep -rl save_character_atomic supabase/migrations/` that
no migration after `20260811000000` redefines it before applying this one.

Copy from the `IF p_character_id IS NULL THEN` line to the end of the file,
applying exactly three edits:

1. In the INSERT column list, append `, created_at` after `creator_mode`.
2. In the INSERT `SELECT` list, append `, COALESCE(record.created_at, now())` after `record.creator_mode`.
3. In the UPDATE `SET` list, append `, created_at = record.created_at` after `creator_mode = record.creator_mode`.

Leave every other statement — traits, gear, abilities, perks, the compounding
pass, the final `RETURN saved;` — byte-identical.

- [ ] **Step 6: Write the failing integration test**

Append to `models/character-atomic.integration.test.js`:

These use the file's existing fixtures: `setup()`, the `input(name)` builder
(line 50), the module-level `profile`, the `db` pg client, and
`createCharacter`/`updateCharacter` from `./character` (line 5).

```js
test('a supplied created_at is persisted on create', async () => {
  await setup();
  const backdated = '2025-01-15T00:00:00.000Z';
  const { data: created, error } = await createCharacter(
    { ...input(`Atomic backdated ${suffix}`), created_at: backdated }, profile
  );
  expect(error).toBeNull();

  const { rows } = await db.query('select created_at from characters where id = $1', [created.id]);
  expect(new Date(rows[0].created_at).toISOString()).toBe(backdated);
});

test('created_at survives an update whose payload omits it', async () => {
  await setup();
  const backdated = '2025-01-15T00:00:00.000Z';
  const { data: created } = await createCharacter(
    { ...input(`Atomic preserve ${suffix}`), created_at: backdated }, profile
  );

  const renamed = `Atomic preserved ${suffix}`;
  const { error } = await updateCharacter(
    created.id, { ...input(renamed), id: created.id }, profile
  );
  expect(error).toBeFalsy();

  const { rows } = await db.query('select name, created_at from characters where id = $1', [created.id]);
  expect(rows[0].name).toBe(renamed);
  expect(new Date(rows[0].created_at).toISOString()).toBe(backdated);
});

test('updating a character bumps updated_at via the trigger', async () => {
  await setup();
  const { data: created } = await createCharacter(input(`Atomic bump ${suffix}`), profile);
  const { rows: before } = await db.query('select updated_at from characters where id = $1', [created.id]);

  await updateCharacter(
    created.id, { ...input(`Atomic bumped ${suffix}`), id: created.id }, profile
  );

  const { rows: after } = await db.query(
    'select created_at, updated_at from characters where id = $1', [created.id]
  );
  // new Date(x).getTime(), not Date.parse(x): node-pg returns timestamptz as a
  // Date object, and Date.parse coerces it via toString(), truncating to whole
  // seconds — which makes a sub-second bump compare as unchanged.
  expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(new Date(before[0].updated_at).getTime());
  expect(new Date(after[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(after[0].created_at).getTime());
});
```

- [ ] **Step 7: Apply the migration and run the integration tests**

Run: `supabase db reset && bun run seed:local`
Then: `SUPABASE_URL=http://127.0.0.1:54321 bun run test:integration`
Expected: PASS, including the three new tests.

- [ ] **Step 8: Add the form field**

In `views/character-form.handlebars`, insert directly above the `<div class="field"><label class="label">Visibility</label>` block at line 367:

```handlebars
{{#unless isNew}}
<div class="field">
  <label class="label" for="char-created-at">Created</label>
  <div class="control">
    <input class="input" type="date" name="created_at" id="char-created-at"
      value="{{date_tz character.created_at 'YYYY-MM-DD' 'UTC'}}">
  </div>
  <p class="help">When this character was made. Correct it if the date is wrong — it orders your recent work on the homepage.</p>
</div>

<hr />
{{/unless}}
```

New characters get `now()` from the column default, so the field appears only when editing.

- [ ] **Step 9: Verify in a browser**

Run: `bun run dev`. Edit a character, set Created to a past date, save.
Expected: the date persists and the character moves in the homepage "Pick up where you left off" ordering. Setting a future date is rejected with `Created date cannot be in the future.`

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20260815000002_character_created_at_editable.sql \
        services/character/input.js services/character/input.test.js \
        views/character-form.handlebars models/character-atomic.integration.test.js
git commit -m "feat: let players correct a character's creation date

The backfilled created_at is a guess and characters carry no other date
to correct it with. Validated as a real, non-future date; updated_at
stays trigger-owned.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Move the calendar to an LFG tab

**Files:**
- Create: `views/partials/lfg-calendar.handlebars`
- Modify: `routes/lfg.js` (add a tab route after `/tab/public`, line 64-74)
- Modify: `views/lfg.handlebars:14-20`
- Modify: `public/js/app.js:745-749`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by later tasks.

`/lfg/events/all` (`routes/lfg.js:249`), `renderCalendar`, `_loadFullCalendar`, and the `x-calendar` branch (`routes/lfg.js:99`) all stay as they are. `/lfg` and its tab routes are `isAuthenticated`, matching `/lfg/events/all`, so no auth change is needed.

- [ ] **Step 1: Create the partial**

Create `views/partials/lfg-calendar.handlebars`:

```handlebars
<div id="calendar"></div>
```

- [ ] **Step 2: Add the tab route**

In `routes/lfg.js`, add directly after the `/tab/public` handler (ends line 74):

```js
router.get('/tab/calendar', isAuthenticated, async (req, res) => {
  // The container only; public/js/app.js fills it from /lfg/events/all once the
  // tab's htmx request settles, which also lazy-loads the FullCalendar script.
  res.render('partials/lfg-calendar', { layout: false });
});
```

- [ ] **Step 3: Add the tab link**

In `views/lfg.handlebars`, add as the last `<li>` inside the tab strip (after the Public tab, line 18):

```handlebars
    <li><a hx-get="/lfg/tab/calendar" hx-target="#lfg-content" hx-swap="innerHTML">Calendar</a></li>
```

- [ ] **Step 4: Retarget the render trigger**

In `public/js/app.js`, in the `htmx:afterRequest` listener at lines 745-749, change:

```js
        if (!pathInfo || pathInfo.finalRequestPath !== '/') return;
```

to:

```js
        if (!pathInfo || pathInfo.finalRequestPath !== '/lfg/tab/calendar') return;
```

This also fixes the cold-load bug the widget had on the homepage: the tab click *is* the htmx request that triggers the render, so the calendar can no longer end up in the DOM undrawn.

- [ ] **Step 5: Verify in a browser**

Run: `bun run dev`, sign in, open `/lfg`.
Expected: a Calendar tab beside Public. Opening it draws the month grid with existing LFG posts. Clicking an event navigates to that post's page. The `cdn.jsdelivr.net` FullCalendar request fires only after the tab is opened — not on `/lfg` load, and never on `/`.

- [ ] **Step 6: Verify the full suite passes**

Run: `bun run test:unit && bun run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add views/partials/lfg-calendar.handlebars routes/lfg.js views/lfg.handlebars public/js/app.js
git commit -m "feat: move the game calendar from the homepage to an LFG tab

The homepage had too few games to justify a month grid. On the LFG page
the calendar loads only when its tab is opened, which also fixes the
cold-load bug where the container rendered undrawn.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Post-implementation verification

- [ ] `bun run test:unit` passes
- [ ] `bun run test:http` passes
- [ ] `SUPABASE_URL=http://127.0.0.1:54321 bun run test:integration` passes
- [ ] `bun run test:e2e` passes — the happy-path suite navigates the homepage
- [ ] `bun run check` passes
- [ ] `grep -rn "id=\"calendar\"" views/` returns only `views/partials/lfg-calendar.handlebars`
