// util/character-content-integrity.integration.test.js
//
// Characters store their class abilities and gear as plain name strings in
// `class_abilities` and `class_gear`. Nothing in the schema ties those strings
// to the class item they came from: on every save the name is looked up in a
// GLOBAL, name-only, exact-string map (models/class.js
// buildClassContentLookupMaps), and a name that misses the map aborts the whole
// save with one of --
//
//     [setCharacterGear] Missing class_id for gear item "<name>"
//     [setCharacterAbilities] Missing class_id for ability "<name>"
//
// (services/character/service.js, saveCharacterAtomic / reconcileGear /
// reconcileAbilities). Both are quoted verbatim so a reader can grep for
// whichever half they hit. The character is still readable, but its owner can
// no longer save it, and nothing tells them why.
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
//
// THIS BASELINE DESCRIBES ONE DATABASE. It was derived from the restored
// production copy this suite runs against. Against a database that does not
// hold those two characters the test fails with an empty `found` -- and that
// failure means "re-derive the baseline for this database", NOT "the guard is
// broken". Do not answer it by deleting the assertion or by asserting
// emptiness; replace the entries with the set that database actually has, by
// the same method (run the test and read what `found` reports). Expect exactly
// this when the production load lands: a fresh baseline there is the normal
// outcome, not a regression.
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
// third of the data. The exact count is read back separately and asserted
// against what was actually fetched, so a future regression in this loop fails
// here rather than silently narrowing the guard.
//
// `narrow` shapes both the count and the pages, so the two always describe the
// same set of rows.
const identity = (query) => query;

const fetchAllRows = async (table, columns, narrow = identity) => {
  const { count, error: countError } = await narrow(
    supabaseAdmin.from(table).select('id', { count: 'exact', head: true }));
  expect(countError).toBeNull();
  expect(typeof count).toBe('number');

  // The count is known before the first page is read, so the number of pages is
  // known too: a full page plus the short or empty one that ends the walk. A
  // loop that ran past it would be one that stopped advancing, and spinning is
  // the worst way to fail -- a hung CI job is indistinguishable from an
  // infrastructure problem, while a failed one names its own cause.
  const maxPages = Math.floor(count / PAGE) + 1;
  const rows = [];
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) {
      throw new Error(
        `${table}: read ${rows.length} of ${count} row(s) in ${maxPages} page(s) of ${PAGE} and the range walk is still not finished`);
    }
    const { data, error } = await narrow(
      supabaseAdmin.from(table).select(columns)
        .order('id', { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1));
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  expect(rows.length).toBe(count);
  return rows;
};

// Paging bounds the response; this bounds the request. `in.(...)` puts every id
// in the query string, and the gateway rejects an over-long request line with a
// 414 before PostgREST ever sees it -- which would lose the character names
// outright at the moment they are most wanted, the same failure the paging
// above exists to prevent.
//
// Both numbers are measured against this stack rather than assumed. The limit
// is nginx's default 8k request-line buffer: 219 ids answered 200 and 220
// answered 414, putting the cliff at 8192 bytes of `GET <path?query> HTTP/1.1`.
// The cost is 39 bytes per id, not 37, because supabase-js percent-encodes the
// separator -- 36 for the uuid plus `%2C` (probed by spying on the client's own
// fetch: one id built a 118-byte path+query, two built 157).
//
// Spending at most half the budget on ids leaves the other half for the rest of
// the line, which is 92 bytes today. That is the headroom for a filter or a
// longer table name someone adds later without re-measuring any of this.
const REQUEST_LINE_LIMIT = 8192;
const ID_QUERY_BYTES = 39;
const ID_CHUNK = Math.floor(REQUEST_LINE_LIMIT / 2 / ID_QUERY_BYTES);

const chunked = (items, size) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, index * size + size));

const characterNamesById = async (ids) => {
  const names = new Map();
  for (const batch of chunked(ids, ID_CHUNK)) {
    const rows = await fetchAllRows('characters', 'id, name', query => query.in('id', batch));
    for (const row of rows) names.set(row.id, row.name);
  }
  return names;
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
    const rows = await fetchAllRows(table, 'name, character_id');
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
