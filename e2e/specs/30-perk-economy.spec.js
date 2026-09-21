// e2e/specs/30-perk-economy.spec.js
//
// ENCLAVE: Aspirant V1 pg. 7 -- the Perk economy: an Advanced Ability from a
// character's own Class costs 2 Perks, Cross-Classing a Core Ability costs 3
// and an Advanced one costs 4, and no character may ever hold more than its
// edition's Ability cap (six for aspirant, four for aspiring). pg. 90 layers
// the aspiring rule on top: three picks (two Core, one Advanced) define the
// invented Class at creation, priced at the own-class rate, and pg. 90 step
// 3b is explicit that buying them is optional -- "immediately (or at all)".
//
// Five journeys, proving what no unit test can because each needs a real
// browser against a real database:
//   1. An aspirant character buys an own-class Advanced Ability on the edit
//      form for 2 Perks, and the character PAGE (not just the form) shows
//      the balance fall after a save and reload.
//   2. An aspirant character buys a Cross-Class Core ability for 3 Perks, and
//      the catalogue entry itself carries an origin badge naming the donor
//      class -- proof the rate and the badge agree about which class an
//      ability actually comes from.
//   3. The rule the whole slice turns on: an aspiring character is created
//      selecting three picks (from three DISTINCT donor classes) and buying
//      none, then buys two of the three later from the edit form's
//      catalogue -- proving selection != purchase for Abilities the same way
//      27/29 already prove it for the type tag and for Signatures.
//   4. A grandfathered character -- already over the Ability cap before this
//      economy existed to refuse it -- still saves when renamed, and the
//      Illegal Build notice persists rather than silently clearing.
//   5. The catalogue's search finds an ability in a class that is not the
//      character's own, proving the grouping (util/character-form's
//      abilityPurchaseData) and CatalogueControls' search both work over the
//      WHOLE roster, not just the character's own class.
//
// Modelled on e2e/specs/29-aspiring-signature-acquisition.spec.js for the
// donor-class setup, cleanup and DB-assertion style, and on
// e2e/specs/27-aspirant-ability-type.spec.js for the aspirant wizard flow.
//
// SELECTOR NOTE: the character page prints three separate lines --
// "Perks earned:", "Perks spent:" and "Perks remaining:" (views/character.
// handlebars) -- and Playwright's `hasText` string filter substring-matches
// case-INsensitively, so a bare "Spent:" filter matches "Perks spent:" too
// and throws a strict-mode violation (this is a live, pre-existing failure
// in 29 at HEAD: `locator('p').filter({ hasText: 'Spent:' })` resolves to
// both the Merx "Spent:" line and the "Perks spent:" line). Every locator
// below filters on the FULL "Perks spent:" / "Perks earned:" /
// "Perks remaining:" text for exactly this reason.
//
// CLEANUP: every row this spec creates is removed by cleanupByPrefix, keyed
// on the shared prefix -- including the grandfathered character's raw-
// inserted 7th class_abilities row (deleted by character_id, same as any
// other). Row counts must be identical before and after this spec runs.
//
// CONFIRMED DEFECT (journeys 1 and 3 fail against it, honestly, on purpose):
// routes/characters.js's PUT /:id handler calls applyGearPurchases(req.body)
// (util/gear-purchase-data.js), which reads the submitted gear_json field and
// turns it into body.gear before updateCharacter ever runs. There is no such
// call for Abilities: views/character-form.handlebars's #abilityJson hidden
// input (name="abilities_json") is correctly populated by
// public/js/character-ability-purchases.js -- verified directly against a
// live PUT request body, which does carry a correct abilities_json string --
// but nothing on the server ever reads it. body.abilities is therefore never
// set, normalizeCharacterInput's childData.classAbilities comes out
// undefined, and services/character/service.js's
// `if (childData.classAbilities) { reconcileAbilities(...) }` guard (both
// the create and update paths) skips the write entirely. Every purchase made
// through the edit-form's ability catalogue is real in the browser and in
// the submitted request, and vanishes on save without any error -- there is
// no applyAbilityPurchases counterpart to util/gear-purchase-data.js's
// applyGearPurchases. Journeys 2, 4 and 5 do not depend on this path and are
// unaffected. This is a routes/services gap left by Tasks 6/7, not a mistake
// in this spec or its fixtures -- see the two `expect(...).toEqual(...)`
// assertions below marked DEFECT for exactly where it bites, and task-8-
// report.md for the full writeup.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('perk-economy');

// ---- Fixtures shared by journeys 1, 2, 4 and 5 (the aspirant economy) ----
const OWN_ADVANCED = `${prefix} Own Advanced`;
const OWN_CORE_ONE = `${prefix} Own Core One`;
const OWN_CORE_TWO = `${prefix} Own Core Two`;
const CROSS_CORE = `${prefix} Cross Core`;
const CROSS_CORE_TWO = `${prefix} Cross Core Two`;
const SEARCH_TARGET_ABILITY = `${prefix} Findable Cross Core`;

// ---- Fixtures for journey 3 (the aspiring economy) -- three DISTINCT donor
// classes for the three picks, disjoint stat spreads for the same reason
// 26-aspiring-wizard.spec.js and 29-aspiring-signature-acquisition.spec.js
// give their own donors one: step 2's stat selects offer the union of all
// three, so overlapping spreads would make that union unassertable.
const DONORS = [
  { key: 'alpha', statSpread: { vitality: 2, might: 1 } },
  { key: 'beta', statSpread: { reflex: 2, skill: 1 } },
  { key: 'gamma', statSpread: { luck: 2, sensory: 1 } }
];
const donorGearName = (key) => `${prefix} ${key} Gear`;
const donorCoreName = (key) => `${prefix} ${key} Core`;
const donorCoreTwoName = (key) => `${prefix} ${key} Core Two`;
const donorAdvancedName = (key) => `${prefix} ${key} Advanced`;

let db;
let profile;
let ownClass;
let crossClass;
const donors = {};

// Aspirant characters, one per journey so parallel workers never share
// mutable state (playwright.config.js runs this suite fullyParallel).
let aspirant1; // journey 1: own-class Advanced buy
let aspirant2; // journey 2: Cross-Class Core buy
let aspirant4; // journey 4: grandfathered over-cap
let aspirant5; // journey 5: catalogue search

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);

  ownClass = await seedClass(prefix, {
    name: `${prefix}-own`,
    rulesVersion: 'v1',
    statSpread: { vitality: 2, might: 1 },
    abilities: [
      { name: OWN_CORE_ONE, description: 'own core one' },
      { name: OWN_CORE_TWO, description: 'own core two' }
    ],
    advancedAbilities: [{ name: OWN_ADVANCED, description: 'own advanced ability' }]
  });
  // fixtures/class.js#seedClass has no content_format parameter, and the
  // column's own DB default is 'advent' (migration
  // 20260916000000_class_content_format.sql) -- so every class this suite's
  // fixtures create is 'advent' unless corrected here. economyFor
  // (util/merx-economy.js) resolves a character's Perk economy from ITS OWN
  // CLASS's content_format, not from creator_mode alone (creator_mode
  // 'aspiring' is the one exception, resolving to 'aspiring' regardless --
  // which is why 26/27/29's aspiring-mode specs never needed this fix). An
  // aspirant character on an 'advent' class silently gets the ADVENT Ability
  // cap (3) and no Cross-Class pricing at all, which is exactly the failure
  // this update prevents: every aspirant journey below (1, 2, 4, 5) resolves
  // its economy through ownClass, so only ownClass needs the correction --
  // crossClass and the donor classes are never anyone's OWN class here, and
  // economyFor never consults a donor's content_format.
  await db.query(`update classes set content_format = 'aspirant' where id = $1`, [ownClass.id]);
  crossClass = await seedClass(prefix, {
    name: `${prefix}-cross`,
    rulesVersion: 'v1',
    statSpread: { reflex: 2, skill: 1 },
    abilities: [
      { name: CROSS_CORE, description: 'cross core' },
      { name: CROSS_CORE_TWO, description: 'cross core two' }
    ]
  });
  await unlockClassForProfile(profile, ownClass);
  await unlockClassForProfile(profile, crossClass);

  for (const { key, statSpread } of DONORS) {
    const row = await seedClass(prefix, {
      name: `${prefix}-${key}`,
      rulesVersion: 'v1',
      statSpread,
      gear: [{ name: donorGearName(key), description: `${key} gear` }],
      abilities: [
        { name: donorCoreName(key), description: `${key} core ability` },
        { name: donorCoreTwoName(key), description: `${key} second core ability` }
      ],
      advancedAbilities: [{ name: donorAdvancedName(key), description: `${key} advanced ability` }]
    });
    await unlockClassForProfile(profile, row);
    donors[key] = row;
  }

  // validateTraits (services/character/input.js) enforces exactly 3 Traits
  // on distinct Stats for every economy but advent -- unlike the rest of
  // this suite's seedCharacter calls, whose classes default to 'advent'
  // content_format (validateTraits short-circuits to {ok:true} there), these
  // characters are genuinely under the aspirant economy, so all three must
  // be supplied explicitly with their Stats rather than left to seedCharacter's
  // single-trait, vocabulary-derived default.
  const ASPIRANT_TRAITS = {
    trait0: 'Brave', trait0_stat: 'vitality',
    trait1: 'Quick', trait1_stat: 'reflex',
    trait2: 'Sharp', trait2_stat: 'intelligence'
  };

  // Level 5 grants an aspirant character 5 Perks (PERK_GRANT.aspirant=1 +
  // PERKS_PER_LEVEL=1 per level, util/perk-economy.js) -- enough to afford
  // both an own-class Advanced buy (2) and a Cross-Class Core buy (3) with
  // room to spare, so neither purchase is gated by the balance itself.
  aspirant1 = await seedCharacter(prefix, profile, ownClass, {
    name: `${prefix}-aspirant1`,
    creator_mode: 'aspirant',
    level: 5,
    ...ASPIRANT_TRAITS,
    abilities: [{ name: OWN_CORE_ONE, class_id: ownClass.id, type: 'core' }]
  });
  aspirant2 = await seedCharacter(prefix, profile, ownClass, {
    name: `${prefix}-aspirant2`,
    creator_mode: 'aspirant',
    level: 5,
    ...ASPIRANT_TRAITS,
    abilities: [{ name: OWN_CORE_ONE, class_id: ownClass.id, type: 'core' }]
  });
  // Level 1's creation allotment (6 Stat pluses, util/stat-caps.js
  // CREATION_PLUSES.aspirant) is smaller than BASE_STATS' own 12-plus total
  // (fixtures/character.js -- every one of its 12 Stats starts at 1), so
  // this character needs the same level-5 headroom as the others even though
  // journey 5 spends no Perks at all.
  aspirant5 = await seedCharacter(prefix, profile, ownClass, {
    name: `${prefix}-aspirant5`,
    creator_mode: 'aspirant',
    level: 5,
    ...ASPIRANT_TRAITS,
    abilities: [{ name: OWN_CORE_ONE, class_id: ownClass.id, type: 'core' }]
  });

  // Journey 4: a character already AT the six-Ability cap (legal on its
  // own -- pg. 7's cap is "no more than six", and six is not more than six).
  // Six own-class Core rows: the first three are FREE_CORE_ABILITIES.aspirant
  // (util/perk-economy.js), the other three cost 1 Perk each, so level 4
  // (grant 4) affords it with one to spare.
  const capAbilities = Array.from({ length: 6 }, (_, i) => ({
    name: `${prefix} Cap Ability ${i}`, class_id: ownClass.id, type: 'core'
  }));
  aspirant4 = await seedCharacter(prefix, profile, ownClass, {
    name: `${prefix}-aspirant4`,
    creator_mode: 'aspirant',
    level: 4,
    ...ASPIRANT_TRAITS,
    abilities: capAbilities
  });
  // Push it OVER the cap by inserting a SEVENTH class_abilities row directly,
  // bypassing every app-level validator -- simulating a character that
  // already existed, over the cap, before this economy's ratchet was there
  // to refuse it (services/character/service.js's worsenedBreaches grants
  // exactly this: a save that leaves an existing breach exactly as it stands
  // goes through). createCharacter itself would refuse a fresh 7-Ability
  // submission outright (services/character/service.test.js "an update
  // introducing a fresh Ability-cap breach is refused"), which is why this
  // row cannot be seeded through the ordinary creation path.
  await db.query(
    `insert into class_abilities (character_id, name, class_id, type)
     values ($1, $2, $3, 'core')`,
    [aspirant4.id, `${prefix} Cap Ability Seventh`, ownClass.id]
  );
});

test.afterAll(async () => {
  try {
    await cleanupByPrefix(db, prefix);
  } finally {
    await db.end();
  }
});

// Reads one entry's price tag ("2 Perks") as a number, the same way
// 28-aspirant-v1-merx-purchases.spec.js and 29 read a served price off the
// DOM rather than duplicating it from util/perk-economy.js.
const readPerks = async (locator) => {
  const text = (await locator.textContent()) || '';
  const n = parseInt(text, 10);
  expect(Number.isNaN(n), `expected a Perk price tag, got "${text}"`).toBe(false);
  return n;
};

const abilityEntry = (page, name, classId) =>
  page.locator(`[data-ability-entry][data-ability-name="${name}"][data-ability-class="${classId}"]`);

test('an aspirant character buys an own-class Advanced Ability for 2 Perks, and the character page shows the balance fall', async ({ page }) => {
  await page.goto(`/characters/${aspirant1.id}/edit`);
  await page.waitForLoadState('networkidle');

  const entry = abilityEntry(page, OWN_ADVANCED, ownClass.id);
  await expect(entry).toBeVisible();
  const price = await readPerks(entry.locator('.tag.is-warning'));
  expect(price, 'an own-class Advanced Ability must cost 2 Perks').toBe(2);

  // Only one owned Core Ability, well inside the free allowance -- nothing
  // spent yet.
  await expect(page.locator('[data-perks-spent]')).toHaveText('0');
  await expect(page.locator('[data-perks-earned]')).toHaveText('5');

  await entry.locator('[data-ability-buy]').click();
  await expect(page.locator('[data-perks-spent]'), 'buying the Advanced Ability must spend exactly its 2-Perk price').toHaveText('2');
  await expect(entry.locator('.tag.is-success')).toHaveText('Owned');

  await page.locator('form[hx-put] button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));

  // DEFECT: this is expected to hold -- a save must persist what the
  // catalogue just sold -- and currently does not. See the file header's
  // "CONFIRMED DEFECT" note: routes/characters.js's PUT handler never reads
  // the submitted abilities_json field, so this purchase never reaches the
  // database no matter how correctly the browser drove it.
  const { rows: abilityRows } = await db.query(
    'select name, type, class_id from class_abilities where character_id = $1 order by name', [aspirant1.id]
  );
  expect(
    abilityRows.map((r) => ({ name: r.name, type: r.type, class_id: r.class_id })),
    'the save must persist the Advanced Ability the edit form just sold'
  ).toEqual(expect.arrayContaining([{ name: OWN_ADVANCED, type: 'advanced', class_id: ownClass.id }]));

  await page.goto(`/characters/${aspirant1.id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('p').filter({ hasText: 'Perks spent:' }), 'the character page must show the balance the purchase actually charged').toContainText('2');
  await expect(page.locator('p').filter({ hasText: 'Perks remaining:' })).toContainText('3');
});

test('an aspirant character buys a Cross-Class Core ability for 3 Perks, and the entry carries the origin badge naming the donor class', async ({ page }) => {
  await page.goto(`/characters/${aspirant2.id}/edit`);
  await page.waitForLoadState('networkidle');

  const entry = abilityEntry(page, CROSS_CORE, crossClass.id);
  await expect(entry).toBeVisible();

  // The origin badge -- character-ability-purchases.js#renderEntry only
  // prints it when entry.crossClass && entry.class_name, so its presence
  // here is itself proof this row priced as Cross-Class, not own.
  const badge = entry.locator('.tag.is-info');
  await expect(badge, 'a Cross-Class entry must carry an origin badge naming its donor class').toHaveText(crossClass.name);

  const price = await readPerks(entry.locator('.tag.is-warning'));
  expect(price, 'a Cross-Class Core ability must cost 3 Perks').toBe(3);

  await expect(page.locator('[data-perks-spent]')).toHaveText('0');
  await entry.locator('[data-ability-buy]').click();
  await expect(page.locator('[data-perks-spent]')).toHaveText('3');

  // The badge survives the purchase -- it is not replaced by the "Owned"
  // tag, it sits alongside it (renderEntry concatenates origin + priceTag).
  await expect(entry.locator('.tag.is-info'), 'the origin badge must still name the donor class after the purchase').toHaveText(crossClass.name);
  await expect(entry.locator('.tag.is-success')).toHaveText('Owned');
});

test('an aspiring character selects three picks from three donor classes, buys none at creation, then buys two of them later', async ({ page }) => {
  const name = `${prefix} Aspiring Hero`;

  await page.goto('/characters/wizard?mode=aspiring&fresh=1');
  await page.waitForLoadState('networkidle');

  await page.fill('#pseudoClassName', 'Threefold Perk Build');
  await page.fill('#pseudoClassTagline', 'Invented from three borrowed Abilities');
  await page.fill('#pseudoClassDescription', 'A pseudo-class this spec invents to prove pg. 90 for Abilities.');

  // Step 1 -- one gear pick per donor (required to clear the step-1 gate)
  // plus the three Ability picks the whole spec turns on: two Core from two
  // distinct donors, one Advanced from the third.
  for (const { key } of DONORS) {
    await page.locator('[data-toggler-button="gear"]').click();
    await page
      .locator(`[data-toggler-picker="gear"] li[data-class-id="${donors[key].id}"][data-item-name="${donorGearName(key)}"]`)
      .click();
  }
  await expect(page.locator('[data-toggler-card="gear"]')).toHaveCount(3);

  const pickAbility = async (donorKey, itemName) => {
    await page.locator('[data-toggler-button="abilities"]').click();
    await page
      .locator(`[data-toggler-picker="abilities"] li[data-class-id="${donors[donorKey].id}"][data-item-name="${itemName}"]`)
      .click();
  };
  await pickAbility('alpha', donorCoreName('alpha'));
  await pickAbility('beta', donorCoreName('beta'));
  await pickAbility('gamma', donorAdvancedName('gamma'));
  await expect(page.locator('[data-toggler-card="abilities"]')).toHaveCount(3);

  const step1Next = page.locator('#step1Next');
  await expect(step1Next, 'step 1 gate must open once the build is complete').toBeEnabled();
  await step1Next.click();
  await expect(page.locator('[data-step-panel="2"]')).toBeVisible();

  // Step 2 -- traits and stats, not this journey's proof; filled minimally.
  await page.selectOption('#trait1StatSelect', 'vitality');
  await page.fill('#trait1Custom', 'optimistic');
  await page.selectOption('#trait2StatSelect', 'reflex');
  await page.fill('#trait2Custom', 'quick');
  await page.selectOption('#trait3StatSelect', 'luck');
  await page.fill('#trait3Custom', 'fortunate');

  const next2 = page.locator('#step2Next');
  const assignable = page.locator('#statGrid .wizard-stat-box.is-assignable[data-clickable="1"]');
  for (let i = 0; i < 20 && await next2.isDisabled(); i++) {
    if (await assignable.count() === 0) break;
    await assignable.first().click();
  }
  await expect(next2, 'step 2 gate must open once traits and stats are set').toBeEnabled();
  await next2.click();
  await expect(page.locator('[data-step-panel="3"]')).toBeVisible();

  // ---- Proof 1: choosing the three is not buying them ----
  const perksBox = page.locator('#abilityPrimerList .has-background-light strong');
  await expect(perksBox, 'no pick is bought merely by being chosen').toHaveText('Perks spent 0 / 3');

  const next3 = page.locator('[data-step-panel="3"] [data-wizard-next]');
  await next3.click();
  await expect(page.locator('[data-step-panel="4"]')).toBeVisible();

  const next4 = page.locator('#step4Next');
  await expect(next4).toBeEnabled();
  await next4.click();
  await expect(page.locator('[data-step-panel="5"]')).toBeVisible();

  await page.fill('#wizardName', name);
  const submit = page.locator('#wizardSubmit');
  await expect(submit).toBeEnabled();
  await submit.click();

  await page.waitForURL(/\/characters\/[0-9a-f-]{36}/);
  const id = page.url().match(/\/characters\/([0-9a-f-]{36})/)[1];

  // ---- Proof 2: the stored pool holds exactly the three picks, and the
  // character owns NONE of them yet ----
  const { rows: charRows } = await db.query(
    'select aspiring_abilities, creator_mode from characters where id = $1', [id]
  );
  expect(charRows).toHaveLength(1);
  expect(charRows[0].creator_mode).toBe('aspiring');
  const storedPool = charRows[0].aspiring_abilities;
  expect(storedPool, 'the pool must hold exactly the three picks').toHaveLength(3);
  const sortByName = (list) => list.slice().sort((a, b) => a.name.localeCompare(b.name));
  const expectedPool = [
    { class_id: donors.alpha.id, name: donorCoreName('alpha'), type: 'core' },
    { class_id: donors.beta.id, name: donorCoreName('beta'), type: 'core' },
    { class_id: donors.gamma.id, name: donorAdvancedName('gamma'), type: 'advanced' }
  ];
  expect(sortByName(storedPool)).toEqual(sortByName(expectedPool));

  const { rows: ownedRows } = await db.query(
    'select name from class_abilities where character_id = $1', [id]
  );
  expect(ownedRows, 'nothing was bought at creation -- the character owns none of its three picks').toHaveLength(0);

  // ---- Proof 3: buying two of the three later, from the edit form's
  // catalogue, at the 1/1/2 own-pool rate ----
  await page.goto(`/characters/${id}/edit`);
  await page.waitForLoadState('networkidle');

  await expect(page.locator('[data-perks-spent]')).toHaveText('0');
  await expect(page.locator('[data-perks-earned]')).toHaveText('3');

  const coreEntry = abilityEntry(page, donorCoreName('alpha'), donors.alpha.id);
  const corePrice = await readPerks(coreEntry.locator('.tag.is-warning'));
  expect(corePrice, "a pool Core pick must cost 1 Perk").toBe(1);
  await coreEntry.locator('[data-ability-buy]').click();
  await expect(page.locator('[data-perks-spent]')).toHaveText('1');

  const advancedEntry = abilityEntry(page, donorAdvancedName('gamma'), donors.gamma.id);
  const advancedPrice = await readPerks(advancedEntry.locator('.tag.is-warning'));
  expect(advancedPrice, 'the pool Advanced pick must cost 2 Perks').toBe(2);
  await advancedEntry.locator('[data-ability-buy]').click();
  await expect(page.locator('[data-perks-spent]'), 'buying two of the three picks must spend exactly 1 + 2').toHaveText('3');

  // The third pick sits unbought -- assert its Buy button is still offered,
  // proving "some" is a real state distinct from "none" and "all".
  const untouchedEntry = abilityEntry(page, donorCoreName('beta'), donors.beta.id);
  await expect(untouchedEntry.locator('[data-ability-buy]'), 'the third pick must remain unbought, still offered for sale').toBeVisible();

  await page.locator('form[hx-put] button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));

  // DEFECT: same gap as journey 1 (see the file header's "CONFIRMED DEFECT"
  // note) -- this is the rule the whole slice turns on, and the save that is
  // supposed to make "buy two of the three later" real currently persists
  // nothing at all (ownedAfter comes back empty).
  const { rows: ownedAfter } = await db.query(
    'select name, type, class_id from class_abilities where character_id = $1 order by name', [id]
  );
  expect(
    ownedAfter.map((r) => ({ name: r.name, type: r.type, class_id: r.class_id })),
    'the save must persist exactly the two picks that were bought, not the untouched third'
  ).toEqual([
    { name: donorAdvancedName('gamma'), type: 'advanced', class_id: donors.gamma.id },
    { name: donorCoreName('alpha'), type: 'core', class_id: donors.alpha.id }
  ].sort((a, b) => a.name.localeCompare(b.name)));

  const { rows: poolAfter } = await db.query(
    'select aspiring_abilities from characters where id = $1', [id]
  );
  expect(sortByName(poolAfter[0].aspiring_abilities), 'an edit-form purchase must never touch the stored pool').toEqual(sortByName(expectedPool));
});

test('a grandfathered over-cap character still saves when renamed, and the Illegal Build notice persists', async ({ page }) => {
  await page.goto(`/characters/${aspirant4.id}`);
  await page.waitForLoadState('networkidle');
  const noticeBefore = page.locator('p').filter({ hasText: 'Illegal Build:' });
  await expect(noticeBefore, 'a character stored over the Ability cap must show the Illegal Build notice').toBeVisible();
  await expect(noticeBefore).toContainText('7 Abilities');

  const newName = `${prefix}-aspirant4-renamed`;
  await page.goto(`/characters/${aspirant4.id}/edit`);
  await page.waitForLoadState('networkidle');
  await page.fill('#char-name', newName);
  await page.locator('form[hx-put] button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));

  const { rows } = await db.query('select name from characters where id = $1', [aspirant4.id]);
  expect(rows[0].name, 'the rename must have actually saved').toBe(newName);

  await page.goto(`/characters/${aspirant4.id}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1')).toContainText(newName);
  const noticeAfter = page.locator('p').filter({ hasText: 'Illegal Build:' });
  await expect(noticeAfter, 'the Illegal Build notice must persist across a save that leaves the breach unchanged').toBeVisible();
  await expect(noticeAfter).toContainText('7 Abilities');
});

test("the catalogue's search finds an ability in a class that is not the character's own", async ({ page }) => {
  // A donor class the character has never owned anything from, added purely
  // so this journey proves search reaches the WHOLE roster (buildCatalogue
  // in util/ability-purchase-data.js), not just the character's own class
  // plus whatever it already owns.
  const searchDonor = await seedClass(prefix, {
    name: `${prefix}-search-donor`,
    rulesVersion: 'v1',
    abilities: [
      { name: SEARCH_TARGET_ABILITY, description: 'findable only by search' },
      { name: `${prefix} Search Donor Filler`, description: 'a second ability so the class fixture meets its own >=2 minimum' }
    ]
  });
  await unlockClassForProfile(profile, searchDonor);

  await page.goto(`/characters/${aspirant5.id}/edit`);
  await page.waitForLoadState('networkidle');

  const groupHeading = page.locator(`[data-catalogue-group-heading]:text-is("${searchDonor.name}")`);
  await expect(groupHeading, 'before searching, the donor class group must already be present in the whole-roster catalogue').toBeVisible();

  const searchInput = page.locator('#abilityCatalogue [data-catalogue-search]');
  await searchInput.fill('Findable Cross Core');

  await expect(page.locator('[data-catalogue-group]'), 'search must narrow the catalogue to exactly the one matching group').toHaveCount(1);
  await expect(page.locator('[data-catalogue-group-heading]')).toHaveText(searchDonor.name);
  await expect(abilityEntry(page, SEARCH_TARGET_ABILITY, searchDonor.id)).toBeVisible();
  await expect(page.getByText(`${prefix} Search Donor Filler`), 'the non-matching entry in the SAME group must be filtered out too').toHaveCount(0);

  // Own class's group must be gone entirely -- the search reaches every
  // group, not just the one being demonstrated.
  await expect(page.locator(`[data-catalogue-group-heading]:text-is("${ownClass.name}")`)).toHaveCount(0);
});
