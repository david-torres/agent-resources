// util/core-roster.integration.test.js
//
// The whole book-unlock design rests on an invariant nothing enforces at
// runtime: for each id in CORE_CLASS_UNLOCKS[r], a `classes` row with that id
// must exist and carry rules_edition = r. util/seed-classes.test.js only
// checks the pure builder's output; util/book-classes.test.js only checks set
// arithmetic over the constant. Neither ever looks at the database, so both
// stay green while the constant points at nothing.
//
// Two silent failure modes this closes:
//
//   1. A wrong id grants a phantom. isClassUnlocked returns true for an id
//      that hydrates to no row, so getUnlockedClasses drops it and the class
//      simply never appears — access granted to something that doesn't exist,
//      with no error anywhere.
//   2. A right id on a row whose rules_edition was never corrected makes an
//      Aspirant-roster class an Advent-family member. Family expansion
//      (util/class-family.js) is same-edition, so an Advent v2 fork of that
//      class becomes reachable from the Aspirant book — the one
//      cross-boundary leak the design otherwise closes.
//
// The Aspirant ids were freshly minted at implementation time and a human is
// expected to reconcile them against production by hand before deploy (see
// the Deployment section of the design). This test is that reconciliation's
// gate for every environment it runs against.
//
// Requires local Supabase to be running (http://127.0.0.1:54321).
require('./require-local-supabase');

const { describe, test, expect } = require('bun:test');
const { supabaseAdmin } = require('../models/_base');
const { CORE_CLASS_UNLOCKS } = require('./starter-content');

const rosterRows = async (roster) => {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .select('id, name, rules_edition')
    .in('id', Object.values(roster));

  expect(error).toBeNull();
  return new Map((data || []).map(row => [row.id, row]));
};

for (const [ruleset, roster] of Object.entries(CORE_CLASS_UNLOCKS)) {
  describe(`${ruleset} core roster`, () => {
    test('every roster id resolves to a real class row', async () => {
      const byId = await rosterRows(roster);

      const missing = Object.entries(roster)
        .filter(([, id]) => !byId.has(id))
        .map(([name, id]) => `${name} -> ${id}`);

      expect(missing).toEqual([]);
    });

    test(`every roster row carries rules_edition '${ruleset}'`, async () => {
      const byId = await rosterRows(roster);

      const mismatched = Object.entries(roster)
        .filter(([, id]) => byId.has(id) && byId.get(id).rules_edition !== ruleset)
        .map(([name, id]) => `${name} -> ${id} is ${byId.get(id).rules_edition}`);

      expect(mismatched).toEqual([]);
    });

    // An id that exists with the right ruleset can still be the WRONG class —
    // point Berserker's entry at Freerunner's id and both tests above stay
    // green while the roster silently grants a class nobody chose. The
    // constant is a name -> id map, so the name is part of the contract.
    test('every roster id resolves to the class the roster names', async () => {
      const byId = await rosterRows(roster);

      const misnamed = Object.entries(roster)
        .filter(([name, id]) => byId.has(id) && byId.get(id).name !== name)
        .map(([name, id]) => `${name} -> ${id} is named ${byId.get(id).name}`);

      expect(misnamed).toEqual([]);
    });
  });
}
