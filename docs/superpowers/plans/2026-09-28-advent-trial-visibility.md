# Advent Trial Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user on the 30-day Advent free trial always sees that they are on a trial and when it ends, every surface that silently loses content after expiry says why, and locked Advent/Aspirant content is teased instead of hidden.

**Architecture:** One read (`fetchCoreBookGrantsForUser`, every core-book grant including lapsed ones) feeds a pure resolver (`resolveEditionStatus`) that yields `owned | trial | expired | none` per edition. `util/auth.js` attaches the result to `res.locals.editionAccess` on every layout-rendering request, and every surface (layout banner, badges, inline alerts, locked teasers, upsell panel) reads that one value. Catalog and picker locking reuse the family-expanded roster ids `getEffectiveClassUnlocks` already computes.

**Tech Stack:** Node/Bun, Express 4, express-handlebars (Handlebars 4 + handlebars-helpers), Bulma, Supabase JS (PostgREST), moment-timezone, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-09-28-advent-trial-visibility-design.md`

## Global Constraints

- Purchase URLs, verbatim: advent `https://enclave-aspirant.backerkit.com/hosted_preorders/822768`, aspirant `https://enclave-aspirant.backerkit.com/hosted_preorders/822771`. A falsy URL renders a redeem-only CTA.
- `EDITION_LABELS = { advent: 'Advent', aspirant: 'Aspirant' }`. Editions are the keys of `CORE_CLASS_UNLOCKS`; unknown `rules_edition` values are ignored.
- Resolver rules: any `expires_at` null → `owned`; else any `expires_at > now` → `trial` (`endsAt` latest active expiry, `daysLeft = ceil((endsAt - now) / day)`, `urgent: daysLeft <= 7`); else any grant → `expired` (`endedAt` latest expiry); else `none`.
- Banner copy: trial **"ADVENT FREE TRIAL — {daysLeft} days left"** · "Ends {endsAt date}" · CTA; "day" singular at 1; "Ends today" when `daysLeft` is 1 and the end is today; `is-warning`, or `is-danger` when urgent. Expired: **"Your Advent free trial ended {endedAt date}."** "Advent classes, character abilities and the rulebook are locked." · CTA, `is-danger`. No dismiss control. Aspirant never produces a banner.
- Badge copy: `TRIAL · ends {date}` (warning, or danger when urgent).
- Sheet alert copy: "Ability and gear descriptions are hidden because your Advent free trial ended {date}." Class teaser header: "Your Advent free trial ended {date}".
- `/library/:id/view` without access stays HTTP 403.
- During an Advent trial, Advent is never shown as locked; only non-owned, non-trial editions are teased.
- Selecting a locked class is still rejected server-side; existing validation is unchanged.
- Teaser text comes from the existing `classes.teaser` column; no new content.
- Status lookup failure → `editionAccess` null → no banner, badges or teasers; logged; never blocks rendering.
- Dates render with `date_tz <iso> "MMM D, YYYY" profile.timezone`.
- `.env` points at PRODUCTION Supabase. Never run anything that touches a database. Every single-file test run in this plan is prefixed with the unit runner's placeholder env (`SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key`), which Bun lets override `.env`. The full suite is `bun run test:unit` (spec baseline: 2591 pass / 0 fail, before this plan's added tests).
- Commits: `feat: ...` lowercase subject, body ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. When code is replaced, the old code is deleted in the same commit.

## Review Focus

1. **A code redeemed after the trial lapsed** (an expired trial row plus a permanent row, in either order) must read as `owned`: no banner, no expired alerts, nothing teased. Pinned in Task 1 (both row orders) and Task 5 (owned renders no banner).
2. **Day boundaries and timezones**: exactly 7 days left is urgent and 7 days + 1 ms is 8 and not urgent; an expiry equal to `now` has ended; "Ends today" is judged in the viewer's timezone (an end at 02:00Z is "today" in New York the evening before), and an unknown timezone falls back to UTC instead of throwing. Pinned in Task 1 and Task 5.
3. **No profile, signed out, or a failed lookup**: `editionAccess` undefined or null must leave the layout, catalog and library rendering unchanged, with no throw. Pinned in Task 3 (no profile → no lookup, null result), Task 5 (layout with `profile: null` and with `editionAccess: null`), Task 8 (null → no locked sections) and Task 11 (signed-out locked PDF page).
4. **htmx requests**: fragment swaps skip the lookup, but boosted navigations, history restores and `hx-target="body"` swaps render the layout and must still get the banner; the onboarding POST fragment still shows days-left by looking the status up itself; a non-boosted htmx PDF request keeps the inline 403. Pinned in Task 3, Task 6 and Task 11.
5. **An Advent core class with a same-named Aspirant fork**: the Advent row is teased under Locked — Advent only when Advent is locked, the fork always under Locked — Aspirant; during an Advent trial the Advent row stays in "Your Released Classes" and only the fork is locked; a class the viewer can play by a direct unlock is never teased. Pinned in Task 7, Task 8 and Task 10.

---

## File Map

| File | Responsibility |
|---|---|
| `services/access/edition-status.js` (new) | Pure resolver: grants + now + timezone → per-edition status; `isLockedStatus` |
| `services/access/service.js` (new) | `getEditionAccess`: repository read + resolver, fail-quiet null |
| `services/access/upsell.js` (new) | `getEditionUpsell`: showcase classes (name, teaser) per locked edition |
| `services/rules/repository.js` | `fetchCoreBookGrantsForUser` (every core grant, lapsed included) |
| `util/edition-access.js` (new) | `populateEditionAccess` (request-level), `trialStatus`, `trialEndedAt` |
| `util/auth.js` | Calls `populateEditionAccess` in `isAuthenticated` and `authOptional` |
| `util/starter-content.js` | `EDITION_LABELS`, `EDITION_PURCHASE_URLS` |
| `util/handlebars.js` | `edition_label`, `edition_purchase_url` helpers |
| `views/partials/access/*.handlebars` (new) | `unlock-cta`, `trial-badge`, `trial-ended-alert`, `access-banner`, `edition-upsell`, `locked-class-list`, `locked-class-options` |
| `test/helpers/access-partials.js` (new) | Registers every `access/*` partial on a test Handlebars instance |
| `services/home/onboarding.js`, `services/home/sections.js`, `routes/home.js` | Days-left read from `editionAccess.advent`; home upsell |
| `models/class.js`, `util/class-filter.js` | `rosterIdsByEdition`; `lockedRosterIds`; locked catalog partition |
| `routes/classes.js`, `views/classes.handlebars`, `views/partials/class-group-card.handlebars`, `views/class-view.handlebars`, `views/class-view-teaser.handlebars` | Locked sections, TRIAL badges, teaser header |
| `services/character/description-gate.js`, `routes/characters.js`, `views/character*.handlebars` | Sheet alert; locked picker options; picker alert |
| `routes/library.js`, `views/library.handlebars`, `views/library-locked.handlebars` (new) | Book-card badge; locked PDF page |
| `routes/profile.js`, `views/profile.handlebars`, `views/home.handlebars` | Profile badges; upsell panels |

---

### Task 1: Edition status resolver

**Files:**
- Create: `services/access/edition-status.js`
- Test: `services/access/edition-status.test.js`

**Interfaces:**
- Consumes: `CORE_CLASS_UNLOCKS` from `util/starter-content.js` (keys `advent`, `aspirant`).
- Produces:
  - `resolveEditionStatus(grants: Array<{ rules_edition: string, expires_at: string|null }>|null, now: Date, { timeZone?: string|null } = {}) -> { advent: EditionStatus, aspirant: EditionStatus }` where `EditionStatus = { state: 'owned' } | { state: 'trial', endsAt: string, daysLeft: number, urgent: boolean, endsToday: boolean } | { state: 'expired', endedAt: string } | { state: 'none' }`. `endsAt`/`endedAt` are the grant's own ISO strings.
  - `isLockedStatus(status) -> boolean` — true for `expired` and `none` only.
  - `URGENT_DAYS = 7`.

- [ ] **Step 1: Write the failing test**

Create `services/access/edition-status.test.js`:

```js
const { test, expect, describe } = require('bun:test');
const { resolveEditionStatus, isLockedStatus } = require('./edition-status');

const NOW = new Date('2026-09-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();
const advent = (expires_at) => ({ rules_edition: 'advent', expires_at });

describe('resolveEditionStatus', () => {
  test('a permanent grant is owned', () => {
    expect(resolveEditionStatus([advent(null)], NOW).advent).toEqual({ state: 'owned' });
  });

  test('an edition with no grant is none, independently of the other edition', () => {
    expect(resolveEditionStatus([advent(null)], NOW).aspirant).toEqual({ state: 'none' });
  });

  test('an unexpired grant is a trial with the days left rounded up', () => {
    expect(resolveEditionStatus([advent(at(10 * DAY - 1000))], NOW).advent).toEqual({
      state: 'trial', endsAt: at(10 * DAY - 1000), daysLeft: 10, urgent: false, endsToday: false
    });
  });

  test('a lapsed grant is expired, carrying when it ended', () => {
    expect(resolveEditionStatus([advent(at(-3 * DAY))], NOW).advent)
      .toEqual({ state: 'expired', endedAt: at(-3 * DAY) });
  });

  test('a grant expiring this very instant has ended', () => {
    expect(resolveEditionStatus([advent(at(0))], NOW).advent.state).toBe('expired');
  });

  test('a permanent grant beats an active trial', () => {
    expect(resolveEditionStatus([advent(at(5 * DAY)), advent(null)], NOW).advent).toEqual({ state: 'owned' });
  });

  test('a code redeemed after the trial lapsed reads as owned, in either row order', () => {
    expect(resolveEditionStatus([advent(at(-2 * DAY)), advent(null)], NOW).advent).toEqual({ state: 'owned' });
    expect(resolveEditionStatus([advent(null), advent(at(-2 * DAY))], NOW).advent).toEqual({ state: 'owned' });
  });

  test('the latest active expiry is the trial end', () => {
    const status = resolveEditionStatus([advent(at(3 * DAY)), advent(at(20 * DAY)), advent(at(-DAY))], NOW).advent;
    expect(status.endsAt).toBe(at(20 * DAY));
    expect(status.daysLeft).toBe(20);
  });

  test('the latest lapsed expiry is the end date', () => {
    expect(resolveEditionStatus([advent(at(-10 * DAY)), advent(at(-2 * DAY))], NOW).advent.endedAt)
      .toBe(at(-2 * DAY));
  });

  test('exactly seven days left is urgent', () => {
    const status = resolveEditionStatus([advent(at(7 * DAY))], NOW).advent;
    expect(status.daysLeft).toBe(7);
    expect(status.urgent).toBe(true);
  });

  test('seven days and a moment left is eight days and not urgent', () => {
    const status = resolveEditionStatus([advent(at(7 * DAY + 1))], NOW).advent;
    expect(status.daysLeft).toBe(8);
    expect(status.urgent).toBe(false);
  });

  test('a +00:00 offset is compared as an instant, not a string', () => {
    expect(resolveEditionStatus([advent('2026-10-01T12:00:00+00:00')], NOW).advent.daysLeft).toBe(3);
  });

  test('unknown editions and malformed rows are ignored', () => {
    const status = resolveEditionStatus(
      [{ rules_edition: 'quickstart', expires_at: null }, null, { expires_at: null }],
      NOW
    );
    expect(status).toEqual({ advent: { state: 'none' }, aspirant: { state: 'none' } });
  });

  test('no grants at all resolves every edition to none', () => {
    expect(resolveEditionStatus(null, NOW)).toEqual({ advent: { state: 'none' }, aspirant: { state: 'none' } });
  });
});

describe('endsToday', () => {
  const EVENING = new Date('2026-09-30T20:00:00Z');
  const endsAt = '2026-10-01T02:00:00Z';

  test('an end six hours away falls on the same local day in New York', () => {
    const status = resolveEditionStatus([advent(endsAt)], EVENING, { timeZone: 'America/New_York' }).advent;
    expect(status.daysLeft).toBe(1);
    expect(status.endsToday).toBe(true);
  });

  test('the same end is tomorrow in UTC', () => {
    expect(resolveEditionStatus([advent(endsAt)], EVENING, { timeZone: 'UTC' }).advent.endsToday).toBe(false);
  });

  test('no timezone reads as UTC', () => {
    expect(resolveEditionStatus([advent(endsAt)], EVENING).advent.endsToday).toBe(false);
  });

  test('an unknown timezone reads as UTC rather than throwing', () => {
    expect(resolveEditionStatus([advent(endsAt)], EVENING, { timeZone: 'Mars/Olympus' }).advent.endsToday).toBe(false);
  });
});

describe('isLockedStatus', () => {
  test('only a lapsed or never-granted edition is locked', () => {
    expect(isLockedStatus({ state: 'expired', endedAt: 'x' })).toBe(true);
    expect(isLockedStatus({ state: 'none' })).toBe(true);
    expect(isLockedStatus({ state: 'owned' })).toBe(false);
    expect(isLockedStatus({ state: 'trial' })).toBe(false);
    expect(isLockedStatus(null)).toBe(false);
    expect(isLockedStatus(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/access/edition-status.test.js`
Expected: FAIL — `Cannot find module './edition-status'`.

- [ ] **Step 3: Write minimal implementation**

Create `services/access/edition-status.js`:

```js
const moment = require('moment-timezone');
const { CORE_CLASS_UNLOCKS } = require('../../util/starter-content');

const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT_DAYS = 7;
const EDITIONS = Object.keys(CORE_CLASS_UNLOCKS);

const latest = (isoValues) => isoValues.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));

const knownZone = (timeZone) => (timeZone && moment.tz.zone(timeZone) ? timeZone : 'UTC');

const statusFor = (expiries, now, timeZone) => {
  if (expiries.length === 0) return { state: 'none' };
  if (expiries.some(value => value == null)) return { state: 'owned' };
  const active = expiries.filter(value => Date.parse(value) > now.getTime());
  if (active.length === 0) return { state: 'expired', endedAt: latest(expiries) };

  const endsAt = latest(active);
  const daysLeft = Math.ceil((Date.parse(endsAt) - now.getTime()) / DAY_MS);
  const zone = knownZone(timeZone);
  return {
    state: 'trial',
    endsAt,
    daysLeft,
    urgent: daysLeft <= URGENT_DAYS,
    endsToday: moment.utc(endsAt).tz(zone).isSame(moment.utc(now).tz(zone), 'day')
  };
};

// There is no trial flag: a trial is a core-book grant with an expiry, and a
// permanent grant for the same edition (a redeemed code) outranks it.
const resolveEditionStatus = (grants, now, { timeZone = null } = {}) => {
  const expiriesByEdition = Object.fromEntries(EDITIONS.map(edition => [edition, []]));
  for (const grant of grants || []) {
    const bucket = expiriesByEdition[grant?.rules_edition];
    if (bucket) bucket.push(grant.expires_at ?? null);
  }
  return Object.fromEntries(
    EDITIONS.map(edition => [edition, statusFor(expiriesByEdition[edition], now, timeZone)])
  );
};

const isLockedStatus = (status) => status?.state === 'expired' || status?.state === 'none';

module.exports = { resolveEditionStatus, isLockedStatus, URGENT_DAYS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/access/edition-status.test.js`
Expected: PASS — `19 pass`, `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add services/access/edition-status.js services/access/edition-status.test.js
git commit -m "feat: resolve each edition's access as owned, trial, expired or none

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core-book grant read and `getEditionAccess`

**Files:**
- Modify: `services/rules/repository.js:91-114` (add a method after `fetchActiveBooksForUser`, inside `module.exports`)
- Create: `services/access/service.js`
- Test: `services/rules/repository.test.js` (append), `services/access/service.test.js` (new)

**Interfaces:**
- Consumes: `resolveEditionStatus` (Task 1).
- Produces:
  - `rulesRepository.fetchCoreBookGrantsForUser({ userId }) -> Promise<{ data: Array<{ rules_edition, expires_at }>|null, error }>` — every core-book grant, lapsed included.
  - `getEditionAccess(userId: string, now: Date = new Date(), { timeZone?: string|null } = {}, deps = { fetchCoreBookGrantsForUser }) -> Promise<{ advent, aspirant }|null>` — null on any failure, logged.

- [ ] **Step 1: Write the failing tests**

Append to `services/rules/repository.test.js` (after the last test; `rulesRepository`, `calls`, `makeClient`, `realBase` are already in scope):

```js
// The status resolver has to tell "expired" from "none", so unlike
// fetchActiveBooksForUser this read must not filter lapsed grants out.
test('fetchCoreBookGrantsForUser returns every core grant, lapsed ones included', async () => {
  calls.length = 0;
  const { data, error } = await rulesRepository.fetchCoreBookGrantsForUser({ userId: 'u1' });

  expect(error).toBeNull();
  expect(data).toEqual([{ rules_edition: 'advent', expires_at: '2026-09-16T00:00:00Z' }]);
  expect(calls.some(c => typeof c.or === 'string')).toBe(false);
  const select = calls.find(c => typeof c.select === 'string');
  expect(select.select).toContain('rules_pdfs!inner');
  expect(calls.some(c => Array.isArray(c.eq) && c.eq[0] === 'rules_pdf.book_type' && c.eq[1] === 'core')).toBe(true);
  expect(calls.some(c => Array.isArray(c.eq) && c.eq[0] === 'user_id' && c.eq[1] === 'u1')).toBe(true);
});

test('fetchCoreBookGrantsForUser surfaces a failed read as an error with no data', async () => {
  mock.module('../../models/_base', () => ({
    supabase: makeClient({ data: null, error: { message: 'boom' } }, []),
    supabaseAdmin: makeClient({ data: null, error: { message: 'boom' } }, []),
    anonKey: 'test-anon-key',
    createUserClient: () => makeClient({ data: null, error: null }, [])
  }));
  delete require.cache[require.resolve('./repository')];
  const failing = require('./repository');

  const { data, error } = await failing.fetchCoreBookGrantsForUser({ userId: 'u1' });

  expect(data).toBeNull();
  expect(error).not.toBeNull();
});
```

Create `services/access/service.test.js`:

```js
const { test, expect } = require('bun:test');
const { getEditionAccess } = require('./service');

const NOW = new Date('2026-09-28T12:00:00Z');

test('resolves the grants the repository returns for the user', async () => {
  const calls = [];
  const access = await getEditionAccess('u1', NOW, {}, {
    fetchCoreBookGrantsForUser: async (args) => {
      calls.push(args);
      return { data: [{ rules_edition: 'advent', expires_at: '2026-10-08T12:00:00Z' }], error: null };
    }
  });

  expect(calls).toEqual([{ userId: 'u1' }]);
  expect(access.advent).toMatchObject({ state: 'trial', daysLeft: 10, urgent: false });
  expect(access.aspirant).toEqual({ state: 'none' });
});

test('passes the viewer timezone through to endsToday', async () => {
  const access = await getEditionAccess('u1', new Date('2026-09-30T20:00:00Z'), { timeZone: 'America/New_York' }, {
    fetchCoreBookGrantsForUser: async () => ({
      data: [{ rules_edition: 'advent', expires_at: '2026-10-01T02:00:00Z' }], error: null
    })
  });
  expect(access.advent.endsToday).toBe(true);
});

test('a repository error is null, never a confident "none"', async () => {
  const access = await getEditionAccess('u1', NOW, {}, {
    fetchCoreBookGrantsForUser: async () => ({ data: null, error: { message: 'boom' } })
  });
  expect(access).toBeNull();
});

test('a throwing repository is null', async () => {
  const access = await getEditionAccess('u1', NOW, {}, {
    fetchCoreBookGrantsForUser: async () => { throw new Error('down'); }
  });
  expect(access).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/rules/repository.test.js services/access/service.test.js`
Expected: FAIL — `rulesRepository.fetchCoreBookGrantsForUser is not a function` and `Cannot find module './service'`.

- [ ] **Step 3: Write minimal implementation**

In `services/rules/repository.js`, add after the closing `}` of `fetchActiveBooksForUser` (turn that `}` into `},`):

```js
  // Every core-book grant the user holds, lapsed ones included: the edition
  // status resolver needs a lapsed trial to read as "expired", not "none".
  // Same embed alias and !inner join as fetchActiveBooksForUser, for the
  // same reasons.
  fetchCoreBookGrantsForUser: async ({ userId }) => {
    try {
      const { data, error } = await supabaseAdmin
        .from('rules_pdf_unlocks')
        .select('expires_at, rules_pdf:rules_pdfs!inner(rules_edition)')
        .eq('user_id', userId)
        .eq('rules_pdf.book_type', 'core');
      if (error || !Array.isArray(data)) {
        if (error) console.error(error);
        return { data: null, error: error || { message: 'rules_pdf_unlocks read returned no rows' } };
      }
      return {
        data: data
          .filter(row => row.rules_pdf && row.rules_pdf.rules_edition)
          .map(row => ({ rules_edition: row.rules_pdf.rules_edition, expires_at: row.expires_at ?? null })),
        error: null
      };
    } catch (e) {
      console.error(e);
      return { data: null, error: e };
    }
  }
```

Create `services/access/service.js`:

```js
const rulesRepository = require('../rules/repository');
const { resolveEditionStatus } = require('./edition-status');

const defaultDeps = {
  fetchCoreBookGrantsForUser: (args) => rulesRepository.fetchCoreBookGrantsForUser(args)
};

// Fail quiet: the caller renders no banner or teasers rather than a wrong
// "none", and existing access checks still enforce the gating.
const getEditionAccess = async (userId, now = new Date(), { timeZone = null } = {}, deps = defaultDeps) => {
  try {
    const { data, error } = await deps.fetchCoreBookGrantsForUser({ userId });
    if (error) {
      console.error('edition access lookup failed:', error);
      return null;
    }
    return resolveEditionStatus(data, now, { timeZone });
  } catch (err) {
    console.error('edition access lookup threw:', err);
    return null;
  }
};

module.exports = { getEditionAccess };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/rules/repository.test.js services/access/service.test.js`
Expected: PASS — `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add services/rules/repository.js services/rules/repository.test.js services/access/service.js services/access/service.test.js
git commit -m "feat: read a user's core-book grants, lapsed included, into edition access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Attach `res.locals.editionAccess` in auth

`util/auth.js` has no app-level middleware; `isAuthenticated` and `authOptional` are per-route and are where `systemMessage` is set, so both call the new populate step (the `populateNavItems` pattern).

**Files:**
- Create: `util/edition-access.js`
- Modify: `util/auth.js:1-8` (require), `util/auth.js:87` and `util/auth.js:126` (after each `await populateNavItems(req, res);`)
- Test: `util/edition-access.test.js` (new), `util/auth.test.js` (mock + 3 tests)

**Interfaces:**
- Consumes: `getEditionAccess` (Task 2).
- Produces:
  - `populateEditionAccess(req, res, deps = { getEditionAccess }) -> Promise<void>` — sets `res.locals.editionAccess` (status object or null) when there is a user and a profile and the request renders the layout; otherwise leaves it undefined.
  - `trialStatus(editionAccess, edition) -> EditionStatus|null` (the status when `trial`).
  - `trialEndedAt(editionAccess, edition) -> string|null` (`endedAt` when `expired`).

- [ ] **Step 1: Write the failing tests**

Create `util/edition-access.test.js`:

```js
const { test, expect } = require('bun:test');
const { populateEditionAccess, trialStatus, trialEndedAt } = require('./edition-access');

const TRIAL = { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false };
const STATUS = { advent: TRIAL, aspirant: { state: 'none' } };

const makeReq = (headers = {}) => ({ get: (name) => headers[name.toLowerCase()] });
const makeRes = (locals = {}) => ({
  locals: { user: { id: 'u1' }, profile: { id: 'p1', user_id: 'u1', timezone: 'America/New_York' }, ...locals }
});
const recorder = (result = STATUS) => {
  const calls = [];
  return { calls, deps: { getEditionAccess: async (...args) => { calls.push(args); return result; } } };
};

test("a full page request gets the viewer's edition access, in their timezone", async () => {
  const { calls, deps } = recorder();
  const res = makeRes();
  await populateEditionAccess(makeReq(), res, deps);
  expect(res.locals.editionAccess).toBe(STATUS);
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe('u1');
  expect(calls[0][1]).toBeInstanceOf(Date);
  expect(calls[0][2]).toEqual({ timeZone: 'America/New_York' });
});

test('an htmx fragment swapped into a target element skips the lookup', async () => {
  const { calls, deps } = recorder();
  const res = makeRes();
  await populateEditionAccess(makeReq({ 'hx-request': 'true', 'hx-target': 'alerts' }), res, deps);
  expect(calls).toHaveLength(0);
  expect(res.locals.editionAccess).toBeUndefined();
});

test('a boosted navigation renders the layout, so it looks up', async () => {
  const { calls, deps } = recorder();
  await populateEditionAccess(makeReq({ 'hx-request': 'true', 'hx-boosted': 'true', 'hx-target': 'main' }), makeRes(), deps);
  expect(calls).toHaveLength(1);
});

test('a history restore renders the layout, so it looks up', async () => {
  const { calls, deps } = recorder();
  await populateEditionAccess(makeReq({ 'hx-request': 'true', 'hx-history-restore-request': 'true', 'hx-target': 'x' }), makeRes(), deps);
  expect(calls).toHaveLength(1);
});

// hx-target="body" (the catalog's Create/Import buttons) sends no HX-Target,
// because <body> has no id, and the response carries the full layout.
test('an hx-target="body" swap renders the layout, so it looks up', async () => {
  const { calls, deps } = recorder();
  await populateEditionAccess(makeReq({ 'hx-request': 'true' }), makeRes(), deps);
  expect(calls).toHaveLength(1);
});

test('a signed-in user without a profile gets no lookup', async () => {
  const { calls, deps } = recorder();
  const res = makeRes({ profile: null });
  await populateEditionAccess(makeReq(), res, deps);
  expect(calls).toHaveLength(0);
  expect(res.locals.editionAccess).toBeUndefined();
});

test('a signed-out request gets no lookup', async () => {
  const { calls, deps } = recorder();
  const res = makeRes({ user: null, profile: null });
  await populateEditionAccess(makeReq(), res, deps);
  expect(calls).toHaveLength(0);
});

test('a failed lookup leaves editionAccess null', async () => {
  const { deps } = recorder(null);
  const res = makeRes();
  await populateEditionAccess(makeReq(), res, deps);
  expect(res.locals.editionAccess).toBeNull();
});

test('trialStatus and trialEndedAt read one edition and tolerate a missing status', () => {
  const expired = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };
  expect(trialStatus(STATUS, 'advent')).toBe(TRIAL);
  expect(trialStatus(expired, 'advent')).toBeNull();
  expect(trialEndedAt(expired, 'advent')).toBe('2026-09-20T12:00:00Z');
  expect(trialEndedAt(STATUS, 'advent')).toBeNull();
  expect(trialStatus(null, 'advent')).toBeNull();
  expect(trialEndedAt(undefined, 'advent')).toBeNull();
});
```

In `util/auth.test.js`, add beside the other `real*` requires at the top:

```js
const realEditionAccess = require('./edition-access');
```

add beside the other `mock.module` calls (before `delete require.cache[require.resolve('./auth')];`):

```js
const editionAccessCalls = [];
mock.module('./edition-access', () => ({
  populateEditionAccess: async (req, res) => {
    editionAccessCalls.push(res.locals.profile);
    res.locals.editionAccess = { advent: { state: 'none' }, aspirant: { state: 'none' } };
  }
}));
```

add inside `afterAll`, beside the other restores:

```js
  mock.module('./edition-access', () => realEditionAccess);
```

and append these tests:

```js
test('isAuthenticated attaches edition access once the profile is known', async () => {
  editionAccessCalls.length = 0;
  const res = makeRes();
  await isAuthenticated(makeReq({ authorization: 'Bearer valid-jwt' }), res, () => {});
  expect(editionAccessCalls).toEqual([{ id: 'p1', user_id: 'u1' }]);
  expect(res.locals.editionAccess.advent.state).toBe('none');
});

test('authOptional with a token attaches edition access', async () => {
  editionAccessCalls.length = 0;
  const res = makeRes();
  await authOptional(makeReq({ authorization: 'Bearer valid-jwt' }), res, () => {});
  expect(editionAccessCalls).toHaveLength(1);
  expect(res.locals.editionAccess).toBeDefined();
});

test('authOptional without a token looks nothing up', async () => {
  editionAccessCalls.length = 0;
  const res = makeRes();
  await authOptional(makeReq({}), res, () => {});
  expect(editionAccessCalls).toHaveLength(0);
  expect(res.locals.editionAccess).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/edition-access.test.js util/auth.test.js`
Expected: FAIL — `Cannot find module './edition-access'`.

- [ ] **Step 3: Write minimal implementation**

Create `util/edition-access.js`:

```js
const { getEditionAccess } = require('../services/access/service');

// A non-boosted htmx request that names a target element swaps a fragment and
// never renders the layout, so it has no use for the banner's lookup. Boosted
// navigations, history restores and hx-target="body" swaps (which send no
// HX-Target: <body> has no id) do render it.
const rendersLayout = (req) => !req.get('HX-Request')
  || Boolean(req.get('HX-Boosted'))
  || req.get('HX-History-Restore-Request') === 'true'
  || !req.get('HX-Target');

const populateEditionAccess = async (req, res, deps = { getEditionAccess }) => {
  const { user, profile } = res.locals;
  if (!user || !profile || !rendersLayout(req)) return;
  res.locals.editionAccess = await deps.getEditionAccess(user.id, new Date(), { timeZone: profile.timezone || null });
};

const trialStatus = (editionAccess, edition) =>
  (editionAccess?.[edition]?.state === 'trial' ? editionAccess[edition] : null);

const trialEndedAt = (editionAccess, edition) =>
  (editionAccess?.[edition]?.state === 'expired' ? editionAccess[edition].endedAt : null);

module.exports = { populateEditionAccess, trialStatus, trialEndedAt };
```

In `util/auth.js`, add after `const { populateNavItems } = require('./nav-loader');`:

```js
const { populateEditionAccess } = require('./edition-access');
```

and after each of the two `await populateNavItems(req, res);` lines (isAuthenticated at line 87, authOptional at line 126) add:

```js
    await populateEditionAccess(req, res);
```

(indent to match: four spaces inside isAuthenticated's `else` block, two spaces in authOptional).

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test util/edition-access.test.js util/auth.test.js`
Expected: PASS — `0 fail`.

Then run: `bun run test:unit`
Expected: every file passes. Route tests whose `models/_base` stub has no working `supabaseAdmin` now log `edition access lookup threw:` and render as before (fail quiet).

- [ ] **Step 5: Commit**

```bash
git add util/edition-access.js util/edition-access.test.js util/auth.js util/auth.test.js
git commit -m "feat: attach the viewer's edition access to every layout-rendering request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Purchase config, helpers and the shared access partials

**Files:**
- Modify: `util/starter-content.js` (constants + `module.exports` on the last line)
- Modify: `util/handlebars.js:1-3` (require), `util/handlebars.js:280-305` (`module.exports`)
- Create: `views/partials/access/unlock-cta.handlebars`, `views/partials/access/trial-badge.handlebars`, `views/partials/access/trial-ended-alert.handlebars`
- Create: `test/helpers/access-partials.js`
- Test: `views/partials/access/access-partials.test.js` (new)

**Interfaces:**
- Produces:
  - `EDITION_LABELS`, `EDITION_PURCHASE_URLS` exported from `util/starter-content.js`.
  - Helpers `edition_label(edition) -> string` ('' when unknown), `edition_purchase_url(edition) -> string` ('' when unknown or unset).
  - Partial `access/unlock-cta` (hash: `edition`) — "Buy {Label}" external link when a URL is configured, always "Redeem a code" → `/classes/redeem/bulk`.
  - Partial `access/trial-badge` (hash: `status` = a trial EditionStatus) — `TRIAL · ends {date}` tag, `is-danger` when urgent else `is-warning`; carries `data-trial-badge`.
  - Partial `access/trial-ended-alert` (hash: `edition`, `endedAt`, optional `lead`) — `notification is-danger` with `role="alert"` and `data-trial-ended`, text "{lead} your {Label} free trial ended {date}." or "Your {Label} free trial ended {date}." when no lead, then the CTA.
  - `registerAccessPartials(hb)` from `test/helpers/access-partials.js`.

- [ ] **Step 1: Write the failing test**

Create `test/helpers/access-partials.js`:

```js
const fs = require('fs');
const path = require('path');

const ACCESS_DIR = path.join(__dirname, '..', '..', 'views', 'partials', 'access');

// View tests build their own Handlebars instance; this registers every
// access/* partial under the name express-handlebars gives it.
const registerAccessPartials = (hb) => {
  for (const file of fs.readdirSync(ACCESS_DIR)) {
    if (!file.endsWith('.handlebars')) continue;
    hb.registerPartial(`access/${file.replace(/\.handlebars$/, '')}`, fs.readFileSync(path.join(ACCESS_DIR, file), 'utf8'));
  }
};

module.exports = { registerAccessPartials };
```

Create `views/partials/access/access-partials.test.js`:

```js
const { test, expect } = require('bun:test');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../../util/handlebars');
const { registerAccessPartials } = require('../../../test/helpers/access-partials');
const { EDITION_PURCHASE_URLS, EDITION_LABELS } = require('../../../util/starter-content');

const ADVENT_URL = 'https://enclave-aspirant.backerkit.com/hosted_preorders/822768';
const ASPIRANT_URL = 'https://enclave-aspirant.backerkit.com/hosted_preorders/822771';

const render = (template, context = {}, helperOverrides = {}) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper(helperOverrides);
  registerAccessPartials(hb);
  return hb.compile(template)({ profile: { timezone: 'UTC' }, ...context });
};

test('each edition has its own purchase page and label', () => {
  expect(EDITION_PURCHASE_URLS).toEqual({ advent: ADVENT_URL, aspirant: ASPIRANT_URL });
  expect(EDITION_LABELS).toEqual({ advent: 'Advent', aspirant: 'Aspirant' });
});

test("the Advent CTA links to Advent's purchase page, not Aspirant's", () => {
  const html = render('{{> access/unlock-cta edition="advent"}}');
  expect(html).toContain(`href="${ADVENT_URL}"`);
  expect(html).toContain('Buy Advent');
  expect(html).not.toContain(ASPIRANT_URL);
});

test("the Aspirant CTA links to Aspirant's purchase page, not Advent's", () => {
  const html = render('{{> access/unlock-cta edition="aspirant"}}');
  expect(html).toContain(`href="${ASPIRANT_URL}"`);
  expect(html).toContain('Buy Aspirant');
  expect(html).not.toContain(ADVENT_URL);
});

test('the purchase link opens in a new tab without an opener', () => {
  expect(render('{{> access/unlock-cta edition="advent"}}')).toContain('target="_blank" rel="noopener noreferrer"');
});

test('every CTA offers code redemption', () => {
  const html = render('{{> access/unlock-cta edition="advent"}}');
  expect(html).toContain('href="/classes/redeem/bulk"');
  expect(html).toContain('Redeem a code');
});

test('with no purchase URL configured the CTA is redeem-only', () => {
  const html = render('{{> access/unlock-cta edition="advent"}}', {}, { edition_purchase_url: () => '' });
  expect(html).not.toContain('Buy ');
  expect(html).toContain('Redeem a code');
});

test('an unknown edition gets a redeem-only CTA', () => {
  const html = render('{{> access/unlock-cta edition=edition}}', { edition: null });
  expect(html).not.toContain('Buy ');
  expect(html).toContain('Redeem a code');
});

test('the edition helpers answer empty for an unknown edition', () => {
  expect(customHelpers.edition_label('advent')).toBe('Advent');
  expect(customHelpers.edition_label('bogus')).toBe('');
  expect(customHelpers.edition_purchase_url('bogus')).toBe('');
});

const TRIAL = { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false };

test('a trial badge names the end date in warning colours', () => {
  const html = render('{{> access/trial-badge status=status}}', { status: TRIAL });
  expect(html).toContain('TRIAL · ends Oct 8, 2026');
  expect(html).toContain('is-warning');
  expect(html).toContain('data-trial-badge');
});

test('an urgent trial badge turns danger', () => {
  const html = render('{{> access/trial-badge status=status}}', { status: { ...TRIAL, daysLeft: 3, urgent: true } });
  expect(html).toContain('is-danger');
  expect(html).not.toContain('is-warning');
});

test('a trial-ended alert completes its lead with the end date and offers the CTA', () => {
  const html = render(
    '{{> access/trial-ended-alert lead="Ability and gear descriptions are hidden because" edition="advent" endedAt=endedAt}}',
    { endedAt: '2026-09-20T12:00:00Z' }
  );
  expect(html).toContain('Ability and gear descriptions are hidden because your Advent free trial ended Sep 20, 2026.');
  expect(html).toContain('role="alert"');
  expect(html).toContain('notification is-danger');
  expect(html).toContain(`href="${ADVENT_URL}"`);
});

test('a trial-ended alert without a lead reads as a sentence of its own', () => {
  const html = render('{{> access/trial-ended-alert edition="advent" endedAt=endedAt}}', { endedAt: '2026-09-20T12:00:00Z' });
  expect(html).toContain('Your Advent free trial ended Sep 20, 2026.');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test views/partials/access/access-partials.test.js`
Expected: FAIL — `ENOENT` reading `views/partials/access` (the directory does not exist yet).

- [ ] **Step 3: Write minimal implementation**

In `util/starter-content.js`, add above `module.exports`:

```js
const EDITION_LABELS = { advent: 'Advent', aspirant: 'Aspirant' };

// A falsy URL makes every CTA for that edition redeem-only.
const EDITION_PURCHASE_URLS = {
  advent: 'https://enclave-aspirant.backerkit.com/hosted_preorders/822768',
  aspirant: 'https://enclave-aspirant.backerkit.com/hosted_preorders/822771',
};
```

and replace the last line with:

```js
module.exports = {
  STARTER_RULES_PDF_ID,
  CORE_CLASS_UNLOCKS,
  ASPIRANT_V1_CLASS_IDS,
  EDITION_LABELS,
  EDITION_PURCHASE_URLS
};
```

In `util/handlebars.js`, add after the `const { gearCategory } = require('./class-gear');` line:

```js
const { EDITION_LABELS, EDITION_PURCHASE_URLS } = require('./starter-content');

const edition_label = (edition) => EDITION_LABELS[edition] || '';
const edition_purchase_url = (edition) => EDITION_PURCHASE_URLS[edition] || '';
```

and add `edition_label,` and `edition_purchase_url,` to the `module.exports` object (after `json: jsonH` add a comma, then the two names).

Create `views/partials/access/unlock-cta.handlebars`:

```handlebars
<div class="buttons mt-2 access-unlock-cta">
  {{#if (edition_purchase_url edition)}}
  <a class="button is-primary" href="{{edition_purchase_url edition}}" target="_blank" rel="noopener noreferrer">Buy {{edition_label edition}}</a>
  {{/if}}
  <a class="button is-light" href="/classes/redeem/bulk">Redeem a code</a>
</div>
```

Create `views/partials/access/trial-badge.handlebars`:

```handlebars
<span class="tag {{#if status.urgent}}is-danger{{else}}is-warning{{/if}} ml-2" data-trial-badge>TRIAL · ends {{date_tz status.endsAt "MMM D, YYYY" @root.profile.timezone}}</span>
```

Create `views/partials/access/trial-ended-alert.handlebars`:

```handlebars
<div class="notification is-danger" role="alert" aria-live="assertive" data-trial-ended>
  <p>{{#if lead}}{{lead}} your{{else}}Your{{/if}} {{edition_label edition}} free trial ended {{date_tz endedAt "MMM D, YYYY" @root.profile.timezone}}.</p>
  {{> access/unlock-cta edition=edition}}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test views/partials/access/access-partials.test.js test/app-engine-helpers.test.js`
Expected: PASS — `0 fail` (the app-engine test confirms the two new helpers are registered by `app.js`'s spread).

- [ ] **Step 5: Commit**

```bash
git add util/starter-content.js util/handlebars.js views/partials/access test/helpers/access-partials.js
git commit -m "feat: add per-edition purchase links and the shared unlock, trial badge and trial-ended partials

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Site-wide access banner

**Files:**
- Create: `views/partials/access/access-banner.handlebars`
- Modify: `views/layouts/main.handlebars:9-13`
- Modify: `views/partials/feedback-widget.test.js:15` (stub list)
- Test: `views/partials/access/access-banner.test.js` (new), `views/layouts/main.test.js` (new)

**Interfaces:**
- Consumes: `res.locals.editionAccess` (Task 3), `access/unlock-cta` and helpers (Task 4).
- Produces: `access/access-banner` (reads `editionAccess.advent` and `@root.profile.timezone`; no params). Root element `id="access-banner"` with `data-access-banner="trial"|"expired"`.

- [ ] **Step 1: Write the failing tests**

Create `views/partials/access/access-banner.test.js`:

```js
const { test, expect } = require('bun:test');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../../util/handlebars');
const { registerAccessPartials } = require('../../../test/helpers/access-partials');

const render = (editionAccess) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  registerAccessPartials(hb);
  return hb.compile('{{> access/access-banner}}')({ profile: { timezone: 'UTC' }, editionAccess }).trim();
};

const trial = (over = {}) => ({
  advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false, ...over },
  aspirant: { state: 'none' }
});

test('a trial shows the days left and the end date in warning colours', () => {
  const html = render(trial());
  expect(html).toContain('ADVENT FREE TRIAL — 10 days left');
  expect(html).toContain('Ends Oct 8, 2026');
  expect(html).toContain('notification is-warning');
  expect(html).toContain('data-access-banner="trial"');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822768');
});

test('an urgent trial turns danger', () => {
  const html = render(trial({ daysLeft: 5, urgent: true }));
  expect(html).toContain('ADVENT FREE TRIAL — 5 days left');
  expect(html).toContain('notification is-danger');
});

test('one day left is singular', () => {
  const html = render(trial({ daysLeft: 1, urgent: true, endsAt: '2026-10-01T12:00:00Z' }));
  expect(html).toContain('ADVENT FREE TRIAL — 1 day left');
  expect(html).not.toContain('1 days');
  expect(html).toContain('Ends Oct 1, 2026');
});

test('a trial ending today says so instead of a date', () => {
  const html = render(trial({ daysLeft: 1, urgent: true, endsToday: true }));
  expect(html).toContain('Ends today');
  expect(html).not.toContain('Ends Oct');
});

test('an expired trial names the end date and what is locked', () => {
  const html = render({ advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } });
  expect(html).toContain('Your Advent free trial ended Sep 20, 2026.');
  expect(html).toContain('Advent classes, character abilities and the rulebook are locked.');
  expect(html).toContain('notification is-danger');
  expect(html).toContain('data-access-banner="expired"');
  expect(html).toContain('Redeem a code');
});

test('the banner cannot be dismissed', () => {
  expect(render(trial())).not.toContain('class="delete"');
});

test('an owner, a never-granted user and a failed lookup get no banner', () => {
  expect(render({ advent: { state: 'owned' }, aspirant: { state: 'none' } })).toBe('');
  expect(render({ advent: { state: 'none' }, aspirant: { state: 'none' } })).toBe('');
  expect(render(null)).toBe('');
  expect(render(undefined)).toBe('');
});

test('Aspirant never produces a banner', () => {
  expect(render({
    advent: { state: 'owned' },
    aspirant: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }
  })).toBe('');
});
```

Create `views/layouts/main.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../util/handlebars');
const { registerAccessPartials } = require('../../test/helpers/access-partials');

const LAYOUT = fs.readFileSync(path.join(__dirname, 'main.handlebars'), 'utf8');
const SYSTEM_BANNER = fs.readFileSync(path.join(__dirname, '..', 'partials', 'alert', 'system-banner.handlebars'), 'utf8');

const renderLayout = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  for (const name of ['head', 'nav', 'feedback-widget']) hb.registerPartial(name, '');
  hb.registerPartial('alert/system-banner', SYSTEM_BANNER);
  registerAccessPartials(hb);
  return hb.compile(LAYOUT)(context);
};

const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };

test('the access banner sits above the system banner', () => {
  const html = renderLayout({
    profile: { timezone: 'UTC' },
    editionAccess: TRIAL,
    systemMessage: { id: 'm1', level: 'info', text: 'Maintenance tonight' }
  });
  const bannerAt = html.indexOf('data-access-banner');
  expect(bannerAt).toBeGreaterThan(-1);
  expect(bannerAt).toBeLessThan(html.indexOf('id="system-banner"'));
});

test('a signed-out page renders without a banner', () => {
  expect(renderLayout({ profile: null })).not.toContain('data-access-banner');
});

test('a failed status lookup renders the page without a banner', () => {
  expect(renderLayout({ profile: { timezone: 'UTC' }, editionAccess: null })).not.toContain('data-access-banner');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test views/partials/access/access-banner.test.js views/layouts/main.test.js`
Expected: FAIL — `The partial access/access-banner could not be found`.

- [ ] **Step 3: Write minimal implementation**

Create `views/partials/access/access-banner.handlebars`:

```handlebars
{{#if (eq editionAccess.advent.state 'trial')}}
<div id="access-banner" class="notification {{#if editionAccess.advent.urgent}}is-danger{{else}}is-warning{{/if}} mb-4" role="status" aria-live="polite" data-access-banner="trial">
  <p class="title is-4 mb-2">ADVENT FREE TRIAL — {{editionAccess.advent.daysLeft}} {{#if (eq editionAccess.advent.daysLeft 1)}}day{{else}}days{{/if}} left</p>
  <p>{{#if editionAccess.advent.endsToday}}Ends today{{else}}Ends {{date_tz editionAccess.advent.endsAt "MMM D, YYYY" @root.profile.timezone}}{{/if}}</p>
  {{> access/unlock-cta edition="advent"}}
</div>
{{else if (eq editionAccess.advent.state 'expired')}}
<div id="access-banner" class="notification is-danger mb-4" role="alert" data-access-banner="expired">
  <p class="title is-4 mb-2">Your Advent free trial ended {{date_tz editionAccess.advent.endedAt "MMM D, YYYY" @root.profile.timezone}}.</p>
  <p>Advent classes, character abilities and the rulebook are locked.</p>
  {{> access/unlock-cta edition="advent"}}
</div>
{{/if}}
```

In `views/layouts/main.handlebars`, replace lines 9-13:

```handlebars
    {{#if profile}}
    {{#if systemMessage}}
    {{> alert/system-banner systemMessage}}
    {{/if}}
    {{/if}}
```

with:

```handlebars
    {{#if profile}}
    {{> access/access-banner}}
    {{#if systemMessage}}
    {{> alert/system-banner systemMessage}}
    {{/if}}
    {{/if}}
```

In `views/partials/feedback-widget.test.js`, change the stub list on line 15 to:

```js
  for (const name of ['head', 'nav', 'alert/system-banner', 'access/access-banner']) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test views/partials/access/access-banner.test.js views/layouts/main.test.js views/partials/feedback-widget.test.js`
Expected: PASS — `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add views/partials/access/access-banner.handlebars views/partials/access/access-banner.test.js views/layouts/main.handlebars views/layouts/main.test.js views/partials/feedback-widget.test.js
git commit -m "feat: show a non-dismissible Advent trial and expiry banner under the nav

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Onboarding reads days-left from the edition status

**Files:**
- Modify: `services/home/onboarding.js` (whole-file changes below; delete `DAY_MS`, the `listRulesPdfUnlocksForUser` import and the inline `adventDaysLeft` computation)
- Modify: `services/home/sections.js:43` (signature) and `services/home/sections.js:61-66` (onboarding call)
- Modify: `routes/home.js:19`
- Test: `services/home/onboarding.test.js`, `services/home/sections.test.js`

**Interfaces:**
- Consumes: `getEditionAccess` (Task 2).
- Produces:
  - `computeOnboarding({ profile, hasCharacters, hasMissions, inGame, advent, freePdf })` — `advent` is an EditionStatus or null; `adventDaysLeft = advent.state === 'trial' ? advent.daysLeft : null`.
  - `loadOnboarding({ profile, client, hasCharacters, hasMissions, advent, now }, deps)` — when `advent` is `undefined` it calls `deps.getEditionAccess(profile.user_id, now, { timeZone })` itself (the POST `/profile/onboarding` htmx fragment has no `res.locals.editionAccess`). `defaultDeps` gains `getEditionAccess` and loses `listRulesPdfUnlocksForUser`.
  - `loadHomeSections({ profile, client, editionAccess }, deps)`.

- [ ] **Step 1: Write the failing tests**

In `services/home/onboarding.test.js`:

Replace the `base` helper (lines 5-12) with:

```js
const NOW = new Date('2026-08-17T12:00:00Z');
const TRIAL_24 = { state: 'trial', endsAt: '2026-09-10T12:00:00Z', daysLeft: 24, urgent: false, endsToday: false };
const base = () => ({
  profile: { user_id: 'u1', name: 'Dave', onboarding: {} },
  hasCharacters: false, hasMissions: false, inGame: false,
  advent: TRIAL_24,
  freePdf: { id: 'qs-id' }
});
```

Replace the three tests `'advent days-left counts up from now and links the starter PDF'`, `'an expired starter unlock drops the advent link but keeps the quickstart'` and `'a missing starter unlock behaves like an expired one'` with:

```js
test("advent days-left comes from the edition status and links the starter PDF", () => {
  const m = computeOnboarding({ ...base(), profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } } });
  expect(m.adventDaysLeft).toBe(24);
  expect(m.adventHref).toBe(`/library/${STARTER_RULES_PDF_ID}/view`);
  expect(m.quickstartHref).toBe('/library/qs-id/view');
});

test('an expired Advent trial drops the advent link but keeps the quickstart', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
    advent: { state: 'expired', endedAt: '2026-08-01T00:00:00Z' }
  });
  expect(m.adventDaysLeft).toBeNull();
  expect(m.adventHref).toBeNull();
  expect(m.quickstartHref).toBe('/library/qs-id/view');
});

test('an owned Advent shows no trial countdown', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
    advent: { state: 'owned' }
  });
  expect(m.adventDaysLeft).toBeNull();
  expect(m.adventHref).toBeNull();
});

test('no edition status behaves like no trial', () => {
  const m = computeOnboarding({
    ...base(),
    profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
    advent: null
  });
  expect(m.adventDaysLeft).toBeNull();
});
```

In the `deps` helper, replace the `listRulesPdfUnlocksForUser` entry with:

```js
  getEditionAccess: async () => ({ advent: TRIAL_24, aspirant: { state: 'none' } }),
```

Append:

```js
// POST /profile/onboarding answers an htmx fragment, which the auth step
// skips, so loadOnboarding has to find the status on its own.
test('loadOnboarding looks the Advent status up itself when the caller has none', async () => {
  const calls = [];
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', timezone: 'America/New_York', onboarding: { path: 'new' } }, client: {}, now: NOW },
    deps({ getEditionAccess: async (...args) => { calls.push(args); return { advent: TRIAL_24, aspirant: { state: 'none' } }; } })
  );
  expect(calls).toEqual([['u1', NOW, { timeZone: 'America/New_York' }]]);
  expect(m.adventDaysLeft).toBe(24);
});

test("loadOnboarding uses a caller-supplied Advent status and skips the lookup", async () => {
  let lookups = 0;
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, advent: { ...TRIAL_24, daysLeft: 3 }, now: NOW },
    deps({ getEditionAccess: async () => { lookups++; return null; } })
  );
  expect(m.adventDaysLeft).toBe(3);
  expect(lookups).toBe(0);
});

test('a throwing edition lookup degrades to no countdown, never the whole card', async () => {
  const m = await loadOnboarding(
    { profile: { user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } }, client: {}, now: NOW },
    deps({ getEditionAccess: async () => { throw new Error('down'); } })
  );
  expect(m.show).toBe(true);
  expect(m.adventDaysLeft).toBeNull();
});
```

In `services/home/sections.test.js`, replace `listRulesPdfUnlocksForUser: ok([]),` in `onboardingDeps` with:

```js
  getEditionAccess: async () => null,
```

and append:

```js
test("loadHomeSections hands the request's Advent status to onboarding without a second lookup", async () => {
  let lookups = 0;
  const result = await loadHomeSections(
    {
      profile: { id: 'p1', user_id: 'u1', name: 'Vex', onboarding: { path: 'new' } },
      client,
      editionAccess: {
        advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false },
        aspirant: { state: 'none' }
      }
    },
    {
      ...allGood(), ...onboardingDeps,
      getRecentCharactersByCreator: ok([]), getRecentMissionsByCreator: ok([]),
      getEditionAccess: async () => { lookups++; return null; }
    }
  );
  expect(result.onboarding.adventDaysLeft).toBe(10);
  expect(lookups).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/home/onboarding.test.js services/home/sections.test.js`
Expected: FAIL — `adventDaysLeft` is `null` where 24/10/3 are expected (the old code reads `starterUnlock`).

- [ ] **Step 3: Write minimal implementation**

In `services/home/onboarding.js`:

Replace lines 1-15 (the requires, `DAY_MS` and `defaultDeps`) with:

```js
const { STARTER_RULES_PDF_ID } = require('../../util/starter-content');
const { countCharactersByCreator } = require('../../models/character');
const { hasAnyGameActivity } = require('../../models/lfg');
const { getRulesPdfs } = require('../../models/rules');
const { getEditionAccess } = require('../access/service');

const defaultDeps = {
  countCharactersByCreator,
  hasAnyGameActivity,
  getEditionAccess,
  getRulesPdfs
};
```

Replace the `computeOnboarding` signature line with:

```js
const computeOnboarding = ({ profile, hasCharacters, hasMissions, inGame, advent, freePdf }) => {
```

and replace the four lines that compute `expiresMs` and `adventDaysLeft` with:

```js
  const adventDaysLeft = advent?.state === 'trial' ? advent.daysLeft : null;
```

Replace `loadOnboarding` (from its signature to the end of the function) with:

```js
const loadOnboarding = async ({ profile, client, hasCharacters, hasMissions, advent, now = new Date() }, deps = defaultDeps) => {
  const findFreePdf = async () => {
    const rules = await settle('free-pdf', [], () => deps.getRulesPdfs({}));
    return rules.find(r => r.free_access && r.is_active) || null;
  };

  if (!profile) {
    const freePdf = await findFreePdf();
    return hidden({ quickstartHref: freePdf ? viewHref(freePdf.id) : null });
  }

  if (profile.onboarding?.dismissed) return hidden();

  const lookUpAdvent = async () => {
    try {
      const access = await deps.getEditionAccess(profile.user_id, now, { timeZone: profile.timezone || null });
      return access?.advent || null;
    } catch (err) {
      console.error('onboarding read "edition-access" threw:', err);
      return null;
    }
  };

  const [resolvedHasCharacters, inGame, resolvedAdvent, freePdf] = await Promise.all([
    hasCharacters === undefined
      ? settle('character-count', 0, () => deps.countCharactersByCreator(profile.id, client)).then(n => n > 0)
      : hasCharacters,
    settle('game-activity', false, () => deps.hasAnyGameActivity(profile.id, client)),
    advent === undefined ? lookUpAdvent() : advent,
    findFreePdf()
  ]);

  return computeOnboarding({
    profile,
    hasCharacters: resolvedHasCharacters,
    hasMissions: hasMissions === undefined ? false : hasMissions,
    inGame,
    advent: resolvedAdvent,
    freePdf
  });
};
```

In `services/home/sections.js`, change line 43 to:

```js
const loadHomeSections = async ({ profile, client, editionAccess }, deps = defaultDeps) => {
```

and the `loadOnboarding` call (lines 61-66) to:

```js
  const onboarding = await loadOnboarding({
    profile,
    client,
    hasCharacters: signedIn ? myCharacters.length > 0 : undefined,
    hasMissions: signedIn ? myMissions.length > 0 : undefined,
    advent: editionAccess ? editionAccess.advent : undefined
  }, deps);
```

In `routes/home.js`, change line 19 to:

```js
  const sections = await loadHomeSections({ profile, client: res.locals.supabase, editionAccess: res.locals.editionAccess });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/home/onboarding.test.js services/home/sections.test.js views/home.test.js routes/profile-onboarding.test.js`
Expected: PASS — `0 fail`. Confirm nothing else references the deleted names: `grep -rn "starterUnlock\|DAY_MS" services/home` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add services/home/onboarding.js services/home/onboarding.test.js services/home/sections.js services/home/sections.test.js routes/home.js
git commit -m "feat: read onboarding's Advent days-left from the edition status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Locked roster ids and the locked catalog partition

**Files:**
- Modify: `models/class.js:1-10` (require), `models/class.js:145-147` (compute rosters before the early return), `models/class.js:195-203` (return), `models/class.js:331-334` (`getUnlockedClassIdsForUser`)
- Modify: `util/class-filter.js:44-80` (`partitionClassCatalog`, `OWNED_EDITIONS` moved above it, new `lockedRosterIds`), `util/class-filter.js:124-133` (exports)
- Test: `models/class-book-unlocks.test.js` (append), `util/class-filter.test.js`

**Interfaces:**
- Consumes: `isLockedStatus` (Task 1).
- Produces:
  - `getEffectiveClassUnlocks(userId)` result gains `rosterIdsByEdition: { advent: Set<id>, aspirant: Set<id> }` — each edition's core roster expanded across same-edition version families, computed for every caller including signed-out and grantless users.
  - `getUnlockedClassIdsForUser(userId) -> { data: Set<id>, rosterIdsByEdition, error }`.
  - `lockedRosterIds(editionAccess, rosterIdsByEdition = {}, playableIds = new Set()) -> { [edition]: Set<id> }` — only editions whose status `isLockedStatus`, minus anything playable.
  - `partitionClassCatalog(groups, bookClassIds, lockedIds = {})` result gains `locked: { advent: Group[], aspirant: Group[] }`.

- [ ] **Step 1: Write the failing tests**

Append to `models/class-book-unlocks.test.js`:

```js
test("rosterIdsByEdition names each edition's roster, family-expanded, for a user with no grants", async () => {
  reset();
  const access = await getEffectiveClassUnlocks('u1');

  expect(access.rosterIdsByEdition.advent.has(ADVENT_LIBRARIAN)).toBe(true);
  expect(access.rosterIdsByEdition.advent.has(LIBRARIAN_V2)).toBe(true);
  expect(access.rosterIdsByEdition.advent.has(ASPIRANT_VESSEL)).toBe(false);
  expect(access.rosterIdsByEdition.advent.has(PRIVATE_CLASS)).toBe(false);
  expect(access.rosterIdsByEdition.aspirant.has(ASPIRANT_VESSEL)).toBe(true);
});

test('a signed-out viewer still gets the rosters', async () => {
  reset();
  const access = await getEffectiveClassUnlocks(null);
  expect(access.rosterIdsByEdition.aspirant.has(ASPIRANT_VESSEL)).toBe(true);
});

test('getUnlockedClassIdsForUser carries the rosters alongside the playable ids', async () => {
  reset();
  state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent', expires_at: null }];
  const { data, rosterIdsByEdition } = await getUnlockedClassIdsForUser('u1');
  expect(data.has(ADVENT_LIBRARIAN)).toBe(true);
  expect(rosterIdsByEdition.aspirant.has(ASPIRANT_VESSEL)).toBe(true);
});
```

In `util/class-filter.test.js`, add `lockedRosterIds` to the require list at the top, and in the two existing `partitionClassCatalog` tests that use `toEqual` on the whole result, add `locked: { advent: [], aspirant: [] }` to the expected objects:

```js
    expect(partitionClassCatalog([teaser, pcc, owned, other], new Set(['owned']))).toEqual({
      ownedReleases: [owned],
      otherReleases: [other],
      prerelease: [teaser],
      pcc: [pcc],
      locked: { advent: [], aspirant: [] }
    });
```

```js
    expect(out).toEqual({
      ownedReleases: advent, otherReleases: aspirant, prerelease: teasers, pcc: pccs,
      locked: { advent: [], aspirant: [] }
    });
```

Then append inside `describe('partitionClassCatalog', ...)`:

```js
  const ADVENT_ROSTER = new Set(['gun-adv']);
  const ASPIRANT_ROSTER = new Set(['gun-asp']);

  test("a released core class the viewer cannot play moves to its edition's locked section", () => {
    const advGun = group('gun-adv');
    const aspGun = group('gun-asp');
    const releasedPcc = group('pcc-rel', { is_player_created: true });
    const out = partitionClassCatalog([advGun, aspGun, releasedPcc], new Set(), { advent: ADVENT_ROSTER, aspirant: ASPIRANT_ROSTER });
    expect(out.locked).toEqual({ advent: [advGun], aspirant: [aspGun] });
    expect(out.otherReleases).toEqual([releasedPcc]);
  });

  test('during an Advent trial the Advent class stays owned and only its Aspirant fork is locked', () => {
    const advGun = group('gun-adv');
    const aspGun = group('gun-asp');
    const lockedIds = lockedRosterIds(
      { advent: { state: 'trial' }, aspirant: { state: 'none' } },
      { advent: ADVENT_ROSTER, aspirant: ASPIRANT_ROSTER },
      new Set(['gun-adv'])
    );
    const out = partitionClassCatalog([advGun, aspGun], new Set(['gun-adv']), lockedIds);
    expect(out.ownedReleases).toEqual([advGun]);
    expect(out.locked).toEqual({ advent: [], aspirant: [aspGun] });
  });

  test('a pre-release class stays pre-release even when its edition is locked', () => {
    const teaser = group('gun-asp', { prerelease_section: 'aspirant' });
    const out = partitionClassCatalog([teaser], new Set(), { aspirant: ASPIRANT_ROSTER });
    expect(out.prerelease).toEqual([teaser]);
    expect(out.locked.aspirant).toEqual([]);
  });
```

And append a new describe:

```js
describe('lockedRosterIds', () => {
  const rosters = { advent: new Set(['gun-adv', 'gun-adv-v2']), aspirant: new Set(['gun-asp', 'berserker']) };
  const status = (advent, aspirant) => ({ advent: { state: advent }, aspirant: { state: aspirant } });

  test('an Advent trial is access: only Aspirant is teased', () => {
    expect(lockedRosterIds(status('trial', 'none'), rosters)).toEqual({ aspirant: new Set(['gun-asp', 'berserker']) });
  });

  test('a lapsed Advent trial teases the Advent roster', () => {
    expect(lockedRosterIds(status('expired', 'owned'), rosters)).toEqual({ advent: new Set(['gun-adv', 'gun-adv-v2']) });
  });

  test('an owned edition is never teased', () => {
    expect(lockedRosterIds(status('owned', 'owned'), rosters)).toEqual({});
  });

  test('a class the viewer can already play by another route is not teased', () => {
    expect(lockedRosterIds(status('expired', 'owned'), rosters, new Set(['gun-adv-v2'])).advent)
      .toEqual(new Set(['gun-adv']));
  });

  test('no edition status teases nothing', () => {
    expect(lockedRosterIds(null, rosters)).toEqual({});
    expect(lockedRosterIds(undefined, rosters)).toEqual({});
  });

  test('an edition without a roster is skipped', () => {
    expect(lockedRosterIds(status('none', 'none'), { advent: new Set(['a']) })).toEqual({ advent: new Set(['a']) });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test models/class-book-unlocks.test.js util/class-filter.test.js`
Expected: FAIL — `undefined is not an object (evaluating 'access.rosterIdsByEdition.advent')` and `lockedRosterIds is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `models/class.js`, add after `const { coreClassIdsForEditions } = require('../util/book-classes');`:

```js
const { CORE_CLASS_UNLOCKS } = require('../util/starter-content');
```

Replace lines 145-147:

```js
    if (rawUnion.size === 0) return { ...empty, error: readError };

    const expand = (idSet) => (classRows ? expandIdsToFamilies(classRows, idSet) : new Set(idSet));
```

with:

```js
    const expand = (idSet) => (classRows ? expandIdsToFamilies(classRows, idSet) : new Set(idSet));
    // Every edition's roster, owned or not: the catalog and pickers tease the
    // ones the viewer lacks.
    const rosterIdsByEdition = Object.fromEntries(
        Object.keys(CORE_CLASS_UNLOCKS).map(edition => [edition, expand(coreClassIdsForEditions([edition]))])
    );
    if (rawUnion.size === 0) return { ...empty, rosterIdsByEdition, error: readError };
```

In the final `return { ... }` of `getEffectiveClassUnlocks` (lines 195-203), add `rosterIdsByEdition,` after `directIds,`.

Replace `getUnlockedClassIdsForUser` (lines 331-334) with:

```js
const getUnlockedClassIdsForUser = async (userId) => {
    const { ids, rosterIdsByEdition, error } = await getEffectiveClassUnlocks(userId);
    return { data: ids, rosterIdsByEdition, error: error || null };
};
```

In `util/class-filter.js`, add at the top of the file (after the header comment):

```js
const { isLockedStatus } = require('../services/access/edition-status');
```

Move the line `const OWNED_EDITIONS = ['advent', 'aspirant'];` from above `splitOwnedByEdition` to directly above the `partitionClassCatalog` comment, then replace `partitionClassCatalog` with:

```js
// The /classes catalog's sections, decided per version group by its primary
// and checked in this order. Pre-release comes first because it must win over
// book ownership: the Aspirant book's roster grants the six pre-release
// aspirant-section classes (util/starter-content.js). A released core class
// the viewer cannot play goes to its edition's locked section (lockedIds,
// from lockedRosterIds) instead of "Other Released". Artwork is release
// content and appears only for released classes covered by a book the viewer
// owns; the other sections stay art-free (views/classes.handlebars).
const partitionClassCatalog = (groups, bookClassIds = new Set(), lockedIds = {}) => {
  const list = Array.isArray(groups) ? groups : [];
  const ownedReleases = [];
  const otherReleases = [];
  const prerelease = [];
  const pcc = [];
  const locked = Object.fromEntries(OWNED_EDITIONS.map(edition => [edition, []]));
  for (const group of list) {
    const cls = group && group.primary;
    if (cls?.prerelease_section) prerelease.push(group);
    else if (isUnreleasedPcc(cls)) pcc.push(group);
    else if (bookClassIds.has(cls?.id)) ownedReleases.push(group);
    else {
      const edition = OWNED_EDITIONS.find(e => lockedIds[e]?.has(cls?.id));
      (edition ? locked[edition] : otherReleases).push(group);
    }
  }
  return { ownedReleases, otherReleases, prerelease, pcc, locked };
};

// Roster ids of every edition the viewer neither owns nor is trialling, minus
// anything they can already play by another route (a direct unlock, a free
// pre-release row). A trial counts as access, so Advent is teased only once
// it has lapsed or was never granted.
const lockedRosterIds = (editionAccess, rosterIdsByEdition = {}, playableIds = new Set()) => {
  const locked = {};
  if (!editionAccess) return locked;
  for (const [edition, status] of Object.entries(editionAccess)) {
    const roster = rosterIdsByEdition?.[edition];
    if (!isLockedStatus(status) || !roster) continue;
    locked[edition] = new Set([...roster].filter(id => !playableIds.has(id)));
  }
  return locked;
};
```

Add `lockedRosterIds,` to `module.exports` after `partitionClassCatalog,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test models/class-book-unlocks.test.js util/class-filter.test.js routes/classes-catalog-order.test.js`
Expected: PASS — `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add models/class.js models/class-book-unlocks.test.js util/class-filter.js util/class-filter.test.js
git commit -m "feat: partition released core classes the viewer cannot play into per-edition locked sets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Catalog locked sections, TRIAL badges, class view badge and teaser header

**Files:**
- Modify: `routes/classes.js:41` (requires), `routes/classes.js:147-176` (GET `/`), `routes/classes.js:486-503` (teaser render), `routes/classes.js:541-558` (class-view render)
- Modify: `views/classes.handlebars:92-121`, `views/partials/class-group-card.handlebars`, `views/class-view.handlebars:1-22`, `views/class-view-teaser.handlebars:1-2`
- Modify: `views/classes.test.js:14-23` (harness), `views/class-view.test.js:255-270` (harness)
- Test: `routes/classes-edition-access.test.js` (new), `views/classes.test.js`, `views/class-view.test.js`, `views/class-view-teaser.test.js` (new)

**Interfaces:**
- Consumes: `lockedRosterIds`, `partitionClassCatalog(...).locked`, `access.rosterIdsByEdition` (Task 7); `trialStatus`, `trialEndedAt` (Task 3); partials (Task 4).
- Produces render context:
  - `classes`: `lockedSections: Array<{ edition, count, trialEndedAt: string|null, buckets }>` (edition order advent, aspirant; empty sections omitted), `showTrialBadges: boolean`.
  - `class-view`: `adventTrial: EditionStatus|null` (set for a book-granted Advent class during the trial).
  - `class-view-teaser`: `adventTrialEndedAt: string|null` (official Advent class, Advent expired).
- `class-group-card` accepts `locked` and `showTrial` hash params.

- [ ] **Step 1: Write the failing tests**

Create `routes/classes-edition-access.test.js`:

```js
// GET /classes and GET /classes/:id read res.locals.editionAccess for the
// locked sections, the TRIAL badges and the lapsed-trial teaser header.
// freshRequire scaffold as in routes/classes-catalog-order.test.js.
const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const { CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS } = require('../util/starter-content');
const realEditionAccess = require('../util/edition-access');

const ADV = CORE_CLASS_UNLOCKS.advent.Gunslinger[0];
const ASP = ASPIRANT_V1_CLASS_IDS.Gunslinger;
const row = (id, rules_edition, extra = {}) => ({
  id, name: 'Gunslinger', rules_edition, rules_version: 'v1', status: 'release', is_public: true,
  is_player_created: false, prerelease_section: null, challenge_level: 'Mid', created_by: 'someone-else',
  gear: [], abilities: [], created_at: '2026-01-01T00:00:00Z', ...extra
});
const ROWS = [row(ADV, 'advent'), row(ASP, 'aspirant', { base_class_id: ADV })];
const ROSTERS = { advent: new Set([ADV]), aspirant: new Set([ASP]) };

const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };
const EXPIRED = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };

const state = {};
beforeEach(() => {
  state.editionAccess = EXPIRED;
  state.access = { ids: new Set(), bookIds: new Set(), rosterIdsByEdition: ROSTERS, error: null };
  state.classAccess = { unlocked: false, productUnlocked: false, bookUnlocked: false, accessSource: null, expiresAt: null };
});

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user', timezone: 'UTC' }),
    getProfileById: async () => ({ data: null, error: null }),
    patchOnboarding: async () => ({ data: null, error: null })
  }],
  [require.resolve('../models/class'), {
    getClasses: async () => ({ data: ROWS, error: null }),
    getClass: async (id) => ({ data: ROWS.find(r => r.id === id) || null, error: null }),
    getEffectiveClassUnlocks: async () => state.access,
    getEffectiveClassAccess: async () => ({ data: state.classAccess, error: null }),
    canViewClassPdf: async () => ({ data: false, error: null })
  }],
  [require.resolve('../models/rules'), { getRulesPdf: async () => ({ data: null, error: null }) }],
  [require.resolve('../models/pdf'), {
    storeClassPdf: async () => ({ data: null, error: null }),
    getSignedPdfUrl: async () => ({ data: null, error: null }),
    deletePdfObject: async () => ({ error: null }),
    CLASS_PDF_BUCKET: 'class-pdfs'
  }],
  [require.resolve('../util/edition-access'), {
    ...realEditionAccess,
    populateEditionAccess: async (req, res) => { res.locals.editionAccess = state.editionAccess; }
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), { populateNavItems: async () => {}, loadNavItems: (req, res, next) => next() }]
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(require('../util/open-graph').openGraphDefaults);
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/classes', freshRequire(require.resolve('./classes'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

const get = async (path) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer valid-jwt' } });
  expect(res.status).toBe(200);
  return res.json();
};
const idsIn = (buckets) => buckets.flatMap(b => b.groups.map(g => g.primary.id));

test('a lapsed Advent trial teases each Gunslinger under its own edition', async () => {
  const { ctx } = await get('/classes');
  expect(ctx.lockedSections.map(s => ({ edition: s.edition, count: s.count, trialEndedAt: s.trialEndedAt, ids: idsIn(s.buckets) })))
    .toEqual([
      { edition: 'advent', count: 1, trialEndedAt: '2026-09-20T12:00:00Z', ids: [ADV] },
      { edition: 'aspirant', count: 1, trialEndedAt: null, ids: [ASP] }
    ]);
  expect(ctx.otherReleaseGroups).toEqual([]);
  expect(ctx.showTrialBadges).toBe(false);
});

test('during an Advent trial the Advent class is owned with a badge and only the fork is locked', async () => {
  state.editionAccess = TRIAL;
  state.access = { ids: new Set([ADV]), bookIds: new Set([ADV]), rosterIdsByEdition: ROSTERS, error: null };
  const { ctx } = await get('/classes');
  expect(idsIn(ctx.ownedReleaseGroups)).toEqual([ADV]);
  expect(ctx.lockedSections.map(s => s.edition)).toEqual(['aspirant']);
  expect(ctx.showTrialBadges).toBe(true);
});

test('a failed status lookup leaves the catalog as it was: no locked sections', async () => {
  state.editionAccess = null;
  const { ctx } = await get('/classes');
  expect(ctx.lockedSections).toEqual([]);
  expect(idsIn(ctx.otherReleaseGroups).sort()).toEqual([ADV, ASP].sort());
});

test('a book-granted Advent class carries the trial status into the class view', async () => {
  state.editionAccess = TRIAL;
  state.classAccess = { unlocked: true, productUnlocked: true, bookUnlocked: true, accessSource: 'book', expiresAt: '2026-10-08T12:00:00Z' };
  const { view, ctx } = await get(`/classes/${ADV}/Gunslinger`);
  expect(view).toBe('class-view');
  expect(ctx.adventTrial).toEqual(TRIAL.advent);
});

test('a directly unlocked class shows no trial badge', async () => {
  state.editionAccess = TRIAL;
  state.classAccess = { unlocked: true, productUnlocked: true, bookUnlocked: false, accessSource: 'direct', expiresAt: null };
  const { ctx } = await get(`/classes/${ADV}/Gunslinger`);
  expect(ctx.adventTrial).toBeNull();
});

test("a locked Advent class's teaser names when the trial ended", async () => {
  const { view, ctx } = await get(`/classes/${ADV}/Gunslinger`);
  expect(view).toBe('class-view-teaser');
  expect(ctx.adventTrialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test("the Aspirant fork's teaser does not blame the Advent trial", async () => {
  const { view, ctx } = await get(`/classes/${ASP}/Gunslinger`);
  expect(view).toBe('class-view-teaser');
  expect(ctx.adventTrialEndedAt).toBeNull();
});
```

In `views/classes.test.js`, add to the requires:

```js
const { registerAccessPartials } = require('../test/helpers/access-partials');
```

add `registerAccessPartials(hb);` inside `renderClasses` after the `class-group-card` registration, add `lockedSections: [],` to `baseContext`, and append:

```js
const aspirantSection = (over = {}) => ({
  edition: 'aspirant', count: 1, trialEndedAt: null,
  buckets: unrated([{ ...group('asp-1', 'Berserker'), primary: { ...group('asp-1', 'Berserker').primary, rules_edition: 'aspirant' } }]),
  ...over
});

test('a locked edition section names the edition, counts its classes and offers its CTA', () => {
  const html = renderClasses(baseContext({ profile: { timezone: 'UTC' }, lockedSections: [aspirantSection()] }));
  expect(html).toContain('Locked — Aspirant');
  expect(html).toContain('1 class');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822771');
  expect(html).toContain('Redeem a code');
  expect(html).toContain('Berserker teaser');
  expect(html).toContain('href="/classes/asp-1/Berserker"');
});

test("a lapsed trial's Advent section carries the ended notice", () => {
  const html = renderClasses(baseContext({
    profile: { timezone: 'UTC' },
    lockedSections: [aspirantSection({ edition: 'advent', trialEndedAt: '2026-09-20T12:00:00Z' })]
  }));
  expect(html).toContain('Locked — Advent');
  expect(html).toContain('Your Advent free trial ended Sep 20, 2026.');
});

test('locked cards are dimmed, carry a lock and render no art', () => {
  const html = renderClasses(baseContext({
    lockedSections: [aspirantSection({ buckets: unrated([group('asp-2', 'Vessel', { image: true })]) })]
  }));
  expect(html).toContain('data-locked-card');
  expect(html).toContain('fa-lock');
  expect(html).not.toContain('image-crop-render');
});

test('locked sections sit between the owned and the other released sections', () => {
  const html = renderClasses(baseContext({
    ownedReleaseGroups: unrated([group('own-1', 'Gunslinger')]),
    otherReleaseGroups: unrated([group('oth-1', 'Homebrew')]),
    lockedSections: [aspirantSection()]
  }));
  const ownedAt = html.indexOf('Your Released Classes');
  const lockedAt = html.indexOf('Locked — Aspirant');
  const otherAt = html.indexOf('Other Released Classes');
  expect(ownedAt).toBeLessThan(lockedAt);
  expect(lockedAt).toBeLessThan(otherAt);
});

test('owned Advent cards carry a TRIAL badge while the trial runs', () => {
  const html = renderClasses(baseContext({
    profile: { timezone: 'UTC' },
    showTrialBadges: true,
    editionAccess: { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false } },
    ownedReleaseGroups: unrated([group('own-1', 'Gunslinger')])
  }));
  expect(html).toContain('TRIAL · ends Oct 8, 2026');
});

test('no TRIAL badge without an Advent trial', () => {
  const html = renderClasses(baseContext({ ownedReleaseGroups: unrated([group('own-1', 'Gunslinger')]) }));
  expect(html).not.toContain('TRIAL ·');
});
```

In `views/class-view.test.js`, add near the other requires below line 248:

```js
const { registerAccessPartials } = require('../test/helpers/access-partials');
```

add `registerAccessPartials(hb);` inside `renderClassView` before `return`, and append:

```js
test('a book-granted Advent class shows the TRIAL badge in its header', () => {
  const html = renderClassView(pdfContext({
    profile: { name: 'Alice', timezone: 'UTC' },
    adventTrial: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }
  }));
  const badgeAt = html.indexOf('TRIAL · ends Oct 8, 2026');
  expect(badgeAt).toBeGreaterThan(-1);
  expect(badgeAt).toBeLessThan(html.indexOf('</h1>'));
});

test('no trial, no TRIAL badge', () => {
  expect(renderClassView(pdfContext({}))).not.toContain('TRIAL ·');
});
```

Create `views/class-view-teaser.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const { registerAccessPartials } = require('../test/helpers/access-partials');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', '');
  registerAccessPartials(hb);
  return hb.compile(fs.readFileSync(path.join(__dirname, 'class-view-teaser.handlebars'), 'utf8'))({
    profile: { name: 'Alice', timezone: 'UTC' },
    class: { id: 'gun', name: 'Gunslinger', status: 'release', rules_edition: 'advent', rules_version: 'v1', teaser: 'Quick on the draw.' },
    ...context
  });
};

test('a lapsed trial heads the teaser with when it ended and how to unlock', () => {
  const html = render({ adventTrialEndedAt: '2026-09-20T12:00:00Z' });
  const noticeAt = html.indexOf('Your Advent free trial ended Sep 20, 2026.');
  expect(noticeAt).toBeGreaterThan(-1);
  expect(noticeAt).toBeLessThan(html.indexOf('About this class'));
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822768');
});

test('no lapsed trial, no header', () => {
  expect(render({})).not.toContain('free trial ended');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/classes-edition-access.test.js views/classes.test.js views/class-view.test.js views/class-view-teaser.test.js`
Expected: FAIL — `ctx.lockedSections` is `undefined`, and the view assertions for `Locked — Aspirant`, `TRIAL ·` and `free trial ended` do not match.

- [ ] **Step 3: Write minimal implementation**

In `routes/classes.js`, change line 41 to:

```js
const { partitionClassCatalog, lockedRosterIds, splitOwnedByEdition, ownedToggleLinks, groupByDifficulty } = require('../util/class-filter');
const { trialStatus, trialEndedAt } = require('../util/edition-access');
```

In GET `/`, replace the partition block and `res.render('classes', ...)` (lines 149-176) with:

```js
    const access = await getEffectiveClassUnlocks(viewerUserId);
    if (access.error) return sendError(req, res, access.error);
    const { editionAccess } = res.locals;
    const {
        ownedReleases: ownedReleaseGroups,
        otherReleases: otherReleaseGroups,
        prerelease: prereleaseGroups,
        pcc: pccGroups,
        locked: lockedGroups
    } = partitionClassCatalog(
        classGroups,
        access.bookIds,
        lockedRosterIds(editionAccess, access.rosterIdsByEdition, access.ids)
    );
    const owned = splitOwnedByEdition(ownedReleaseGroups, req.query.yours);

    res.render('classes', {
        profile,
        title: 'Classes',
        ownedReleaseGroups: groupByDifficulty(owned.groups),
        ownedEdition: owned.edition,
        ownedEditions: owned.editions,
        ownedToggleLinks: ownedToggleLinks(req.query),
        showTrialBadges: owned.edition === 'advent' && Boolean(trialStatus(editionAccess, 'advent')),
        lockedSections: Object.entries(lockedGroups)
            .filter(([, groups]) => groups.length > 0)
            .map(([edition, groups]) => ({
                edition,
                count: groups.length,
                trialEndedAt: trialEndedAt(editionAccess, edition),
                buckets: groupByDifficulty(groups)
            })),
        otherReleaseGroups: groupByDifficulty(otherReleaseGroups),
        prereleaseGroups: groupByDifficulty(prereleaseGroups),
        pccGroups: groupByDifficulty(pccGroups),
        filters: filters,
        isAdmin,
        activeNav: 'classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' }
        ]
    });
```

In the teaser `res.render('class-view-teaser', { ... })` (line ~487), add after `showClassArt: ...,`:

```js
                adventTrialEndedAt: !classData.is_player_created && classData.rules_edition === 'advent'
                    ? trialEndedAt(res.locals.editionAccess, 'advent')
                    : null,
```

In `res.render('class-view', { ... })` (line ~541), add after `unlockExpiresAt,`:

```js
        adventTrial: access?.accessSource === 'book' && classData.rules_edition === 'advent'
            ? trialStatus(res.locals.editionAccess, 'advent')
            : null,
```

In `views/classes.handlebars`, change the card line inside the `class-difficulty-buckets` inline partial to:

```handlebars
    {{> class-group-card this showImage=../../showImage showTrial=../../showTrial locked=../../locked}}
```

change the owned-section call to:

```handlebars
{{> class-difficulty-buckets buckets=ownedReleaseGroups listId="classList" showImage=true showTrial=showTrialBadges}}
{{/if}}
```

and insert between that `{{/if}}` and `{{#if otherReleaseGroups.length}}`:

```handlebars

{{#each lockedSections}}
<section class="block locked-edition" data-locked-edition="{{edition}}">
  <h2 class="title is-4" id="locked-{{edition}}-classes">
    <span class="icon has-text-grey"><i class="fas fa-lock"></i></span>
    <span>Locked — {{edition_label edition}}</span>
    <span class="tag is-light ml-2">{{count}} {{#if (eq count 1)}}class{{else}}classes{{/if}}</span>
  </h2>
  {{#if trialEndedAt}}
  <p class="has-text-danger mb-2">Your {{edition_label edition}} free trial ended {{date_tz trialEndedAt "MMM D, YYYY" @root.profile.timezone}}.</p>
  {{/if}}
  {{> access/unlock-cta edition=edition}}
  {{> class-difficulty-buckets buckets=buckets listId=(concat "locked-" edition "-list") locked=true}}
</section>
{{/each}}
```

In `views/partials/class-group-card.handlebars`, replace the first three lines:

```handlebars
<div class="column is-3">
  <div class="card">
    {{#if (and showImage primary.image_url)}}
```

with:

```handlebars
<div class="column is-3">
  <div class="card"{{#if locked}} data-locked-card style="opacity: 0.7"{{/if}}>
    {{#if (and showImage primary.image_url (not locked))}}
```

change the title line `<h5 class="title is-5"><a href=...>{{primary.name}}</a>` to:

```handlebars
      <h5 class="title is-5">{{#if locked}}<span class="icon has-text-grey mr-1" title="Locked"><i class="fas fa-lock"></i></span>{{/if}}<a href="/classes/{{primary.id}}/{{primary.name}}">{{primary.name}}</a>
        {{#if (and showTrial (eq primary.rules_edition 'advent'))}}
        {{> access/trial-badge status=@root.editionAccess.advent}}
        {{/if}}
```

In `views/class-view.handlebars`, add before `</h1>` on line 22:

```handlebars
  {{#if adventTrial}}
  {{> access/trial-badge status=adventTrial}}
  {{/if}}
```

In `views/class-view-teaser.handlebars`, add after line 2 (`<h1 ...>{{class.name}}</h1>`):

```handlebars
{{#if adventTrialEndedAt}}
{{> access/trial-ended-alert edition="advent" endedAt=adventTrialEndedAt}}
{{/if}}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/classes-edition-access.test.js views/classes.test.js views/class-view.test.js views/class-view-teaser.test.js routes/classes-catalog-order.test.js routes/classes-redeem-onboarding.test.js test/app-engine-helpers.test.js`
Expected: PASS — `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add routes/classes.js routes/classes-edition-access.test.js views/classes.handlebars views/classes.test.js views/partials/class-group-card.handlebars views/class-view.handlebars views/class-view.test.js views/class-view-teaser.handlebars views/class-view-teaser.test.js
git commit -m "feat: tease locked editions in the class catalog and badge Advent classes during the trial

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Character sheet alert when descriptions were hidden by a lapsed trial

**Files:**
- Modify: `services/character/description-gate.js` (report `gated`)
- Modify: `routes/characters.js:25-51` (require), `routes/characters.js:1134-1140` (capture `gated`), `routes/characters.js:1224-1260` (render context)
- Modify: `views/character.handlebars:1`
- Modify: `routes/open-graph.test.js:57` (mock returns the new shape)
- Test: `services/character/description-gate.test.js`, `routes/characters-edition-access.test.js` (new), `views/character.test.js`

**Interfaces:**
- Consumes: `trialEndedAt` (Task 3), `access/trial-ended-alert` (Task 4).
- Produces:
  - `applyDescriptionGate(...) -> Promise<{ character, gated: boolean }>` — `gated` is true when any non-empty class-authored description (ability, gear, Default Enchantment) was blanked, including on the fail-closed path.
  - `character` render context: `adventTrialEndedAt: string|null` — set only when something was gated, the character's class is Advent, and Advent is expired.

- [ ] **Step 1: Write the failing tests**

In `services/character/description-gate.test.js`, replace the last two tests (`'returns the same character object it mutated'`, `'a character with no abilities or gear arrays passes through untouched'`) with:

```js
test('returns the same character object it mutated', async () => {
  const character = makeCharacter();
  const result = await applyDescriptionGate({ character, profile: null, client: {} });
  expect(result.character).toBe(character);
});

test('a character with no abilities or gear arrays passes through untouched and ungated', async () => {
  const character = { id: 'char-1' };
  const result = await applyDescriptionGate({ character, profile: null, client: {} });
  expect(result).toEqual({ character, gated: false });
});

test('a locked viewer losing a description is reported as gated', async () => {
  const result = await applyDescriptionGate({ character: makeCharacter(), profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expect(result.gated).toBe(true);
});

test('an unlocked viewer is not gated', async () => {
  state.unlockedIds = new Set(['class-a']);
  const result = await applyDescriptionGate({ character: makeCharacter(), profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expect(result.gated).toBe(false);
});

test('blanking descriptions that were already empty is not gating', async () => {
  const character = {
    id: 'char-1',
    abilities: [{ name: 'Fireball', description: '', class_id: 'class-a' }],
    gear: [{ name: 'Staff', description: '', class_id: 'class-a' }]
  };
  const result = await applyDescriptionGate({ character, profile: { id: 'p1', user_id: 'u1' }, client: {} });
  expect(result.gated).toBe(false);
});

test('the fail-closed path reports what it gated', async () => {
  state.unlocksThrow = true;
  const result = await applyDescriptionGate({ character: makeCharacter(), profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {} });
  expect(result.gated).toBe(true);
});
```

Create `routes/characters-edition-access.test.js`:

```js
// The character sheet, the wizard and the expert form read
// res.locals.editionAccess. freshRequire scaffold, render capture.
const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const { CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS } = require('../util/starter-content');
const realEditionAccess = require('../util/edition-access');

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const ADVENT_GUN = {
  id: CORE_CLASS_UNLOCKS.advent.Gunslinger[0], name: 'Gunslinger', base_class_id: null,
  rules_edition: 'advent', rules_version: 'v1', content_format: 'advent', status: 'release',
  is_public: true, is_player_created: false, prerelease_section: null, created_at: '2026-01-01T00:00:00Z',
  teaser: 'Quick on the draw.', overview: 'SECRET overview',
  abilities: [{ name: 'Deadeye', description: 'SECRET ability' }], gear: [{ name: 'Revolver', description: 'SECRET gear' }]
};
const ASPIRANT_GUN = {
  ...ADVENT_GUN, id: ASPIRANT_V1_CLASS_IDS.Gunslinger, base_class_id: ADVENT_GUN.id,
  rules_edition: 'aspirant', content_format: 'aspirant', teaser: 'Draws first, V1.', created_at: '2026-03-01T00:00:00Z'
};

const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };
const EXPIRED = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };

const state = {};
beforeEach(() => {
  state.editionAccess = EXPIRED;
  state.allowedIds = new Set();
  state.gated = true;
  state.characterClass = ADVENT_GUN;
});

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user', timezone: 'UTC' }),
    getProfileById: async () => ({ data: null, error: null }),
    getProfileConduitCredits: async () => ({ data: null, error: null })
  }],
  [require.resolve('../models/character'), {
    getCharacter: async () => ({
      data: {
        id: CHARACTER_ID, name: 'Vex', class_id: state.characterClass.id, creator_id: 'p1', is_public: true,
        level: 1, abilities: [], gear: [], traits: [], stat_cap_purchases: [], ability_perks: [], common_items: []
      },
      error: null
    }),
    getCharacterRecentMissions: async () => ({ data: [] })
  }],
  [require.resolve('../models/offscreen-mission'), { listOffscreenMissions: async () => ({ data: [] }) }],
  [require.resolve('../services/character/repository'), {
    getClassFamilyRows: async () => ({ data: [] }),
    getRealMissions: async () => ({ data: [] })
  }],
  [require.resolve('../services/character/description-gate'), {
    applyDescriptionGate: async ({ character }) => ({ character, gated: state.gated })
  }],
  [require.resolve('../models/class'), {
    getClass: async () => ({ data: state.characterClass, error: null }),
    getClasses: async (filters = {}) => {
      if (filters.is_player_created === true) return { data: [], error: null };
      if (filters.rules_edition === 'aspirant') return { data: [ASPIRANT_GUN], error: null };
      return { data: [ADVENT_GUN], error: null };
    },
    getUnlockedClassIdsForUser: async () => ({
      data: state.allowedIds,
      rosterIdsByEdition: { advent: new Set([ADVENT_GUN.id]), aspirant: new Set([ASPIRANT_GUN.id]) },
      error: null
    })
  }],
  [require.resolve('../util/edition-access'), {
    ...realEditionAccess,
    populateEditionAccess: async (req, res) => { res.locals.editionAccess = state.editionAccess; }
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), { populateNavItems: async () => {}, loadNavItems: (req, res, next) => next() }]
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(require('../util/open-graph').openGraphDefaults);
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/characters', freshRequire(require.resolve('./characters'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

const get = async (path) => {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer valid-jwt' } });
  expect(res.status).toBe(200);
  return res.json();
};

test('a sheet whose Advent descriptions were hidden by a lapsed trial says so', async () => {
  const { view, ctx } = await get(`/characters/${CHARACTER_ID}/Vex`);
  expect(view).toBe('character');
  expect(ctx.adventTrialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test('a sheet with nothing hidden carries no alert', async () => {
  state.gated = false;
  const { ctx } = await get(`/characters/${CHARACTER_ID}/Vex`);
  expect(ctx.adventTrialEndedAt).toBeNull();
});

test('an Aspirant character hidden from a lapsed Advent trialist does not blame the trial', async () => {
  state.characterClass = ASPIRANT_GUN;
  const { ctx } = await get(`/characters/${CHARACTER_ID}/Vex`);
  expect(ctx.adventTrialEndedAt).toBeNull();
});

test('a running trial carries no expiry alert', async () => {
  state.editionAccess = TRIAL;
  const { ctx } = await get(`/characters/${CHARACTER_ID}/Vex`);
  expect(ctx.adventTrialEndedAt).toBeNull();
});
```

In `views/character.test.js`, append:

```js
const fs = require('fs');
const path = require('path');

test('the sheet opens with the lapsed-trial alert, above the character name', () => {
  const src = fs.readFileSync(path.join(__dirname, 'character.handlebars'), 'utf8');
  const alertAt = src.indexOf('{{> access/trial-ended-alert lead="Ability and gear descriptions are hidden because" edition="advent" endedAt=adventTrialEndedAt}}');
  expect(alertAt).toBeGreaterThan(-1);
  expect(alertAt).toBeLessThan(src.indexOf('<h1'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/description-gate.test.js routes/characters-edition-access.test.js views/character.test.js`
Expected: FAIL — `result.character` is undefined (the gate returns the character itself), `ctx.adventTrialEndedAt` is undefined, and the source search returns -1.

- [ ] **Step 3: Write minimal implementation**

In `services/character/description-gate.js`, replace `blankDefaultEnchantment`, `blankAll` and `applyDescriptionGate` (everything from `const blankDefaultEnchantment` to the end of `applyDescriptionGate`) with:

```js
// Each blank reports whether it removed text, so the caller can tell the
// viewer that something was hidden.
const blankField = (item, key) => {
  if (!item[key]) return false;
  item[key] = '';
  return true;
};

const blankDefaultEnchantment = (gear) => {
  if (!gear.default_enchantment?.description) return false;
  gear.default_enchantment = { ...gear.default_enchantment, description: '' };
  return true;
};

const blankAll = (character) => {
  let gated = false;
  try {
    if (Array.isArray(character.abilities)) {
      for (const ability of character.abilities) {
        if (ability) gated = blankField(ability, 'description') || gated;
      }
    }
    if (Array.isArray(character.gear)) {
      for (const gear of character.gear) {
        if (gear) {
          gated = blankField(gear, 'description') || gated;
          gated = blankDefaultEnchantment(gear) || gated;
        }
      }
    }
  } catch (_) { /* ignore */ }
  return gated;
};

// Mutates class-authored descriptions on the character and reports whether
// any were hidden. Fails closed: any unexpected error blanks them rather than
// throwing.
const applyDescriptionGate = async ({ character, profile, userId = null, lfgPostId = null, client }) => {
  let gated = false;
  try {
    let hostingViaLfg = false;

    // If an LFG context is provided and the viewer hosts that post with this
    // character approved on it, allow full descriptions regardless of unlocks.
    if (profile && lfgPostId) {
      try {
        const { data: lfgPost } = await getLfgPost(lfgPostId, client);
        if (lfgPost && lfgPost.host_id === profile.id) {
          hostingViaLfg = Array.isArray(lfgPost.join_requests) && lfgPost.join_requests.some(r =>
            r && r.status === 'approved' && r.character && r.character.id === character.id
          );
        }
      } catch (_) { /* ignore; hostingViaLfg remains false */ }
    }

    if (!hostingViaLfg) {
      let unlockedClassIds = new Set();
      try {
        // Admin-backed lookup on purpose: the shared anon client no longer
        // carries the user's JWT, so RLS on class_unlocks would return zero
        // rows and wipe every description.
        const { data: ids, error } = await getUnlockedClassIdsForUser(userId || (profile && profile.user_id) || null);
        if (!error && ids instanceof Set) unlockedClassIds = ids;
      } catch (_) {
        unlockedClassIds = new Set();
      }

      if (Array.isArray(character.abilities)) {
        for (const ability of character.abilities) {
          if (ability && (
            (ability.class_id && !unlockedClassIds.has(ability.class_id)) ||
            (!ability.class_id && !profile)
          )) {
            gated = blankField(ability, 'description') || gated;
          }
        }
      }
      if (Array.isArray(character.gear)) {
        for (const gear of character.gear) {
          if (!gear) continue;
          if (
            (gear.class_id && !unlockedClassIds.has(gear.class_id)) ||
            (!gear.class_id && !profile)
          ) {
            gated = blankField(gear, 'description') || gated;
          }
          // A Default Enchantment comes from the class book, even if the
          // purchase row has no class_id. Without one, access cannot be proven.
          if (!gear.class_id || !unlockedClassIds.has(gear.class_id)) {
            gated = blankDefaultEnchantment(gear) || gated;
          }
        }
      }
    }
  } catch (_) {
    gated = blankAll(character) || gated;
  }
  return { character, gated };
};
```

In `routes/characters.js`, add after `const { renderMarkdown } = require('../util/markdown');`:

```js
const { trialEndedAt } = require('../util/edition-access');
```

In GET `/:id/:name?`, change `await applyDescriptionGate({` (line ~1134) to:

```js
      const { gated: descriptionsGated } = await applyDescriptionGate({
```

and in its `res.render('character', { ... })` add after `buildBreaches,`:

```js
        adventTrialEndedAt: descriptionsGated && characterClass?.rules_edition === 'advent'
          ? trialEndedAt(res.locals.editionAccess, 'advent')
          : null,
```

In `views/character.handlebars`, add after line 1 (`{{> breadcrumbs}}`):

```handlebars
{{#if adventTrialEndedAt}}
{{> access/trial-ended-alert lead="Ability and gear descriptions are hidden because" edition="advent" endedAt=adventTrialEndedAt}}
{{/if}}
```

In `routes/open-graph.test.js`, change line 57 to:

```js
mock.module('../services/character/description-gate', () => ({ applyDescriptionGate: async ({ character }) => ({ character, gated: false }) }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/character/description-gate.test.js routes/characters-edition-access.test.js views/character.test.js routes/open-graph.test.js routes/character-details.test.js`
Expected: PASS — `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add services/character/description-gate.js services/character/description-gate.test.js routes/characters.js routes/characters-edition-access.test.js views/character.handlebars views/character.test.js routes/open-graph.test.js
git commit -m "feat: tell a sheet's viewer when a lapsed Advent trial hid its descriptions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Locked classes in the wizard and expert form, and the picker alert

The wizard kiosk is drawn client-side from the `wizard-data` JSON. Locked classes are never added to that JSON (so they cannot be selected or leak content); the wizard renders them server-side beside the kiosk as disabled "Unlock to play" entries, and the expert form lists them as disabled `<option>`s in an edition `<optgroup>`. Only the new-character pages get them; the edit form's class is immutable.

**Files:**
- Modify: `routes/characters.js:43` (require), `routes/characters.js:97-166` (`filterClassDataForUser`), `routes/characters.js:202-240` (GET `/new/expert`), `routes/characters.js:243-385` (GET `/wizard`)
- Create: `views/partials/access/locked-class-list.handlebars`, `views/partials/access/locked-class-options.handlebars`
- Modify: `views/character-wizard.handlebars:55` (alert), `views/character-wizard.handlebars:127-129` (list), `views/character-form.handlebars:2` (alert), `views/character-form.handlebars:87` (options)
- Test: `routes/characters-edition-access.test.js` (append), `views/character-wizard.test.js`, `views/character-form.test.js`, `views/partials/access/locked-class.test.js` (new)

**Interfaces:**
- Consumes: `lockedRosterIds`, `getUnlockedClassIdsForUser(...).rosterIdsByEdition` (Task 7); `trialEndedAt` (Task 3); `access/unlock-cta`, `access/trial-ended-alert` (Task 4).
- Produces:
  - `filterClassDataForUser(user, editionAccess = null)` result gains `lockedClasses: { advent: LockedOption[], aspirant: LockedOption[] }`, `LockedOption = { id, name, rules_edition, content_format, teaser_html, locked: true }` (latest version per family, pre-release rows excluded).
  - Render context on `character-wizard` and `character-form` (new only): `lockedClassGroups: Array<{ edition, classes: LockedOption[] }>` (wizard filters by the mode's `content_format`; aspiring gets none) and `adventTrialEndedAt: string|null`.
  - Partials `access/locked-class-list` and `access/locked-class-options` (hash: `groups`).

- [ ] **Step 1: Write the failing tests**

Append to `routes/characters-edition-access.test.js`:

```js
const wizardIds = (ctx) => ctx.wizardData.classes.map(c => c.id);

test('a lapsed Advent trial keeps the Advent class in the wizard as a locked teaser only', async () => {
  const { view, ctx } = await get('/characters/wizard?mode=advent');
  expect(view).toBe('character-wizard');
  expect(ctx.lockedClassGroups).toEqual([{
    edition: 'advent',
    classes: [{
      id: ADVENT_GUN.id, name: 'Gunslinger', rules_edition: 'advent', content_format: 'advent',
      teaser_html: expect.stringContaining('Quick on the draw.'), locked: true
    }]
  }]);
  expect(JSON.stringify(ctx.lockedClassGroups)).not.toContain('SECRET');
  expect(wizardIds(ctx)).not.toContain(ADVENT_GUN.id);
  expect(ctx.adventTrialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test('the Aspirant wizard teases the Aspirant fork under Aspirant', async () => {
  const { ctx } = await get('/characters/wizard?mode=aspirant');
  expect(ctx.lockedClassGroups.map(g => ({ edition: g.edition, ids: g.classes.map(c => c.id) })))
    .toEqual([{ edition: 'aspirant', ids: [ASPIRANT_GUN.id] }]);
});

test('an Advent trial user plays the Advent class and sees only Aspirant locked', async () => {
  state.editionAccess = TRIAL;
  state.allowedIds = new Set([ADVENT_GUN.id]);
  const advent = (await get('/characters/wizard?mode=advent')).ctx;
  expect(advent.lockedClassGroups).toEqual([]);
  expect(wizardIds(advent)).toContain(ADVENT_GUN.id);
  expect(advent.adventTrialEndedAt).toBeNull();
  const aspirant = (await get('/characters/wizard?mode=aspirant')).ctx;
  expect(aspirant.lockedClassGroups.map(g => g.edition)).toEqual(['aspirant']);
});

test('the aspiring builder gets no locked list', async () => {
  const { ctx } = await get('/characters/wizard?mode=aspiring');
  expect(ctx.lockedClassGroups).toEqual([]);
});

test('the expert form lists both locked editions and the lapsed-trial alert', async () => {
  const { view, ctx } = await get('/characters/new/expert');
  expect(view).toBe('character-form');
  expect(ctx.lockedClassGroups.map(g => g.edition)).toEqual(['advent', 'aspirant']);
  expect(ctx.adventTrialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test('no edition status, no locked options', async () => {
  state.editionAccess = null;
  const { ctx } = await get('/characters/new/expert');
  expect(ctx.lockedClassGroups).toEqual([]);
  expect(ctx.adventTrialEndedAt).toBeNull();
});
```

Create `views/partials/access/locked-class.test.js`:

```js
const { test, expect } = require('bun:test');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../../util/handlebars');
const { registerAccessPartials } = require('../../../test/helpers/access-partials');

const render = (template, context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  registerAccessPartials(hb);
  return hb.compile(template)(context);
};

const GROUPS = [{ edition: 'aspirant', classes: [{ id: 'bers', name: 'Berserker', teaser_html: '<p>Rage.</p>', locked: true }] }];

test('the form lists a locked class as a disabled option in its edition group', () => {
  const html = render('<select>{{> access/locked-class-options groups=groups}}</select>', { groups: GROUPS });
  expect(html).toContain('<optgroup label="Locked — Aspirant">');
  expect(html).toContain('<option value="" disabled>Berserker — Unlock to play</option>');
});

test('the wizard lists a locked class as a disabled entry with its teaser and CTA', () => {
  const html = render('{{> access/locked-class-list groups=groups}}', { groups: GROUPS });
  expect(html).toContain('Locked — Aspirant');
  expect(html).toContain('disabled aria-disabled="true">Berserker — Unlock to play</button>');
  expect(html).toContain('<p>Rage.</p>');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822771');
});

test('no groups render nothing', () => {
  expect(render('{{> access/locked-class-list groups=groups}}', { groups: [] }).trim()).toBe('');
  expect(render('{{> access/locked-class-options groups=groups}}', {}).trim()).toBe('');
});
```

In `views/character-wizard.test.js`, add to the requires:

```js
const { registerAccessPartials } = require('../test/helpers/access-partials');
```

replace `renderWizardView` with:

```js
const renderWizardView = ({ mode, wizardData, ...extra }) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  registerAccessPartials(hb);
  return hb.compile(SRC)({
    mode,
    economy: economyFigures(),
    state: {},
    wizardData,
    ...extra
  });
};
```

and append:

```js
const LOCKED = [{ edition: 'aspirant', classes: [{ id: 'bers', name: 'Berserker', teaser_html: '<p>Rage.</p>', locked: true }] }];

test('locked classes sit beside the kiosk as disabled Unlock to play entries', () => {
  const html = renderWizardView({ mode: 'advent', wizardData: fixture({ mode: 'advent' }), lockedClassGroups: LOCKED });
  const lockedAt = html.indexOf('Berserker — Unlock to play');
  expect(lockedAt).toBeGreaterThan(html.indexOf('id="classKiosk"'));
  expect(lockedAt).toBeLessThan(html.indexOf('id="selectedClassPanel"'));
});

test('a lapsed trial alerts above the class pickers', () => {
  const html = renderWizardView({
    mode: 'advent', wizardData: fixture({ mode: 'advent' }),
    profile: { timezone: 'UTC' }, adventTrialEndedAt: '2026-09-20T12:00:00Z'
  });
  const alertAt = html.indexOf('Advent classes are locked because your Advent free trial ended Sep 20, 2026.');
  expect(alertAt).toBeGreaterThan(-1);
  expect(alertAt).toBeLessThan(html.indexOf('id="classKiosk"'));
});

test('the aspiring builder shows no locked list', () => {
  const html = renderWizardView({ mode: 'aspiring', wizardData: fixture({ mode: 'aspiring' }), lockedClassGroups: LOCKED });
  expect(html).not.toContain('Unlock to play');
});
```

In `views/character-form.test.js`, append:

```js
test('locked classes are listed inside the class select, after the playable ones', () => {
  const html = source();
  const lockedAt = html.indexOf('{{> access/locked-class-options groups=lockedClassGroups}}');
  expect(lockedAt).toBeGreaterThan(html.indexOf('id="char-class-id"'));
  expect(lockedAt).toBeGreaterThan(html.indexOf('{{#each playerCreatedAspirantV2Classes}}'));
  expect(lockedAt).toBeLessThan(html.indexOf('</select>'));
});

test('a lapsed trial alerts above the class select', () => {
  const html = source();
  const alertAt = html.indexOf('{{> access/trial-ended-alert lead="Advent classes are locked because" edition="advent" endedAt=adventTrialEndedAt}}');
  expect(alertAt).toBeGreaterThan(-1);
  expect(alertAt).toBeLessThan(html.indexOf('id="char-class-id"'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters-edition-access.test.js views/partials/access/locked-class.test.js views/character-wizard.test.js views/character-form.test.js`
Expected: FAIL — `ctx.lockedClassGroups` is undefined, `The partial access/locked-class-options could not be found`, and the source searches return -1.

- [ ] **Step 3: Write minimal implementation**

In `routes/characters.js`, change line 43 to:

```js
const { filterClassListsByIds, isUnreleasedPcc, lockedRosterIds } = require('../util/class-filter');
```

Add directly above `// Helper to filter class lists/lookup maps by user's unlocked classes`:

```js
const LOCKABLE_EDITIONS = ['advent', 'aspirant'];

// A locked class reaches the picker as its name and teaser only: nothing a
// player could build a character from.
const toLockedOption = (c) => ({
  id: c.id,
  name: c.name,
  rules_edition: c.rules_edition || 'advent',
  content_format: c.content_format || 'advent',
  teaser_html: renderMarkdown(c.teaser || ''),
  locked: true
});

const lockedClassGroupsFor = (lockedClasses, keep = () => true) => LOCKABLE_EDITIONS
  .map(edition => ({ edition, classes: lockedClasses[edition].filter(keep) }))
  .filter(group => group.classes.length > 0);
```

In `filterClassDataForUser`, change the signature to:

```js
const filterClassDataForUser = async (user, editionAccess = null) => {
```

replace the block

```js
  if (user) {
    const { data: allowedIds } = await getUnlockedClassIdsForUser(user.id);
```

with:

```js
  let lockedClasses = { advent: [], aspirant: [] };
  if (user) {
    const { data: allowedIds, rosterIdsByEdition } = await getUnlockedClassIdsForUser(user.id);
    const lockedIds = lockedRosterIds(editionAccess, rosterIdsByEdition, allowedIds || new Set());
    const releasedOfficials = [...advent, ...aspirant].filter(c => !c.prerelease_section);
    lockedClasses = Object.fromEntries(LOCKABLE_EDITIONS.map(edition => [
      edition,
      latestClassVersions(releasedOfficials.filter(c => lockedIds[edition]?.has(c.id))).map(toLockedOption)
    ]));
```

and add `lockedClasses` to the returned object (after `filteredAbilities`).

In GET `/new/expert`, change the destructuring to add `lockedClasses` and pass the status:

```js
  const { filteredAdventV1, filteredAdventV2, filteredAspirantV1, filteredAspirantV2, filteredPCCAdventV1, filteredPCCAdventV2, filteredPCCAspirantV1, filteredPCCAspirantV2, filteredGear, filteredAbilities, lockedClasses } = await filterClassDataForUser(user, res.locals.editionAccess);
```

and add to its `res.render('character-form', { ... })` after `classAbilityList: filteredAbilities,`:

```js
    lockedClassGroups: lockedClassGroupsFor(lockedClasses),
    adventTrialEndedAt: trialEndedAt(res.locals.editionAccess, 'advent'),
```

In GET `/wizard`, change the destructuring to:

```js
  const { filteredAdvent, filteredAspirant, filteredPCC, lockedClasses } = await filterClassDataForUser(user, res.locals.editionAccess);
```

and add to `res.render('character-wizard', { ... })` after `wizardClasses,`:

```js
    lockedClassGroups: mode === 'aspiring' ? [] : lockedClassGroupsFor(lockedClasses, (c) => c.content_format === mode),
    adventTrialEndedAt: trialEndedAt(res.locals.editionAccess, 'advent'),
```

Create `views/partials/access/locked-class-options.handlebars`:

```handlebars
{{#each groups}}
<optgroup label="Locked — {{edition_label edition}}">
  {{#each classes}}
  <option value="" disabled>{{name}} — Unlock to play</option>
  {{/each}}
</optgroup>
{{/each}}
```

Create `views/partials/access/locked-class-list.handlebars`:

```handlebars
{{#each groups}}
<div class="box mt-4 wizard-locked-classes" data-locked-edition="{{edition}}">
  <h4 class="title is-6 mb-2">
    <span class="icon has-text-grey"><i class="fas fa-lock"></i></span>
    <span>Locked — {{edition_label edition}}</span>
  </h4>
  <ul class="mb-3">
    {{#each classes}}
    <li class="mb-3">
      <button type="button" class="button is-small" disabled aria-disabled="true">{{name}} — Unlock to play</button>
      <div class="content is-size-7 has-text-grey mt-1">{{{teaser_html}}}</div>
    </li>
    {{/each}}
  </ul>
  {{> access/unlock-cta edition=edition}}
</div>
{{/each}}
```

In `views/character-wizard.handlebars`, add directly after line 55 (`<section class="wizard-step" data-step-panel="1" hidden>`):

```handlebars
  {{#if adventTrialEndedAt}}
  {{> access/trial-ended-alert lead="Advent classes are locked because" edition="advent" endedAt=adventTrialEndedAt}}
  {{/if}}
```

and between the `</div>` that closes `#classKiosk` and `<div class="box mt-4" id="selectedClassPanel">`:

```handlebars

  {{> access/locked-class-list groups=lockedClassGroups}}
```

In `views/character-form.handlebars`, add after line 2 (the `<h2>`):

```handlebars
{{#if adventTrialEndedAt}}
{{> access/trial-ended-alert lead="Advent classes are locked because" edition="advent" endedAt=adventTrialEndedAt}}
{{/if}}
```

and directly before the class select's `</select>` (after the `playerCreatedAspirantV2Classes` block's `{{/if}}`):

```handlebars
          {{> access/locked-class-options groups=lockedClassGroups}}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/characters-edition-access.test.js views/partials/access/locked-class.test.js views/character-wizard.test.js views/character-form.test.js routes/character-wizard-classes.test.js routes/characters-wizard-data.test.js`
Expected: PASS — `0 fail`. The server-side rejection of a locked class is untouched: `git diff --stat routes/characters.js` shows no change to the POST handlers.

- [ ] **Step 5: Commit**

```bash
git add routes/characters.js routes/characters-edition-access.test.js views/partials/access/locked-class-list.handlebars views/partials/access/locked-class-options.handlebars views/partials/access/locked-class.test.js views/character-wizard.handlebars views/character-wizard.test.js views/character-form.handlebars views/character-form.test.js
git commit -m "feat: list locked classes in the character pickers as disabled Unlock to play entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Library TRIAL badge and the locked rulebook page

**Files:**
- Modify: `routes/library.js:24-30` (requires), `routes/library.js:387-401` (the 403)
- Create: `views/library-locked.handlebars`
- Modify: `views/library.handlebars:64-93`
- Test: `routes/library-locked.test.js` (new), `views/library.test.js` (new), `views/library-locked.test.js` (new)

**Interfaces:**
- Consumes: `trialEndedAt` (Task 3); partials (Task 4).
- Produces: `library-locked` view, rendered with HTTP 403 and context `{ profile, rulesPdf, edition: string|null, trialEndedAt: string|null, breadcrumbs }`. `edition` is the book's `rules_edition` only for `book_type === 'core'`. Non-boosted htmx and non-HTML requests keep `sendError` (403).

- [ ] **Step 1: Write the failing tests**

Create `routes/library-locked.test.js`:

```js
// GET /library/:id/view without access stays a 403, but names a lapsed trial
// and offers the edition's unlock. Scaffold from routes/library-view-onboarding.test.js.
const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const realEditionAccess = require('../util/edition-access');

const ADVENT_ID = '33333333-3333-4333-8333-333333333333';
const SUPPLEMENT_ID = '44444444-4444-4444-8444-444444444444';
const RULES_BY_ID = {
  [ADVENT_ID]: { id: ADVENT_ID, title: 'Enclave: Advent', storage_path: 'advent.pdf', free_access: false, book_type: 'core', rules_edition: 'advent' },
  [SUPPLEMENT_ID]: { id: SUPPLEMENT_ID, title: 'GM Screen', storage_path: 'gm.pdf', free_access: false, book_type: 'supplement', rules_edition: 'advent' }
};

const state = {};
beforeEach(() => {
  state.editionAccess = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };
});

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user', timezone: 'UTC' }),
    patchOnboarding: async () => ({ data: {}, error: null })
  }],
  [require.resolve('../models/rules'), {
    getRulesPdf: async (id) => ({ data: RULES_BY_ID[id] || null, error: RULES_BY_ID[id] ? null : { message: 'not found' } }),
    canViewRulesPdf: async () => ({ data: false, error: null })
  }],
  [require.resolve('../models/pdf'), {
    storeRulesPdf: async () => ({ data: null, error: null }),
    deletePdfObject: async () => ({ error: null }),
    getSignedPdfUrl: async () => ({ data: 'https://signed.example/pdf', error: null }),
    RULES_PDF_BUCKET: 'rules-pdfs'
  }],
  [require.resolve('../util/edition-access'), {
    ...realEditionAccess,
    populateEditionAccess: async (req, res) => { res.locals.editionAccess = state.editionAccess; }
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), { populateNavItems: async () => {}, loadNavItems: (req, res, next) => next() }]
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/library', freshRequire(require.resolve('./library'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

const open = (id, headers = { Authorization: 'Bearer valid-jwt' }) => fetch(`${baseUrl}/library/${id}/view`, { headers });

test('a lapsed trial gets a 403 page naming when it ended', async () => {
  const res = await open(ADVENT_ID);
  expect(res.status).toBe(403);
  const { view, ctx } = await res.json();
  expect(view).toBe('library-locked');
  expect(ctx.edition).toBe('advent');
  expect(ctx.trialEndedAt).toBe('2026-09-20T12:00:00Z');
});

test('never having had access gets the generic locked page with the edition CTA', async () => {
  state.editionAccess = { advent: { state: 'none' }, aspirant: { state: 'none' } };
  const res = await open(ADVENT_ID);
  expect(res.status).toBe(403);
  const { view, ctx } = await res.json();
  expect(view).toBe('library-locked');
  expect(ctx.edition).toBe('advent');
  expect(ctx.trialEndedAt).toBeNull();
});

test('a supplement names no edition, so its CTA is redeem-only', async () => {
  const { ctx } = await (await open(SUPPLEMENT_ID)).json();
  expect(ctx.edition).toBeNull();
  expect(ctx.trialEndedAt).toBeNull();
});

test('a signed-out visitor gets the locked page without a trial notice', async () => {
  const res = await open(ADVENT_ID, {});
  expect(res.status).toBe(403);
  const { view, ctx } = await res.json();
  expect(view).toBe('library-locked');
  expect(ctx.trialEndedAt).toBeNull();
});

test('a non-boosted htmx request keeps the inline 403', async () => {
  const res = await open(ADVENT_ID, { Authorization: 'Bearer valid-jwt', 'HX-Request': 'true', 'HX-Target': 'alerts' });
  expect(res.status).toBe(403);
  expect((await res.json()).view).toBe('error-inline');
});
```

Create `views/library-locked.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const { registerAccessPartials } = require('../test/helpers/access-partials');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', '');
  registerAccessPartials(hb);
  return hb.compile(fs.readFileSync(path.join(__dirname, 'library-locked.handlebars'), 'utf8'))({
    profile: { timezone: 'UTC' },
    rulesPdf: { id: 'adv', title: 'Enclave: Advent' },
    ...context
  });
};

test('a lapsed trial names the end date and offers the Advent CTA', () => {
  const html = render({ edition: 'advent', trialEndedAt: '2026-09-20T12:00:00Z' });
  expect(html).toContain('Enclave: Advent is locked');
  expect(html).toContain('Your Advent free trial ended Sep 20, 2026.');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822768');
});

test('otherwise it is a generic locked message with the CTA', () => {
  const html = render({ edition: 'advent', trialEndedAt: null });
  expect(html).toContain('You need an unlock to read this rulebook.');
  expect(html).not.toContain('free trial ended');
  expect(html).toContain('Buy Advent');
});

test('a book with no edition gets a redeem-only CTA', () => {
  const html = render({ edition: null, trialEndedAt: null });
  expect(html).not.toContain('Buy ');
  expect(html).toContain('Redeem a code');
});
```

Create `views/library.test.js`:

```js
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const { registerAccessPartials } = require('../test/helpers/access-partials');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', '');
  registerAccessPartials(hb);
  return hb.compile(fs.readFileSync(path.join(__dirname, 'library.handlebars'), 'utf8'))({
    profile: { timezone: 'UTC' },
    ...context
  });
};

const book = (over = {}) => ({
  primary: {
    id: 'adv', title: 'Enclave: Advent', edition: 'v1', book_type: 'core', rules_edition: 'advent',
    canView: true, isUnlocked: true, expires_at: '2026-10-08T12:00:00Z', ...over
  },
  previous: []
});
const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };

test('the Advent book card carries the TRIAL badge during the trial', () => {
  const html = render({ ruleGroups: [book()], editionAccess: TRIAL });
  expect(html).toContain('TRIAL · ends Oct 8, 2026');
});

test('a supplement card never carries the TRIAL badge', () => {
  const html = render({ ruleGroups: [book({ book_type: 'supplement', title: 'GM Screen' })], editionAccess: TRIAL });
  expect(html).not.toContain('TRIAL ·');
});

test('a lapsed core book card offers its edition CTA', () => {
  const html = render({
    ruleGroups: [book({ canView: false, isUnlocked: true, expires_at: '2026-09-20T12:00:00Z' })],
    editionAccess: { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } }
  });
  expect(html).toContain('Access expired');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822768');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/library-locked.test.js views/library-locked.test.js views/library.test.js`
Expected: FAIL — the route answers view `error` rather than `library-locked`, `library-locked.handlebars` does not exist (`ENOENT`), and the library card has no `TRIAL ·`.

- [ ] **Step 3: Write minimal implementation**

In `routes/library.js`, add after `const { actorFromLocals } = require('../util/actor');`:

```js
const { trialEndedAt } = require('../util/edition-access');

// A core rulebook names the edition it belongs to, so the locked page can say
// why access is missing (a lapsed trial) and offer that edition's unlock.
const sendLockedRulesPdf = (req, res, rulesPdf) => {
    const isFragment = req.get('HX-Request') && !req.get('HX-Boosted');
    if (isFragment || !req.accepts('html')) {
        return sendError(req, res, null, { status: 403, title: 'No access', message: 'You do not have access to this rules PDF' });
    }
    const edition = rulesPdf.book_type === 'core' ? (rulesPdf.rules_edition || null) : null;
    return res.status(403).render('library-locked', {
        profile: res.locals.profile,
        title: `${rulesPdf.title} - Locked`,
        rulesPdf,
        edition,
        trialEndedAt: edition ? trialEndedAt(res.locals.editionAccess, edition) : null,
        activeNav: 'library',
        breadcrumbs: [
            { label: 'Library', href: '/library' },
            { label: rulesPdf.title, href: `/library/${rulesPdf.id}/view` }
        ]
    });
};
```

and replace

```js
    if (!canView) {
        return sendError(req, res, null, { status: 403, title: 'No access', message: 'You do not have access to this rules PDF' });
    }
```

with:

```js
    if (!canView) {
        return sendLockedRulesPdf(req, res, rulesPdf);
    }
```

Create `views/library-locked.handlebars`:

```handlebars
{{> breadcrumbs}}
<div class="notification is-danger is-light" role="alert" data-library-locked>
  <h1 class="title is-4">
    <span class="icon"><i class="fas fa-lock"></i></span>
    <span>{{rulesPdf.title}} is locked</span>
  </h1>
  {{#if trialEndedAt}}
  <p class="block">Your {{edition_label edition}} free trial ended {{date_tz trialEndedAt "MMM D, YYYY" profile.timezone}}. The rulebook stays locked until you unlock {{edition_label edition}}.</p>
  {{else}}
  <p class="block">You need an unlock to read this rulebook.</p>
  {{/if}}
  {{> access/unlock-cta edition=edition}}
  <a class="button is-text" href="/library">Back to the library</a>
</div>
```

In `views/library.handlebars`, inside the "Access granted" notification, replace:

```handlebars
            {{#if this.primary.expires_at}}
            <br>
            <span class="is-size-7">Expires {{date_tz this.primary.expires_at}}</span>
            {{/if}}
```

with:

```handlebars
            {{#if (and (eq this.primary.book_type 'core') (eq this.primary.rules_edition 'advent') (eq @root.editionAccess.advent.state 'trial') this.primary.expires_at)}}
            <br>
            {{> access/trial-badge status=@root.editionAccess.advent}}
            {{else if this.primary.expires_at}}
            <br>
            <span class="is-size-7">Expires {{date_tz this.primary.expires_at}}</span>
            {{/if}}
```

and inside the "Access expired" notification, after its closing `</span>` of `icon-text`, add:

```handlebars
            {{#if (eq this.primary.book_type 'core')}}
            {{> access/unlock-cta edition=this.primary.rules_edition}}
            {{/if}}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test routes/library-locked.test.js views/library-locked.test.js views/library.test.js routes/library-view-onboarding.test.js`
Expected: PASS — `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add routes/library.js routes/library-locked.test.js views/library-locked.handlebars views/library-locked.test.js views/library.handlebars views/library.test.js
git commit -m "feat: explain a locked rulebook and badge the Advent book during the trial

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Edition upsell on home and profile, and profile TRIAL badges

**Files:**
- Create: `services/access/upsell.js`, `views/partials/access/edition-upsell.handlebars`
- Modify: `routes/home.js:1-30`, `views/home.handlebars:4`
- Modify: `routes/profile.js:1-16` (requires), `routes/profile.js:18-52` (GET `/`), `views/profile.handlebars:74-78` (Access cell), `views/profile.handlebars:97` (end)
- Modify: `views/home.test.js:24-33` (harness), `views/profile.test.js:10-24` (harness)
- Test: `services/access/upsell.test.js` (new), `routes/home-edition-access.test.js` (new), `routes/profile-edition-access.test.js` (new), `views/home.test.js`, `views/profile.test.js`

**Interfaces:**
- Consumes: `isLockedStatus` (Task 1), `trialStatus` (Task 3), `classRowsByIds` (`services/class/repository.js`), partials (Task 4).
- Produces:
  - `getEditionUpsell(editionAccess, deps = { classRowsByIds }) -> Promise<Array<{ edition, label, count, classes: Array<{ id, name, teaser: string|null }> }>>` — one entry per locked edition, in roster order; `[]` on no status or any failure.
  - `access/edition-upsell` partial (hash: `upsell`).
  - Render context: `home` gains `editionUpsell`; `profile` gains `editionUpsell` and `adventTrial`.

- [ ] **Step 1: Write the failing tests**

Create `services/access/upsell.test.js`:

```js
const { test, expect } = require('bun:test');
const { getEditionUpsell } = require('./upsell');
const { CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS } = require('../../util/starter-content');

const rowsFor = (ids) => ids.map((id, i) => ({ id, name: `Class ${i}`, teaser: i === 0 ? null : `Teaser ${i}.`, overview: 'not sent' }));
const recorder = () => {
  const calls = [];
  return { calls, deps: { classRowsByIds: async (ids) => { calls.push(ids); return { data: rowsFor(ids), error: null }; } } };
};

test('a lapsed Advent and an unowned Aspirant each get a panel of their own printings', async () => {
  const { calls, deps } = recorder();
  const upsell = await getEditionUpsell({ advent: { state: 'expired', endedAt: 'x' }, aspirant: { state: 'none' } }, deps);

  expect(calls[0]).toEqual(Object.values(CORE_CLASS_UNLOCKS.advent).map(ids => ids[0]));
  expect(new Set(calls[1])).toEqual(new Set(Object.values(ASPIRANT_V1_CLASS_IDS)));
  expect(upsell.map(u => ({ edition: u.edition, label: u.label, count: u.count }))).toEqual([
    { edition: 'advent', label: 'Advent', count: 6 },
    { edition: 'aspirant', label: 'Aspirant', count: 12 }
  ]);
  expect(upsell[0].classes[1]).toEqual({ id: calls[0][1], name: 'Class 1', teaser: 'Teaser 1.' });
  expect(upsell[0].classes[0].teaser).toBeNull();
});

test('a trial or owned edition gets no panel', async () => {
  const { calls, deps } = recorder();
  const upsell = await getEditionUpsell({ advent: { state: 'trial' }, aspirant: { state: 'owned' } }, deps);
  expect(upsell).toEqual([]);
  expect(calls).toHaveLength(0);
});

test('no edition status, no panels', async () => {
  const { deps } = recorder();
  expect(await getEditionUpsell(null, deps)).toEqual([]);
  expect(await getEditionUpsell(undefined, deps)).toEqual([]);
});

test('a failed class read drops the panels rather than the page', async () => {
  const upsell = await getEditionUpsell({ advent: { state: 'none' }, aspirant: { state: 'none' } }, {
    classRowsByIds: async () => ({ data: null, error: { message: 'boom' } })
  });
  expect(upsell).toEqual([]);
});
```

Create `routes/home-edition-access.test.js`:

```js
const { test, expect, beforeAll, afterAll, beforeEach } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const realEditionAccess = require('../util/edition-access');

const EXPIRED = { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } };
const UPSELL = [{ edition: 'advent', label: 'Advent', count: 1, classes: [{ id: 'g', name: 'Gunslinger', teaser: 'Quick.' }] }];

const state = {};
beforeEach(() => {
  state.sectionsArgs = null;
  state.upsellArgs = [];
});

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'user', name: 'Vex', onboarding: { dismissed: true } }),
    patchOnboarding: async () => ({ data: {}, error: null })
  }],
  [require.resolve('../services/home/sections'), {
    loadHomeSections: async (args) => {
      state.sectionsArgs = args;
      return { hasCharacters: false, recentMine: [], upcomingGames: [], news: [], community: [], onboarding: { show: false } };
    }
  }],
  [require.resolve('../models/pages'), { getAllNews: async () => ({ data: [], error: null }) }],
  [require.resolve('../services/access/upsell'), {
    getEditionUpsell: async (editionAccess) => { state.upsellArgs.push(editionAccess); return UPSELL; }
  }],
  [require.resolve('../util/edition-access'), {
    ...realEditionAccess,
    populateEditionAccess: async (req, res) => { res.locals.editionAccess = EXPIRED; }
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), { populateNavItems: async () => {}, loadNavItems: (req, res, next) => next() }]
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/', freshRequire(require.resolve('./home'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

test('a signed-in home hands its edition status to onboarding and renders the upsell', async () => {
  const res = await fetch(`${baseUrl}/`, { headers: { Authorization: 'Bearer valid-jwt' } });
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('home');
  expect(state.sectionsArgs.editionAccess).toEqual(EXPIRED);
  expect(state.upsellArgs).toEqual([EXPIRED]);
  expect(ctx.editionUpsell).toEqual(UPSELL);
});

test('a signed-out home has no upsell and looks nothing up', async () => {
  const res = await fetch(`${baseUrl}/`);
  const { ctx } = await res.json();
  expect(ctx.editionUpsell).toEqual([]);
  expect(state.upsellArgs).toEqual([]);
});
```

Create `routes/profile-edition-access.test.js`:

```js
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { freshRequire } = require('../test/helpers/fresh-require');
const realEditionAccess = require('../util/edition-access');

const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };
const UPSELL = [{ edition: 'aspirant', label: 'Aspirant', count: 1, classes: [{ id: 'b', name: 'Berserker', teaser: 'Rage.' }] }];
const upsellArgs = [];

const overrides = new Map([
  [require.resolve('../models/_base'), { supabase: {}, supabaseAdmin: {}, anonKey: 'test-anon-key', createUserClient: () => ({}) }],
  [require.resolve('../models/auth'), { getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false) }],
  [require.resolve('../models/profile'), {
    getProfile: async () => ({ id: 'p1', user_id: 'u1', name: 'Vex', role: 'user' }),
    updateUser: async () => ({ data: null, error: null }),
    getProfileByName: async () => ({ data: null, error: null }),
    setDiscordId: async () => ({ error: null }),
    searchProfiles: async () => ({ data: [], error: null }),
    getProfileConduitCredits: async () => ({ data: { earned: 0, spent_linked: 0, balance: 0 }, error: null }),
    patchOnboarding: async () => ({ data: {}, error: null })
  }],
  [require.resolve('../services/home/onboarding'), { loadOnboarding: async () => ({ show: false, askPath: false, path: null }) }],
  [require.resolve('../models/character'), { getPublicCharactersByCreator: async () => ({ data: [], error: null }) }],
  [require.resolve('../models/class'), {
    getClasses: async () => ({ data: [], error: null }),
    getUnlockedClasses: async () => ({ data: [], error: null })
  }],
  [require.resolve('../models/agent-token'), {
    createAgentToken: async () => ({ data: null, error: null }),
    listAgentTokens: async () => ({ data: [], error: null }),
    revokeAgentToken: async () => ({ data: null, error: null })
  }],
  [require.resolve('../models/badge'), { getProfileBadges: async () => ({ data: null, error: null }) }],
  [require.resolve('../services/access/upsell'), {
    getEditionUpsell: async (editionAccess) => { upsellArgs.push(editionAccess); return UPSELL; }
  }],
  [require.resolve('../util/edition-access'), {
    ...realEditionAccess,
    populateEditionAccess: async (req, res) => { res.locals.editionAccess = TRIAL; }
  }],
  [require.resolve('../util/system-message'), { getSystemMessage: () => null }],
  [require.resolve('../models/lfg'), { getPendingJoinRequestCount: async () => ({ count: 0 }) }],
  [require.resolve('../util/nav-loader'), { populateNavItems: async () => {}, loadNavItems: (req, res, next) => next() }]
]);

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({ view, ctx: ctx || {} });
    next();
  });
  app.use('/profile', freshRequire(require.resolve('./profile'), overrides));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
});

test('the profile carries the Advent trial for its badges and the upsell for locked editions', async () => {
  const res = await fetch(`${baseUrl}/profile`, { headers: { Authorization: 'Bearer valid-jwt' } });
  expect(res.status).toBe(200);
  const { view, ctx } = await res.json();
  expect(view).toBe('profile');
  expect(ctx.adventTrial).toEqual(TRIAL.advent);
  expect(ctx.editionUpsell).toEqual(UPSELL);
  expect(upsellArgs).toEqual([TRIAL]);
});
```

In `views/home.test.js`, add to the requires:

```js
const customHelpers = require('../util/handlebars');
const { registerAccessPartials } = require('../test/helpers/access-partials');
```

inside `render`, after `hb.registerHelper('date_tz', dateTzStub);` add:

```js
  hb.registerHelper('edition_label', customHelpers.edition_label);
  hb.registerHelper('edition_purchase_url', customHelpers.edition_purchase_url);
  registerAccessPartials(hb);
```

and append:

```js
const UPSELL = [{ edition: 'aspirant', label: 'Aspirant', count: 1, classes: [{ id: 'b', name: 'Berserker', teaser: 'Rage.' }] }];

test('the edition upsell renders for a signed-in player even with onboarding dismissed', () => {
  const html = render({ ...empty, profile: { name: 'Vex' }, hasCharacters: true, onboarding: { show: false }, editionUpsell: UPSELL });
  expect(html).toContain('Aspirant: 1 class');
  expect(html).toContain('Berserker');
  expect(html).toContain('Rage.');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822771');
});

test('a signed-out visitor never sees the upsell', () => {
  expect(render({ ...empty, profile: null, editionUpsell: UPSELL })).not.toContain('Aspirant: 1 class');
});
```

In `views/profile.test.js`, add to the requires:

```js
const { registerAccessPartials } = require('../test/helpers/access-partials');
```

add `registerAccessPartials(hb);` inside `renderProfile` before `const src`, and append:

```js
const TRIAL = { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false };

test("an Advent class from the trial book carries the TRIAL badge", () => {
  const html = renderProfile({
    ...baseContext,
    profile: { ...baseContext.profile, timezone: 'UTC' },
    adventTrial: TRIAL,
    unlockedClasses: [{ ...CLASS_TEMPORARY, unlock_source: 'book', unlock_book_title: 'Enclave: Advent' }]
  });
  expect(html).toContain('TRIAL · ends Oct 8, 2026');
});

test('a directly unlocked Advent class keeps its plain Expires tag during the trial', () => {
  const html = renderProfile({ ...baseContext, adventTrial: TRIAL, unlockedClasses: [{ ...CLASS_TEMPORARY, unlock_source: 'direct' }] });
  expect(html).not.toContain('TRIAL ·');
  expect(html).toContain('Expires');
});

test('the profile shows an upsell panel per locked edition', () => {
  const html = renderProfile({
    ...baseContext,
    unlockedClasses: [CLASS_PERMANENT],
    editionUpsell: [{ edition: 'aspirant', label: 'Aspirant', count: 2, classes: [
      { id: 'b', name: 'Berserker', teaser: 'Rage.' }, { id: 'v', name: 'Vessel', teaser: null }
    ] }]
  });
  expect(html).toContain('Aspirant: 2 classes');
  expect(html).toContain('href="/classes/b/Berserker"');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/access/upsell.test.js routes/home-edition-access.test.js routes/profile-edition-access.test.js views/home.test.js views/profile.test.js`
Expected: FAIL — `Cannot find module './upsell'`, `ctx.editionUpsell` undefined, and the view assertions do not match.

- [ ] **Step 3: Write minimal implementation**

Create `services/access/upsell.js`:

```js
const { CORE_CLASS_UNLOCKS, EDITION_LABELS } = require('../../util/starter-content');
const classRepository = require('../class/repository');
const { isLockedStatus } = require('./edition-status');

// The row each roster name is shown by: an Aspirant name lists its
// pre-release parent first and the edition's own printing last.
const showcaseIds = (edition) => Object.values(CORE_CLASS_UNLOCKS[edition]).map(ids => ids[ids.length - 1]);

const defaultDeps = { classRowsByIds: (ids) => classRepository.classRowsByIds(ids) };

const getEditionUpsell = async (editionAccess, deps = defaultDeps) => {
  if (!editionAccess) return [];
  const editions = Object.keys(CORE_CLASS_UNLOCKS).filter(edition => isLockedStatus(editionAccess[edition]));
  try {
    return await Promise.all(editions.map(async (edition) => {
      const { data, error } = await deps.classRowsByIds(showcaseIds(edition));
      if (error) throw error;
      const classes = (data || []).map(({ id, name, teaser }) => ({ id, name, teaser: teaser || null }));
      return { edition, label: EDITION_LABELS[edition], count: classes.length, classes };
    }));
  } catch (err) {
    console.error('edition upsell lookup failed:', err);
    return [];
  }
};

module.exports = { getEditionUpsell };
```

Create `views/partials/access/edition-upsell.handlebars`:

```handlebars
{{#each upsell}}
<div class="box edition-upsell" data-upsell-edition="{{edition}}">
  <h3 class="title is-5">
    <span class="icon has-text-grey"><i class="fas fa-lock"></i></span>
    <span>{{label}}: {{count}} {{#if (eq count 1)}}class{{else}}classes{{/if}}</span>
  </h3>
  <ul class="mb-3">
    {{#each classes}}
    <li class="mb-1"><a href="/classes/{{id}}/{{name}}"><strong>{{name}}</strong></a>{{#if teaser}} — {{teaser}}{{/if}}</li>
    {{/each}}
  </ul>
  {{> access/unlock-cta edition=edition}}
</div>
{{/each}}
```

In `routes/home.js`, add after `const { patchOnboarding } = require('../models/profile');`:

```js
const { getEditionUpsell } = require('../services/access/upsell');
```

and replace the body of GET `/` from `const sections = ...` through the `res.render('home', ...)` call with:

```js
  const [sections, editionUpsell] = await Promise.all([
    loadHomeSections({ profile, client: res.locals.supabase, editionAccess: res.locals.editionAccess }),
    profile ? getEditionUpsell(res.locals.editionAccess) : []
  ]);

  if (sections.onboarding?.persistDismiss && res.locals.user) {
    // Fire-and-forget: the gate/completion write must never delay the page.
    patchOnboarding(res.locals.user.id, { dismissed: true }).catch(() => {});
  }

  res.render('home', {
    profile,
    authOptional: true,
    editionUpsell,
    ...sections
  });
```

(keep the existing explanatory comment above the old `loadHomeSections` call, now above the `Promise.all`).

In `views/home.handlebars`, add after line 4 (`{{> home-onboarding}}`):

```handlebars
  {{> access/edition-upsell upsell=editionUpsell}}
```

In `routes/profile.js`, add after `const { asyncHandler } = require('../util/async-handler');`:

```js
const { getEditionUpsell } = require('../services/access/upsell');
const { trialStatus } = require('../util/edition-access');
```

In GET `/`, add before `res.render('profile', {`:

```js
  const editionUpsell = await getEditionUpsell(res.locals.editionAccess);
```

and add to the render object after `badges,`:

```js
    editionUpsell,
    adventTrial: trialStatus(res.locals.editionAccess, 'advent'),
```

In `views/profile.handlebars`, replace the Access cell body (lines 75-78):

```handlebars
            {{#if this.unlock_expires_at}}
            <span class="tag is-warning is-light">Expires {{date_tz this.unlock_expires_at}}</span>
            {{/if}}
```

with:

```handlebars
            {{#if (and @root.adventTrial (eq this.unlock_source 'book') (eq this.rules_edition 'advent'))}}
            {{> access/trial-badge status=@root.adventTrial}}
            {{else if this.unlock_expires_at}}
            <span class="tag is-warning is-light">Expires {{date_tz this.unlock_expires_at}}</span>
            {{/if}}
```

and append at the end of the file (after the final `{{/if}}`):

```handlebars

{{> access/edition-upsell upsell=editionUpsell}}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `SUPABASE_URL=https://test.invalid SUPABASE_PUBLISHABLE_KEY=test-publishable-key SUPABASE_SECRET_KEY=test-secret-key OPENAI_API_KEY=test-openai-key bun test services/access/upsell.test.js routes/home-edition-access.test.js routes/profile-edition-access.test.js views/home.test.js views/profile.test.js views/profile-unlock-source.test.js routes/profile-unlocked-classes.test.js`
Expected: PASS — `0 fail`.

Then run: `bun run test:unit`
Expected: every file passes (spec baseline 2591 plus this plan's tests, `0 fail`).

- [ ] **Step 5: Commit**

```bash
git add services/access/upsell.js services/access/upsell.test.js views/partials/access/edition-upsell.handlebars routes/home.js routes/home-edition-access.test.js views/home.handlebars views/home.test.js routes/profile.js routes/profile-edition-access.test.js views/profile.handlebars views/profile.test.js
git commit -m "feat: tease each locked edition on home and profile and badge trial classes on the profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- Spec §1 → Tasks 1, 2, 3, 6. §2 → Task 4. §3 → Task 5. §4 → Tasks 8 (catalog cards, class view), 11 (library card), 12 (profile). §5 → Tasks 9 (sheet), 10 (wizard/form), 11 (library page), 8 (teaser header, catalog notice). §6 → Tasks 7-8 (catalog), 10 (pickers), 12 (upsell). Error handling → Tasks 2, 3, 12 (fail quiet), 4 (redeem-only CTA).
- Deviations the spec leaves open, decided here: `getEditionAccess(userId, now, { timeZone })` and a `trial.endsToday` field (needed for "Ends today" in the viewer's timezone); the htmx skip also lets through history restores and target-less (`hx-target="body"`) swaps, which render the layout; the class-view TRIAL badge sits in the `<h1>` header (the existing "Access expires" tag lives in the PDF panel, which classes without a PDF never show); teasers need a signed-in viewer with a resolved status, so the signed-out catalog is unchanged.
