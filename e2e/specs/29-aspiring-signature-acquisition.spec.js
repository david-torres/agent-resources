// e2e/specs/29-aspiring-signature-acquisition.spec.js
//
// ENCLAVE: Aspirant V1 pg. 90 -- an aspiring character invents its own Class
// out of three Signature Items picked from three donor classes at creation.
// Those three price at the own-class rate (2 Merx); every OTHER Signature in
// the game -- including one from a class a pick came from, because the
// character had that ITEM, not that class -- costs the cross-class rate (3).
// And picking the three is not buying them: the 10-Merx creation grant is
// spent however the player likes.
//
// This is the only spec that proves the whole rule end to end, through a
// real browser against a real database: pick three, buy two of them (proving
// selection != purchase), buy the third, buy a fourth Signature from the
// wizard's own shop at the cross-class rate, submit, confirm the STORED pool
// holds exactly the three picks (not the four Signatures the character now
// owns), then reach the SAME character from its edit form after creation and
// buy a fifth Signature from the catalogue at the same cross-class rate, and
// finally confirm the character page's own Merx breakdown agrees with what
// both surfaces charged.
//
// Modelled on 26-aspiring-wizard.spec.js for the donor-class setup and the
// step-1/2/3 builder flow, and on 28-aspirant-v1-merx-purchases.spec.js for
// how a Signature is actually bought: open its grid cell, then click
// data-signature-buy in the drawer that opens. That second file's mechanism
// -- not 26's -- is how the three picks are bought here.
//
// WHY THE PICKS ARE BOUGHT VIA THE GRID, NOT VIA #spendList LIKE 26 DOES:
// 26-aspiring-wizard.spec.js buys its three picks through
// `#spendList [data-shop-key="class:...`, and that is now BROKEN by this
// same plan's own public/js/character-wizard.js#getShopPool (commit
// a07c618): the shop explicitly excludes any item already in the aspiring
// pool (`if (economyForState() === 'aspiring' && inPool(cls, g)) return;`),
// so those shop-key locators never resolve and 26 times out. Verified by
// running 26 directly against this branch: it fails at that exact line.
// signatureEntries() (character-wizard.js) already builds the grid for
// aspiring mode from the three picks (DATA.mode === 'aspiring' branch), and
// grid cells were never a free grant -- clicking one only opens a drawer;
// "nothing is bought by opening one" (character-wizard.js's own comment) --
// so buying through the grid+drawer, exactly like 28 does for an aspirant's
// own class, is the CORRECT and only working purchase path for the three
// picks post-a07c618. This is a real regression in 26, reported separately;
// this spec does not fix it, only avoids relying on the broken selector.
//
// CLEANUP: every row this spec creates -- the character, its class_gear,
// class_abilities, traits, the one offscreen mission seeded for Merx
// headroom, and the four donor classes -- is removed by cleanupByPrefix,
// which matches on the shared prefix. Row counts must be identical before
// and after this spec runs.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('sig-acquire');

// Three donor classes for the three picks, disjoint stat spreads for the
// same reason 26-aspiring-wizard.spec.js gives them one (the step-2 stat
// selects offer the UNION of the three, so overlapping spreads would make
// that union unassertable). Alpha alone gets a SECOND gear item: it is never
// picked, so it stays available in the wizard's shop, and buying it there is
// the sharpest proof of the rule pg. 90 states -- the cross-class rate
// applies because the character does not have THAT ITEM, even though it
// does have a different Signature from the very same class.
const DONORS = [
  { key: 'alpha', statSpread: { vitality: 2, might: 1 } },
  { key: 'beta', statSpread: { reflex: 2, skill: 1 } },
  { key: 'gamma', statSpread: { luck: 2, sensory: 1 } }
];
const poolItemName = (key) => `${prefix} ${key} Item`;
const ALPHA_SECOND_ITEM = `${prefix} alpha Item Two`;
// A fourth class, never a donor and never touched by the builder at all --
// this is the general case the pg. 90 rule exists for: a Signature the
// character never chose, from a class it never picked from either. Bought
// later from the EDIT form's catalogue (Task 9/10's surface), not the wizard.
const CATALOGUE_ITEM_NAME = `${prefix} delta Item`;
// Fixture headroom, not an economy figure: an offscreen mission's merx_gained
// is arbitrary earned Merx, seeded directly so the edit form has budget left
// to buy a fifth Signature after the wizard already spent 9 of its 10-Merx
// grant. Any value large enough to clear the cross-class price clears it;
// this one is comfortably larger.
const EXTRA_MISSION_MERX = 5;

let db;
let profile;
const donors = {};
let deltaClass;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  for (const { key, statSpread } of DONORS) {
    const gear = [{ name: poolItemName(key), description: `${key} item` }];
    if (key === 'alpha') {
      gear.push({ name: ALPHA_SECOND_ITEM, description: 'A second alpha Signature, never picked for the Class.' });
    }
    const row = await seedClass(prefix, {
      name: `${prefix}-${key}`,
      rulesVersion: 'v1',
      statSpread,
      gear,
      abilities: [
        { name: `${prefix} ${key} Core`, description: `${key} core ability` },
        { name: `${prefix} ${key} Core Two`, description: `${key} second core ability` }
      ],
      advancedAbilities: [
        { name: `${prefix} ${key} Advanced`, description: `${key} advanced ability` }
      ]
    });
    await unlockClassForProfile(profile, row);
    donors[key] = row;
  }
  deltaClass = await seedClass(prefix, {
    name: `${prefix}-delta`,
    rulesVersion: 'v1',
    gear: [{ name: CATALOGUE_ITEM_NAME, description: 'A Signature from a class the builder never touched.' }]
  });
  await unlockClassForProfile(profile, deltaClass);
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

// Each pick re-renders the whole builder, so the toggler has to be reopened
// for every one of them. Copied verbatim from 26-aspiring-wizard.spec.js.
const pickFromToggler = async (page, section, classRow, itemName) => {
  await page.locator(`[data-toggler-button="${section}"]`).click();
  await page
    .locator(`[data-toggler-picker="${section}"] li[data-class-id="${classRow.id}"][data-item-name="${itemName}"]`)
    .click();
};

// Reads a served price tag ("3m") as a number, exactly as
// 28-aspirant-v1-merx-purchases.spec.js does -- every price this spec checks
// is read off the DOM rather than duplicated from util/merx-economy.js.
const readPrice = async (locator) => {
  const text = (await locator.textContent()) || '';
  const n = parseInt(text, 10);
  expect(Number.isNaN(n), `expected a price tag, got "${text}"`).toBe(false);
  return n;
};

// Opens a Signature's grid cell and buys it through the drawer that opens --
// the wizard's actual purchase mechanism (see the file-header comment for
// why this, not #spendList, is what buys a pool pick).
const buyFromGrid = async (page, itemName) => {
  await page.locator(`#signatureGrid [data-signature-name="${itemName}"]`).click();
  await expect(page.locator('#signatureDrawer')).toBeVisible();
  await page.locator('#signatureDrawer [data-signature-buy]').click();
};

test('a player can acquire a Signature the character never chose, charged at the cross-class rate', async ({ page }) => {
  const name = `${prefix} Hero`;

  await page.goto('/characters/wizard?mode=aspiring&fresh=1');
  await page.waitForLoadState('networkidle');

  await page.fill('#pseudoClassName', 'Threefold');
  await page.fill('#pseudoClassTagline', 'Built from three borrowed tricks');
  await page.fill('#pseudoClassDescription', 'A pseudo-class this spec invents to prove pg. 90.');

  // Step 1 -- pick three Signature Items from three distinct classes. This is
  // the invention of the Class; it is not yet a purchase (proof 1 below).
  for (const { key } of DONORS) {
    await pickFromToggler(page, 'gear', donors[key], poolItemName(key));
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

  // Step 2 -- traits and stats. Not this spec's proof; filled the same
  // minimal way 26-aspiring-wizard.spec.js does, to reach step 4.
  await page.selectOption('#trait1StatSelect', 'vitality');
  await page.fill('#trait1Custom', 'optimistic');
  await page.selectOption('#trait2StatSelect', 'reflex');
  await page.fill('#trait2Custom', 'smooth');
  await page.selectOption('#trait3StatSelect', 'intelligence');
  await page.fill('#trait3Custom', 'analytical');

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

  // ---- Proof 1: choosing the three is not buying them ----
  // Buy only two of the three picks and assert the spend reads 4 (2 Merx
  // each, the own-class rate pg. 90 grants the invented Class) -- the third
  // pick sits chosen but unbought, still defining the Class either way.
  await expect(page.locator('#merxSpent')).toHaveText('0');
  await buyFromGrid(page, poolItemName('alpha'));
  await buyFromGrid(page, poolItemName('beta'));
  await expect(page.locator('#merxSpent')).toHaveText('4');

  // Buying the third pick now brings it to 6 -- both readings prove the same
  // point twice over: the grant was never spent by picking, only by buying.
  await buyFromGrid(page, poolItemName('gamma'));
  await expect(page.locator('#merxSpent')).toHaveText('6');

  // ---- Proof 2: every other Signature costs the cross-class rate, even one
  // from a class a pick came from ----
  // Alpha's SECOND item was never picked; the character had alpha's ITEM,
  // not alpha's class, so this one must price at 3, not 2. Bought from the
  // wizard's own shop (#spendList), whose "Signature Items" tab is active by
  // default and lists every Signature outside the pool.
  await page.locator(`#spendList [data-shop-key="class:${donors.alpha.id}:${ALPHA_SECOND_ITEM}"]`).click();
  await expect(page.locator('#merxSpent'), 'a Signature outside the pool must cost 3, not 2, even from a donor class').toHaveText('9');

  // The grant this character was offered, read off the served DOM rather
  // than duplicated from util/merx-economy.js -- used below to compute the
  // edit form's own budget without hardcoding the creation grant twice.
  const wizardGrant = await page.locator('#merxBudget').textContent();

  const next4 = page.locator('#step4Next');
  await expect(next4, 'step 4 gate must open once the Merx budget is spent within limits').toBeEnabled();
  await next4.click();
  await expect(page.locator('[data-step-panel="5"]')).toBeVisible();

  await page.fill('#wizardName', name);
  const submit = page.locator('#wizardSubmit');
  await expect(submit).toBeEnabled();
  await submit.click();

  await page.waitForURL(/\/characters\/[0-9a-f-]{36}/);
  const id = page.url().match(/\/characters\/([0-9a-f-]{36})/)[1];

  // ---- Proof 3: the stored pool holds exactly the three picks, not the
  // four Signatures the character now owns ----
  const { rows: charRows } = await db.query(
    'select aspiring_signatures from characters where id = $1', [id]
  );
  expect(charRows).toHaveLength(1);
  const storedPool = charRows[0].aspiring_signatures;
  expect(storedPool, 'the pool must hold exactly the three picks').toHaveLength(3);
  const expectedPool = DONORS.map(({ key }) => ({ class_id: donors[key].id, name: poolItemName(key) }));
  const sortByName = (list) => list.slice().sort((a, b) => a.name.localeCompare(b.name));
  expect(sortByName(storedPool)).toEqual(sortByName(expectedPool));

  const { rows: gearRows } = await db.query(
    'select name, class_id from class_gear where character_id = $1 order by name', [id]
  );
  expect(gearRows, 'the character owns FOUR Signatures -- the three picks plus the cross-class buy').toHaveLength(4);
  expect(gearRows.map((r) => r.name).sort()).toEqual(
    [poolItemName('alpha'), poolItemName('beta'), poolItemName('gamma'), ALPHA_SECOND_ITEM].sort()
  );

  // Seed Merx the character earned from a mission, so the edit form's budget
  // (grant + earned) has room left to buy a fifth Signature: the wizard
  // already spent 9 of its 10-Merx grant, leaving only 1, which is not
  // enough to afford the cross-class rate (3) proof 4 needs.
  await db.query(
    `insert into offscreen_missions
       (character_id, name, summary, source_mission_name, source_mission_date, created_by, merx_gained)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, `${prefix} Salvage Run`, 'Fixture merx grant for the edit-form purchase',
      'Fixture Source', '2026-01-01', profile.id, EXTRA_MISSION_MERX]
  );

  // ---- Proof 4: the edit form's catalogue prices the same way ----
  await page.goto(`/characters/${id}/edit`);
  await page.waitForLoadState('networkidle');

  await expect(page.locator('[data-merx-spent]'), 'the edit form must carry forward what the wizard already spent').toHaveText('9');

  const purchaseDrawer = page.locator('#purchaseDrawer');
  await page.locator(`#purchaseGrid [data-signature-name="${CATALOGUE_ITEM_NAME}"]`).click();
  await expect(purchaseDrawer).toBeVisible();
  const cataloguePrice = await readPrice(purchaseDrawer.locator('.entry-header .entry-price'));
  expect(cataloguePrice, 'a catalogue Signature from a class the builder never touched must charge 3').toBe(3);
  await purchaseDrawer.locator('[data-signature-buy]').click();
  await expect(page.locator('[data-merx-spent]')).toHaveText('12');

  await page.locator('form[hx-put] button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));

  const { rows: gearRowsAfterEdit } = await db.query(
    'select name from class_gear where character_id = $1', [id]
  );
  expect(gearRowsAfterEdit, 'the edit form save must add the fifth Signature without disturbing the pool').toHaveLength(5);
  const { rows: poolAfterEdit } = await db.query(
    'select aspiring_signatures, creator_mode from characters where id = $1', [id]
  );
  expect(sortByName(poolAfterEdit[0].aspiring_signatures), 'an edit must never touch the stored pool').toEqual(sortByName(expectedPool));
  // creator_mode is the ONLY signal economyFor has once class_id is null
  // (util/merx-economy.js). The classic edit form submits no such field, so
  // this is the character's whole claim to the aspiring economy surviving a
  // save through the surface proof 4 just used -- see services/character/
  // service.js#updateCharacter, where it is now preserved the same way
  // class_id is.
  expect(poolAfterEdit[0].creator_mode, 'an edit must not revert the character out of the aspiring economy').toBe('aspiring');

  // ---- Proof 5: the character page's own Merx breakdown agrees with what
  // both surfaces charged ----
  // Total spend is the sum of what was actually charged at each step, read
  // off the DOM above rather than restated as a fresh literal: 6 for the
  // three picks (proof 1), 3 for the wizard's cross-class buy (proof 2), and
  // 3 for the edit form's catalogue buy (proof 4).
  const totalSpent = 6 + 3 + cataloguePrice;
  const totalEarned = Number(wizardGrant) + EXTRA_MISSION_MERX;

  await page.goto(`/characters/${id}`);
  await page.waitForLoadState('networkidle');

  const spentLine = page.locator('p').filter({ hasText: 'Spent:' });
  const earnedLine = page.locator('p').filter({ hasText: 'Earned:' });
  await expect(spentLine, 'the character page must charge the same total the two purchase surfaces charged').toContainText(String(totalSpent));
  await expect(earnedLine).toContainText(String(totalEarned));
});
