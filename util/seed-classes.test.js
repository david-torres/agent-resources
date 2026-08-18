const { test, expect } = require('bun:test');
const { buildHardcodedClasses } = require('./seed-classes');
const { CORE_CLASS_UNLOCKS } = require('./starter-content');
const { classGearList, classAbilityList } = require('./enclave-consts');

// The starter-unlock grant (models/profile.js) and the seed's class rows
// must never drift apart, or every new profile gets a foreign-key violation
// and zero unlocked classes. Names are stable, known concepts; only the ids
// are fragile, so the ids are derived from the modules under test rather
// than pasted here.
const STARTER_CLASS_NAMES = ['Gunslinger', 'Illusionist', 'Librarian', 'Thane', 'Thunderbird', 'Wanderer'];

test('the seed assigns each starter class exactly the id its starter-unlock constant grants, leaving other classes id-less', () => {
  expect(Object.keys(CORE_CLASS_UNLOCKS.advent).sort()).toEqual([...STARTER_CLASS_NAMES].sort());

  const rows = buildHardcodedClasses();
  const rowsByName = Object.fromEntries(rows.map(row => [row.name, row]));

  for (const name of STARTER_CLASS_NAMES) {
    expect(rowsByName[name]).toBeDefined();
    expect(rowsByName[name].id).toBe(CORE_CLASS_UNLOCKS.advent[name]);
  }

  // Same invariant, checked as a set comparison rather than restating the
  // ids a third time: the ids the starter-unlock logic grants must be
  // exactly the ids the seed assigned to those six named rows.
  const idsGrantedByStarterUnlock = Object.values(CORE_CLASS_UNLOCKS.advent).sort();
  const idsAssignedBySeed = STARTER_CLASS_NAMES.map(name => rowsByName[name] && rowsByName[name].id).sort();
  expect(idsAssignedBySeed).toEqual(idsGrantedByStarterUnlock);

  // Classes in neither core roster are unaffected — Postgres is free to
  // generate their ids.
  const nonRosterRow = rows.find(row => row.name === 'Beastmaster');
  expect(nonRosterRow).toBeDefined();
  expect(nonRosterRow.id).toBeUndefined();
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

const byName = () => {
  const map = new Map();
  for (const row of buildHardcodedClasses()) map.set(row.name, row);
  return map;
};

// A book grants CORE_CLASS_UNLOCKS[ruleset] by id. If the seeded row carries a
// different id — or the wrong ruleset — the grant resolves to nothing.
test('seeded advent core classes use the advent roster ids and ruleset', () => {
  const rows = byName();
  for (const [name, id] of Object.entries(CORE_CLASS_UNLOCKS.advent)) {
    expect(rows.get(name)).toBeDefined();
    expect(rows.get(name).id).toBe(id);
    expect(rows.get(name).rules_edition).toBe('advent');
  }
});

test('seeded aspirant core classes use the aspirant roster ids and ruleset', () => {
  const rows = byName();
  for (const [name, id] of Object.entries(CORE_CLASS_UNLOCKS.aspirant)) {
    expect(rows.get(name)).toBeDefined();
    expect(rows.get(name).id).toBe(id);
    expect(rows.get(name).rules_edition).toBe('aspirant');
  }
});

test('player-created seed classes stay advent and carry no fixed id', () => {
  const pcc = buildHardcodedClasses().filter(row => row.is_player_created);
  expect(pcc.length).toBeGreaterThan(0);
  for (const row of pcc) {
    expect(row.rules_edition).toBe('advent');
    expect(row.id).toBeUndefined();
  }
});
