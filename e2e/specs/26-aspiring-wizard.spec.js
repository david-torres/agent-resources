// e2e/specs/26-aspiring-wizard.spec.js
//
// Aspiring is the wizard's class-less mode: instead of picking one class, the
// user invents a pseudo-class and borrows 3 signature items and 3 abilities (2
// core + 1 advanced) from other classes. Nothing about that reaches the
// database as a `classes` row -- the pseudo-class name lands in
// characters.class with class_id left null, and its tagline/description in
// characters.pseudo_class_tagline / _description
// (services/character/input.js:113-120).
//
// This is the only test that drives that mapping over a real request: the
// route-level harness at routes/character-wizard-aspiring.test.js mocks the
// model layer, so the pseudo_class -> characters columns translation and the
// aspiring_abilities pool write are otherwise unproven end to end.
//
// Selection is not purchase. The three picks land in the
// characters.aspiring_abilities pool, and the character owns none of them
// until it spends Perks (docs/.../2026-09-20-aspirant-v1-perk-economy-design.md).
// It could not own all three in any case: the picks cost 1 + 1 + 2 against a
// grant of 3 (util/perk-economy.js). Buying them later is 30-perk-economy's
// third journey; this spec proves the pool itself persists.
//
// It shares 19-character-wizard-crud.spec.js's traps: every step panel is in
// the DOM from first paint and merely toggled with .hidden, so assert
// VISIBILITY plus the Next button's own gate, never mere presence.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('aspiring');

// Three donor classes, because the builder requires the 3 gear picks to come
// from 3 different classes and the 3 ability picks likewise (a class may
// appear in both lists). Their stat spreads are deliberately disjoint: the
// step-2 stat selects offer the UNION of the borrowed classes' spreads
// (public/js/character-wizard.js#getAspiringSpreadStats), so six distinct
// stats make that union assertable rather than coincidental.
const DONORS = [
  { key: 'alpha', statSpread: { vitality: 2, might: 1 } },
  { key: 'beta', statSpread: { reflex: 2, skill: 1 } },
  { key: 'gamma', statSpread: { luck: 2, sensory: 1 } }
];
const UNION_STATS = ['vitality', 'might', 'reflex', 'skill', 'luck', 'sensory'];

let db;
let profile;
const donors = {};

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  for (const { key, statSpread } of DONORS) {
    const row = await seedClass(prefix, {
      name: `${prefix}-${key}`,
      rulesVersion: 'v1',
      statSpread,
      gear: [{ name: `${prefix} ${key} Item`, description: `${key} item` }],
      abilities: [
        { name: `${prefix} ${key} Core`, description: `${key} core ability` },
        { name: `${prefix} ${key} Core Two`, description: `${key} second core ability` }
      ],
      advancedAbilities: [
        { name: `${prefix} ${key} Advanced`, description: `${key} advanced ability` }
      ]
    });
    // Unlocking matters twice over: the wizard's class pool is the user's
    // unlocked set (routes/characters.js#filterClassDataForUser), and an
    // unlocked class keeps its ability descriptions on the rendered character
    // page (services/character/description-gate.js).
    await unlockClassForProfile(profile, row);
    donors[key] = row;
  }
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

// Each pick re-renders the whole builder, so the toggler has to be reopened
// for every one of them.
const pickFromToggler = async (page, section, classRow, itemName) => {
  await page.locator(`[data-toggler-button="${section}"]`).click();
  await page
    .locator(`[data-toggler-picker="${section}"] li[data-class-id="${classRow.id}"][data-item-name="${itemName}"]`)
    .click();
};

test('the wizard creates an aspiring character end to end', async ({ page }) => {
  const name = `${prefix} Aspiring Hero`;
  // The user types the SUFFIX; the wizard prepends "Aspiring " and that full
  // string is what characters.class must end up holding.
  const pseudoSuffix = 'Tide-Turner';
  const pseudoClassName = `Aspiring ${pseudoSuffix}`;
  const tagline = 'Turns the tide, one sump at a time';
  const description = 'Borrowed tricks from three crews.';

  await page.goto('/characters/wizard?mode=aspiring&fresh=1');
  await page.waitForLoadState('networkidle');

  // Step 1 -- the pseudo-class identity. The running summary is fed from the
  // name input's own `input` handler, so it names the class before anything
  // is persisted anywhere.
  await page.fill('#pseudoClassName', pseudoSuffix);
  await page.fill('#pseudoClassTagline', tagline);
  await page.fill('#pseudoClassDescription', description);
  await expect(page.locator('#summaryClass')).toContainText(pseudoClassName);
  await expect(page.locator('#summaryClass')).toContainText(tagline);

  // Step 1 -- borrow 3 items and 3 abilities, each trio from 3 distinct
  // classes. #step1Next is disabled until the name and all six picks are in
  // (character-wizard.js#updateBuilderGate), so its enabling IS the assertion
  // that the builder accepted the build.
  for (const { key } of DONORS) {
    await pickFromToggler(page, 'gear', donors[key], `${prefix} ${key} Item`);
  }
  await expect(page.locator('[data-toggler-card="gear"]')).toHaveCount(3);

  await pickFromToggler(page, 'abilities', donors.alpha, `${prefix} alpha Core`);
  await pickFromToggler(page, 'abilities', donors.beta, `${prefix} beta Core`);
  await pickFromToggler(page, 'abilities', donors.gamma, `${prefix} gamma Advanced`);
  await expect(page.locator('[data-toggler-card="abilities"]')).toHaveCount(3);

  const step1Next = page.locator('#step1Next');
  await expect(step1Next, 'step 1 gate must open once the build is complete').toBeEnabled();
  await step1Next.click();
  await expect(page.locator('[data-step-panel="2"]')).toBeVisible();

  // Step 2 -- traits 1 and 2 are the pseudo-class's own stat spread, which
  // only exists as the union of the borrowed classes' spreads. An empty or
  // disabled select here means the union never reached the selects.
  const trait1Stats = page.locator('#trait1StatSelect option:not([value=""])');
  await expect(page.locator('#trait1StatSelect')).toBeEnabled();
  await expect(page.locator('#trait2StatSelect')).toBeEnabled();
  expect((await trait1Stats.allTextContents()).length).toBeGreaterThan(0);
  const offered = await trait1Stats.evaluateAll((els) => els.map((el) => el.value));
  expect(offered.slice().sort()).toEqual(UNION_STATS.slice().sort());

  // The trait text input stays disabled until its stat is picked, so the stat
  // select goes first in every pair.
  await page.selectOption('#trait1StatSelect', 'vitality');
  await page.fill('#trait1Custom', 'optimistic');
  await page.selectOption('#trait2StatSelect', 'reflex');
  await page.fill('#trait2Custom', 'smooth');
  await page.selectOption('#trait3StatSelect', 'intelligence');
  await page.fill('#trait3Custom', 'analytical');

  // Spend every stat point. Aspiring has no class spread to seed the grid, so
  // there are 5 user points to place at level 1 (6 total, 1 from trait 3).
  // Click the lowest empty assignable box each time: an already-filled box
  // would hand the point back.
  const next2 = page.locator('#step2Next');
  const assignable = page.locator('#statGrid .wizard-stat-box.is-assignable[data-clickable="1"]');
  for (let i = 0; i < 20 && await next2.isDisabled(); i++) {
    if (await assignable.count() === 0) break;
    await assignable.first().click();
  }
  await expect(next2, 'step 2 gate must open once traits and stats are set').toBeEnabled();
  await next2.click();
  await expect(page.locator('[data-step-panel="3"]')).toBeVisible();

  // Step 3 -- the primer lists the three borrowed abilities; no gate.
  await page.locator('[data-step-panel="3"] [data-wizard-next]').click();
  await expect(page.locator('[data-step-panel="4"]')).toBeVisible();

  // Step 4 -- 10 Merx, spent however the player likes. Choosing the three
  // Signatures in step 1 already defines the invented Class; the grant is
  // not compelled to buy them (services/character/input.js's
  // validateAspiringBuild checks the aspiring_signatures pool, not the gear
  // array). Buying all three at 2 Merx each plus 4 common items at 1 is one
  // legal way to spend the full 10 -- not the only one -- and is what this
  // spec exercises below.
  //
  // The three picks are bought through the grid + drawer, not #spendList:
  // pg. 90 prices them at the own-class rate, and the shop
  // (character-wizard.js#getShopPool) deliberately excludes anything already
  // in the pool so the same Signature is never offered at two prices at
  // once. signatureEntries() builds the grid for aspiring mode from exactly
  // these three picks; a cell only opens the drawer, and the drawer's own
  // data-signature-buy is what actually buys it -- same mechanism
  // 28-aspirant-v1-merx-purchases.spec.js uses for an aspirant's own class,
  // and the one 29-aspiring-signature-acquisition.spec.js uses for the same
  // three picks.
  const next4 = page.locator('#step4Next');
  for (const { key } of DONORS) {
    await page.locator(`#signatureGrid [data-signature-name="${prefix} ${key} Item"]`).click();
    await expect(page.locator('#signatureDrawer')).toBeVisible();
    await page.locator('#signatureDrawer [data-signature-buy]').click();
  }
  await page.locator('[data-shop-tab="common"]').click();
  for (let i = 0; i < 4; i++) {
    await page.locator('#spendList [data-shop-key]:not(.is-disabled)').nth(i).click();
  }
  await expect(page.locator('#merxSpent')).toHaveText('10');
  await expect(next4, 'step 4 gate must open once the Merx budget is spent').toBeEnabled();
  await next4.click();
  await expect(page.locator('[data-step-panel="5"]')).toBeVisible();

  // Step 5 -- aspiring has no class to gate on, so only the name does.
  await page.fill('#wizardName', name);
  const submit = page.locator('#wizardSubmit');
  await expect(submit).toBeEnabled();
  await submit.click();

  await page.waitForURL(/\/characters\/[0-9a-f-]{36}/);
  const id = page.url().match(/\/characters\/([0-9a-f-]{36})/)[1];

  const { rows } = await db.query(
    `select name, class, class_id, pseudo_class_tagline, pseudo_class_description
       from characters where id = $1`,
    [id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(name);
  expect(rows[0].class).toBe(pseudoClassName);
  expect(rows[0].class_id).toBeNull();
  expect(rows[0].pseudo_class_tagline).toBe(tagline);
  expect(rows[0].pseudo_class_description).toBe(description);

  const { rows: poolRows } = await db.query(
    'select aspiring_abilities from characters where id = $1', [id]
  );
  const sortByName = (list) => list.slice().sort((a, b) => a.name.localeCompare(b.name));
  expect(sortByName(poolRows[0].aspiring_abilities)).toEqual(sortByName([
    { class_id: donors.alpha.id, name: `${prefix} alpha Core`, type: 'core' },
    { class_id: donors.beta.id, name: `${prefix} beta Core`, type: 'core' },
    { class_id: donors.gamma.id, name: `${prefix} gamma Advanced`, type: 'advanced' }
  ]));

  const { rows: ownedRows } = await db.query(
    'select name from class_abilities where character_id = $1', [id]
  );
  expect(ownedRows, 'selection is not purchase -- nothing was bought').toHaveLength(0);

  // The rendered page is the point of the whole slice: the invented name has
  // to read as the character's class even though no class row backs it.
  await expect(page.locator('p').filter({ hasText: 'Class:' }).first()).toContainText(pseudoClassName);
  const abilityBox = page.locator('.box').filter({
    has: page.locator('h3', { hasText: 'Class Abilities' })
  });
  // Empty, for the same reason: the box renders character.abilities, which
  // holds only bought abilities (views/character.handlebars:258-265).
  await expect(abilityBox.locator('.column')).toHaveCount(0);
});
