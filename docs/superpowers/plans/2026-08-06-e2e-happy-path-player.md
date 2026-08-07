# E2E Happy-Path Coverage (Player-Facing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the create → view → edit → delete lifecycle of every player-facing feature with Playwright specs that drive the real UI, and fix the defects those specs expose.

**Architecture:** New specs join the existing browser tier at `e2e/specs/`, continuing the `NN-topic.spec.js` numbering from 16. Each spec seeds prerequisites through the existing fixture seams (`e2e/fixtures/*`), performs the lifecycle through the browser, and asserts every mutation landed by reading Postgres directly with `pg`. Three production defects (D1 htmx URL-param serialisation, D2 a missing FK cascade, D3 a 204 that htmx cannot swap) are fixed inside the task whose spec needs them, red test first.

**Tech Stack:** Playwright 1.62 (chromium only), Bun, Express 4, Handlebars, htmx 2.0.8, Alpine 3.15.12, Supabase (local), `pg` for direct DB assertions.

**Design doc:** `docs/superpowers/specs/2026-08-06-e2e-happy-path-design.md`

## Global Constraints

These apply to **every** task. They are measured behaviours of this app, not style preferences — ignoring any one of them produces a spec that passes vacuously or fails for the wrong reason.

- **Prereqs:** `supabase start` must be running and `SUPABASE_URL=http://127.0.0.1:54321`. `playwright.config.js:10-18` throws otherwise. Run `bun run seed:local` once before starting. Run specs with `bunx playwright test <file>`.
- **`page.on('dialog', d => d.accept())` must be registered BEFORE any click on a control carrying `hx-confirm`.** Every delete/leave/unjoin button in this app uses `hx-confirm`, which is native `window.confirm`. Playwright auto-**dismisses** dialogs, so without this the click silently no-ops and a naive "row still gone?" assertion passes for the wrong reason. No `htmx:confirm` override exists in `public/js/`.
- **`await page.waitForLoadState('networkidle')` after every `page.goto()`.** `public/js/app.js:970-989` replaces the entire `<body>` via an htmx `outerHTML` swap on every authenticated page load, discarding all Alpine components created at first parse.
- **Never `fill()` a `textarea[data-toast-editor]`.** `public/js/app.js:610-619` sets those to `display:none !important; left:-9999px`. Write into the sibling ProseMirror instead: `page.locator('.toastui-editor-container .ProseMirror').fill(text)`. Affected fields are called out per task.
- **Never `selectOption()` a `select[data-searchable-select]`.** Those are Tom Select-enhanced (`public/js/app.js:802-828`); the underlying select is hidden, so `required` validation reports "not focusable" and blocks submit with no visible error. On the character form this is `gear[]` and `abilities[]` — the happy path simply does not add those rows.
- **All other selects in scope are plain native** — `selectOption()` works on `class_id`, `trait0-2`, `mission-outcome`, `lfg-character`, `characterId`, `status`.
- **`hx-redirect` is not an htmx attribute and is implemented nowhere.** Never assert on it. Navigation comes from the server's `HX-Location` header. The destinations differ from what the markup claims — each task states the real one.
- **Every fixture row's name/title MUST start with the spec's `newPrefix()` value**, including rows created through the UI. `cleanupByPrefix` deletes by `LIKE prefix || '%'`; an unprefixed row leaks and pollutes later runs.
- **Assert deletions against Postgres, never against the DOM.** Several delete routes return 204, which htmx does not swap, so the row remains on screen even on success.
- **Alpine liveness is checked with `'<key>' in Alpine.$data(el)`, never `!!Alpine.$data(el)`** — `$data` returns a truthy Proxy for any element (`e2e/specs/00-smoke.spec.js:56-68`).
- **Seeded classes need ≥2 abilities** (the `e2e/fixtures/class.js` default). A one-ability class trips a Handlebars context-depth bug that leaves the required Tom Select empty and blocks submit (`e2e/specs/03-perk-textarea.spec.js:16-21`).
- **Any spec that opens `/characters/:id/edit` MUST call `unlockClassForProfile(profile, classRow)` first.** Otherwise it hits the known, deliberately-unfixed class-reassignment defect (`e2e/specs/03b-class-reassignment.spec.js`) and fails for an unrelated reason.
- **Commit prefix:** `test:` for spec-only commits, `fix:` for production fixes, matching repo history.

---

## Task 1: Character create → view → edit (spec 17, part 1)

**Files:**
- Create: `e2e/specs/17-characters-crud.spec.js`

**Interfaces:**
- Consumes: `connect, newPrefix, profileForEmail, cleanupByPrefix` (`e2e/fixtures/db.js`); `seedClass, unlockClassForProfile` (`e2e/fixtures/class.js`); `PLAYER_EMAIL, PLAYER_STATE` (`e2e/global-setup.js`).
- Produces: the file, the `prefix`/`db`/`classRow` module-scope setup, and the `createCharacterViaUi(page, name)` helper that Tasks 2 and 3 reuse.

- [ ] **Step 1: Write the spec file**

```js
// e2e/specs/17-characters-crud.spec.js
//
// Happy-path lifecycle for characters, driven through the real UI. The
// existing browser tier is entirely regression-shaped -- each spec targets one
// previously-identified defect mechanism -- so nothing in it walks a feature
// end to end. Character delete was completely broken in the running app while
// the suite sat at 80/83.
//
// WHY CREATE GOES THROUGH THE FORM. Seeding via e2e/fixtures/character.js
// would skip routes/characters.js:570 entirely -- the code most likely to be
// broken. Fixtures here cover only the PREREQUISITE (a class that exists and
// is unlocked), never the thing under test.
//
// THE VACUITY TRAP THIS FILE IS BUILT AROUND: a lifecycle test passes
// vacuously if an earlier stage silently failed. If create never happened,
// "edit round-trips" and "delete removed it" are both trivially true against
// nothing. So every stage asserts its own effect reached Postgres before the
// next stage runs, and each stage reads the row by id rather than by name.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('char-crud');
let db;
let profile;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  // v1: the v2 blocks add required quirk/accessory/perk controls that the
  // happy path has no reason to exercise. Two abilities is the fixture
  // default and is load-bearing -- see the global constraints.
  classRow = await seedClass(prefix, { rulesVersion: 'v1' });
  // Required for /characters/:id/edit to render an option for this class.
  await unlockClassForProfile(profile, classRow);
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

// Fills the minimum required set on /characters/new/expert and submits.
// Returns the new character's id, read from the URL the server sent us to.
//
// Only these eight controls are `required` on a fresh create form. Gear and
// ability rows do not exist until their "Add" buttons are clicked, and both
// are Tom Select-enhanced -- adding one would block submit (global
// constraints), so the happy path leaves them alone.
async function createCharacterViaUi(page, name) {
  await page.goto('/characters/new/expert');
  await page.waitForLoadState('networkidle');

  await page.fill('#char-name', name);
  await page.selectOption('#char-class-id', classRow.id);
  await page.fill('#char-level', '1');
  await page.fill('#char-completed-missions', '0');
  await page.fill('#char-commissary-reward', '0');
  // Trait options come from personalityMap (util/enclave-consts.js:16+).
  // Selected by index so this spec does not hardcode game content that may
  // legitimately change.
  await page.selectOption('#trait0', { index: 1 });
  await page.selectOption('#trait1', { index: 2 });
  await page.selectOption('#trait2', { index: 3 });

  // Stat blocks are a widget: the POSTed control is a hidden input whose
  // value Alpine binds (views/partials/stat-blocks.handlebars:57), so fill()
  // cannot touch it. Click the 3rd block (nth is 0-based -> value 3) and
  // assert the hidden input actually moved, so a dead widget fails here
  // rather than silently posting 0.
  await page.locator('.stat-blocks[data-stat="might"] [role="radio"]').nth(2).click();
  await expect(page.locator('input[name="might"]')).toHaveValue('3');

  await page.locator('form[hx-post] button[type="submit"]').click();

  // routes/characters.js:613 answers HX-Location /characters/{id}/{name} --
  // NOT /characters, despite the form's inert hx-redirect attribute.
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}/);
  const id = page.url().match(/\/characters\/([0-9a-f-]{36})/)[1];
  return id;
}

test('a character can be created through the expert form', async ({ page }) => {
  const name = `${prefix} Created`;
  const id = await createCharacterViaUi(page, name);

  const { rows } = await db.query(
    'select name, class_id, level, might from characters where id = $1', [id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(name);
  expect(rows[0].class_id).toBe(classRow.id);
  expect(Number(rows[0].level)).toBe(1);
  expect(Number(rows[0].might)).toBe(3);
});

test('the character page shows the character that was just created', async ({ page }) => {
  const name = `${prefix} Viewable`;
  const id = await createCharacterViaUi(page, name);

  await page.goto(`/characters/${id}`);
  await page.waitForLoadState('networkidle');

  // #statsBox carries data-character-name (views/character.handlebars:203) --
  // a machine-readable anchor, unlike the h1 which also holds the deceased
  // tag and private badge. Same positive precondition 04-stats-editor.spec.js
  // uses at :133.
  await expect(page.locator('#statsBox')).toHaveAttribute('data-character-name', name);
  await expect(page.locator('h1.title.is-2')).toContainText(name);
});

test('editing a character round-trips the change to the database', async ({ page }) => {
  const name = `${prefix} Editable`;
  const id = await createCharacterViaUi(page, name);
  const renamed = `${prefix} Edited`;

  await page.goto(`/characters/${id}/edit`);
  await page.waitForLoadState('networkidle');

  await page.fill('#char-name', renamed);
  await page.locator('form[hx-put] button[type="submit"]').first().click();

  // Not /\/characters\// -- the edit page already matches that, so
  // waitForURL would resolve before the save happened
  // (03b-class-reassignment.spec.js:91-95).
  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));

  const { rows } = await db.query(
    'select name, class_id from characters where id = $1', [id]
  );
  expect(rows[0].name).toBe(renamed);
  // The class must NOT have moved. This is the same assertion 03b makes; it
  // passes here only because beforeAll unlocked the class for this profile.
  expect(rows[0].class_id).toBe(classRow.id);
});
```

Note: `createCharacterViaUi` is NOT exported. Tasks 2 and 3 append their tests to
this same file, so the helper is already in scope; exporting it from a spec file
would be dead code.

- [ ] **Step 2: Run the spec**

Run: `bunx playwright test e2e/specs/17-characters-crud.spec.js`
Expected: 3 PASS.

If create fails on a hidden required control, read the failure carefully before changing the spec — `views/character-form.handlebars` renders both v1 and v2 blocks and only toggles visibility (`public/js/character-form-version.js:39-43`). A required control inside a `hidden` block blocks submit invisibly and is a real defect worth reporting, not a spec bug to work around.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/17-characters-crud.spec.js
git commit -m "test: cover character create, view, and edit happy paths"
```

---

## Task 2: Fix D1 — the edit-page Delete button serialises the whole form

**Files:**
- Modify: `e2e/specs/17-characters-crud.spec.js` (append one test)
- Modify: `views/partials/head.handlebars:4`
- Modify: `views/character-form.handlebars:15` and `:389` (remove inert `hx-redirect`)
- Modify: `views/mission.handlebars:84` (remove inert `hx-redirect`)

**Interfaces:**
- Consumes: `createCharacterViaUi` from Task 1.
- Produces: an app-wide htmx config in which DELETE no longer appends form state to the URL. Task 3 and Task 7 both depend on this.

- [ ] **Step 1: Write the failing test**

Append to `e2e/specs/17-characters-crud.spec.js`:

```js
// D1. htmx 2.0.8 defaults methodsThatUseUrlParams to ['get', 'delete'], and
// for a non-GET verb getInputValues() includes the RELATED FORM -- so the
// Delete button at views/character-form.handlebars:388, which sits inside the
// <form hx-put> opened at :14, sends all 20 named fields plus 7 rich-text
// areas as query parameters. A real character exceeds Node's 16 KB
// maxHeaderSize (the request line counts against it) and is rejected with a
// 431 before Express sees it; a nearly-empty one fits and works, which is why
// this reads as "broken in real use, fine in dev".
//
// The load-bearing assertion is on the REQUEST URL, not on payload size.
// Asserting "a big character fails to delete" would make the test a function
// of how much text the fixture happens to carry, and would pass today for a
// small one. Asserting the query string is empty characterises the defect
// itself and is size-independent.
test('deleting from the edit page sends a bare URL and removes the character', async ({ page }) => {
  const name = `${prefix} Deletable`;
  const id = await createCharacterViaUi(page, name);

  const deleteUrls = [];
  page.on('request', (r) => {
    if (r.method() === 'DELETE') deleteUrls.push(r.url());
  });
  // hx-confirm is native window.confirm and Playwright auto-DISMISSES
  // dialogs. Without this the click is a silent no-op and every assertion
  // below would be measuring nothing.
  page.on('dialog', (d) => d.accept());

  await page.goto(`/characters/${id}/edit`);
  await page.waitForLoadState('networkidle');

  await page.locator('form[hx-put] button[hx-delete]').click();

  // routes/characters.js:1009 answers HX-Location: /characters
  await page.waitForURL((url) => url.pathname === '/characters');

  expect(deleteUrls).toHaveLength(1);
  expect(
    new URL(deleteUrls[0]).search,
    'the DELETE must not carry the edit form as query parameters'
  ).toBe('');

  const { rows } = await db.query('select id from characters where id = $1', [id]);
  expect(rows).toHaveLength(0);
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

Run: `bunx playwright test e2e/specs/17-characters-crud.spec.js -g "bare URL"`
Expected: FAIL on the `new URL(...).search` assertion, with a received value beginning `?name=...`. If it instead fails on `waitForURL`, the request was rejected outright — also D1, and the fix is the same.

- [ ] **Step 3: Apply the fix**

`views/partials/head.handlebars:4` — replace:

```html
  <meta name="htmx-config" content='{"includeIndicatorStyles": false, "defaultSettleDelay": 0}'>
```

with:

```html
  <!-- methodsThatUseUrlParams: htmx 2.x defaults this to ["get","delete"], which
       serialises a delete button's related form into the request URL. The
       character edit form's Delete button (character-form.handlebars:388) sits
       inside the <form hx-put>, so that overflowed Node's 16 KB maxHeaderSize
       and made character deletion fail. No DELETE route in this app reads query
       parameters -- they are all path-based. -->
  <meta name="htmx-config" content='{"includeIndicatorStyles": false, "defaultSettleDelay": 0, "methodsThatUseUrlParams": ["get"]}'>
```

Then delete the three inert `hx-redirect` attributes. `hx-redirect` is not an htmx attribute and no handler for it exists in `public/js/`, `util/`, or `routes/`; the real navigation is the server's `HX-Location` header.

- `views/character-form.handlebars:15` — remove `hx-redirect="..."` from the `<form>` tag.
- `views/character-form.handlebars:389` — remove `hx-redirect="/characters"` from the Delete button.
- `views/mission.handlebars:84` — remove `hx-redirect="/missions"` from the Delete Mission button.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx playwright test e2e/specs/17-characters-crud.spec.js`
Expected: 4 PASS.

- [ ] **Step 5: Run the full suite to check the config change broke nothing**

Run: `bunx playwright test --workers=1`
Expected: **zero failures.** Baseline corrected 2026-08-07 — the full suite passes 86/86 at commit `ced3fef`. Any failure here is a regression from the htmx config change, which is app-wide and therefore the highest-risk edit in this plan. Serial workers avoid the `11-export-dropdowns.spec.js:186` parallelism flake.

Also run: `bun run test:http`
Expected: PASS. Route-level DELETE handlers read path params only, so this should be unaffected — confirm rather than assume.

- [ ] **Step 6: Commit**

```bash
git add views/partials/head.handlebars views/character-form.handlebars views/mission.handlebars e2e/specs/17-characters-crud.spec.js
git commit -m "fix: stop htmx serialising the edit form into DELETE request URLs"
```

---

## Task 3: Fix D2 — deleting a character that joined an LFG game

**Files:**
- Create: `supabase/migrations/20260806000000_lfg_join_requests_character_set_null.sql`
- Modify: `util/http-error.js:20-22` (add a `23503` case)
- Modify: `e2e/specs/17-characters-crud.spec.js` (append one test)

**Interfaces:**
- Consumes: `createCharacterViaUi` (Task 1); the D1 fix (Task 2) must already be in place or the delete fails for that reason instead; `seedLfgPost, seedJoinRequest` (`e2e/fixtures/lfg.js`).
- Produces: `classifyError` returning `{status: 409, title: 'Still in use', ...}` for Postgres `23503`.

- [ ] **Step 1: Write the failing test**

Append to `e2e/specs/17-characters-crud.spec.js` — and add `seedLfgPost, seedJoinRequest` to the requires at the top of the file:

```js
const { seedLfgPost, seedJoinRequest } = require('../fixtures/lfg');
```

```js
// D2. lfg_join_requests.character_id is the ONLY foreign key pointing at
// characters without an ON DELETE action (baseline_schema.sql:222; verified
// against the live local DB -- every other one is 'c', this one is 'a'). So a
// character that has ever joined a game cannot be deleted at all: Postgres
// raises 23503, util/http-error.js has no branch for it, and the user gets a
// bare 500 reading "An unexpected error occurred."
//
// e2e/fixtures/db.js:37-49 already documents this FK and deletes join
// requests by hand during cleanup, which is why no existing spec ever hit it.
//
// SET NULL rather than CASCADE: the join request is the host's record that
// someone joined their game. Deleting an old character should not silently
// remove a player from a host's roster or from a closed post's history.
test('a character that joined an LFG game can still be deleted', async ({ page }) => {
  const name = `${prefix} Joined`;
  const id = await createCharacterViaUi(page, name);

  const post = await seedLfgPost(prefix, profile, { title: `${prefix} Post`, hosting: true });
  const request = await seedJoinRequest(post, profile, { joinType: 'player', characterId: id });

  page.on('dialog', (d) => d.accept());
  await page.goto(`/characters/${id}/edit`);
  await page.waitForLoadState('networkidle');
  await page.locator('form[hx-put] button[hx-delete]').click();
  await page.waitForURL((url) => url.pathname === '/characters');

  const { rows: charRows } = await db.query(
    'select id from characters where id = $1', [id]
  );
  expect(charRows, 'the character must actually be gone').toHaveLength(0);

  // The host's record of the join survives, with the character detached.
  const { rows: reqRows } = await db.query(
    'select character_id from lfg_join_requests where id = $1', [request.id]
  );
  expect(reqRows).toHaveLength(1);
  expect(reqRows[0].character_id).toBeNull();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bunx playwright test e2e/specs/17-characters-crud.spec.js -g "joined an LFG game"`
Expected: FAIL — the character row is still present, because the DELETE was rejected with 23503 and surfaced as a 500 into `#alerts` without changing the URL. If `seedJoinRequest` returns a shape without `.id`, read `e2e/fixtures/lfg.js:76-91` and adjust the destructuring; the assertion is on the row, not the helper's return shape.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260806000000_lfg_join_requests_character_set_null.sql`:

```sql
-- lfg_join_requests.character_id was declared as a bare
-- "REFERENCES characters(id)" in 20240101000000_baseline_schema.sql:222, with
-- no ON DELETE action -- the only FK to characters lacking one. Any character
-- that had ever joined a game therefore could not be deleted: Postgres raised
-- 23503 and the user saw a generic 500.
--
-- SET NULL, not CASCADE: a join request is the host's record that a player
-- joined their game. It carries its own join_type and status and remains
-- meaningful without the character. Cascading would silently remove players
-- from a host's roster and from the history of closed posts.
alter table lfg_join_requests
  drop constraint lfg_join_requests_character_id_fkey;

alter table lfg_join_requests
  add constraint lfg_join_requests_character_id_fkey
  foreign key (character_id) references characters(id) on delete set null;
```

- [ ] **Step 4: Apply the migration locally**

Run: `supabase migration up`
Expected: the new migration applies.

If that reports the local database is out of sync with the migration history, fall back to `supabase db reset && bun run seed:local`. That wipes local data; both `seed-local.mjs` and `global-setup.js`'s `ensurePlayer()` are idempotent, so the suite recovers.

Verify the constraint actually changed:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "select conname, confdeltype from pg_constraint where conname = 'lfg_join_requests_character_id_fkey';"
```
Expected: `confdeltype` is `n` (SET NULL). It was `a` (NO ACTION).

- [ ] **Step 5: Classify 23503 so the next missing cascade is diagnosable**

`util/http-error.js` — add a case beside the existing `23505` at `:20-22`:

```js
    case '23505':
      base = { status: 409, title: 'Already exists', message: 'That already exists.' };
      break;
    // 23503 = foreign_key_violation. Without this branch a blocked delete
    // falls through to a bare 500 reading "An unexpected error occurred.",
    // which is what made the lfg_join_requests FK take so long to find.
    case '23503':
      base = {
        status: 409,
        title: 'Still in use',
        message: "Something else still refers to this, so it can't be deleted yet.",
      };
      break;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bunx playwright test e2e/specs/17-characters-crud.spec.js`
Expected: 5 PASS.

Then: `bun run test:unit && bun run test:http && bun run test:integration`
Expected: PASS. `classifyError` is directly unit-testable and widely used; confirm no existing test asserted a 500 for a 23503.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260806000000_lfg_join_requests_character_set_null.sql util/http-error.js e2e/specs/17-characters-crud.spec.js
git commit -m "fix: let characters with LFG join requests be deleted"
```

---

## Task 4: Character wizard create (spec 18)

**Files:**
- Create: `e2e/specs/18-character-wizard-crud.spec.js`

**Interfaces:**
- Consumes: the same fixture seams as Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec file**

```js
// e2e/specs/18-character-wizard-crud.spec.js
//
// The wizard is a wholly separate create path from the expert form covered by
// 17: five JS-driven steps in public/js/character-wizard.js, its own stat grid
// markup (#statGrid div.wizard-stat-box, NOT the role=radio stat-blocks
// widget), and a submit that POSTs a single JSON `payload` field rather than
// form-encoded fields (character-wizard.handlebars:273-278 ->
// routes/characters.js:270-284).
//
// VACUITY TRAP: every step panel exists in the DOM from first paint and is
// merely toggled with .hidden (character-wizard.js:1497-1515). Asserting a
// step's controls are "present" proves nothing about whether the wizard
// advanced. Assert VISIBILITY of the panel, and assert the Next button's
// disabled state, which is the wizard's own gate.
//
// DRAFT STATE: the wizard persists to localStorage['agentResources.characterWizard'],
// and /characters/new then shows #restoreDraftModal, which intercepts clicks
// on any later run. This spec always enters via the ?fresh=1 bypass
// (character-new-selector.handlebars:7).
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('wizard');
let db;
let profile;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  classRow = await seedClass(prefix, { rulesVersion: 'v1' });
  await unlockClassForProfile(profile, classRow);
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

test('the wizard creates a character end to end', async ({ page }) => {
  const name = `${prefix} Wizard Hero`;

  await page.goto('/characters/wizard?mode=advent&fresh=1');
  await page.waitForLoadState('networkidle');

  // Step 1 -- pick the seeded class. #step1Next is never disabled, so
  // clicking it without a selection would advance into a broken step 2;
  // assert the card registered before moving on.
  const card = page.locator(`#classKioskTrack .wizard-kiosk-card[data-id="${classRow.id}"]`);
  await card.click();
  await expect(card).toHaveClass(/is-selected|selected/);
  await page.locator('#step1Next').click();
  await expect(page.locator('[data-step-panel="2"]')).toBeVisible();

  // Step 2 -- three traits and every stat point spent. #step2Next stays
  // disabled until both conditions hold (character-wizard.js:892, 901), so
  // waiting for it to enable IS the assertion that the step was completed
  // correctly.
  await page.selectOption('#trait1Select', { index: 1 });
  await page.selectOption('#trait2Select', { index: 2 });
  await page.selectOption('#trait3Select', { index: 3 });

  // The wizard grid is JS-generated div.wizard-stat-box[data-stat][data-slot]
  // with data-clickable="1" (character-wizard.js:853) -- no role=radio, no
  // hidden input. Spend every remaining point by clicking clickable boxes
  // until Next enables.
  const next2 = page.locator('#step2Next');
  const boxes = page.locator('#statGrid .wizard-stat-box[data-clickable="1"]');
  for (let i = 0; i < 60 && await next2.isDisabled(); i++) {
    const count = await boxes.count();
    if (count === 0) break;
    await boxes.nth(i % count).click();
  }
  await expect(next2, 'step 2 gate must open once traits and stats are set').toBeEnabled();
  await next2.click();
  await expect(page.locator('[data-step-panel="3"]')).toBeVisible();

  // Step 3 -- ability primer, no gate.
  await page.locator('[data-step-panel="3"] [data-wizard-next]').click();
  await expect(page.locator('[data-step-panel="4"]')).toBeVisible();

  // Step 4 -- advent mode gates on spending the 2 Merx budget
  // (character-wizard.js:1421-1426).
  const next4 = page.locator('#step4Next');
  const spendable = page.locator('#spendList [data-clickable="1"], #spendList button');
  for (let i = 0; i < 20 && await next4.isDisabled(); i++) {
    const count = await spendable.count();
    if (count === 0) break;
    await spendable.nth(i % count).click();
  }
  await expect(next4, 'step 4 gate must open once the Merx budget is spent').toBeEnabled();
  await next4.click();
  await expect(page.locator('[data-step-panel="5"]')).toBeVisible();

  // Step 5 -- #wizardSubmit is disabled until a class is chosen AND the name
  // is non-blank (character-wizard.js:1487-1494).
  await page.fill('#wizardName', name);
  const submit = page.locator('#wizardSubmit');
  await expect(submit).toBeEnabled();
  await submit.click();

  // routes/characters.js:304 answers HX-Location /characters/{id}/{name}
  await page.waitForURL(/\/characters\/[0-9a-f-]{36}/);
  const id = page.url().match(/\/characters\/([0-9a-f-]{36})/)[1];

  const { rows } = await db.query(
    'select name, class_id from characters where id = $1', [id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(name);
  expect(rows[0].class_id).toBe(classRow.id);

  await expect(page.locator('#statsBox')).toHaveAttribute('data-character-name', name);
});
```

- [ ] **Step 2: Run the spec**

Run: `bunx playwright test e2e/specs/18-character-wizard-crud.spec.js`
Expected: PASS.

The two `for` loops are bounded click-until-enabled drivers, not polling hacks: the wizard's budget rules live in JS and depend on the seeded class's data, so the exact number of clicks is not knowable from the markup. If a loop exhausts and the `toBeEnabled` assertion fails, read `public/js/character-wizard.js:853` (stat grid) or `:1421-1426` (Merx budget) and drive the specific control rather than raising the bound.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/18-character-wizard-crud.spec.js
git commit -m "test: cover the character wizard create happy path"
```

---

## Task 5: Mission lifecycle (spec 19)

**Files:**
- Create: `e2e/specs/19-missions-crud.spec.js`

**Interfaces:**
- Consumes: `seedClass, unlockClassForProfile`, `seedCharacter` (`e2e/fixtures/character.js`), db fixtures, `PLAYER_EMAIL/PLAYER_STATE`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec file**

```js
// e2e/specs/19-missions-crud.spec.js
//
// Mission lifecycle through the real UI, including the attach/detach of a
// character -- which is a two-phase mechanism worth pinning: clicking a search
// result immediately POSTs /missions/:id/characters/:characterId
// (routes/missions.js:375) AND appends a hidden characters[] input, and the
// later PUT reconciles membership from those hidden inputs
// (routes/missions.js:338-360). Either half breaking silently loses party
// members.
//
// NAVIGATION IS NOT WHAT THE MARKUP SAYS. mission-form.handlebars:5 carries
// hx-redirect="/missions", which is not an htmx attribute and is implemented
// nowhere. POST /missions actually answers HX-Location /missions/{id}/edit
// (routes/missions.js:217) -- creating a mission lands you on its EDIT page.
//
// TWO INPUTS SHARE name="q" on the edit form (:193 editor search, :245
// character search). A bare [name="q"] locator is ambiguous; both are scoped
// below.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('mission-crud');
let db;
let profile;
let classRow;
let character;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  classRow = await seedClass(prefix, { rulesVersion: 'v1' });
  await unlockClassForProfile(profile, classRow);
  // Seeded, not UI-created: the character is a PREREQUISITE for the
  // attach/detach test, not the thing under test. Spec 17 covers creation.
  character = await seedCharacter(prefix, profile, classRow);
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

async function createMissionViaUi(page, name) {
  await page.goto('/missions/new');
  await page.waitForLoadState('networkidle');

  await page.fill('#mission-name', name);
  // datetime-local, format YYYY-MM-DDTHH:mm (mission-form.handlebars:116).
  await page.fill('#mission-date', '2027-03-04T19:30');
  await page.selectOption('#mission-outcome', 'success');
  // statement/summary are data-toast-editor and NOT required -- left empty on
  // the happy path rather than fighting the ProseMirror.

  await page.locator('button[type="submit"]:has-text("Create Mission")').click();
  await page.waitForURL(/\/missions\/[0-9a-f-]{36}\/edit/);
  return page.url().match(/\/missions\/([0-9a-f-]{36})/)[1];
}

test('a mission can be created through the form', async ({ page }) => {
  const name = `${prefix} Created`;
  const id = await createMissionViaUi(page, name);

  const { rows } = await db.query(
    'select name, outcome from missions where id = $1', [id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(name);
  expect(rows[0].outcome).toBe('success');
});

test('the mission page shows the mission that was just created', async ({ page }) => {
  const name = `${prefix} Viewable`;
  const id = await createMissionViaUi(page, name);

  await page.goto(`/missions/${id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toContainText(name);
});

test('editing a mission round-trips the change to the database', async ({ page }) => {
  const name = `${prefix} Editable`;
  const id = await createMissionViaUi(page, name);
  const renamed = `${prefix} Edited`;

  await page.goto(`/missions/${id}/edit`);
  await page.waitForLoadState('networkidle');
  await page.fill('#mission-name', renamed);
  await page.locator('button[type="submit"]:has-text("Update Mission")').click();

  // PUT /missions/:id answers HX-Location /missions/{id}
  await page.waitForURL((url) => url.pathname === `/missions/${id}`);

  const { rows } = await db.query('select name from missions where id = $1', [id]);
  expect(rows[0].name).toBe(renamed);
});

test('a character can be attached to a mission and removed again', async ({ page }) => {
  const name = `${prefix} Party`;
  const id = await createMissionViaUi(page, name);

  await page.goto(`/missions/${id}/edit`);
  await page.waitForLoadState('networkidle');

  // Scoped: the editor search input at :193 shares name="q".
  const search = page.locator('input[name="q"][hx-get^="/characters/add-to-mission-search"]');
  await search.fill(character.name);

  // Results replace the innerHTML of #characterSearchResults, which is
  // server-rendered is-hidden until the first swap and re-hides itself after
  // 10s (public/js/app.js:874-881). Click promptly; toBeVisible is the guard.
  const result = page.locator(`#characterSearchResults button.button.is-text:has-text("${character.name}")`);
  await expect(result).toBeVisible();
  await result.click();

  const item = page.locator(`#selectedCharactersList li:has-text("${character.name}")`);
  await expect(item).toBeVisible();

  // The POST fires immediately -- assert the link row exists before saving.
  await expect.poll(async () => {
    const { rows } = await db.query(
      'select count(*)::int as n from mission_characters where mission_id = $1 and character_id = $2',
      [id, character.id]
    );
    return rows[0].n;
  }, { timeout: 15_000 }).toBe(1);

  // Now detach. Server returns '' so the <li> is replaced with nothing.
  await item.locator('button:has-text("Remove")').click();
  await expect(item).toHaveCount(0);

  await expect.poll(async () => {
    const { rows } = await db.query(
      'select count(*)::int as n from mission_characters where mission_id = $1 and character_id = $2',
      [id, character.id]
    );
    return rows[0].n;
  }, { timeout: 15_000 }).toBe(0);
});

test('a mission can be deleted from its detail page', async ({ page }) => {
  const name = `${prefix} Deletable`;
  const id = await createMissionViaUi(page, name);

  page.on('dialog', (d) => d.accept());
  await page.goto(`/missions/${id}`);
  await page.waitForLoadState('networkidle');

  await page.locator(`button[hx-delete="/missions/${id}"]`).click();
  // routes/missions.js:372 answers HX-Location /missions
  await page.waitForURL((url) => url.pathname === '/missions');

  const { rows } = await db.query('select id from missions where id = $1', [id]);
  expect(rows).toHaveLength(0);
});
```

- [ ] **Step 2: Run the spec**

Run: `bunx playwright test e2e/specs/19-missions-crud.spec.js`
Expected: 5 PASS.

- [ ] **Step 3: Check the create-path `is_public` normalisation**

`PUT /missions/:id` normalises the checkbox with `missionData.is_public === 'on'` (`routes/missions.js:313-317`), but the `POST` create path (`:169-217`) does no such normalisation. Check what actually landed:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "select name, is_public, pg_typeof(is_public) from missions where name like 'e2e-mission-crud-%' limit 5;"
```

If `is_public` stores something other than a clean boolean on create, that is a real defect — report it with this evidence and do not fix it inside this task. Add the finding to the plan's Discovered Defects section below.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/19-missions-crud.spec.js
git commit -m "test: cover mission create, view, edit, party, and delete happy paths"
```

---

## Task 6: LFG lifecycle (spec 20)

**Files:**
- Create: `e2e/specs/20-lfg-crud.spec.js`

**Interfaces:**
- Consumes: db/class/character fixtures; `ADMIN_EMAIL, ADMIN_STATE, PLAYER_EMAIL, PLAYER_STATE`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec file**

```js
// e2e/specs/20-lfg-crud.spec.js
//
// LFG lifecycle: create -> view -> edit -> join -> leave -> delete.
//
// FOUR TRAPS THIS FILE IS BUILT AROUND, all measured and documented in
// 14-lfg-controls.spec.js:
//
//   1. #character-select is used by BOTH partials/lfg-form.handlebars:35 and
//      partials/lfg-join-form.handlebars:20, and both can be on screen at
//      once. Every locator here is scoped to its own form.
//   2. lfg_posts.host_id is NOT the source of truth -- models/lfg.js
//      #applyConduitMeta overwrites it on every read from the approved
//      conduit join request. Never raw-insert a post with host_id; go
//      through seedLfgPost, or create it via the UI as this spec does.
//   3. button:has-text("Join") also matches "Unjoin" and "Unjoin as Conduit"
//      (has-text is substring). Use :text-is("Join").
//   4. Both "Edit" and "View Join Requests" on the My Posts tab carry
//      hx-target="closest table" hx-swap="outerHTML" -- clicking either
//      DESTROYS the whole table, so any locator captured from another row
//      beforehand goes stale.
//
// NAVIGATION: PUT /lfg/:id answers HX-Location /lfg -- editing returns you to
// the list, not to the post (routes/lfg.js:150).
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('lfg-crud');
let db;
let profile;
let classRow;
let character;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  classRow = await seedClass(prefix, { rulesVersion: 'v1' });
  await unlockClassForProfile(profile, classRow);
  character = await seedCharacter(prefix, profile, classRow);
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

// The create form arrives via htmx: the button at lfg.handlebars:9-11 has no
// hx-target, so it replaces itself with partials/lfg-form.
async function openCreateForm(page) {
  await page.goto('/lfg');
  await page.waitForLoadState('networkidle');
  await page.locator('#create-post button:has-text("Create LFG Post")').click();
  const form = page.locator('form:has(input[name="host_id"])');
  await expect(form).toBeVisible();
  // Alpine liveness -- 'hosting' is the component's own key. Never
  // !!Alpine.$data(el), which is truthy for any element.
  await expect.poll(async () => page.evaluate(() => {
    const f = document.querySelector('form:has(input[name="host_id"])');
    return f && window.Alpine ? 'hosting' in window.Alpine.$data(f) : false;
  })).toBe(true);
  return form;
}

async function createPostViaUi(page, title) {
  const form = await openCreateForm(page);
  await form.locator('#lfg-title').fill(title);
  // #lfg-description is required AND data-toast-editor, so the real textarea
  // is display:none and fill() would throw. Write into the ProseMirror the
  // editor put in its place.
  await form.locator('.toastui-editor-container .ProseMirror').first()
    .fill(`${title} description`);
  await form.locator('#lfg-date').fill('2027-05-06T18:00');
  await form.locator('button[type="submit"]:has-text("Create LFG Post")').click();

  // POST /lfg answers HX-Location /lfg
  await page.waitForURL((url) => url.pathname === '/lfg');
  const { rows } = await db.query(
    'select id from lfg_posts where title = $1', [title]
  );
  expect(rows, 'the post must exist before any later stage asserts on it').toHaveLength(1);
  return rows[0].id;
}

test('an LFG post can be created through the form', async ({ page }) => {
  const title = `${prefix} Created`;
  const id = await createPostViaUi(page, title);

  const { rows } = await db.query(
    'select title, description from lfg_posts where id = $1', [id]
  );
  expect(rows[0].title).toBe(title);
  expect(rows[0].description).toContain('description');
});

test('the post detail page shows the post that was just created', async ({ page }) => {
  const title = `${prefix} Viewable`;
  const id = await createPostViaUi(page, title);

  await page.goto(`/lfg/${id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toContainText(title);
});

test('editing an LFG post round-trips the change to the database', async ({ page }) => {
  const title = `${prefix} Editable`;
  const id = await createPostViaUi(page, title);
  const renamed = `${prefix} Edited`;

  // Direct URL rather than the My Posts Edit button: that button replaces the
  // whole table (trap 4) and this test is about the save, not the swap.
  await page.goto(`/lfg/${id}/edit`);
  await page.waitForLoadState('networkidle');

  const form = page.locator('form:has(input[name="host_id"])');
  await form.locator('#lfg-title').fill(renamed);
  await form.locator('button[type="submit"]:has-text("Update LFG Post")').click();

  // PUT /lfg/:id answers HX-Location /lfg, NOT /lfg/:id
  await page.waitForURL((url) => url.pathname === '/lfg');

  const { rows } = await db.query('select title from lfg_posts where id = $1', [id]);
  expect(rows[0].title).toBe(renamed);
});

test('a player can join a post with a character and then leave it', async ({ page }) => {
  const title = `${prefix} Joinable`;
  const id = await createPostViaUi(page, title);

  await page.goto(`/lfg/${id}`);
  await page.waitForLoadState('networkidle');

  // :text-is, not :has-text -- trap 3.
  await page.locator('button:text-is("Join")').click();

  const joinForm = page.locator('form:has(#join-player-opt)');
  await expect(joinForm).toBeVisible();
  // Scoped to the join form -- trap 1.
  await joinForm.locator('select[name="characterId"]').selectOption(character.id);
  await joinForm.locator('button[type="submit"]:has-text("Request to Join")').click();

  // POST /lfg/:id/join answers HX-Location /lfg/:id
  await page.waitForURL((url) => url.pathname === `/lfg/${id}`);

  await expect.poll(async () => {
    const { rows } = await db.query(
      'select count(*)::int as n from lfg_join_requests where lfg_post_id = $1 and character_id = $2',
      [id, character.id]
    );
    return rows[0].n;
  }, { timeout: 15_000 }).toBe(1);

  // Leave again.
  page.on('dialog', (d) => d.accept());
  await page.goto(`/lfg/${id}`);
  await page.waitForLoadState('networkidle');
  await page.locator('button:text-is("Unjoin")').click();
  await page.waitForURL((url) => url.pathname.startsWith('/lfg'));

  await expect.poll(async () => {
    const { rows } = await db.query(
      'select count(*)::int as n from lfg_join_requests where lfg_post_id = $1 and character_id = $2',
      [id, character.id]
    );
    return rows[0].n;
  }, { timeout: 15_000 }).toBe(0);
});

test('an LFG post can be deleted from the My Posts tab', async ({ page }) => {
  const title = `${prefix} Deletable`;
  const id = await createPostViaUi(page, title);

  page.on('dialog', (d) => d.accept());
  await page.goto('/lfg');
  await page.waitForLoadState('networkidle');

  // My Posts is pre-rendered server-side into #lfg-content
  // (lfg.handlebars:22-23) -- no tab click needed on first load.
  const row = page.locator('#lfg-posts tr', { hasText: title });
  await expect(row).toBeVisible();
  await row.locator('button:has-text("Delete")').click();

  // routes/lfg.js:160 answers HX-Location /lfg
  await expect.poll(async () => {
    const { rows } = await db.query('select id from lfg_posts where id = $1', [id]);
    return rows.length;
  }, { timeout: 15_000 }).toBe(0);
});
```

- [ ] **Step 2: Run the spec**

Run: `bunx playwright test e2e/specs/20-lfg-crud.spec.js`
Expected: 5 PASS.

If create fails because Chrome refuses to submit — `#lfg-description` is `required` and ToastUI has hidden it — then filling the ProseMirror is not reaching the textarea before validation. That would mean LFG posts cannot be created in a real browser at all, which is a significant defect: capture the console output and the `#alerts` content, stop, and report it rather than working around it.

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/20-lfg-crud.spec.js
git commit -m "test: cover LFG create, view, edit, join, leave, and delete happy paths"
```

---

## Task 7: Class lifecycle and fix D3 (spec 21)

**Files:**
- Create: `e2e/specs/21-classes-crud.spec.js`
- Modify: `routes/classes.js:759`

**Interfaces:**
- Consumes: db fixtures; `PLAYER_EMAIL, PLAYER_STATE`.
- Produces: `DELETE /classes/:id` answering `HX-Location: /classes/my` instead of 204.

- [ ] **Step 1: Write the spec file**

```js
// e2e/specs/21-classes-crud.spec.js
//
// Player-created class lifecycle through the real UI.
//
// D3 -- THE DELETE BUTTON IS INERT. routes/classes.js:759 answers 204 No
// Content, and htmx does not swap on 204. Both delete triggers
// (my-classes.handlebars:115 targeting #row-<id>, class-view.handlebars:29
// targeting "closest tr" on a page that HAS no <tr>) therefore leave the row
// on screen even when the delete succeeded. The delete test below asserts
// against Postgres, which is the only way to tell "it worked but did not
// repaint" from "it did nothing".
//
// The abilities/gear rows are FIXED-COUNT and server-rendered -- exactly 3
// and 6, via {{#times}} (class-form.handlebars:157, :185). There is no
// add-row UI. All 9 name fields are `required`, so a valid create must fill
// every one.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('class-crud');
let db;

test.beforeAll(async () => {
  db = await connect();
  await profileForEmail(db, PLAYER_EMAIL); // fails loudly if seed:local was not run
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

async function createClassViaUi(page, name) {
  await page.goto('/classes/new');
  await page.waitForLoadState('networkidle');

  const form = page.locator('form[hx-post="/classes"]');
  await form.locator('#class-name').fill(name);
  // #class-description is required and data-toast-editor -- write into the
  // ProseMirror, not the hidden textarea. It is the FIRST editor on the form
  // (teaser precedes it in the DOM but is not required), so scope by the
  // editor container that follows #class-description.
  const descEditor = page.locator('#class-description')
    .locator('xpath=following-sibling::div[contains(@class,"toastui-editor-container")][1]')
    .locator('.ProseMirror');
  await descEditor.fill(`${name} description`);

  const abilities = form.locator('input[name="ability_name[]"]');
  await expect(abilities).toHaveCount(3);
  for (let i = 0; i < 3; i++) await abilities.nth(i).fill(`${prefix} Ability ${i + 1}`);

  const gear = form.locator('input[name="gear_name[]"]');
  await expect(gear).toHaveCount(6);
  for (let i = 0; i < 6; i++) await gear.nth(i).fill(`${prefix} Gear ${i + 1}`);

  await form.locator('button[type="submit"]').click();

  // routes/classes.js:650 answers HX-Location /classes/{id}/{encodedName}
  await page.waitForURL(/\/classes\/[0-9a-f-]{36}/);
  return page.url().match(/\/classes\/([0-9a-f-]{36})/)[1];
}

test('a class can be created through the form', async ({ page }) => {
  const name = `${prefix} Created`;
  const id = await createClassViaUi(page, name);

  const { rows } = await db.query('select name from classes where id = $1', [id]);
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(name);
});

test('the class page shows the class that was just created', async ({ page }) => {
  const name = `${prefix} Viewable`;
  const id = await createClassViaUi(page, name);

  await page.goto(`/classes/${id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toContainText(name);
});

test('editing a class round-trips the change to the database', async ({ page }) => {
  const name = `${prefix} Editable`;
  const id = await createClassViaUi(page, name);
  const renamed = `${prefix} Edited`;

  await page.goto(`/classes/${id}/edit`);
  await page.waitForLoadState('networkidle');
  await page.locator('#class-name').fill(renamed);
  await page.locator(`form[hx-put="/classes/${id}"] button[type="submit"]`).click();
  await page.waitForURL(/\/classes\/[0-9a-f-]{36}/);

  const { rows } = await db.query('select name from classes where id = $1', [id]);
  expect(rows[0].name).toBe(renamed);
});

test('a class can be deleted from the My PCCs list', async ({ page }) => {
  const name = `${prefix} Deletable`;
  const id = await createClassViaUi(page, name);

  page.on('dialog', (d) => d.accept());
  await page.goto('/classes/my');
  await page.waitForLoadState('networkidle');

  await page.locator(`#row-${id} button:has-text("Delete")`).click();

  // Asserted against Postgres, not the DOM: with the pre-fix 204 the row
  // stays on screen even on success, so a row-count assertion cannot tell
  // success from failure.
  await expect.poll(async () => {
    const { rows } = await db.query('select id from classes where id = $1', [id]);
    return rows.length;
  }, { timeout: 15_000 }).toBe(0);

  // And the list must actually repaint -- this is the half D3 breaks.
  await expect(page.locator(`#row-${id}`)).toHaveCount(0);
});
```

- [ ] **Step 2: Run it and confirm the delete test fails on the repaint**

Run: `bunx playwright test e2e/specs/21-classes-crud.spec.js`
Expected: the first three PASS; the delete test FAILS on the final `toHaveCount(0)` while the `expect.poll` above it succeeds — proving the row was deleted server-side but htmx never swapped.

- [ ] **Step 3: Apply the D3 fix**

`routes/classes.js:759` — replace:

```js
    return res.status(204).send();
```

with:

```js
    // HX-Location, not 204: htmx does not swap on 204, so the delete buttons
    // at my-classes.handlebars:115 and class-view.handlebars:29 left the row
    // on screen even on success. Matches how the character, mission, and LFG
    // delete routes already answer.
    return res.header('HX-Location', '/classes/my').send();
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `bunx playwright test e2e/specs/21-classes-crud.spec.js`
Expected: 4 PASS.

Then: `bun run test:http`
Expected: PASS. If an existing http test asserts a 204 from this route, update it to assert the `HX-Location` header — the 204 was the defect.

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/21-classes-crud.spec.js routes/classes.js
git commit -m "fix: make the class delete button repaint the list instead of returning 204"
```

---

## Task 8: Profile edit round-trip (spec 22)

**Files:**
- Create: `e2e/specs/22-profile-crud.spec.js`

**Interfaces:**
- Consumes: db fixtures; `PLAYER_EMAIL, PLAYER_STATE`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec file**

```js
// e2e/specs/22-profile-crud.spec.js
//
// Profile has no create or delete -- it is provisioned with the account -- so
// the lifecycle here is view -> edit -> round-trip.
//
// The form arrives by htmx: the Edit button (profile.handlebars:18) swaps
// partials/profile-form into #profile-info. But despite the form's
// hx-target="#profile-info" hx-swap="innerHTML", the route answers
// HX-Location: /profile with an empty body (routes/profile.js:118) -- the
// whole page navigates and #profile-info is never partially swapped. Assert
// on the reloaded page.
//
// `name` is the field under test rather than bio or conduit_briefing: those
// are data-toast-editor (hidden textareas), and `name` is echoed straight
// back into #user-name (profile.handlebars:6), giving a visible round-trip.
//
// THIS SPEC RESTORES THE ORIGINAL NAME in afterAll. The player profile is
// shared infrastructure created once by global-setup's ensurePlayer() and
// never torn down (global-setup.js:29-51); leaving it renamed would leak into
// every later run.
const { test, expect } = require('@playwright/test');
const { connect, profileForEmail } = require('../fixtures/db');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });
// Serial: both tests touch the one shared profile row.
test.describe.configure({ mode: 'serial' });

let db;
let profile;
let originalName;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  originalName = profile.name;
});

test.afterAll(async () => {
  try {
    await db.query('update profiles set name = $1 where id = $2', [originalName, profile.id]);
  } finally {
    await db.end();
  }
});

test('the profile page shows the signed-in player', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#user-email')).toContainText(PLAYER_EMAIL);
});

test('editing the profile name round-trips to the database and the page', async ({ page }) => {
  const renamed = `e2e-profile-${Date.now()}`;

  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  await page.locator('button:has-text("Edit Profile")').click();

  const form = page.locator('form[hx-put="/profile"]');
  await expect(form).toBeVisible();
  await form.locator('#name').fill(renamed);
  await form.locator('button[type="submit"]').click();

  // HX-Location: /profile -- a full navigation, not a partial swap.
  await page.waitForURL((url) => url.pathname === '/profile');
  await page.waitForLoadState('networkidle');

  await expect(page.locator('#user-name')).toContainText(renamed);

  const { rows } = await db.query('select name from profiles where id = $1', [profile.id]);
  expect(rows[0].name).toBe(renamed);
});
```

- [ ] **Step 2: Run the spec**

Run: `bunx playwright test e2e/specs/22-profile-crud.spec.js`
Expected: 2 PASS.

- [ ] **Step 3: Verify the shared profile was restored**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "select name from profiles p join auth.users u on u.id = p.id where u.email = 'e2e-player@testing.com';"
```
Expected: the original name, not an `e2e-profile-...` value. If it leaked, the `afterAll` did not run — fix that before committing.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/22-profile-crud.spec.js
git commit -m "test: cover profile view and edit round-trip"
```

---

## Task 9: Full-suite verification

**Files:** none modified.

- [ ] **Step 1: Run every tier**

```bash
bun run test:unit
bun run test:http
bun run test:integration
bunx playwright test --workers=1
```

- [ ] **Step 2: Confirm the browser tier against the corrected baseline**

**Expected: ZERO failures.** All 83 pre-existing specs plus every spec this plan adds must pass.

Corrected 2026-08-07: an earlier measurement recorded 80 passed / 2 failed / 1 flake and attributed the two failures to deliberately-red characterization specs (`03b-class-reassignment.spec.js:81`, `13-page-slug.spec.js:506`). That did not reproduce. Two consecutive serial full runs at commit `ced3fef`, with no production code changed, gave **86/86 passing**. The `03b` header still says the spec is expected to fail; per its own text, going green because the underlying bug was fixed is the correct outcome, and the class-reassignment fix appears to have already landed on `virtual-party-tool`.

Treat ANY failure as a regression introduced by this branch. Do not proceed past one.

- [ ] **Step 3: Re-run the browser tier in parallel to surface flakes**

Run: `bunx playwright test`
Expected: zero failures. `11-export-dropdowns.spec.js:186` has been seen to fail under parallel workers and pass serially — if it recurs, confirm it passes with `--workers=1` before dismissing it. If any NEW spec is flaky under parallel workers, fix it: the suite runs `fullyParallel: true` by default.

**Shared-state caution:** the local Supabase at 127.0.0.1:54321 is shared across git worktrees and sessions. A concurrent test run elsewhere mutates the same tables and can produce failures unrelated to this branch. Before declaring a regression, confirm nothing else is running against this database.

- [ ] **Step 4: Commit any fixes and report**

Report: which specs were added, which defects were fixed, and every entry added to Discovered Defects below.

---

## Discovered defects (report, do not fix here)

Append findings as tasks surface them. Known before starting:

- **Mission create does not normalise `is_public`.** `PUT /missions/:id` uses `missionData.is_public === 'on'` (`routes/missions.js:313-317`); the `POST` create path (`:169-217`) has no equivalent. Confirm with Task 5 Step 3.
- **`models/pages.js` binds every query to the anon client** (`:1`), so admin page reads and writes silently fail under RLS. Blocks the CMS-pages spec entirely; this is also the root cause of the already-red `13-page-slug.spec.js:506`. Covered by the follow-up admin plan.
- **`DELETE /pages/:id` (`routes/pages.js:146`), `DELETE /nav/:id` (`routes/nav.js:292`), and `DELETE /library/:id/unlocks/:userId` (`routes/library.js:265`) all return 204**, the same inert-button defect as D3. Covered by the follow-up admin plan.
- **`GET /lfg/:id/requests` fires twice on load.** `#join-requests-inline` is `display:none` with `hx-trigger="revealed"`, and htmx reads an all-zero rect as in-view (`e2e/specs/14-lfg-controls.spec.js:52-71`).
