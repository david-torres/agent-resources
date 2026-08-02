const { test, expect } = require('bun:test');
const { buildHardcodedClasses } = require('./seed-classes');
const { STARTER_CLASS_UNLOCKS } = require('./starter-content');
const { classGearList, classAbilityList } = require('./enclave-consts');

// The starter-unlock grant (models/profile.js) and the seed's class rows
// must never drift apart, or every new profile gets a foreign-key violation
// and zero unlocked classes. Names are stable, known concepts; only the ids
// are fragile, so the ids are derived from the modules under test rather
// than pasted here.
const STARTER_CLASS_NAMES = ['Gunslinger', 'Illusionist', 'Librarian', 'Thane', 'Thunderbird', 'Wanderer'];

test('the seed assigns each starter class exactly the id its starter-unlock constant grants, leaving other classes id-less', () => {
  expect(Object.keys(STARTER_CLASS_UNLOCKS).sort()).toEqual([...STARTER_CLASS_NAMES].sort());

  const rows = buildHardcodedClasses();
  const rowsByName = Object.fromEntries(rows.map(row => [row.name, row]));

  for (const name of STARTER_CLASS_NAMES) {
    expect(rowsByName[name]).toBeDefined();
    expect(rowsByName[name].id).toBe(STARTER_CLASS_UNLOCKS[name]);
  }

  // Same invariant, checked as a set comparison rather than restating the
  // ids a third time: the ids the starter-unlock logic grants must be
  // exactly the ids the seed assigned to those six named rows.
  const idsGrantedByStarterUnlock = Object.values(STARTER_CLASS_UNLOCKS).sort();
  const idsAssignedBySeed = STARTER_CLASS_NAMES.map(name => rowsByName[name] && rowsByName[name].id).sort();
  expect(idsAssignedBySeed).toEqual(idsGrantedByStarterUnlock);

  // Non-starter classes are unaffected — Postgres is free to generate their ids.
  const nonStarterRow = rows.find(row => row.name === 'Berserker');
  expect(nonStarterRow).toBeDefined();
  expect(nonStarterRow.id).toBeUndefined();
});

// The wizard's ability primer (step 3) and gear shop (step 4) are built from
// each class's gear/abilities arrays. If the seed builds rows without them,
// those columns default to '[]'::jsonb and a locally-seeded install gets
// empty steps. The expected names are derived from enclave-consts, never
// pasted, so a class gaining gear/abilities there without the seed picking
// it up fails this test.
test('every seeded class row carries its full gear and abilities, shaped as {name, description}', () => {
  const rows = buildHardcodedClasses();
  const rowsByName = Object.fromEntries(rows.map(row => [row.name, row]));

  // Representative class: exact shape and order, derived from the consts.
  const expectedGear = classGearList.Gunslinger.map(name => ({ name, description: '' }));
  const expectedAbilities = classAbilityList.Gunslinger.map(name => ({ name, description: '' }));
  expect(rowsByName.Gunslinger.gear).toEqual(expectedGear);
  expect(rowsByName.Gunslinger.abilities).toEqual(expectedAbilities);

  // Coverage: every class the seed builds has non-empty gear and abilities,
  // matching the consts exactly.
  for (const row of rows) {
    const gearNames = classGearList[row.name];
    const abilityNames = classAbilityList[row.name];
    expect(gearNames && gearNames.length > 0).toBe(true);
    expect(abilityNames && abilityNames.length > 0).toBe(true);
    expect(row.gear).toEqual(gearNames.map(name => ({ name, description: '' })));
    expect(row.abilities).toEqual(abilityNames.map(name => ({ name, description: '' })));
  }
});
