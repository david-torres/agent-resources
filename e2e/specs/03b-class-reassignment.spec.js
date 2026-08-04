// ar-7v3k Task 4 fix round 1, Claim 2 (confirmed, High). This spec is
// EXPECTED TO FAIL -- it characterizes a real, confirmed defect, not a bug
// in this test. Do not "fix" it by changing production code or by loosening
// the assertions below; if it starts passing because someone actually fixed
// the underlying bug, that's the correct way for it to go green.
//
// Mechanism: the edit form's Class <select> options
// (adventV1Classes/adventV2Classes/aspirantPreview*/playerCreated*, built at
// routes/characters.js:113-117 via filterClassDataForUser) are restricted to
// classes the editing user currently has *unlocked*. Gear and abilities get
// an explicit fallback injection so the character's own current items always
// appear even when their class isn't unlocked (routes/characters.js:318-344,
// "so items from classes the user no longer has unlocked still appear") --
// but there is no equivalent injection for the character's own CURRENT
// CLASS in those class-option lists. When the class isn't unlocked, the
// <select required> has no <option> for it; unlike the Class Abilities
// <select> (TomSelect-enhanced, stays empty and blocks required-field
// validation), this is a plain native <select>, and browsers auto-select the
// first enabled <option> when none is marked selected -- so `required` is
// satisfied and nothing blocks submit. Submitting the form (even without
// touching the Class field) silently reassigns the character to that
// unrelated first-listed class. Reachable by a normal user whenever their
// unlocked set no longer covers a character's class -- e.g. a time-limited
// unlock expiring (class_unlocks.expires_at) or a class's is_public flag
// flipping to false.
//
// Cascading data loss (confirmed by running this spec): class_abilities is
// unconditionally deleted and reinserted for the character on every save
// (services/character/service.js's saveCharacterAtomic; the RPC is
// supabase/migrations/20260710000000_atomic_character_writes.sql:83), and
// character_perks.class_ability_id REFERENCES class_abilities(id)
// ON DELETE CASCADE (supabase/migrations/20240101000000_baseline_schema.sql:191)
// -- so the character's old perks disappear with the old ability rows. They
// are not necessarily replaced: services/character/service.js's
// saveCharacterAtomic only rebuilds perks `if (rulesVersion === 'v2')`, and
// rulesVersion is resolved from the *submitted* (wrongly-reassigned)
// class_id, not the character's real one -- when the reassigned class
// happens to be v1, the whole perk-reconciliation step is skipped and
// nothing gets reinserted at all.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter, seedPerk, abilityIdFor } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('reassign');
let db;
let character;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  // Deliberately NOT unlocked for the admin -- that's this defect's
  // precondition.
  //
  // The character is given BOTH of the class's fixture abilities (not the
  // usual single one seedCharacter defaults to). Reason: when a class is
  // locked, routes/characters.js:333-344's fallback injection only adds the
  // ability names the CHARACTER already owns into that class's Class
  // Abilities <select> optgroup -- not the class's full ability roster. With
  // only one owned ability that optgroup has exactly one <option>, which
  // trips the unrelated single-element Handlebars quirk (see
  // 03-perk-textarea.spec.js's header comment / task-4-report.md) and blocks
  // the submit before the class-reassignment defect this spec targets ever
  // gets exercised. Owning two abilities keeps that optgroup at two options.
  classRow = await seedClass(prefix, { rulesVersion: 'v2' });
  character = await seedCharacter(prefix, profile, classRow, {
    abilities: classRow.abilities.map((a) => ({ name: a.name, class_id: classRow.id }))
  });
  await seedPerk(character.id, await abilityIdFor(character.id), 'original perk text');
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

test('saving an edit without touching Class does not reassign the character to an unrelated class', async ({ page }) => {
  await page.goto(`/characters/${character.id}/edit`);
  // Deliberately do not touch the Class <select> or the Class Abilities
  // <select> -- this characterizes what happens on an otherwise-untouched
  // save, which is exactly the scenario a real user hits (e.g. fixing a
  // typo elsewhere on the form).
  const submitButton = page.locator('form[hx-put] button[type="submit"]').first();
  await submitButton.waitFor({ state: 'visible' });
  await submitButton.click();

  // Not /\/characters\// -- the edit page itself (/characters/{id}/edit)
  // already matches that pattern, so waitForURL could resolve immediately,
  // before the save's PUT/redirect actually happens. Wait specifically for
  // navigation away from /edit.
  await page.waitForURL((url) => !url.pathname.endsWith('/edit'));

  const { rows: charRows } = await db.query(
    'select class_id from characters where id = $1', [character.id]
  );
  expect(charRows[0].class_id).toBe(classRow.id);

  const { rows: perkRows } = await db.query(
    'select text from character_perks where character_id = $1', [character.id]
  );
  expect(perkRows).toHaveLength(1);
  expect(perkRows[0].text).toBe('original perk text');
});
