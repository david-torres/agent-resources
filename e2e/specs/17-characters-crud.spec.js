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
  //
  // Deviation from the brief: the trait <select> elements
  // (views/character-form.handlebars:171) carry only `name="trait{{@index}}"`
  // -- no `id` attribute exists in the DOM, so `#trait0`/`#trait1`/`#trait2`
  // never resolve and every test in this file times out on the first one.
  // Selecting by `[name=...]` instead; this is a spec-selector fix, not a
  // product defect (verified: no `id="trait..."` anywhere in the template).
  await page.selectOption('select[name="trait0"]', { index: 1 });
  await page.selectOption('select[name="trait1"]', { index: 2 });
  await page.selectOption('select[name="trait2"]', { index: 3 });

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
