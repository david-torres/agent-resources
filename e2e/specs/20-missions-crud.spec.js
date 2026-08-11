// e2e/specs/20-missions-crud.spec.js
//
// Mission lifecycle through the real UI, including the attach/detach of a
// character -- which is a two-phase mechanism worth pinning: clicking a search
// result immediately POSTs /missions/:id/characters/:characterId
// (routes/missions.js:375) AND appends a hidden characters[] input, and the
// later PUT reconciles membership from those hidden inputs
// (routes/missions.js:338-360). Either half breaking silently loses party
// members. A separate test below exercises that second half specifically:
// it saves via "Update Mission" (PUT) with a character attached, and detaches
// one by removing its hidden characters[] input directly (never the Remove
// button, which only proves the immediate DELETE endpoint) before saving
// again -- so a regression confined to the PUT reconciliation diff logic
// cannot pass unnoticed.
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
  //
  // is_public: 'on' is required here, not cosmetic: the mission edit form's
  // character-add box is powered by GET /characters/add-to-mission-search ->
  // searchPublicCharacters (models/character.js:244-269), which hard-filters
  // `.eq('is_public', true)` with no owner-visibility fallback. seedCharacter
  // -> createCharacter goes through normalizeCharacterInput
  // (services/character/input.js:108), whose is_public normalisation is
  // `data.is_public === 'on'` -- literal HTML-checkbox semantics. A JS
  // `true` fails that strict-equality check and silently becomes `false`;
  // only the string 'on' survives. Without this override (or with a bare
  // `true`) the seeded character is invisible to its own mission's search
  // and the attach/detach test times out waiting for a search result that
  // can never appear.
  character = await seedCharacter(prefix, profile, classRow, { is_public: 'on' });
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

test('attaching a character survives a PUT save, and removing its hidden input detaches it via PUT reconciliation', async ({ page }) => {
  const name = `${prefix} PartyPut`;
  const id = await createMissionViaUi(page, name);

  await page.goto(`/missions/${id}/edit`);
  await page.waitForLoadState('networkidle');

  // Scoped: the editor search input at :193 shares name="q".
  const search = page.locator('input[name="q"][hx-get^="/characters/add-to-mission-search"]');
  await search.fill(character.name);

  const result = page.locator(`#characterSearchResults button.button.is-text:has-text("${character.name}")`);
  await expect(result).toBeVisible();
  await result.click();

  const item = page.locator(`#selectedCharactersList li:has-text("${character.name}")`);
  await expect(item).toBeVisible();

  // The POST fires immediately -- wait for the link row before saving, same
  // guard the sibling attach/detach test uses.
  await expect.poll(async () => {
    const { rows } = await db.query(
      'select count(*)::int as n from mission_characters where mission_id = $1 and character_id = $2',
      [id, character.id]
    );
    return rows[0].n;
  }, { timeout: 15_000 }).toBe(1);

  // Save via PUT. routes/missions.js:338-360 reconciles membership from the
  // hidden characters[] inputs on the form -- the "second half" of the
  // two-phase attach mechanism that the immediate POST above never
  // exercises. Membership must survive this round-trip.
  await page.locator('button[type="submit"]:has-text("Update Mission")').click();
  await page.waitForURL((url) => url.pathname === `/missions/${id}`);

  const afterSave = await db.query(
    'select count(*)::int as n from mission_characters where mission_id = $1 and character_id = $2',
    [id, character.id]
  );
  expect(afterSave.rows[0].n).toBe(1);

  // Reload the edit form -- mission.characters is now populated server-side,
  // so the <li> and its hidden characters[] input render from that, not
  // from the earlier in-page POST.
  await page.goto(`/missions/${id}/edit`);
  await page.waitForLoadState('networkidle');

  const itemAfterReload = page.locator(`#selectedCharactersList li:has-text("${character.name}")`);
  await expect(itemAfterReload).toBeVisible();

  // Detach WITHOUT the Remove button: that button fires the immediate
  // DELETE endpoint (routes/missions.js:375-ish) and would prove nothing
  // about PUT reconciliation. Instead strip the hidden characters[] input
  // for this character directly, so the only way membership can end up
  // removed is through the PUT diff logic at routes/missions.js:338-360.
  await itemAfterReload.locator('input[name="characters[]"]').evaluate((el) => el.remove());

  await page.locator('button[type="submit"]:has-text("Update Mission")').click();
  await page.waitForURL((url) => url.pathname === `/missions/${id}`);

  const afterPutRemoval = await db.query(
    'select count(*)::int as n from mission_characters where mission_id = $1 and character_id = $2',
    [id, character.id]
  );
  expect(afterPutRemoval.rows[0].n).toBe(0);
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
