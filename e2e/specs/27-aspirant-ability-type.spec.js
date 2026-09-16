// e2e/specs/27-aspirant-ability-type.spec.js
//
// Aspirant characters are auto-granted their class's ADVANCED abilities, not
// its base ones (public/js/character-wizard.js#serializePayload). Every one of
// those rows must land in class_abilities with type='advanced' -- the same
// tagging migration 20260913000000's corrective backfill applies to history.
// Nothing else covers the forward path: 19-character-wizard-crud drives advent
// (all-core) and 26-aspiring-wizard drives aspiring (which tags its picks
// explicitly), so aspirant is the one mode where the tag is inferred from
// which list the wizard read.
//
// The defect this guards against is invisible against ordinary fixtures: the
// seeded classes in 19 and 26 aside, no local class carries a non-empty
// advanced_abilities, so an aspirant character's abilities all happen to be
// core-tagged for the right answer by accident. advancedAbilities below is
// what makes the distinction observable.
//
// Shares 19-character-wizard-crud.spec.js's traps: every step panel is in the
// DOM from first paint and merely toggled with .hidden, so assert VISIBILITY
// plus the Next button's own gate, never mere presence.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass, unlockClassForProfile } = require('../fixtures/class');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });

const prefix = newPrefix('aspirant-type');

const ADVANCED_NAMES = [`${prefix} Advanced One`, `${prefix} Advanced Two`];

let db;
let profile;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  classRow = await seedClass(prefix, {
    rulesVersion: 'v1',
    // >= 2 stats or populatePersonalitySelects locks the trait selects.
    statSpread: { vitality: 2, might: 2 },
    abilities: [
      { name: `${prefix} Core One`, description: 'base ability one' },
      { name: `${prefix} Core Two`, description: 'base ability two' }
    ],
    advancedAbilities: ADVANCED_NAMES.map((name) => ({ name, description: `${name} description` }))
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

test('an aspirant character persists its advanced abilities as type=advanced', async ({ page }) => {
  const name = `${prefix} Aspirant Hero`;

  await page.goto('/characters/wizard?mode=aspirant&fresh=1');
  await page.waitForLoadState('networkidle');

  // Step 1 -- #step1Next is never disabled, so assert the card registered
  // rather than trusting the click.
  const card = page.locator(`#classKioskTrack .wizard-kiosk-card[data-id="${classRow.id}"]`);
  await card.click();
  await expect(card).toHaveClass(/is-selected|selected/);
  await page.locator('#step1Next').click();
  await expect(page.locator('[data-step-panel="2"]')).toBeVisible();

  // Step 2 -- aspirant uses the split trait control (stat <select> + free-text
  // input), not advent's unified #traitNSelect. The text input stays disabled
  // until its stat is picked, so the select goes first in every pair.
  await page.selectOption('#trait1StatSelect', 'vitality');
  await page.fill('#trait1Custom', 'stalwart');
  await page.selectOption('#trait2StatSelect', 'might');
  await page.fill('#trait2Custom', 'forceful');
  await page.selectOption('#trait3StatSelect', 'intelligence');
  await page.fill('#trait3Custom', 'analytical');

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

  // Step 3 -- ability primer plus the optional perk editor; no gate.
  await page.locator('[data-step-panel="3"] [data-wizard-next]').click();
  await expect(page.locator('[data-step-panel="4"]')).toBeVisible();

  // Step 4 -- aspirant's 12 Merx is a ceiling, not a quota
  // (character-wizard.js#renderGearStep leaves #step4Next enabled), so the
  // step can be passed without spending.
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

  const { rows } = await db.query(
    'select name, class_id, creator_mode from characters where id = $1', [id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].class_id).toBe(classRow.id);
  expect(rows[0].creator_mode).toBe('aspirant');

  const { rows: abilityRows } = await db.query(
    'select name, type from class_abilities where character_id = $1 order by name', [id]
  );
  expect(abilityRows.map((r) => r.name)).toEqual(ADVANCED_NAMES.slice().sort());
  expect(abilityRows.map((r) => r.type)).toEqual(['advanced', 'advanced']);
});
