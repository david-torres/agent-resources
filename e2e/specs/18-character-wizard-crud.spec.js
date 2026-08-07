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
  // statSpread needs >= 2 stats: character-wizard.js's populatePersonalitySelects
  // (:718-719) locks the trait1/trait2 selects disabled otherwise, since it
  // can't satisfy the "2 different spread stats" rule. e2e/fixtures/class.js
  // defaults statSpread to {} (matching the column's own DB default), which
  // does not seed real classes -- only classes created through the UI's
  // class-form (routes/classes.js parseStatSpread) get non-empty spreads.
  classRow = await seedClass(prefix, {
    rulesVersion: 'v1',
    statSpread: { vitality: 2, might: 2 }
  });
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
  // (character-wizard.js:1421-1426). The shop defaults to the "Signature
  // Items" (class) tab (character-wizard.handlebars:199), but the seeded
  // fixture class carries no gear (e2e/fixtures/class.js's `gear` default is
  // []), so that tab is always empty -- routes/characters.js:224-230 derives
  // class_gear from the class's own `gear` column. Switch to the "Common
  // Items" tab (data-shop-tab="common"), which is populated from the
  // hardcoded util/enclave-consts commonItemList regardless of class, and
  // whose cards are clicked via [data-shop-key] delegation
  // (character-wizard.js:1556-1558), not [data-clickable="1"].
  const next4 = page.locator('#step4Next');
  await page.locator('[data-shop-tab="common"]').click();
  const spendable = page.locator('#spendList [data-shop-key]:not(.is-disabled)');
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
