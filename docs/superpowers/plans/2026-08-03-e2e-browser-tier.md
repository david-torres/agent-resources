# End-to-End Browser Test Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth test tier that drives a real Chromium browser against the locally-booted app, converting the thirteen manual browser checks recorded on `ar-7v3k` and `ar-h6rt` into automated specs.

**Architecture:** `@playwright/test` runs specs from `e2e/specs/` against a server the runner boots on port 3100, backed by the local Supabase stack. A global setup signs two accounts in through the real `/auth` form and saves their `localStorage` as Playwright `storageState`. Each spec seeds only the rows it needs through `supabaseAdmin` + `pg` under a unique prefix and deletes them afterwards, so the developer's local dev data is never touched.

**Tech Stack:** `@playwright/test` (Chromium only), Node 25 (Playwright's runner), Bun 1.3.3 (the app server), Express 4, Supabase JS v2, `pg`, htmx 2.0.8, Alpine.js 3.15.12.

**Spec:** `docs/superpowers/specs/2026-08-03-e2e-browser-tier-design.md`
**Tickets:** ar-7v3k (checks 1-12), ar-h6rt (check 13)

## Global Constraints

- **These are characterization tests. They are expected to PASS on first run.** This is NOT a red-green cycle. If a spec fails, **stop: you have probably found a real bug. Do not change production code to make it pass.** Record it in the findings report (Task 17) and move to the next task.
- The one legitimate exception is a spec whose *expectation* is wrong — a misreading of intended behavior. Fix the spec, and note in the findings why it was an expectation bug rather than a product bug.
- **Never modify anything under `public/`, `views/`, `routes/`, `models/`, `services/`, or `util/`.** This plan only adds files under `e2e/`, plus `playwright.config.js`, `package.json`, `.gitignore`, CI, and docs.
- Prerequisites for every task: `supabase start` is running and `bun run seed:local` has been run at least once. `.env` must have `SUPABASE_URL="http://127.0.0.1:54321"` (it already does).
- The app server for tests runs on **port 3100**, never 3000 — port 3000 belongs to the developer's `bun run dev`.
- Seeded admin credentials are `dummy@testing.com` / `dummypassword` (`util/seed-admin.js:43-44`). Never hardcode them anywhere but `e2e/global-setup.js`.
- Fixture rows are always named with a per-run unique prefix and always deleted in `afterAll`. Never call `supabase db reset` from a spec.
- Existing tiers stay untouched: do not edit `scripts/run-tests.mjs` or `scripts/check.mjs`. Playwright does its own file discovery.
- Commit prefix `test:` for spec commits, `chore:` for tooling, `docs:` for documentation — matching repo history.
- The CI workflow lands **last** (Task 17), so a red spec never turns `main` red before the user has triaged it.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `playwright.config.js` (create) | Runner config, `webServer`, local-Supabase guard, artifact policy |
| `e2e/global-setup.js` (create) | Provision + sign in admin and player; write `storageState` |
| `e2e/fixtures/db.js` (create) | `pg` connection, prefix generator, profile lookup, cleanup-by-prefix |
| `e2e/fixtures/character.js` (create) | Seed characters, abilities, perks, offscreen missions |
| `e2e/fixtures/class.js` (create) | Seed classes |
| `e2e/specs/*.spec.js` (create) | One file per checklist item |
| `package.json` (modify) | `test:e2e` script, `@playwright/test` devDependency |
| `.gitignore` (modify) | `e2e/.auth/`, `e2e/report/` |
| `.github/workflows/e2e.yml` (create) | CI tier |
| `README.md`, `CONTRIBUTING.md` (modify) | Document the fourth tier |
| `docs/superpowers/reports/2026-08-03-e2e-findings.md` (create) | Findings report |

---

## Phase 0 — Tier infrastructure

### Task 1: Playwright tier boots and runs one spec

**Files:**
- Create: `playwright.config.js`
- Create: `e2e/specs/00-smoke.spec.js`
- Modify: `package.json` (scripts + devDependencies)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `baseURL` of `http://127.0.0.1:3100` available to every later spec via Playwright's `page.goto('/path')`; the `chromium` project; `bun run test:e2e`.

- [ ] **Step 1: Install Playwright and its browser**

```bash
bun add -d @playwright/test
bunx playwright install --with-deps chromium
```

- [ ] **Step 2: Create `playwright.config.js`**

```js
// Fourth test tier: real-browser coverage for behavior the unit (jsdom),
// http (mocked-model Express), and integration (Supabase, no browser) tiers
// structurally cannot reach — htmx swaps, Alpine's settle phase, boosted
// navigation, and the back button.
require('./util/env');
const { defineConfig, devices } = require('@playwright/test');

// Same guard the integration tier applies at scripts/run-tests.mjs:44-48.
// Pointing this suite at a cloud project would seed and delete rows there.
const supabaseUrl = process.env.SUPABASE_URL || '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(supabaseUrl)) {
  throw new Error(
    'E2E tests require local Supabase: set SUPABASE_URL=http://127.0.0.1:54321 ' +
    'after `supabase start`, then run `bun run seed:local`.'
  );
}

// 3100, not 3000: the developer's `bun run dev` owns 3000 and the suite must
// be runnable without stopping it.
const port = Number(process.env.E2E_PORT || 3100);
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e/report/artifacts',
  globalSetup: require.resolve('./e2e/global-setup'),
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/report/html', open: 'never' }]
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: `PORT=${port} bun run index.js`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
```

- [ ] **Step 3: Add the script to `package.json`**

Add to `"scripts"`, after `"test:integration"`:

```json
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
```

- [ ] **Step 4: Add artifact directories to `.gitignore`**

Append to `.gitignore`:

```
e2e/.auth/
e2e/report/
```

- [ ] **Step 5: Create a temporary no-op global setup**

Task 2 replaces this. It exists now only so the config resolves.

```js
// e2e/global-setup.js
module.exports = async () => {};
```

- [ ] **Step 6: Write the smoke spec**

```js
// e2e/specs/00-smoke.spec.js
//
// Proves the tier itself works: the server boots, Alpine and htmx load from
// their pinned CDNs, and no x-cloak element is left visible. x-cloak surviving
// past Alpine's start is the signature of Alpine failing to initialise, which
// would make every other spec in this suite fail for the wrong reason.
const { test, expect } = require('@playwright/test');

test('home page boots with Alpine and htmx initialised', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto('/');
  await expect(page).toHaveTitle(/Agent Resources/);

  // Alpine sets window.Alpine on start; htmx sets window.htmx on load.
  await expect.poll(() => page.evaluate(() => typeof window.Alpine)).toBe('object');
  expect(await page.evaluate(() => typeof window.htmx)).toBe('object');

  // Alpine strips x-cloak from every element it initialises.
  const cloaked = page.locator('[x-cloak]');
  for (let i = 0; i < await cloaked.count(); i++) {
    await expect(cloaked.nth(i)).toBeHidden();
  }

  expect(consoleErrors).toEqual([]);
});

test('the navbar burger toggles the menu', async ({ page }) => {
  await page.goto('/');
  const burger = page.locator('#navbar-burger');
  const menu = page.locator('#navbar-menu');

  await expect(menu).not.toHaveClass(/is-active/);
  await burger.click();
  await expect(menu).toHaveClass(/is-active/);
  await burger.click();
  await expect(menu).not.toHaveClass(/is-active/);
});
```

- [ ] **Step 7: Run it**

Run: `bun run test:e2e`
Expected: 2 passed. If the server fails to boot, the failure text will name the missing env var or port conflict.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.js e2e/ package.json bun.lock .gitignore
git commit -m "chore: add a Playwright browser test tier (ar-7v3k)"
```

---

### Task 2: Two signed-in accounts via the real auth form

**Files:**
- Modify: `e2e/global-setup.js` (replace the Task 1 stub)
- Create: `e2e/specs/01-auth-state.spec.js`

**Interfaces:**
- Produces:
  - `e2e/.auth/admin.json` — storageState for `dummy@testing.com` (role `admin`).
  - `e2e/.auth/player.json` — storageState for `e2e-player@testing.com` (role `user`).
  - Exported constants from `e2e/global-setup.js`:
    `ADMIN_EMAIL` (`'dummy@testing.com'`), `ADMIN_PASSWORD` (`'dummypassword'`),
    `PLAYER_EMAIL` (`'e2e-player@testing.com'`), `PLAYER_PASSWORD` (`'e2e-player-password'`),
    `ADMIN_STATE` (absolute path to `admin.json`), `PLAYER_STATE` (absolute path to `player.json`).
- Later specs select an identity with `test.use({ storageState: ADMIN_STATE })`.

**Background the implementer needs:** auth tokens live in `localStorage` as
`authToken` / `refreshToken` (`public/js/app.js:74-92`) and are attached to htmx
requests by an `htmx:configRequest` handler. A plain browser navigation carries
no `Authorization` header, which is why direct loads of protected routes bounce
through `/auth/check?r=`. Playwright's `storageState` captures `localStorage`
per origin, so signing in once and reusing the state works — and signing in
through the real form (rather than injecting tokens) makes the setup itself a
check on that contract.

- [ ] **Step 1: Replace `e2e/global-setup.js`**

```js
// Signs both test identities in through the REAL /auth form and saves their
// localStorage as Playwright storageState.
//
// Deliberately not injecting tokens directly: public/js/app.js:74-92 owns the
// authToken/refreshToken contract, and that contract is refactor-adjacent. If
// sign-in breaks, every spec should fail loudly here rather than mysteriously
// later.
require('../util/env');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const { supabaseAdmin } = require('../models/_base');

const ADMIN_EMAIL = 'dummy@testing.com';
const ADMIN_PASSWORD = 'dummypassword';
const PLAYER_EMAIL = 'e2e-player@testing.com';
const PLAYER_PASSWORD = 'e2e-player-password';

const authDir = path.join(__dirname, '.auth');
const ADMIN_STATE = path.join(authDir, 'admin.json');
const PLAYER_STATE = path.join(authDir, 'player.json');

// The player account is infrastructure, not fixture data: fixed address,
// created idempotently (exactly as util/seed-admin.js treats the admin), never
// torn down. It exists so specs can distinguish "a character you own" from one
// you don't. It needs the admin API rather than the direct `insert into
// auth.users` the fixtures use, because it must be able to sign in with a
// password.
const ensurePlayer = async () => {
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;

  let user = list.users.find((u) => u.email === PLAYER_EMAIL);
  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: PLAYER_EMAIL,
      password: PLAYER_PASSWORD,
      email_confirm: true
    });
    if (error) throw error;
    user = data.user;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id').eq('user_id', user.id).maybeSingle();
  if (!profile) {
    const { error } = await supabaseAdmin.from('profiles').insert({
      user_id: user.id, name: 'E2E Player', is_public: true, timezone: 'UTC', role: 'user'
    });
    if (error) throw error;
  }
};

const signIn = async (browser, baseURL, email, password, statePath) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto('/auth');
  await page.fill('#signin-email', email);
  await page.fill('#signin-password', password);
  await page.click('#signin-submit');

  // App.signIn writes both keys on success; waiting on them rather than on a
  // URL avoids racing the post-sign-in redirect.
  await page.waitForFunction(
    () => !!localStorage.getItem('authToken') && !!localStorage.getItem('refreshToken'),
    null,
    { timeout: 15_000 }
  );

  await context.storageState({ path: statePath });
  await context.close();
};

module.exports = async (config) => {
  const baseURL = config.projects[0].use.baseURL;
  fs.mkdirSync(authDir, { recursive: true });

  await ensurePlayer();

  const browser = await chromium.launch();
  try {
    await signIn(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_STATE);
    await signIn(browser, baseURL, PLAYER_EMAIL, PLAYER_PASSWORD, PLAYER_STATE);
  } finally {
    await browser.close();
  }
};

module.exports.ADMIN_EMAIL = ADMIN_EMAIL;
module.exports.ADMIN_PASSWORD = ADMIN_PASSWORD;
module.exports.PLAYER_EMAIL = PLAYER_EMAIL;
module.exports.PLAYER_PASSWORD = PLAYER_PASSWORD;
module.exports.ADMIN_STATE = ADMIN_STATE;
module.exports.PLAYER_STATE = PLAYER_STATE;
```

- [ ] **Step 2: Confirm the sign-in form's real selectors**

The selectors above (`#signin-email`, `#signin-password`, `#signin-submit`) are
the expected ids. **Verify them before running** — open
`views/partials/signin-form.handlebars` and correct the three selectors if they
differ. Do not guess; the file is short.

```bash
grep -n 'id=\|name=\|type="submit"' views/partials/signin-form.handlebars
```

- [ ] **Step 3: Write the spec**

```js
// e2e/specs/01-auth-state.spec.js
//
// Guards the two storageStates global-setup produces. If either identity stops
// authenticating, this fails first and explains why the rest of the suite did.
const { test, expect } = require('@playwright/test');
const { ADMIN_STATE, PLAYER_STATE } = require('../global-setup');

test.describe('admin identity', () => {
  test.use({ storageState: ADMIN_STATE });

  test('reaches a protected admin route without bouncing', async ({ page }) => {
    await page.goto('/nav/manage');
    await expect(page.locator('body')).toContainText(/nav/i);
  });
});

test.describe('player identity', () => {
  test.use({ storageState: PLAYER_STATE });

  test('is signed in but is not an admin', async ({ page }) => {
    await page.goto('/profile');
    const token = await page.evaluate(() => localStorage.getItem('authToken'));
    expect(token).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run it**

Run: `bun run test:e2e e2e/specs/01-auth-state.spec.js`
Expected: 2 passed.

Note: `/nav/manage` is the exact route `ar-h6rt` reports as trapping users. If
this spec passes, the `ar-h6rt` fixes on this branch are holding for the
authenticated path; Task 16 tests the unauthenticated path that actually
triggered the bug.

- [ ] **Step 5: Commit**

```bash
git add e2e/global-setup.js e2e/specs/01-auth-state.spec.js
git commit -m "test: sign both e2e identities in through the real auth form (ar-7v3k)"
```

---

### Task 3: Fixture layer

**Files:**
- Create: `e2e/fixtures/db.js`
- Create: `e2e/fixtures/character.js`
- Create: `e2e/fixtures/class.js`
- Create: `e2e/specs/02-fixtures.spec.js`

**Interfaces:**
- Produces, from `e2e/fixtures/db.js`:
  - `connect() -> Promise<pg.Client>`
  - `newPrefix(spec: string) -> string`
  - `profileForEmail(db, email) -> Promise<{id, user_id, name, ...}>`
  - `cleanupByPrefix(db, prefix) -> Promise<void>`
- Produces, from `e2e/fixtures/class.js`:
  - `seedClass(prefix, { name?, rulesVersion?, isPublic?, abilities?, gear? }) -> Promise<classRow>`
- Produces, from `e2e/fixtures/character.js`:
  - `seedCharacter(prefix, profile, classRow, overrides?) -> Promise<characterRow>`
  - `seedPerk(characterId, classAbilityId, text, position?) -> Promise<perkRow>`
  - `seedOffscreenMission(characterId, profileId, { sourceMissionId, name, summary }) -> Promise<row>`

**Background:** the canonical pattern is
`models/character-atomic.integration.test.js:22-48` — direct
`insert into auth.users` via `pg` for auth rows, `supabaseAdmin` for
application tables. This layer differs in one way: the browser signs in as an
*already-seeded* account, so fixtures attach rows to that account's existing
profile rather than creating a throwaway one.

Real table names (verified against the local stack): `characters`, `classes`,
`class_abilities`, `class_gear`, `traits`, `character_perks`,
`class_unlock_codes`, `offscreen_missions`, `lfg_posts`, `pages`.

- [ ] **Step 1: Create `e2e/fixtures/db.js`**

```js
require('../../util/env');
const { Client } = require('pg');

const connectionString = process.env.SUPABASE_DB_URL
  || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const connect = async () => {
  const db = new Client({ connectionString });
  await db.connect();
  return db;
};

// Every fixture row's name starts with this, so cleanup is a single LIKE and
// two concurrent runs can never collide.
const newPrefix = (spec) =>
  `e2e-${spec}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const profileForEmail = async (db, email) => {
  const { rows } = await db.query(
    `select p.* from profiles p join auth.users u on u.id = p.user_id where u.email = $1`,
    [email]
  );
  if (!rows[0]) {
    throw new Error(`No profile for ${email}. Run \`bun run seed:local\` and re-run the suite.`);
  }
  return rows[0];
};

// Children are deleted explicitly rather than relying on ON DELETE CASCADE,
// so this is correct whether or not the FKs cascade.
const cleanupByPrefix = async (db, prefix) => {
  const like = `${prefix}%`;

  const { rows: characters } = await db.query(
    'select id from characters where name like $1', [like]
  );
  const characterIds = characters.map((r) => r.id);
  if (characterIds.length) {
    for (const table of ['character_perks', 'class_abilities', 'class_gear', 'traits', 'offscreen_missions']) {
      await db.query(`delete from ${table} where character_id = any($1::uuid[])`, [characterIds]);
    }
    await db.query('delete from characters where id = any($1::uuid[])', [characterIds]);
  }

  const { rows: classes } = await db.query('select id from classes where name like $1', [like]);
  const classIds = classes.map((r) => r.id);
  if (classIds.length) {
    await db.query('delete from class_unlock_codes where class_id = any($1::uuid[])', [classIds]);
    await db.query('delete from classes where id = any($1::uuid[])', [classIds]);
  }

  await db.query('delete from lfg_posts where title like $1', [like]);
  await db.query('delete from pages where title like $1', [like]);
};

module.exports = { connect, newPrefix, profileForEmail, cleanupByPrefix };
```

- [ ] **Step 2: Create `e2e/fixtures/class.js`**

```js
require('../../util/env');
const { supabaseAdmin } = require('../../models/_base');

const seedClass = async (prefix, {
  name = `${prefix}-class`,
  rulesVersion = 'v1',
  isPublic = true,
  abilities = [{ name: 'E2E Ability', description: 'Fixture ability' }],
  gear = []
} = {}) => {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .insert({ name, rules_version: rulesVersion, is_public: isPublic, gear, abilities })
    .select()
    .single();
  if (error) throw error;
  return data;
};

module.exports = { seedClass };
```

- [ ] **Step 3: Create `e2e/fixtures/character.js`**

```js
require('../../util/env');
const { supabaseAdmin } = require('../../models/_base');
const { createCharacter } = require('../../models/character');

// The 15 numeric fields createCharacter requires, copied from
// models/character-atomic.integration.test.js:16-19.
const BASE_STATS = {
  vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
  sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
  level: 1, completed_missions: 0, commissary_reward: 0
};

// Goes through the real model seam rather than raw inserts so fixtures cannot
// drift from what the app itself writes.
const seedCharacter = async (prefix, profile, classRow, overrides = {}) => {
  const input = {
    ...BASE_STATS,
    name: `${prefix}-character`,
    class: classRow.name,
    class_id: classRow.id,
    trait0: 'Brave',
    gear: [],
    abilities: [{ name: 'E2E Ability', class_id: classRow.id }],
    ...overrides
  };
  const { data, error } = await createCharacter(input, profile);
  if (error) throw error;
  return data;
};

// character_perks.class_ability_id references class_abilities.id — the row
// createCharacter wrote for this character, not the class's ability template.
const abilityIdFor = async (characterId) => {
  const { data, error } = await supabaseAdmin
    .from('class_abilities').select('id').eq('character_id', characterId).limit(1).single();
  if (error) throw error;
  return data.id;
};

const seedPerk = async (characterId, classAbilityId, text, position = 1) => {
  const { data, error } = await supabaseAdmin
    .from('character_perks')
    .insert({ character_id: characterId, class_ability_id: classAbilityId, text, position })
    .select()
    .single();
  if (error) throw error;
  return data;
};

const seedOffscreenMission = async (characterId, profileId, {
  sourceMissionId = null,
  name,
  summary = 'Fixture offscreen mission',
  sourceMissionName = 'Fixture Source',
  sourceMissionDate = '2026-01-01'
}) => {
  const { data, error } = await supabaseAdmin
    .from('offscreen_missions')
    .insert({
      character_id: characterId,
      name,
      summary,
      source_mission_id: sourceMissionId,
      source_mission_name: sourceMissionName,
      source_mission_date: sourceMissionDate,
      created_by: profileId
    })
    .select()
    .single();
  if (error) throw error;
  return data;
};

module.exports = { BASE_STATS, seedCharacter, seedPerk, seedOffscreenMission, abilityIdFor };
```

- [ ] **Step 4: Write the spec that proves seed-and-cleanup round-trips**

```js
// e2e/specs/02-fixtures.spec.js
//
// Not a product test: it guards the fixture layer every later spec depends on.
// A silent cleanup failure would slowly fill the developer's local database
// with e2e- rows, so the deletion half is asserted explicitly.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL } = require('../global-setup');

test('fixtures seed under a prefix and clean up completely', async () => {
  const db = await connect();
  const prefix = newPrefix('fixtures');
  try {
    const profile = await profileForEmail(db, ADMIN_EMAIL);
    const classRow = await seedClass(prefix);
    const character = await seedCharacter(prefix, profile, classRow);

    expect(character.id).toBeTruthy();
    expect(character.name).toBe(`${prefix}-character`);

    await cleanupByPrefix(db, prefix);

    const { rows: leftoverCharacters } = await db.query(
      'select id from characters where name like $1', [`${prefix}%`]
    );
    const { rows: leftoverClasses } = await db.query(
      'select id from classes where name like $1', [`${prefix}%`]
    );
    expect(leftoverCharacters).toHaveLength(0);
    expect(leftoverClasses).toHaveLength(0);
  } finally {
    await cleanupByPrefix(db, prefix);
    await db.end();
  }
});
```

- [ ] **Step 5: Run it**

Run: `bun run test:e2e e2e/specs/02-fixtures.spec.js`
Expected: 1 passed.

If `createCharacter` rejects the input, read its validation in
`services/character/input.js` and add the missing required fields to
`BASE_STATS` or the `input` object — this is fixture code, not product code,
so correcting it here is in scope.

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures e2e/specs/02-fixtures.spec.js
git commit -m "test: add e2e fixture layer with prefix-scoped cleanup (ar-7v3k)"
```

---

## Phase 1 — Silent-data-loss risks

These three run first because they are the checks where a regression destroys
user data rather than merely looking wrong.

### Task 4: Perk textarea round-trip (ar-7v3k check 4)

**Files:**
- Create: `e2e/specs/03-perk-textarea.spec.js`

**Interfaces:**
- Consumes: `connect`, `newPrefix`, `profileForEmail`, `cleanupByPrefix` (Task 3); `seedClass` (Task 3); `seedCharacter`, `seedPerk`, `abilityIdFor` (Task 3); `ADMIN_EMAIL`, `ADMIN_STATE` (Task 2).

**Background:** the refactor changed the perk field from `<input type="text">`
to `<textarea>`, keeping `name="ability_perk_text[]"`
(`views/partials/character-ability-perk.handlebars:7`). The server reads
`body.ability_perk_text` at `services/character/input.js:170`, and Express's
`urlencoded({ extended: true })` collapses the `[]` suffix into an array. The
wiring looks correct on inspection — this spec proves it end to end, including
the newline case the `<textarea>` change exists to allow. The live word count
is `x-text` on `.word-count` bound to a sibling `x-data="{ text: ... }"`
(`character-ability-perk.handlebars:6-10`).

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/03-perk-textarea.spec.js
//
// ar-7v3k check 4. The perk field became a <textarea> during the Alpine
// adoption; a disturbed name="ability_perk_text[]" would drop perk text with
// no error surfaced to the user. This asserts the value actually lands in the
// database, not merely that the form looks right.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter, seedPerk, abilityIdFor } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('perk');
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  character = await seedCharacter(prefix, profile, classRow);
  await seedPerk(character.id, await abilityIdFor(character.id), 'original perk text');
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('the perk field is a textarea carrying the array field name', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  const field = page.locator('textarea[name="ability_perk_text[]"]').first();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('original perk text');
});

test('the live word count tracks typing and shows 0 for whitespace', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  const field = page.locator('textarea[name="ability_perk_text[]"]').first();
  const count = page.locator('.word-count').first();

  await field.fill('one two three');
  await expect(count).toHaveText('3');

  await field.fill('   ');
  await expect(count).toHaveText('0');
});

test('saving persists perk text, including newlines', async ({ page }) => {
  const multiline = 'first line\nsecond line';

  await page.goto(`/characters/${character.id}/edit`);
  await page.locator('textarea[name="ability_perk_text[]"]').first().fill(multiline);
  await page.locator('form#characterForm button[type="submit"]').first().click();

  await page.waitForURL(/\/characters\//);

  const { rows } = await db.query(
    'select text from character_perks where character_id = $1', [character.id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].text).toBe(multiline);
});
```

- [ ] **Step 2: Confirm the edit-form and submit-button selectors**

`form#characterForm button[type="submit"]` is the expected shape. Verify and
correct before running:

```bash
grep -n '<form\|type="submit"' views/character-form.handlebars | head -20
```

Also confirm the edit route is `/characters/:id/edit`:

```bash
grep -n "router.get('/:id/edit'\|/edit'" routes/characters.js | head
```

- [ ] **Step 3: Run it**

Run: `bun run test:e2e e2e/specs/03-perk-textarea.spec.js`
Expected: 3 passed.

**If the save test fails, that is the silent-data-loss defect ar-7v3k warned
about. Stop. Do not touch `views/partials/character-ability-perk.handlebars` or
`services/character/input.js`.** Record it for Task 17 with the trace path.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/03-perk-textarea.spec.js
git commit -m "test: cover the perk textarea round-trip in a browser (ar-7v3k)"
```

---

### Task 5: Stats editor cycle and ownership gate (ar-7v3k check 3)

**Files:**
- Create: `e2e/specs/04-stats-editor.spec.js`

**Interfaces:**
- Consumes: the Task 3 fixtures; `ADMIN_EMAIL`, `ADMIN_STATE`, `PLAYER_EMAIL`, `PLAYER_STATE` (Task 2).

**Real selectors** (from `views/character.handlebars:191-227` and
`views/partials/character-stats-editor.handlebars`):

| Element | Selector |
| --- | --- |
| Component root | `#statsBox` (`x-data="characterStats(...)"`) |
| Edit button | `#statsUnlockBtn` (`x-show="!editing"`) |
| Read-only grid | `#statsReadOnly` (`x-show="!editing"`) |
| Editor | `#statsEditor` (`x-show="editing"`, `x-cloak`) |
| Live total | `#statsTotalSum` (`x-text="total"`) |
| Cancel | `#statsCancelBtn` (`@click="cancel()"`) |
| Save | `#statsSaveBtn` (`:disabled="saving"`) |
| Error | `#statsEditorError` (`x-show="error"`) |
| A stat input | `input[name="might"]` (`x-model.number="stats.might"`) |

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/04-stats-editor.spec.js
//
// ar-7v3k check 3. public/js/character-stats.js (108 lines) was deleted and
// replaced by the Alpine `characterStats` component; this is the whole of its
// replacement behaviour, plus the ownership gate that hides Edit entirely.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE, PLAYER_STATE } = require('../global-setup');

const prefix = newPrefix('stats');
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  character = await seedCharacter(prefix, profile, classRow);
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test.describe('as the owner', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the stats box renders with the editor hidden', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await expect(page.locator('#statsBox')).toBeVisible();
    await expect(page.locator('#statsReadOnly')).toBeVisible();
    await expect(page.locator('#statsEditor')).toBeHidden();
    await expect(page.locator('#statsUnlockBtn')).toBeVisible();
  });

  test('Edit reveals the editor and focuses the first input', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();

    await expect(page.locator('#statsEditor')).toBeVisible();
    await expect(page.locator('#statsReadOnly')).toBeHidden();

    // The old imperative code focused the first input on reveal; the Alpine
    // edit() must still do it or keyboard users land nowhere.
    const focusedName = await page.evaluate(() => document.activeElement?.getAttribute('name'));
    expect(focusedName).toBeTruthy();
  });

  test('the live total tracks edits', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();

    const before = Number(await page.locator('#statsTotalSum').innerText());
    await page.locator('input[name="might"]').fill('7');
    await expect
      .poll(async () => Number(await page.locator('#statsTotalSum').innerText()))
      .toBe(before - 1 + 7); // seeded value is 1
  });

  test('Cancel restores the original values and hides the editor', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();
    await page.locator('input[name="might"]').fill('9');
    await page.locator('#statsCancelBtn').click();

    await expect(page.locator('#statsEditor')).toBeHidden();
    await page.locator('#statsUnlockBtn').click();
    await expect(page.locator('input[name="might"]')).toHaveValue('1');
  });

  test('Save persists to the database', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#statsUnlockBtn').click();
    await page.locator('input[name="might"]').fill('5');
    await page.locator('#statsSaveBtn').click();

    await expect(page.locator('#statsEditor')).toBeHidden();
    await expect.poll(async () => {
      const { rows } = await db.query('select might from characters where id = $1', [character.id]);
      return rows[0].might;
    }).toBe(5);
  });
});

test.describe('as a non-owner', () => {
  test.use({ storageState: PLAYER_STATE });

  test('sees no Edit button', async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await expect(page.locator('#statsUnlockBtn')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun run test:e2e e2e/specs/04-stats-editor.spec.js`
Expected: 6 passed.

The non-owner test depends on the seeded character being visible to another
account. If the page 404s or redirects for the player, the character is private
— add `is_public: true` to the `seedCharacter` overrides in `beforeAll`. That is
a fixture correction, not a product change.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/04-stats-editor.spec.js
git commit -m "test: cover the Alpine stats editor end to end (ar-7v3k)"
```

---

### Task 6: Level-up modal, full cycle (ar-7v3k check 1)

**Files:**
- Create: `e2e/specs/05-level-up-modal.spec.js`

**Background:** `public/js/character-level-up.js` (317 lines) was left untouched
and now opens its modal through a one-line bridge —
`window.dispatchEvent(new CustomEvent('open-modal', { detail: 'levelUp' }))`
at `character-level-up.js:238`. The modal shell is the Alpine `modal`
component (`public/js/alpine-components.js:155-177`), which sets
`document.body.classList.add('modal-open')` on open and removes it on close,
and scopes `close(which)` by name so a broadcast for a different modal is
ignored. This is the only path that writes character data through a converted
modal.

Known ids: trigger `#levelUpBtn` (`views/character.handlebars:154`), modal
`#levelUpModal`, total `#levelUpTotal`, missing-missions container
`#levelUpMissingMissions`, conduit credit `#levelUpConduitCredit`, save
`#levelUpSaveBtn`, error `#levelUpError`.

- [ ] **Step 1: Read the level-up partial for the remaining selectors**

```bash
grep -n 'id=\|name=\|@click\|x-' views/partials/character-level-up.handlebars
```

Note the stat-input names and the four close controls (modal background, header
`.delete`, footer Cancel, Escape). Use what you find; do not invent ids.

- [ ] **Step 2: Write the spec**

```js
// e2e/specs/05-level-up-modal.spec.js
//
// ar-7v3k check 1. character-level-up.js was NOT converted — it now opens the
// Alpine modal through a single dispatchEvent bridge. This is the only path
// writing character data through a converted modal, so both the bridge and all
// four close paths are covered.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('levelup');
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  // completed_missions high enough that the level-up gate lets the modal open.
  character = await seedCharacter(prefix, profile, classRow, { completed_missions: 10 });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('the dispatchEvent bridge opens the Alpine modal and locks the body', async ({ page }) => {
  await page.goto(`/characters/${character.id}`);
  await page.locator('#levelUpBtn').click();

  await expect(page.locator('#levelUpModal')).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/modal-open/);
});

for (const [name, close] of [
  ['background click', async (page) => page.locator('#levelUpModal .modal-background').click()],
  ['header delete button', async (page) => page.locator('#levelUpModal .delete').first().click()],
  ['footer cancel', async (page) => page.locator('#levelUpModal .modal-card-foot .button', { hasText: /cancel/i }).click()],
  ['escape key', async (page) => page.keyboard.press('Escape')]
]) {
  test(`closes via ${name} and releases the body lock`, async ({ page }) => {
    await page.goto(`/characters/${character.id}`);
    await page.locator('#levelUpBtn').click();
    await expect(page.locator('#levelUpModal')).toHaveClass(/is-active/);

    await close(page);

    await expect(page.locator('#levelUpModal')).not.toHaveClass(/is-active/);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  });
}

test('completing a level-up persists the new level', async ({ page }) => {
  const before = character.level;

  await page.goto(`/characters/${character.id}`);
  await page.locator('#levelUpBtn').click();
  await expect(page.locator('#levelUpModal')).toHaveClass(/is-active/);

  // Spend the level-up's stat points. The modal gates Save until the running
  // total matches what the level grants, so read the target off the DOM rather
  // than hardcoding a rules number.
  await page.locator('#levelUpModal input[type="number"]').first().fill('2');
  await page.locator('#levelUpSaveBtn').click();

  await expect(page.locator('#levelUpError')).toBeHidden();
  await expect.poll(async () => {
    const { rows } = await db.query('select level from characters where id = $1', [character.id]);
    return rows[0].level;
  }, { timeout: 15_000 }).toBe(before + 1);
});
```

- [ ] **Step 3: Run it**

Run: `bun run test:e2e e2e/specs/05-level-up-modal.spec.js`
Expected: 6 passed.

This is the spec most likely to need selector corrections from Step 1, and the
most likely to reveal a real defect. If the *close* tests fail, the Alpine modal
conversion is at fault — record and stop. If only the *save* test fails because
the level-up rules gate is unsatisfied, that is a fixture problem: adjust
`completed_missions` or the stat allocation and re-run.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/05-level-up-modal.spec.js
git commit -m "test: cover the level-up modal bridge and all four close paths (ar-7v3k)"
```

---

## Phase 2 — Modal semantics

### Task 7: Deceased modal (ar-7v3k check 5)

**Files:**
- Create: `e2e/specs/06-deceased-modal.spec.js`

**Real markup** (`views/character-form.handlebars:407-450`): trigger is
`@click="$dispatch('open-modal', 'deceased')"` on a `.button.is-dark`; the modal
is `#deceased-modal` with `x-data="modal('deceased')"`; the confirm input is
`input[name="confirmName"]` with `x-model="typed"`; the submit is
`#deceased-submit` with `:disabled="typed !== required"`. Opening now sets
`body.modal-open` for the first time, so the scroll lock is new behavior worth
asserting. The modal only renders for a saved, not-yet-deceased character
(`{{#unless isNew}}{{#unless character.is_deceased}}`).

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/06-deceased-modal.spec.js
//
// ar-7v3k check 5. Uses a character whose name contains an apostrophe, because
// the required-name comparison is injected as {{json character.name}} into an
// Alpine expression — a quoting bug there would break the confirm gate for
// exactly those characters and no others.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('deceased');
const NAME = `${prefix}-O'Brien`;
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  character = await seedCharacter(prefix, profile, classRow, { name: NAME });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('opening locks background scroll; the confirm gate honours an apostrophe', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  await page.locator('button', { hasText: /deceased/i }).first().click();

  const modal = page.locator('#deceased-modal');
  await expect(modal).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/modal-open/);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  const submit = page.locator('#deceased-submit');
  await expect(submit).toBeDisabled();

  await page.locator('#deceased-modal input[name="confirmName"]').fill('wrong name');
  await expect(submit).toBeDisabled();

  await page.locator('#deceased-modal input[name="confirmName"]').fill(NAME);
  await expect(submit).toBeEnabled();
});

test('confirming marks the character deceased', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  await page.locator('button', { hasText: /deceased/i }).first().click();
  await page.locator('#deceased-modal input[name="confirmName"]').fill(NAME);
  await page.locator('#deceased-submit').click();

  await expect.poll(async () => {
    const { rows } = await db.query('select is_deceased from characters where id = $1', [character.id]);
    return rows[0].is_deceased;
  }, { timeout: 15_000 }).toBe(true);
});
```

- [ ] **Step 2: Run it**

Run: `bun run test:e2e e2e/specs/06-deceased-modal.spec.js`
Expected: 2 passed.

The `overflow: hidden` assertion depends on a `.modal-open` rule in
`public/css/styles.css`. If it fails but `body` does carry `modal-open`, check
whether the rule exists — a missing rule means the scroll lock is cosmetic only,
which is a genuine finding. Record it; do not add the CSS.

Run the two tests in order (`--workers=1` for this file) — the second
permanently marks the character deceased, which removes the modal from the page.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/06-deceased-modal.spec.js
git commit -m "test: cover the deceased modal scroll lock and confirm gate (ar-7v3k)"
```

---

### Task 8: Unlock-code modal clears on reopen (ar-7v3k check 6)

**Files:**
- Create: `e2e/specs/07-unlock-code-modal.spec.js`

**Real markup** (`views/class-view.handlebars:262-311`): `#unlockCodeModal` with
`x-data="clearingModal('unlockCode')"`; trigger is a `.button.is-info` with
`@click="$dispatch('open-modal', 'unlockCode')"` at line 32; the result target is
`#codeResult-{{class.id}}` carrying `x-ref="result"`; all four close controls
call `closeAndClear()`. The `clearingModal` component
(`alpine-components.js:195-203`) blanks `$refs.result.innerHTML` only when the
call actually transitioned the modal from open to closed.

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/07-unlock-code-modal.spec.js
//
// ar-7v3k check 6. clearingModal must blank the generated code on EVERY close
// path — a stale code shown on reopen looks like a freshly issued one, and the
// user would hand out a code that is already spent.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('unlock');
let db;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  await profileForEmail(db, ADMIN_EMAIL);
  classRow = await seedClass(prefix);
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

const openAndGenerate = async (page) => {
  await page.locator('button', { hasText: /generate unlock code/i }).click();
  await expect(page.locator('#unlockCodeModal')).toHaveClass(/is-active/);
  await page.locator('#unlockCodeModal button[hx-post], #unlockCodeModal button[type="submit"]').first().click();
  await expect(page.locator(`#codeResult-${classRow.id}`)).not.toBeEmpty();
};

for (const [name, close] of [
  ['background click', async (page) => page.locator('#unlockCodeModal .modal-background').click()],
  ['header delete button', async (page) => page.locator('#unlockCodeModal .delete').first().click()],
  ['footer close', async (page) => page.locator('#unlockCodeModal .modal-card-foot .button', { hasText: /close/i }).click()],
  ['escape key', async (page) => page.keyboard.press('Escape')]
]) {
  test(`closing via ${name} clears the code before reopen`, async ({ page }) => {
    await page.goto(`/classes/${classRow.id}`);
    await openAndGenerate(page);

    await close(page);
    await expect(page.locator('#unlockCodeModal')).not.toHaveClass(/is-active/);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);

    await page.locator('button', { hasText: /generate unlock code/i }).click();
    await expect(page.locator('#unlockCodeModal')).toHaveClass(/is-active/);
    await expect(page.locator(`#codeResult-${classRow.id}`)).toBeEmpty();
  });
}
```

- [ ] **Step 2: Confirm the generate button's selector**

```bash
sed -n 280,310p views/class-view.handlebars
```

Replace the `openAndGenerate` inner selector with the real one.

- [ ] **Step 3: Run it**

Run: `bun run test:e2e e2e/specs/07-unlock-code-modal.spec.js`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/07-unlock-code-modal.spec.js
git commit -m "test: cover unlock-code modal clearing on all four close paths (ar-7v3k)"
```

---

### Task 9: Per-row duplicate modal on My Classes (ar-7v3k check 9)

**Files:**
- Create: `e2e/specs/08-my-classes-duplicate.spec.js`

**Real markup** (`views/my-classes.handlebars:90-156`): each row is
`#row-{{this.id}}`; its trigger dispatches `open-modal` with
`'duplicate-{{this.id}}'`; the modal is `#duplicateModal-{{this.id}}` with
`x-data="modal('duplicate-{{this.id}}')"`. The whole point of the name-scoping
in `modalBase` (`alpine-components.js:158-159`) is that one row's trigger must
not open every row's modal, so the spec needs **at least two** classes.

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/08-my-classes-duplicate.spec.js
//
// ar-7v3k check 9. modalBase.open(which) returns early unless `which` matches
// the instance's name; with several rows on the page, an unscoped
// implementation would open all of them at once. Needs two classes to detect
// that at all.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('myclasses');
let db;
let first;
let second;

test.beforeAll(async () => {
  db = await connect();
  await profileForEmail(db, ADMIN_EMAIL);
  first = await seedClass(prefix, { name: `${prefix}-alpha` });
  second = await seedClass(prefix, { name: `${prefix}-beta` });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test("one row's Duplicate opens only that row's modal", async ({ page }) => {
  await page.goto('/classes/my');

  const firstModal = page.locator(`#duplicateModal-${first.id}`);
  const secondModal = page.locator(`#duplicateModal-${second.id}`);

  await expect(firstModal).not.toHaveClass(/is-active/);
  await expect(secondModal).not.toHaveClass(/is-active/);

  await page.locator(`#row-${first.id} button`, { hasText: /duplicate/i }).click();

  await expect(firstModal).toHaveClass(/is-active/);
  await expect(secondModal).not.toHaveClass(/is-active/);
});

test('the duplicate modal submits and creates a copy', async ({ page }) => {
  await page.goto('/classes/my');
  await page.locator(`#row-${first.id} button`, { hasText: /duplicate/i }).click();

  const modal = page.locator(`#duplicateModal-${first.id}`);
  await expect(modal).toHaveClass(/is-active/);
  await modal.locator('button[type="submit"]').click();

  await expect.poll(async () => {
    const { rows } = await db.query('select id from classes where name like $1', [`${prefix}%`]);
    return rows.length;
  }, { timeout: 15_000 }).toBeGreaterThan(2);
});
```

- [ ] **Step 2: Run it**

Run: `bun run test:e2e e2e/specs/08-my-classes-duplicate.spec.js`
Expected: 2 passed.

The duplicate form requires `new_version` (`my-classes.handlebars:147` marks the
select `required`). If submission does nothing, select a version first with
`await modal.locator(`#dup-version-${first.id}`).selectOption({ index: 1 })`
before clicking submit.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/08-my-classes-duplicate.spec.js
git commit -m "test: cover per-row duplicate modal scoping on My Classes (ar-7v3k)"
```

---

## Phase 3 — htmx and Alpine interaction

This phase covers what the ticket calls structurally unreachable: jsdom has no
htmx, so the swap-then-settle race and history snapshots cannot be simulated.

### Task 10: Boosted navigation leaves the navbar closed (ar-7v3k check 2)

**Files:**
- Create: `e2e/specs/09-boosted-nav-settle.spec.js`

**Background — this is the single most important spec in the suite.** It is the
entire justification for `defaultSettleDelay: 0` in
`views/partials/head.handlebars:4`. The hazard: htmx's settle phase restores
`class` and `style` attributes it captured *before* Alpine wrote to them, so a
menu Alpine closed can be re-opened by the settle. The navbar is
`x-data="{ open: false }"` with `:class="open && 'is-active'"` on both
`#navbar-burger` and `#navbar-menu` (`views/partials/nav.handlebars:1-14`).

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/09-boosted-nav-settle.spec.js
//
// ar-7v3k check 2 — the whole reason defaultSettleDelay: 0 exists.
//
// htmx's settle phase can restore class/style attributes captured before
// Alpine wrote to them. With a non-zero settle delay, a navbar menu that
// Alpine re-initialises closed after a boosted swap gets its is-active class
// restored by the settle, and the menu arrives OPEN on the new page. jsdom has
// no htmx, so this race is unreachable from every other tier.
const { test, expect } = require('@playwright/test');
const { ADMIN_STATE } = require('../global-setup');

test.use({
  storageState: ADMIN_STATE,
  viewport: { width: 500, height: 900 } // narrow enough that the burger shows
});

test('htmx-config pins the settle delay to zero', async ({ page }) => {
  await page.goto('/');
  const config = await page.locator('meta[name="htmx-config"]').getAttribute('content');
  expect(JSON.parse(config).defaultSettleDelay).toBe(0);
});

test('the navbar menu arrives closed after a boosted navigation', async ({ page }) => {
  await page.goto('/');

  const burger = page.locator('#navbar-burger');
  const menu = page.locator('#navbar-menu');

  await burger.click();
  await expect(menu).toHaveClass(/is-active/);

  // A boosted link swaps <body> rather than doing a full page load.
  const link = page.locator('#navbar-menu a[href]:not([href^="http"])').first();
  const href = await link.getAttribute('href');
  await link.click();

  await page.waitForURL((url) => url.pathname === href);

  // The assertion the settle race would break.
  await expect(page.locator('#navbar-menu')).not.toHaveClass(/is-active/);
  await expect(page.locator('#navbar-burger')).not.toHaveClass(/is-active/);
});

test('a hidden x-show element stays hidden across a boosted body swap', async ({ page }) => {
  // ar-7v3k records this as the one part of acceptance criterion 2 with no
  // test: x-show combined with a real boosted swap.
  await page.goto('/');
  const link = page.locator('#navbar-menu a[href]:not([href^="http"])').first();
  await link.click();
  await page.waitForLoadState('networkidle');

  const cloaked = page.locator('[x-cloak]');
  for (let i = 0; i < await cloaked.count(); i++) {
    await expect(cloaked.nth(i)).toBeHidden();
  }
});
```

- [ ] **Step 2: Confirm `hx-boost` is actually on the navbar links**

```bash
grep -n 'hx-boost' views/layouts/main.handlebars views/partials/nav.handlebars
```

If boosting is set on a wrapper rather than the nav, adjust the link selector so
the click really performs a body swap rather than a full navigation. A full page
load would make this spec pass vacuously — verify by asserting no `load` event
fires, or by checking `window.htmx` object identity is preserved across the
click:

```js
await page.evaluate(() => { window.__preNav = true; });
await link.click();
await page.waitForURL((url) => url.pathname === href);
expect(await page.evaluate(() => window.__preNav)).toBe(true); // survives a swap, not a reload
```

Add that identity check to the boosted-navigation test.

- [ ] **Step 3: Run it**

Run: `bun run test:e2e e2e/specs/09-boosted-nav-settle.spec.js`
Expected: 3 passed.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/09-boosted-nav-settle.spec.js
git commit -m "test: prove defaultSettleDelay 0 keeps the navbar closed after boosted nav (ar-7v3k)"
```

---

### Task 11: Back button after a boosted navigation (ar-7v3k check 12)

**Files:**
- Create: `e2e/specs/10-back-button-snapshot.spec.js`

**Background:** htmx caches a DOM snapshot for history restoration. That snapshot
is taken *after* Alpine stripped `x-cloak` and wrote `:class` bindings, so a
restored page can come back with Alpine's writes baked into the markup but no
live Alpine state behind them — leaving a menu visually open that nothing can
close.

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/10-back-button-snapshot.spec.js
//
// ar-7v3k check 12. htmx snapshots the DOM for history restore AFTER Alpine has
// stripped x-cloak and written :class. A restored snapshot can therefore carry
// Alpine's output as literal markup with no component behind it — a menu stuck
// open that no click can close.
const { test, expect } = require('@playwright/test');
const { ADMIN_STATE } = require('../global-setup');

test.use({
  storageState: ADMIN_STATE,
  viewport: { width: 500, height: 900 }
});

test('going back after a boosted navigation restores a closed, live navbar', async ({ page }) => {
  await page.goto('/');

  await page.locator('#navbar-burger').click();
  await expect(page.locator('#navbar-menu')).toHaveClass(/is-active/);

  const link = page.locator('#navbar-menu a[href]:not([href^="http"])').first();
  const href = await link.getAttribute('href');
  await link.click();
  await page.waitForURL((url) => url.pathname === href);

  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/');

  // Restored closed...
  await expect(page.locator('#navbar-menu')).not.toHaveClass(/is-active/);

  // ...and still live: the component must respond, not just look right.
  await page.locator('#navbar-burger').click();
  await expect(page.locator('#navbar-menu')).toHaveClass(/is-active/);
});
```

- [ ] **Step 2: Run it**

Run: `bun run test:e2e e2e/specs/10-back-button-snapshot.spec.js`
Expected: 1 passed.

A failure on the final assertion (menu restored closed but the burger no longer
works) means Alpine did not re-initialise the restored snapshot. Record it —
this is exactly the class of defect the check exists to find.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/10-back-button-snapshot.spec.js
git commit -m "test: cover Alpine liveness after htmx history restore (ar-7v3k)"
```

---

### Task 12: Export dropdowns on character and class pages (ar-7v3k check 11)

**Files:**
- Create: `e2e/specs/11-export-dropdowns.spec.js`

**Real markup** — identical shape in both templates
(`views/character.handlebars:161-171`, `views/class-view.handlebars:34-46`):
`#export-dropdown` with `x-data="{ open: false }"`, `@click.outside="open = false"`,
a toggle button with `@click="open = !open"` and `:aria-expanded="open"`, and
`#export-menu`. These replaced the two global dropdown handlers deleted from
`public/js/app.js`.

- [ ] **Step 1: Confirm the Escape binding**

```bash
sed -n 160,172p views/character.handlebars
```

Line 163 (elided in the grep used to write this plan) carries the remaining
directives. If there is no `@keydown.escape` binding, **drop the Escape test and
record the gap as a finding** — ar-7v3k check 11 lists Escape-close as required
behavior, so its absence is a genuine regression from the deleted global handler.

- [ ] **Step 2: Write the spec**

```js
// e2e/specs/11-export-dropdowns.spec.js
//
// ar-7v3k check 11. Both global dropdown handlers were deleted from app.js and
// replaced with per-dropdown Alpine state. Outside-click and Escape used to be
// document-level behaviour; they are now per-component and easy to lose.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('export');
let db;
let character;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  classRow = await seedClass(prefix);
  character = await seedCharacter(prefix, profile, classRow);
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

// character/classRow are assigned in beforeAll, so the URL has to be resolved
// inside each test rather than when the loop body is built.
const PAGES = ['character page', 'class page'];
const urlFor = (label) =>
  label === 'character page' ? `/characters/${character.id}` : `/classes/${classRow.id}`;

for (const label of PAGES) {
  test(`${label}: dropdown opens, second click closes, outside click closes`, async ({ page }) => {
    await page.goto(urlFor(label));

    const toggle = page.locator('#export-dropdown button[aria-haspopup="true"]');
    const dropdown = page.locator('#export-dropdown');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dropdown).toHaveClass(/is-active/);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test(`${label}: Escape closes the dropdown`, async ({ page }) => {
    await page.goto(urlFor(label));

    const toggle = page.locator('#export-dropdown button[aria-haspopup="true"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test(`${label}: both export links resolve`, async ({ page }) => {
    await page.goto(urlFor(label));
    await page.locator('#export-dropdown button[aria-haspopup="true"]').click();

    const links = page.locator('#export-menu a[href]');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute('href');
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
    }
  });
}
```

- [ ] **Step 3: Run it**

Run: `bun run test:e2e e2e/specs/11-export-dropdowns.spec.js`
Expected: 6 passed (3 per page).

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/11-export-dropdowns.spec.js
git commit -m "test: cover Alpine export dropdowns on character and class pages (ar-7v3k)"
```

---

## Phase 4 — Remaining forms

### Task 13: Offscreen mission with a linked source (ar-7v3k check 7)

**Files:**
- Create: `e2e/specs/12-offscreen-mission.spec.js`

**Background — this covers a deliberate, human-approved behavior change.** The
"other" fields previously carried `style="display: ;"` — invalid CSS that falls
back to visible — so they showed whenever an offscreen mission existed, even
when the select had a real mission chosen. Now
`views/partials/offscreen-mission-form.handlebars:55` uses
`x-show="sourceId === '__other__'"` with `x-cloak`, so with a linked source they
start **hidden** while the select still shows the linked mission as selected.

Real markup: form root `x-data="{ sourceId: '' }"`
(`offscreen-mission-form.handlebars:1`); the "other" block is `#om-source-other`;
its inputs are `#om-source-name` (`name="source_mission_name_other"`) and
`#om-source-date` (`name="source_mission_date_other"`); the sentinel option
value is `__other__` (line 41).

- [ ] **Step 1: Read the form to find the select's name and how `sourceId` initialises**

```bash
sed -n 1,60p views/partials/offscreen-mission-form.handlebars
```

The `x-data` shown above initialises `sourceId` to `''`. **If it is literally
`{ sourceId: '' }` with no server-rendered initial value, that is a defect for
the edit case** — a linked mission would leave `sourceId` empty rather than
matching the selected option. Check whether the edit template
(`views/offscreen-mission-edit.handlebars`) passes `currentSourceId`
(`routes/characters.js:506` sets it) into the partial. Record what you find
before writing the spec; the spec below asserts correct behavior either way.

- [ ] **Step 2: Write the spec**

```js
// e2e/specs/12-offscreen-mission.spec.js
//
// ar-7v3k check 7 — a deliberate behaviour change. The "other" source fields
// used to carry style="display: ;" (invalid CSS, falls back to visible) and so
// appeared even when a real mission was linked. They must now start hidden
// while the select still shows the linked mission as selected.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter, seedOffscreenMission } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('offscreen');
let db;
let character;
let offscreen;
let hasLinkedSource = false;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  character = await seedCharacter(prefix, profile, classRow);

  // A linked source mission, if one exists to link to. Without any mission in
  // the database the "linked" case is untestable — record that as a skip
  // rather than silently testing the unlinked path instead.
  const { rows: missions } = await db.query('select id from missions limit 1');
  hasLinkedSource = !!missions[0];
  offscreen = await seedOffscreenMission(character.id, profile.id, {
    name: `${prefix}-offscreen`,
    sourceMissionId: missions[0]?.id || null
  });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('editing a linked offscreen mission starts with the other fields hidden', async ({ page }) => {
  test.skip(!hasLinkedSource, 'no mission in the database to link as an offscreen source');
  await page.goto(`/characters/${character.id}/offscreen-missions/${offscreen.id}/edit`);

  await expect(page.locator('#om-source-other')).toBeHidden();

  // The select must still show the linked mission, not fall back to blank.
  const select = page.locator('select').first();
  await expect(select).not.toHaveValue('__other__');
  await expect(select).not.toHaveValue('');
});

test('choosing "Other" reveals the other fields', async ({ page }) => {
  await page.goto(`/characters/${character.id}/offscreen-missions/${offscreen.id}/edit`);

  await page.locator('select').first().selectOption('__other__');
  await expect(page.locator('#om-source-other')).toBeVisible();
  await expect(page.locator('#om-source-name')).toBeVisible();
  await expect(page.locator('#om-source-date')).toBeVisible();
});

test('a new offscreen mission starts with the other fields hidden', async ({ page }) => {
  await page.goto(`/characters/${character.id}/offscreen-missions/new`);
  await expect(page.locator('#om-source-other')).toBeHidden();
});
```

- [ ] **Step 3: Run it**

Run: `bun run test:e2e e2e/specs/12-offscreen-mission.spec.js`
Expected: 3 passed, or a skip if the local database has no missions.

If the first test fails because the select is blank, that confirms the Step 1
suspicion: `sourceId` never receives the server's `currentSourceId`. **Record it,
do not fix the template.**

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/12-offscreen-mission.spec.js
git commit -m "test: cover offscreen mission linked-source field visibility (ar-7v3k)"
```

---

### Task 14: Page editor slug stability (ar-7v3k check 8)

**Files:**
- Create: `e2e/specs/13-page-slug.spec.js`

**Real markup** (`views/page-form.handlebars:15-29`): the form is `#page-form`
with `x-data="pageSlug({{json page.title}}, {{json page.slug}})"`; `#title` has
`x-model="title" @input="onTitle()"`; `#slug` has `x-model="slug" @input="auto = false"`.
The `pageSlug` component is at `public/js/alpine-components.js:52`. Two
behaviors matter: an existing page's slug must not move when the title is
untouched, and the auto-fill must re-arm when the slug field is cleared
(commit `e626499`).

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/13-page-slug.spec.js
//
// ar-7v3k check 8. The slug auto-fill replaced a deleted inline script. On an
// EXISTING page the slug is part of the public URL, so an auto-fill that
// re-fires on load or on an unrelated edit silently breaks every inbound link.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, cleanupByPrefix } = require('../fixtures/db');
const { supabaseAdmin } = require('../../models/_base');
const { ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('page');
const ORIGINAL_SLUG = `${prefix}-original-slug`;
let db;
let pageRow;

test.beforeAll(async () => {
  db = await connect();
  const { data, error } = await supabaseAdmin.from('pages').insert({
    title: `${prefix}-title`,
    slug: ORIGINAL_SLUG,
    content: 'Fixture content',
    access_level: 'public',
    is_published: true
  }).select().single();
  if (error) throw error;
  pageRow = data;
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('an existing page loads with title and slug populated', async ({ page }) => {
  await page.goto(`/pages/${pageRow.id}/edit`);
  await expect(page.locator('#title')).toHaveValue(`${prefix}-title`);
  await expect(page.locator('#slug')).toHaveValue(ORIGINAL_SLUG);
});

test('saving without touching the slug leaves the URL unchanged', async ({ page }) => {
  await page.goto(`/pages/${pageRow.id}/edit`);
  await page.locator('#page-form button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle');

  const { rows } = await db.query('select slug from pages where id = $1', [pageRow.id]);
  expect(rows[0].slug).toBe(ORIGINAL_SLUG);
});

test('editing the title of an existing page does not move its slug', async ({ page }) => {
  await page.goto(`/pages/${pageRow.id}/edit`);
  await page.locator('#title').fill(`${prefix}-a-completely-different-title`);
  await expect(page.locator('#slug')).toHaveValue(ORIGINAL_SLUG);
});

test('clearing the slug re-arms auto-fill from the title', async ({ page }) => {
  await page.goto(`/pages/${pageRow.id}/edit`);
  await page.locator('#slug').fill('');
  await page.locator('#title').fill('Re Armed Title');
  await expect(page.locator('#slug')).toHaveValue('re-armed-title');
});

test('slugify preserves underscores', async ({ page }) => {
  // Deliberate, human-approved: foo_bar stays foo_bar rather than folding to
  // foo-bar, matching the deleted script (ar-7v3k "Deliberate behavior changes").
  await page.goto('/pages/new');
  await page.locator('#title').fill('foo_bar baz');
  await expect(page.locator('#slug')).toHaveValue('foo_bar-baz');
});
```

- [ ] **Step 2: Confirm the page edit and new routes**

```bash
grep -n "router.get(" routes/pages.js | head
```

Correct `/pages/:id/edit` and `/pages/new` if they differ.

- [ ] **Step 3: Run it**

Run: `bun run test:e2e e2e/specs/13-page-slug.spec.js`
Expected: 5 passed.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/13-page-slug.spec.js
git commit -m "test: cover page slug auto-fill and stability on existing pages (ar-7v3k)"
```

---

### Task 15: LFG form controls (ar-7v3k check 10)

**Files:**
- Create: `e2e/specs/14-lfg-controls.spec.js`

**Real markup:**
- `views/partials/lfg-form.handlebars:2` — `x-data="{ hosting: <bool> }"`, seeded
  from whether the viewer is the post's host; the checkbox at line 29 is
  `input[type="checkbox"][name="host_id"]` with `x-model="hosting"`; the
  character picker is `#character-select` with `x-show="!hosting"` and `x-cloak`.
- `views/partials/lfg-join-form.handlebars:1` — `x-data="{ joinType: 'player' }"`;
  radios `#join-player-opt` (`value="player"`) and a `value="conduit"` radio,
  both `x-model="joinType"`; `#character-select` is `x-show="joinType === 'player'"`.

Note both partials use the id `#character-select`, so scope every locator to its
form.

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/14-lfg-controls.spec.js
//
// ar-7v3k check 10. Both LFG forms gained Alpine-driven conditional sections.
// The create-form case has to start on a post where the viewer IS the host,
// because `hosting` initialises from the server-rendered value — the bug this
// would catch is an initialiser that ignores it and defaults to false.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { supabaseAdmin } = require('../../models/_base');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('lfg');
let db;
let hostedPost;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);

  const { data, error } = await supabaseAdmin.from('lfg_posts').insert({
    title: `${prefix}-hosted-post`,
    description: 'Fixture LFG post',
    date: '2027-01-01T18:00:00Z',
    creator_id: profile.id,
    host_id: profile.id,          // the viewer IS the host
    max_characters: 4,
    is_public: true
  }).select().single();
  if (error) throw error;
  hostedPost = data;
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('the create form starts hosting, hiding the character picker', async ({ page }) => {
  await page.goto(`/lfg/${hostedPost.id}/edit`);

  const form = page.locator('form:has(input[name="host_id"])');
  const hosting = form.locator('input[type="checkbox"][name="host_id"]');
  const picker = form.locator('#character-select');

  await expect(hosting).toBeChecked();
  await expect(picker).toBeHidden();

  await hosting.uncheck();
  await expect(picker).toBeVisible();

  await hosting.check();
  await expect(picker).toBeHidden();
});

test('the join form radios toggle the character picker', async ({ page }) => {
  await page.goto(`/lfg/${hostedPost.id}`);

  const form = page.locator('form:has(#join-player-opt)');
  test.skip(await form.count() === 0, 'no join form on this post for the current viewer');

  const picker = form.locator('#character-select');
  await expect(picker).toBeVisible();

  const conduit = form.locator('input[type="radio"][value="conduit"]');
  test.skip(await conduit.isDisabled(), 'conduit option disabled because the post has a host');

  await conduit.check();
  await expect(picker).toBeHidden();

  await form.locator('#join-player-opt').check();
  await expect(picker).toBeVisible();
});

test('join requests still lazy-load on demand', async ({ page }) => {
  await page.goto(`/lfg/${hostedPost.id}`);

  const toggle = page.locator('[hx-get*="join-requests"]').first();
  test.skip(await toggle.count() === 0, 'no join-requests toggle rendered');

  await toggle.click();
  await expect(page.locator('#join-requests, [id*="join-request"]').first()).toBeVisible();
});
```

- [ ] **Step 2: Confirm the LFG routes**

```bash
grep -n "router.get(" routes/lfg.js | head -15
```

Correct `/lfg/:id` and `/lfg/:id/edit` if they differ.

- [ ] **Step 3: Run it**

Run: `bun run test:e2e e2e/specs/14-lfg-controls.spec.js`
Expected: 3 passed, or skips where the fixture post does not present that form.

Skips are acceptable here and must be listed in the findings report as
**uncovered**, not as passing.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/14-lfg-controls.spec.js
git commit -m "test: cover LFG create and join form conditional sections (ar-7v3k)"
```

---

## Phase 5 — Auth redirect

### Task 16: Auth redirect no longer traps the user (ar-h6rt)

**Files:**
- Create: `e2e/specs/15-auth-redirect.spec.js`

**Background:** `redirectTo()` (`public/js/app.js:955-965`) performs an htmx body
swap without touching `window.location`, so the address bar kept showing
`/auth/check?r=%2Fnav%2Fmanage` while the body showed `/nav/manage`.
`getRedirectUrl()` then re-read the same stale `?r=` on every later auth event
and swapped the body back — an unescapable loop. The fixes on this branch
(`af2b098`, `43c6120`, `a324968`, `b072d4a`) sync the address bar and stop the
deferred timer from undoing a boosted navigation.

The open-redirect guards must survive: `getRedirectUrl` rejects
protocol-relative (`//evil.com`), absolute, and backslash-prefixed
(`/\evil.com`) values. The client is **stricter** than the server, which only
tests `startsWith('//')` — the stricter rule is the one that must hold.

These tests start **unauthenticated**, then sign in through the form, because
that is the flow that produced the bug.

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/15-auth-redirect.spec.js
//
// ar-h6rt. Starts with NO storageState: the trap only appears on a direct load
// of a protected route, which carries no Authorization header and so bounces
// through /auth/check?r=.
const { test, expect } = require('@playwright/test');
const { ADMIN_EMAIL, ADMIN_PASSWORD } = require('../global-setup');

test.use({ storageState: { cookies: [], origins: [] } });

const signInThroughForm = async (page) => {
  await page.fill('#signin-email', ADMIN_EMAIL);
  await page.fill('#signin-password', ADMIN_PASSWORD);
  await page.click('#signin-submit');
};

test('after an auth redirect the address bar matches the rendered page', async ({ page }) => {
  await page.goto('/nav/manage');

  // Bounced to the auth check with the intended destination in ?r=.
  await page.waitForURL(/\/auth/);
  await signInThroughForm(page);

  // The fix: the URL must catch up with the body swap.
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 })
    .toBe('/nav/manage');
  await expect.poll(() => new URL(page.url()).search).toBe('');
});

test('a reload after the redirect lands on the same page', async ({ page }) => {
  await page.goto('/nav/manage');
  await page.waitForURL(/\/auth/);
  await signInThroughForm(page);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/nav/manage');

  await page.reload();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/nav/manage');
});

test('navigating away from the protected page is not bounced back', async ({ page }) => {
  await page.goto('/nav/manage');
  await page.waitForURL(/\/auth/);
  await signInThroughForm(page);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/nav/manage');

  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);

  // The original bug re-armed on later auth events (token refresh, focus).
  // Give the deferred handlers a window to misfire, then confirm we stayed put.
  await page.waitForTimeout(3000);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a boosted navigation is not undone by the deferred timer', async ({ page }) => {
  await page.goto('/auth');
  await signInThroughForm(page);
  await page.waitForFunction(() => !!localStorage.getItem('authToken'), null, { timeout: 15_000 });

  await page.goto('/');
  const link = page.locator('a[href]:not([href^="http"]):not([href^="#"])').first();
  const href = await link.getAttribute('href');
  await link.click();
  await page.waitForURL((url) => url.pathname === href);

  // The 100 ms timer captured a URL at event time; it must not yank us back.
  await page.waitForTimeout(2000);
  expect(new URL(page.url()).pathname).toBe(href);
});

for (const hostile of ['//evil.com', '/\\evil.com', 'https://evil.com', '///evil.com']) {
  test(`rejects a hostile ?r= value: ${hostile}`, async ({ page, baseURL }) => {
    await page.goto(`/auth/check?r=${encodeURIComponent(hostile)}`);
    await signInThroughForm(page);
    await page.waitForTimeout(2000);

    // Never navigated off-origin, and never wrote the hostile value into the
    // address bar — which would persist and be copyable, strictly worse than
    // the body swap it replaced.
    expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin);
    expect(page.url()).not.toContain('evil.com');
  });
}
```

- [ ] **Step 2: Run it**

Run: `bun run test:e2e e2e/specs/15-auth-redirect.spec.js --workers=1`
Expected: 8 passed.

Run this file with `--workers=1`: several tests sign in from a clean state and
share the app's Supabase client behavior around token refresh.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/15-auth-redirect.spec.js
git commit -m "test: cover the auth redirect address-bar sync and open-redirect guards (ar-h6rt)"
```

---

## Phase 6 — CI, documentation, findings

### Task 17: Wire CI, document the tier, and publish the findings report

**Files:**
- Create: `.github/workflows/e2e.yml`
- Create: `docs/superpowers/reports/2026-08-03-e2e-findings.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: the pass/fail verdict recorded during Tasks 4-16.

- [ ] **Step 1: Run the whole suite and capture the verdict**

```bash
bun run test:e2e 2>&1 | tee /tmp/e2e-full-run.txt
```

Record, for every spec: passed / failed / skipped. Do not proceed with a guess —
this run is the report's evidence.

- [ ] **Step 2: Write the findings report**

Create `docs/superpowers/reports/2026-08-03-e2e-findings.md` with this exact
structure, filling in real results:

```markdown
# E2E Browser Tier — Findings

**Run date:** <date>
**Branch:** <branch>
**Command:** `bun run test:e2e`
**Result:** <N passed, N failed, N skipped>

## Summary

| ar-7v3k check | Spec | Verdict |
| --- | --- | --- |
| 1 Level-up modal | `05-level-up-modal.spec.js` | |
| 2 Boosted nav settle | `09-boosted-nav-settle.spec.js` | |
| 3 Stats editor | `04-stats-editor.spec.js` | |
| 4 Perk textarea | `03-perk-textarea.spec.js` | |
| 5 Deceased modal | `06-deceased-modal.spec.js` | |
| 6 Unlock-code modal | `07-unlock-code-modal.spec.js` | |
| 7 Offscreen mission | `12-offscreen-mission.spec.js` | |
| 8 Page editor slug | `13-page-slug.spec.js` | |
| 9 My Classes duplicate | `08-my-classes-duplicate.spec.js` | |
| 10 LFG controls | `14-lfg-controls.spec.js` | |
| 11 Export dropdowns | `11-export-dropdowns.spec.js` | |
| 12 Back button | `10-back-button-snapshot.spec.js` | |
| ar-h6rt auth redirect | `15-auth-redirect.spec.js` | |

## Failures

For each failure:

### <spec name> — <one-line description>

- **What the spec asserted:**
- **What happened:**
- **Trace:** `e2e/report/artifacts/<dir>/trace.zip` (open with `bunx playwright show-trace <path>`)
- **Diagnosis:** (file:line of the suspected cause — no fix applied)
- **Severity:** data loss / broken behavior / cosmetic

## Skipped and uncovered

List every `test.skip` that fired and why. A skip is **not** a pass.

## Expectation bugs corrected

Any spec whose expectation was wrong rather than the product, with reasoning.
```

- [ ] **Step 3: Create the CI workflow**

```yaml
# .github/workflows/e2e.yml
name: E2E browser tests

on:
  pull_request:
    paths:
      - 'public/**'
      - 'views/**'
      - 'routes/**'
      - 'models/**'
      - 'services/**'
      - 'util/**'
      - 'supabase/**'
      - 'scripts/**'
      - 'e2e/**'
      - 'playwright.config.js'
      - 'package.json'
      - 'bun.lock'
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: supabase/setup-cli@v1
      - run: bun install --frozen-lockfile
      - run: supabase start
      - run: supabase db reset
      - name: Seed local app data
        run: |
          eval "$(supabase status -o env)"
          SUPABASE_URL="$API_URL" \
          SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" \
          SUPABASE_SECRET_KEY="$SERVICE_ROLE_KEY" \
          SUPABASE_DB_URL="$DB_URL" \
          bun run seed:local
      - run: bunx playwright install --with-deps chromium
      - name: Run E2E suite
        run: |
          eval "$(supabase status -o env)"
          SUPABASE_URL="$API_URL" \
          SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" \
          SUPABASE_SECRET_KEY="$SERVICE_ROLE_KEY" \
          SUPABASE_DB_URL="$DB_URL" \
          bun run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            e2e/report/html
            e2e/report/artifacts
          retention-days: 7
```

Note: this workflow deliberately has **no `push: branches: [main]` trigger**
while failing specs remain. Add it only after the findings are triaged.

- [ ] **Step 4: Document the tier in `README.md`**

Add a "Testing" subsection listing all four tiers:

```markdown
### Testing

| Command | Tier | Requires |
| --- | --- | --- |
| `bun run test` | Unit (jsdom, no DB) | nothing |
| `bun run test:http` | HTTP (Express + mocked models) | nothing |
| `bun run test:integration` | Integration (real Supabase) | `supabase start` |
| `bun run test:e2e` | End-to-end (Chromium) | `supabase start` + `bun run seed:local` |

The E2E tier boots its own server on port 3100, so it runs alongside
`bun run dev`. It seeds and deletes its own rows under an `e2e-` prefix and
never resets your database.

Open the report for a failed run with:

```sh
bunx playwright show-report e2e/report/html
```
```

- [ ] **Step 5: Document the conventions in `CONTRIBUTING.md`**

Add: new E2E specs go in `e2e/specs/`, seed through `e2e/fixtures/` under a
prefix from `newPrefix()`, clean up in `afterAll`, and pick an identity with
`test.use({ storageState: ADMIN_STATE })` or `PLAYER_STATE`. Unlike the other
tiers, there is no file to register — Playwright discovers `e2e/specs/*.spec.js`
automatically.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/e2e.yml docs/superpowers/reports README.md CONTRIBUTING.md
git commit -m "docs: document the e2e tier and record its first-run findings (ar-7v3k, ar-h6rt)"
```

- [ ] **Step 7: Report to the user — do not merge**

Present the findings table and stop. The triage decision is the user's:
fix the defects, mark specs `test.fixme()` with ticket references, or accept
them. Only after that decision should `push: branches: [main]` be added to the
workflow and `ar-7v3k`'s "BLOCKING: manual browser verification" section be
replaced with a reference to this suite.

---

## Self-Review Notes

**Spec coverage:** all thirteen checks in the design's spec inventory have a
task (4-16); the infrastructure sections map to Tasks 1-3; CI, documentation,
reporting, and the `.gitignore` entries map to Tasks 1 and 17.

**Known selector risk:** the sign-in form (Task 2), level-up partial (Task 6),
character-form submit (Task 4), unlock-code generate button (Task 8), and the
export dropdown's Escape binding (Task 12) each carry an explicit verification
step because their exact ids were not read while writing this plan. Every other
selector in this plan was read from the template and is quoted with its
file and line.

**Deliberate deviation from red-green-refactor:** these are characterization
tests, expected green on first run. The TDD cycle does not apply, and the
"do not fix production code" rule in Global Constraints is what replaces it.
