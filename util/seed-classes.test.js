const { test, expect } = require('bun:test');
const { buildHardcodedClasses } = require('./seed-classes');
const { STARTER_CLASS_UNLOCKS } = require('./starter-content');

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
