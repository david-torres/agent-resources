// e2e/specs/28-aspirant-v1-merx-purchases.spec.js
//
// Walks the wizard's Merx purchase journey for an Aspirant V1 class in a real
// browser: buy a printed Signature, unlock its Default Enchantment, swap the
// Default for a Custom, add two Mods, and watch the served spend/slot
// readouts move by exactly the served prices -- then push the build over
// budget and confirm the save is refused, and separately confirm that
// removing a Signature carrying a paid Enchantment asks first and names it.
//
// Modelled on 19-character-wizard-crud.spec.js (fixture/auth setup, the
// wizard's step-panel visibility trap, the ?fresh=1 draft bypass) and
// 26-aspiring-wizard.spec.js (the aspirant/aspiring "split" step 2 UI --
// character-wizard.js#isSplitMode -- a <select> for the Stat paired with a
// free-text Trait, and the `.wizard-stat-box.is-assignable` point-spend
// loop). Neither of those two drives step 4's Signature grid, which is what
// this file adds coverage for.
//
// No successful character is ever created here: the main journey ends in a
// refused save, and the removal test never reaches step 5. So this file
// leaves the characters/traits/class_gear/class_abilities row counts
// untouched and only needs to clean up the one fixture class it seeds.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('merx');
const SIGNATURE_NAME = `${prefix} Signature`;

let db;
let profile;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  classRow = await seedClass(prefix, {
    rulesVersion: 'v1',
    // character-wizard.js's populatePersonalitySelects requires >= 2 spread
    // stats before it unlocks the trait1/trait2 selects (see
    // 19-character-wizard-crud.spec.js's own fixture comment).
    statSpread: { vitality: 2, might: 2 },
    gear: [{
      name: SIGNATURE_NAME,
      description: `${SIGNATURE_NAME} description.`,
      meters: [],
      column: 1,
      position: 1,
      default_enchantment: {
        name: `${SIGNATURE_NAME} Enchantment`,
        description: 'Grants a bonus.'
      }
    }]
  });
  // e2e/fixtures/class.js's seedClass has no contentFormat parameter, so the
  // row lands with the classes.content_format column's own default
  // ('advent'). economyFor (util/merx-economy.js) is what actually decides
  // which economy prices a class's Signatures, and it reads content_format,
  // not rules_version -- so the row is flipped here to 'aspirant' (Aspirant
  // V1's own content shape) to buy under the V1 economy this spec is about.
  await db.query('update classes set content_format = $1 where id = $2', ['aspirant', classRow.id]);
  await unlockClassForProfile(profile, classRow);
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

// Drives the wizard from the class kiosk through step 4 and opens the
// printed grid's one Signature, leaving its drawer open. Steps 1-3 mirror
// 19-character-wizard-crud.spec.js and 26-aspiring-wizard.spec.js's own
// setup verbatim; nothing about how those steps work changes here.
const openToSignatureDrawer = async (page) => {
  await page.goto('/characters/wizard?mode=aspirant&fresh=1');
  await page.waitForLoadState('networkidle');

  const card = page.locator(`#classKioskTrack .wizard-kiosk-card[data-id="${classRow.id}"]`);
  await card.click();
  await expect(card).toHaveClass(/is-selected|selected/);
  await page.locator('#step1Next').click();
  await expect(page.locator('[data-step-panel="2"]')).toBeVisible();

  // Step 2: aspirant is a "split mode" (character-wizard.js#isSplitMode) --
  // a <select> for the Stat plus a free-text Trait, same control
  // 26-aspiring-wizard.spec.js drives for aspiring. Slots 1 and 2 are
  // limited to the class's own stat_spread (vitality, might); slot 3 takes
  // any of the twelve stats.
  await page.selectOption('#trait1StatSelect', 'vitality');
  await page.fill('#trait1Custom', 'steady');
  await page.selectOption('#trait2StatSelect', 'might');
  await page.fill('#trait2Custom', 'forceful');
  await page.selectOption('#trait3StatSelect', 'reflex');
  await page.fill('#trait3Custom', 'quick');

  const next2 = page.locator('#step2Next');
  const assignable = page.locator('#statGrid .wizard-stat-box.is-assignable[data-clickable="1"]');
  for (let i = 0; i < 20 && await next2.isDisabled(); i++) {
    if (await assignable.count() === 0) break;
    await assignable.first().click();
  }
  await expect(next2, 'step 2 gate must open once traits and stats are set').toBeEnabled();
  await next2.click();
  await expect(page.locator('[data-step-panel="3"]')).toBeVisible();

  await page.locator('[data-step-panel="3"] [data-wizard-next]').click();
  await expect(page.locator('[data-step-panel="4"]')).toBeVisible();

  const cell = page.locator(`#signatureGrid [data-signature-name="${SIGNATURE_NAME}"]`);
  await cell.click();
  await expect(page.locator('#signatureDrawer')).toBeVisible();
};

// Reads a served price tag ("2m") off the drawer as a number. Every price
// this spec checks is read this way rather than duplicated from
// util/merx-economy.js as a literal.
const readPrice = async (locator) => {
  const text = (await locator.textContent()) || '';
  const n = parseInt(text, 10);
  expect(Number.isNaN(n), `expected a price tag, got "${text}"`).toBe(false);
  return n;
};

test('buying a Default, swapping to a Custom and adding two Mods prices exactly as served, then an over-budget build is refused', async ({ page }) => {
  await openToSignatureDrawer(page);
  const drawer = page.locator('#signatureDrawer');

  await expect(page.locator('#merxSpent')).toHaveText('0');
  await expect(page.locator('#slotsUsed')).toHaveText('0');

  const sigPrice = await readPrice(drawer.locator('.entry-header .entry-price'));
  await drawer.locator('[data-signature-buy]').click();
  await expect(page.locator('#merxSpent')).toHaveText(String(sigPrice));
  await expect(page.locator('#slotsUsed')).toHaveText('1');

  // pg. 8: a Default Enchantment takes a Signature slot of its own, so
  // buying one raises slotsUsed as well as merxSpent -- the "cap arithmetic"
  // the plan is about.
  const defaultPrice = await readPrice(
    drawer.locator('label.entry-option:has(input[value="default"]) .entry-price')
  );
  await drawer.locator('input[name="enchantment"][value="default"]').check();
  await expect(page.locator('#merxSpent')).toHaveText(String(sigPrice + defaultPrice));
  await expect(page.locator('#slotsUsed')).toHaveText('2');

  // Swapping the Default for a Custom changes only the Merx spent: both are
  // one Enchantment, so the slot count does not move.
  const customPrice = await readPrice(
    drawer.locator('label.entry-option:has(input[value="custom"]) .entry-price')
  );
  await drawer.locator('input[name="enchantment"][value="custom"]').check();
  await expect(page.locator('#merxSpent')).toHaveText(String(sigPrice + customPrice));
  await expect(page.locator('#slotsUsed')).toHaveText('2');
  await drawer.locator('[data-custom-name]').fill(`${prefix} Custom Rune`);
  await drawer.locator('[data-custom-description]').fill('A hand-written effect.');

  // pg. 87: a Signature's second Mod costs more than its first. Read off the
  // two served price tags rather than asserting a number.
  const mod0Price = await readPrice(drawer.locator('[data-mod-index="0"] .entry-price'));
  const mod1Price = await readPrice(drawer.locator('[data-mod-index="1"] .entry-price'));
  expect(mod1Price, "a Signature's second Mod must cost more than its first").toBeGreaterThan(mod0Price);

  await drawer.locator('[data-mod-index="0"] [data-mod-name]').fill('Fire Rune');
  // Blurred explicitly, and waited on, before the second Mod's field is
  // touched: focusing it fires 'change' on this one first, and that
  // handler's refreshGearViews() replaces the whole drawer (character-
  // wizard.js:3536-3552), including the second Mod's own <input> --
  // leaving Playwright mid-fill holding a handle to a node the rerender
  // just detached. Settling this fill first keeps the second one aimed at
  // the input that is actually still attached.
  await drawer.locator('[data-mod-index="0"] [data-mod-name]').blur();
  await expect(page.locator('#merxSpent')).toHaveText(String(sigPrice + customPrice + mod0Price));
  await drawer.locator('[data-mod-index="1"] [data-mod-name]').fill('Ice Rune');
  const affordableSpend = sigPrice + customPrice + mod0Price + mod1Price;
  await expect(page.locator('#merxSpent')).toHaveText(String(affordableSpend));

  // ---- Over budget ----
  // The client refuses every purchase that would cross the budget
  // (character-wizard.js#affordsChange), so an over-budget shape can only be
  // assembled by writing state directly -- the same debug handle
  // character-wizard.js exposes CharacterWizard.getState() for ("a console
  // debug handle" per its own comment), returning the wizard's own live
  // state object rather than a copy.
  const budget = parseInt(await page.locator('#merxBudget').textContent(), 10);
  const extraCount = Math.floor((budget - affordableSpend) / sigPrice) + 1;
  const overBudgetSpend = await page.evaluate(({ count, classId, name }) => {
    const state = window.CharacterWizard.getState();
    for (let i = 0; i < count; i++) {
      state.gear.push({
        name: `${name} ${i}`, kind: 'class', subtype: 'elective',
        class_id: classId, class_name: '', owned: true, enchantment: null, mods: []
      });
    }
    return window.CharacterWizard.getMerxSpent();
  }, { count: extraCount, classId: classRow.id, name: `${prefix} Overflow` });
  expect(overBudgetSpend, 'the assembled build must actually exceed the budget').toBeGreaterThan(budget);

  const name = `${prefix} Over Budget Hero`;
  await page.locator('#step4Next').click();
  await expect(page.locator('[data-step-panel="5"]')).toBeVisible();
  await page.fill('#wizardName', name);
  await expect(page.locator('#wizardSubmit')).toBeEnabled();

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/characters/wizard') && r.request().method() === 'POST'),
    page.locator('#wizardSubmit').click()
  ]);

  // KNOWN GAP, measured against the real local server while writing this
  // spec (not asserted on faith): services/character/input.js's
  // validateEconomyLimits DOES compute the specific "This character spends
  // N Merx of 12." message, but routes/characters.js's wizard handler loses
  // it before it reaches the browser. normalizeWizardPayload's own
  // structural errors are sent with an explicit `{ status: 400 }` (line
  // ~354), but createCharacter's error two lines below is not -- it falls
  // into util/http-error.js classifyError's `default` branch, which has no
  // case for a bare validation string and, once NODE_ENV isn't literally
  // 'development' (true for this suite's webServer), replaces it with the
  // generic 500 below. So the save IS refused and NO character is created --
  // proven below against the database, not just the page -- but "with the
  // server's message" is not something the current app can show; only this
  // generic fallback is. That specific gap belongs to whoever picks up this
  // finding, not to this spec.
  expect(response.status()).toBe(500);
  await expect(page.locator('#alerts .notification.is-danger'))
    .toHaveText('An unexpected error occurred. Please try again.');
  expect(page.url(), 'a refused save must not navigate away from the wizard').toContain('/characters/wizard');

  const { rows } = await db.query('select id from characters where name = $1', [name]);
  expect(rows, 'a refused save must create no character row').toHaveLength(0);
});

test('removing a Signature that carries a paid Enchantment confirms first and names it', async ({ page }) => {
  await openToSignatureDrawer(page);
  const drawer = page.locator('#signatureDrawer');

  await drawer.locator('[data-signature-buy]').click();
  await drawer.locator('input[name="enchantment"][value="default"]').check();

  await drawer.locator('[data-signature-sell]').click();
  const dialog = page.locator('#pendingRemovalDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.wizard-pending-removal-message')).toContainText(`Removing "${SIGNATURE_NAME}"`);
  await expect(dialog.locator('.wizard-pending-removal-lines')).toContainText('Default Enchantment');

  // Cancel keeps the purchase intact.
  await dialog.locator('[data-cancel-removal]').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#signatureGrid')).toContainText('Owned');
  await expect(page.locator('#merxSpent')).not.toHaveText('0');

  // Confirm destroys it, and its Enchantment with it.
  await drawer.locator('[data-signature-sell]').click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-confirm-removal]').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#signatureGrid')).not.toContainText('Owned');
  await expect(page.locator('#merxSpent')).toHaveText('0');
  await expect(page.locator('#slotsUsed')).toHaveText('0');
});
