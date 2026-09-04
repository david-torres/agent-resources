// util/character-content-integrity.integration.test.js
//
// Characters store their class abilities and gear as plain name strings in
// `class_abilities` and `class_gear`. Nothing in the schema ties those strings
// to the class item they came from: on every save the name is looked up in a
// GLOBAL, name-only, exact-string map (models/class.js
// buildClassContentLookupMaps), and a name that misses the map aborts the whole
// save --
//
//     [setCharacterGear] Missing class_id for gear item "<name>"
//
// (services/character/service.js, saveCharacterAtomic / reconcileGear /
// reconcileAbilities). The character is still readable, but its owner can no
// longer save it, and nothing tells them why.
//
// So renaming or removing a class's item silently strands every character
// holding the old name. Nothing in the suite pinned that, which is how it went
// unnoticed. This test is that pin.
//
// Requires local Supabase to be running (http://127.0.0.1:54321).
const { test, expect } = require('bun:test');
const { supabaseAdmin } = require('../models/_base');
const { buildClassContentLookupMaps } = require('../models/class');

// KNOWN PRE-EXISTING DEFECT -- NOT APPROVAL.
//
// Fortean's gear was renamed at some point without remapping the character rows
// that referenced it, so four rows across two characters are unresolvable today.
// It predates this branch, is out of its scope, and has its own follow-up. The
// assertion below is EQUALITY with this baseline rather than emptiness: an
// empty-set assertion would fail on day one over a defect this suite cannot fix
// and would be deleted by the first person it inconvenienced, while equality
// still catches the thing the guard exists for -- a change that strands a
// character it had not stranded before. Shrinking this list when the defect is
// repaired is the expected way for it to change.
//
// `Agent’s Fieldcoat` carries U+2019, a curly apostrophe, not ASCII '.
// It is escaped so that neither an editor nor a copy-paste can quietly
// substitute the ASCII form and make this pass against the wrong string.
const KNOWN_UNRESOLVABLE = [
  { table: 'class_gear', name: 'Agent\u2019s Fieldcoat', rows: 2, characters: ['Agent Jack Hawthorne', 'Thaddeus'] },
  { table: 'class_gear', name: 'Neuralyzer', rows: 2, characters: ['Agent Jack Hawthorne', 'Thaddeus'] }
];

const PAGE = 1000;

// Code-unit ordering, not localeCompare: a curly apostrophe sorts differently
// under different locales, and a comparison this test's verdict rests on must
// not depend on the machine running it.
const sortKey = (entry) => `${entry.table}:${entry.name}`;
const byTableThenName = (a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0);

// PostgREST caps a select at 1000 rows by default and says nothing when it
// truncates. `class_gear` is past that cap, so an unpaginated read would check
// the first page, find no new orphan in it, and pass while never looking at a
// third of the data. exactCount is read back separately and asserted against
// what was actually fetched, so a future regression in this loop fails here
// rather than silently narrowing the guard.
const fetchAllRows = async (table) => {
  const { count, error: countError } = await supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true });
  expect(countError).toBeNull();
  expect(typeof count).toBe('number');

  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('name, character_id')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  expect(rows.length).toBe(count);
  return rows;
};

const characterNamesById = async (ids) => {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('characters')
    .select('id, name')
    .in('id', ids);
  expect(error).toBeNull();
  expect(Array.isArray(data)).toBe(true);
  return new Map(data.map(row => [row.id, row.name]));
};

// The real resolver, not a reimplementation of it. A hand-built "known names"
// set that diverged on is_public filtering, on trimming, or on which client it
// used would prove nothing about whether a character can actually be saved --
// which is the only question this test is asking.
const unresolvableRows = async () => {
  const { gearNameToClassId, abilityNameToClassId } = await buildClassContentLookupMaps();
  expect(gearNameToClassId.size).toBeGreaterThan(0);
  expect(abilityNameToClassId.size).toBeGreaterThan(0);

  const tables = [
    { table: 'class_gear', known: gearNameToClassId },
    { table: 'class_abilities', known: abilityNameToClassId }
  ];

  const found = [];
  for (const { table, known } of tables) {
    const rows = await fetchAllRows(table);
    console.log(`${table}: ${rows.length} rows checked against ${known.size} catalogue names`);
    const orphans = rows.filter(row => !known.has(String(row.name).trim()));
    const names = await characterNamesById([...new Set(orphans.map(row => row.character_id))]);
    for (const name of [...new Set(orphans.map(row => row.name))].sort()) {
      const matching = orphans.filter(row => row.name === name);
      found.push({
        table,
        name,
        rows: matching.length,
        // Named, not counted: a failure has to tell whoever reads CI which
        // characters are stranded, not just that a number moved.
        characters: [...new Set(matching.map(row => names.get(row.character_id) ?? row.character_id))].sort()
      });
    }
  }
  return found.sort(byTableThenName);
};

test('no character holds a class item name outside the save-time lookup map', async () => {
  const found = await unresolvableRows();

  expect(found).toEqual([...KNOWN_UNRESOLVABLE].sort(byTableThenName));
});
