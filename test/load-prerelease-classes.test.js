// Pure-function cover for scripts/load-prerelease-classes.mjs. The loader's
// resolution step decides whether a class is updated in place or inserted
// again, so it is exercised here against both spellings of every renamed class
// -- the state before a load and the state after one.
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  buildPayload, diffFields, displayName, fieldsFor, fold, isLocalTarget, planLoad, reportPlan,
  resolveTarget, sectionEnum, trimEnds, unremapped, unresolvableTargets
} from '../scripts/load-prerelease-classes.mjs';
import { bookFor } from '../scripts/lib/books.mjs';
import {
  catalogueNames, groupUnresolvable, projectImport
} from '../scripts/lib/character-impact.mjs';
import { ASPIRANT_V1_CLASS_IDS } from '../util/starter-content.js';

const book = bookFor('prerelease');
const records = JSON.parse(readFileSync(book.artifact, 'utf8'));
const remap = JSON.parse(readFileSync(book.remap, 'utf8'));

// The second book forks the classes it shares with the catalogue instead of
// overwriting them, so every disposition below is exercised against a real
// record of each book rather than a hand-built one.
const forkBook = bookFor('aspirant-v1');
const forkRecords = JSON.parse(readFileSync(forkBook.artifact, 'utf8'));
const forkRecordFor = (name) => forkRecords.find((record) => displayName(record.name) === name);
const berserkerRecord = forkRecordFor('Berserker');
const gunslingerRecord = forkRecordFor('Gunslinger');
const prereleaseRecord = records[0];

const ITEM_KEY = { ability: 'abilities', gear: 'gear' };
const artifactNames = (kind) =>
    records.flatMap((record) => (record[ITEM_KEY[kind]] ?? []).map((item) => item.name.trim()));
const codepoints = (text) => [...text].map((character) => character.codePointAt(0));

const row = (name, over = {}) => ({ id: `id-${name}`, name, rules_edition: 'advent',
  content_format: 'advent', rules_version: 'v1', is_player_created: false, ...over });

// Columns the owner controls: no payload may flip a row's visibility, its
// status, its marketing copy, or the `rules_version` an owner set -- the insert
// that creates a row is the only thing that writes that one.
const FORBIDDEN = ['is_public', 'status', 'teaser', 'image_url', 'image_crop', 'rules_version'];

// A fork mints these four itself. An update or a create must leave every one of
// them to the row's own column defaults.
const FORK_ONLY = ['id', 'base_class_id', 'rules_edition', 'content_format'];

// The catalogue names as they stand before any load has run.
const namesBeforeLoad = ['Beastmaster', 'Berserker', 'Bogatyr', 'Brainiac', 'Drachentöter',
  'Freerunner', 'Greybeard', 'Infiltrator', 'Lithomancer', 'Oddball', 'Raubritter', 'Samaritan',
  'Shonen', 'Vessel', 'Witchhunter', 'Zoologist'];

const split = (rows) => {
  const plans = planLoad(records, rows.map((name) => row(name)), book);
  return {
    update: plans.filter((plan) => plan.disposition === 'update').length,
    create: plans.filter((plan) => plan.disposition === 'create').length,
    ambiguous: plans.filter((plan) => plan.matches.length > 1).length
  };
};

test('an aliased class resolves against the catalogue spelling', () => {
  const matches = resolveTarget({ name: 'Witchfinder' }, [row('Witchhunter')], book);
  expect(matches.map((m) => m.name)).toEqual(['Witchhunter']);
});

test('an aliased class still resolves once it carries the document spelling', () => {
  const matches = resolveTarget({ name: 'Witchfinder' }, [row('Witchfinder')], book);
  expect(matches.map((m) => m.name)).toEqual(['Witchfinder']);
});

test('resolution folds diacritics and trims stored whitespace', () => {
  expect(resolveTarget({ name: 'Shōnen' }, [row('Shonen')], book)).toHaveLength(1);
  expect(resolveTarget({ name: 'Zoologist' }, [row('Zoologist ')], book)).toHaveLength(1);
  expect(resolveTarget({ name: 'Drachentöter' }, [row('Drachentöter')], book)).toHaveLength(1);
});

test('a name matching several rows is reported rather than silently picked', () => {
  const plans = planLoad([records[0]], [row('Beastmaster'), row('beastmaster')], book);
  expect(plans[0].matches).toHaveLength(2);
  expect(plans[0].row).toBeNull();
});

// A name shared across content formats names two different classes: this
// document describes the Advent-shaped one, and the Aspirant-shaped row of the
// same name is not its to update.
test('a name shared with another content format resolves within this format', () => {
  const rows = [row('Beastmaster'),
    row('Beastmaster', { id: 'id-aspirant', content_format: 'aspirant', rules_edition: 'aspirant' })];
  const [plan] = planLoad([records[0]], rows, book);
  expect(plan.disposition).toBe('update');
  expect(plan.row.id).toBe('id-Beastmaster');
});

// The ambiguity report prints `plan.matches`, so the scoping has to reach it
// too: a row the disposition ignored must never be offered as a reason the name
// could not be resolved.
test("the matches a plan carries hold only rows of the book's own format", () => {
  const aspirant = (id) =>
      row('Beastmaster', { id, content_format: 'aspirant', rules_edition: 'aspirant' });
  const [plan] = planLoad([records[0]], [row('Beastmaster'), aspirant('a1'), aspirant('a2')], book);
  expect(plan.matches.map((match) => match.id)).toEqual(['id-Beastmaster']);
});

test("two rows of the book's own format are ambiguous as they always were", () => {
  const rows = [row('Beastmaster'), row('Beastmaster', { id: 'id-other' })];
  const [plan] = planLoad([records[0]], rows, book);
  expect(plan.matches).toHaveLength(2);
  expect(plan.row).toBeNull();
});

// Charlatan's case: the document carries a class the catalogue does not. A row
// of that name in another format is still not a row this book may write.
test('a name no row of this format carries is created', () => {
  const charlatan = records.find((record) => displayName(record.name) === 'Charlatan');
  expect(planLoad([charlatan], [], book)[0].disposition).toBe('create');
  const elsewhere = [row('Charlatan', { content_format: 'aspirant', rules_edition: 'aspirant' })];
  expect(planLoad([charlatan], elsewhere, book)[0].disposition).toBe('create');
});

test('the load resolves 16 updates and 4 creates against the pre-load catalogue', () => {
  expect(split(namesBeforeLoad)).toEqual({ update: 16, create: 4, ambiguous: 0 });
});

test('re-running after a load creates nothing', () => {
  const afterLoad = records.map((record) => displayName(record.name));
  expect(split(afterLoad)).toEqual({ update: 20, create: 0, ambiguous: 0 });
});

test('a class with an advent-format parent forks rather than updating it', () => {
  const rows = [row('Berserker', { rules_edition: 'aspirant' })];
  const [plan] = planLoad([berserkerRecord], rows, forkBook);
  expect(plan.disposition).toBe('fork');
  expect(plan.row).toBeNull();
  expect(plan.parent.id).toBe('id-Berserker');
});

test('the fork payload carries the parent pointer and both axes', () => {
  const [plan] = planLoad([berserkerRecord], [row('Berserker', { rules_edition: 'aspirant' })], forkBook);
  expect(plan.payload.base_class_id).toBe('id-Berserker');
  expect(plan.payload.rules_edition).toBe('aspirant');
  expect(plan.payload.content_format).toBe('aspirant');
  expect(plan.payload.id).toBe(ASPIRANT_V1_CLASS_IDS.Berserker);
});

test('v1 is the parent when a class has both a v1 and a v2 row', () => {
  const rows = [row('Gunslinger'), row('Gunslinger', { id: 'id-v2', rules_version: 'v2' })];
  const [plan] = planLoad([gunslingerRecord], rows, forkBook);
  expect(plan.disposition).toBe('fork');
  expect(plan.parent.id).toBe('id-Gunslinger');
});

test("a player's own class of the same name is not a fork parent", () => {
  const rows = [row('Gunslinger', { id: 'id-mine', is_player_created: true })];
  expect(() => planLoad([gunslingerRecord], rows, forkBook)).toThrow('Gunslinger');
});

test('re-running after a fork updates the fork and never creates a second one', () => {
  const rows = [row('Berserker', { rules_edition: 'aspirant' }),
    row('Berserker', { id: 'id-v1fork', rules_edition: 'aspirant', content_format: 'aspirant' })];
  const [plan] = planLoad([berserkerRecord], rows, forkBook);
  expect(plan.disposition).toBe('update');
  expect(plan.row.id).toBe('id-v1fork');
});

// Both axes decide it: a row in this book's content format but another
// rules_edition is not this book's fork, and reading it as one would overwrite a
// class this book never described.
test("a row matching one axis only is neither this book's fork nor a parent", () => {
  const rows = [row('Berserker', { content_format: 'aspirant', rules_edition: 'advent' })];
  expect(() => planLoad([berserkerRecord], rows, forkBook)).toThrow('Berserker');
});

// A parent and its own fork share a name for good, so the name alone can no
// longer decide the row. Two candidates on the side that decides the
// disposition is the ambiguity, and it is reported rather than picked from.
test('two forks or two parents of one name are ambiguous rather than silently picked', () => {
  const twoParents = [row('Berserker'), row('Berserker', { id: 'id-other' })];
  const [byParent] = planLoad([berserkerRecord], twoParents, forkBook);
  expect(byParent.matches).toHaveLength(2);
  expect(byParent.row).toBeNull();
  expect(byParent.parent).toBeNull();

  const fork = (id) => row('Berserker', { id, rules_edition: 'aspirant', content_format: 'aspirant' });
  const [byFork] = planLoad([berserkerRecord], [row('Berserker'), fork('f1'), fork('f2')], forkBook);
  expect(byFork.matches).toHaveLength(2);
  expect(byFork.row).toBeNull();
});

// An id Postgres mints instead would differ between local and production, which
// is the one thing minting them by hand exists to prevent -- and a payload with
// no `id` key is exactly what makes Postgres mint one.
test('a forked class with no minted id stops the run', () => {
  const unnamed = { ...berserkerRecord, name: 'Nobody' };
  expect(() => planLoad([unnamed], [row('Nobody')], forkBook)).toThrow('Nobody');
});

test('every V1 class has one minted id of its own', () => {
  expect(Object.keys(ASPIRANT_V1_CLASS_IDS).sort())
      .toEqual(forkRecords.map((record) => displayName(record.name)).sort());
  expect(new Set(Object.values(ASPIRANT_V1_CLASS_IDS)).size).toBe(forkRecords.length);
  for (const id of Object.values(ASPIRANT_V1_CLASS_IDS)) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
});

// These ids are referenced by a roster, by the loader and by production rows,
// so they are data, not an implementation detail -- an accidental edit to a
// single character has to fail this test, not just the shape checks above.
test('the twelve minted ids are pinned to their exact values', () => {
  expect(ASPIRANT_V1_CLASS_IDS).toEqual({
    Gunslinger: '3311fb69-4f9a-45f1-88d1-529bd8870a4c',
    Illusionist: '84543c7f-bb35-45e6-af5a-899b954bdc95',
    Librarian: '3667c568-616f-4910-a89a-e576e197c862',
    Thane: '0f8bbc56-90e7-4997-9356-a7aecaaecb21',
    Thunderbird: '4837502d-6595-44a9-8488-86e125a4bab3',
    Wanderer: '00e706bd-fe35-478c-b817-3ce65c7ff91a',
    Berserker: 'cd56fcba-10b5-41af-9bbd-3c882377ac9d',
    Freerunner: 'c8b18cea-b8c9-4433-aa93-545eb28dcf66',
    Infiltrator: 'a8b0d13d-280b-48b1-b410-37b34bfc1a81',
    Samaritan: 'fa42bce0-431c-4d00-a9f4-a21a1be0e519',
    Vessel: 'e293cb3a-98b0-492c-bf32-6311413574e4',
    Witchfinder: '81bccc24-a7f3-4217-8bf8-de65d1ae4633'
  });
});

test('the document title casing reproduces the catalogue names', () => {
  expect(displayName('BEASTMASTER')).toBe('Beastmaster');
  expect(displayName('SHŌNEN')).toBe('Shōnen');
  expect(displayName('DRACHENTÖTER')).toBe('Drachentöter');
});

test('fold ignores case and diacritics', () => {
  expect(fold('Shōnen')).toBe(fold('SHONEN'));
  expect(fold('Drachentöter')).toBe('drachentoter');
});

test('section headings map to the column enum and reject anything else', () => {
  expect(sectionEnum('PCCs')).toBe('pcc');
  expect(sectionEnum('EXCLUSIVES')).toBe('exclusive');
  expect(sectionEnum('ASPIRANT CLASSES')).toBe('aspirant');
  expect(sectionEnum(' PCCs ')).toBe('pcc');
  expect(() => sectionEnum('PCC')).toThrow(/unrecognised section heading/);
});

test('every record maps to one of the three enum values', () => {
  const counts = {};
  for (const record of records) {
    const value = sectionEnum(record.prerelease_section);
    counts[value] = (counts[value] || 0) + 1;
  }
  expect(counts).toEqual({ pcc: 11, exclusive: 3, aspirant: 6 });
});

test('trimming takes the ends only and leaves rich-text runs alone', () => {
  expect(trimEnds({ overview: '  text  ' })).toEqual({ overview: 'text' });
  expect(trimEnds({ quote: 'a  b' })).toEqual({ quote: 'a  b' });
  expect(trimEnds({ notes: [{ text: 'bold ', children: [{ text: 'word' }] }] }))
      .toEqual({ notes: [{ text: 'bold ', children: [{ text: 'word' }] }] });
});

test('the payload carries the allowlist and nothing else', () => {
  for (const record of records) {
    const payload = buildPayload(record, book);
    expect(Object.keys(payload).sort()).toEqual([...fieldsFor(book)].sort());
    for (const field of [...FORBIDDEN, ...FORK_ONLY]) expect(payload).not.toHaveProperty(field);
    expect(payload).not.toHaveProperty('page_range');
    expect(payload.free_play_access).toBe(true);
  }
});

const forkPlans = () =>
    planLoad(forkRecords, forkRecords.map((record) => row(displayName(record.name))), forkBook);

test('a fork payload carries the allowlist plus the four fields it mints', () => {
  for (const plan of forkPlans()) {
    expect(plan.disposition).toBe('fork');
    expect(Object.keys(plan.payload).sort())
        .toEqual([...fieldsFor(forkBook), ...FORK_ONLY].sort());
    for (const field of FORBIDDEN) expect(plan.payload).not.toHaveProperty(field);
    expect(plan.payload).not.toHaveProperty('page_range');
    expect(plan.payload.id).toBe(ASPIRANT_V1_CLASS_IDS[plan.payload.name]);
  }
});

// A fork payload carries four keys (id, base_class_id, rules_edition,
// content_format) the row's own field list does not, and if diffFields walked
// the row's keys instead of the payload's, every one of those four would be
// reported as "differing" against a row that simply lacks the key.
test('diffFields compares only the keys the payload itself carries', () => {
  const payload = { name: 'Berserker', rules_edition: 'aspirant' };
  const row = { name: 'Berserker', rules_edition: 'advent', overview: 'a row-only field' };
  expect(diffFields(payload, row).map((change) => change.field)).toEqual(['rules_edition']);
});

// `prerelease_section` is the pre-release document's own sectioning. The V1
// artifact carries no such key, and the derivation throws on a record without
// one rather than storing a null.
test('only the pre-release book writes prerelease_section', () => {
  expect(fieldsFor(book)).toContain('prerelease_section');
  expect(fieldsFor(forkBook)).not.toContain('prerelease_section');
});

// The Aspirant book grants its twelve classes through the unlock roster, so
// free-play access on top of that would make the roster meaningless.
test('only the pre-release book grants free play access', () => {
  expect(buildPayload(berserkerRecord, forkBook).free_play_access).toBe(false);
  expect(buildPayload(prereleaseRecord, bookFor('prerelease')).free_play_access).toBe(true);
});

// The field list and buildPayload are compared against each other above, so
// widening the list alone stays green while buildPayload silently omits the key
// for every record. Both columns are NOT NULL with a shaped default, so an
// omitted key stores that default in place of the book's own content.
test('every payload carries an advanced_abilities array', () => {
  for (const record of records) {
    expect(Array.isArray(buildPayload(record, book).advanced_abilities)).toBe(true);
  }
});

test('every payload carries expanded_tips, whether its book has any or not', () => {
  expect(buildPayload(prereleaseRecord, bookFor('prerelease')).expanded_tips)
      .toEqual({ player: [], conduit: [] });
  expect(buildPayload(berserkerRecord, forkBook).expanded_tips)
      .toEqual(berserkerRecord.expanded_tips);
});

test('tips are written as a markdown bullet list', () => {
  const payload = buildPayload(records[0], book);
  expect(payload.tips.split('\n').every((line) => line.startsWith('- '))).toBe(true);
  expect(payload.tips.split('\n')).toHaveLength(records[0].tips.length);
});

test('only a local stack counts as a safe --apply target', () => {
  expect(isLocalTarget('http://127.0.0.1:54321')).toBe(true);
  expect(isLocalTarget('http://localhost:54321/')).toBe(true);
  expect(isLocalTarget('https://abcdefg.supabase.co')).toBe(false);
  expect(isLocalTarget('http://127.0.0.1.example.com')).toBe(false);
  expect(isLocalTarget('')).toBe(false);
});

test('ability pronunciation survives into the payload', () => {
  const pronunciations = records
      .flatMap((record) => buildPayload(record, book).abilities)
      .filter((ability) => ability.pronunciation);
  expect(pronunciations).toHaveLength(2);
});

test('every remap entry names a class row, one of the two kinds and two distinct names', () => {
  expect(remap).toHaveLength(15);
  for (const entry of remap) {
    expect(Object.keys(entry).sort()).toEqual(['class_id', 'from', 'kind', 'to']);
    expect(['ability', 'gear']).toContain(entry.kind);
    expect(entry.class_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.from).not.toBe(entry.to);
  }
});

test('each remap target is a name this document introduces and each source is not', () => {
  for (const entry of remap) {
    const names = artifactNames(entry.kind);
    expect(names.filter((name) => name === entry.to)).toHaveLength(1);
    expect(names).not.toContain(entry.from);
  }
});

// These two differ from their targets by one codepoint, so a straight quote
// surviving into `to` -- or a curly one into `from` -- would silently rename
// nothing and leave every character holding the name unsaveable.
test('the apostrophe remaps carry the exact quote characters', () => {
  const entry = (from) => remap.find((candidate) => candidate.from === from);
  expect(codepoints(entry("Sic 'Em!").from)).toContain(0x0027);
  expect(codepoints(entry("Sic 'Em!").to)).toContain(0x2018);
  expect(codepoints(entry("Tag, You're It").from)).toContain(0x0027);
  expect(codepoints(entry("Tag, You're It").to)).toContain(0x2019);
  for (const { from, to } of remap.filter((candidate) => /['\u2018\u2019]/.test(candidate.to))) {
    expect(fold(from.replace(/['\u2018\u2019]/g, ''))).toBe(fold(to.replace(/['\u2018\u2019]/g, '')));
  }
});

const group = (overrides) => ({
  kind: 'gear', classId: 'class-1', name: 'Toolbox', survivesNow: true, rows: ['row-1'],
  characters: new Set(['character-1']), ...overrides
});

test('a vanishing name with no remap entry is reported', () => {
  expect(unremapped([group()], []).map((entry) => entry.name)).toEqual(['Toolbox']);
});

test('a vanishing name the remap accounts for is not reported', () => {
  const covered = [{ class_id: 'class-1', kind: 'gear', from: 'Toolbox', to: 'Bindle' }];
  expect(unremapped([group()], covered)).toEqual([]);
  expect(unremapped([group({ classId: 'other' })], covered)).toHaveLength(1);
  expect(unremapped([group({ kind: 'abilities' })], covered)).toHaveLength(1);
});

// A name already unresolvable before the import is not this import's to answer
// for, and demanding a remap entry for one would block the load forever.
test('a name that does not resolve today needs no remap entry', () => {
  expect(unremapped([group({ survivesNow: false })], [])).toEqual([]);
});

const publicClass = (id, gear) =>
    ({ id, is_public: true, is_player_created: false, rules_edition: 'advent', gear });

test('only a public class contributes names to the catalogue', () => {
  const names = catalogueNames([
    publicClass('a', [{ name: ' Toolbox ' }]),
    { ...publicClass('b', [{ name: 'Bindle' }]), is_public: false }
  ]);
  expect([...names.gear]).toEqual(['Toolbox']);
});

test('a held name is grouped only when the import leaves it unresolvable', () => {
  const before = { abilities: new Set(), gear: new Set(['Toolbox']) };
  const after = { abilities: new Set(), gear: new Set(['Bindle']) };
  const held = [
    { kind: 'gear', id: 'row-1', name: 'Toolbox', classId: 'class-1', characterId: 'character-1' },
    { kind: 'gear', id: 'row-2', name: 'Toolbox', classId: 'class-1', characterId: 'character-2' },
    { kind: 'gear', id: 'row-3', name: 'Bindle', classId: 'class-1', characterId: 'character-3' },
    { kind: 'gear', id: 'row-4', name: 'Neuralyzer', classId: 'class-2', characterId: 'character-4' }
  ];
  const groups = groupUnresolvable(held, before, after);
  expect(groups.map((entry) => [entry.name, entry.survivesNow, entry.rows.length, entry.characters.size]))
      .toEqual([['Toolbox', true, 2, 2], ['Neuralyzer', false, 1, 1]]);
});

// `main` reads a book with no remap file as an empty remap and runs the orphan
// scan anyway. An empty remap covers nothing, so a vanishing name is still
// reported: a scan that is skipped could not tell anyone the projection is
// wrong, while a scan that runs and reports nothing can.
test('a book with no remap file leaves the orphan scan able to report', () => {
  expect(forkBook.remap).toBeNull();
  expect(unremapped([group()], []).map((entry) => entry.name)).toEqual(['Toolbox']);
});

test('a fork leaves its parent untouched in the post-import projection', () => {
  const parent = row('Berserker', { rules_edition: 'aspirant', gear: [{ name: 'Old Axe' }] });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const after = projectImport([parent], [plan], forkBook);
  expect(after.find((c) => c.id === 'id-Berserker').gear).toEqual([{ name: 'Old Axe' }]);
  expect(after).toHaveLength(2);
});

test("the parent's item names survive the fork, so nothing is orphaned", () => {
  const parent = row('Berserker', { is_public: true, rules_edition: 'aspirant',
    gear: [{ name: 'Old Axe' }], abilities: [] });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const names = catalogueNames(projectImport([parent], [plan], forkBook));
  expect(names.gear.has('Old Axe')).toBe(true);
});

test('the projected fork stands under the id the load will give it', () => {
  const parent = row('Berserker', { rules_edition: 'aspirant' });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  expect(projectImport([parent], [plan], forkBook).map((cls) => cls.id))
      .toEqual(['id-Berserker', ASPIRANT_V1_CLASS_IDS.Berserker]);
});

// Both rows are named Berserker and the book publishes that name, but only the
// fork is this load's to publish: a projection that published by name would make
// a private parent public and count its item names as catalogued.
test('the projection publishes the fork and not the parent it descends from', () => {
  const parent = row('Berserker', { rules_edition: 'aspirant', is_public: false });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const projected = projectImport([parent], [plan], forkBook);
  const publicity = (id) => projected.find((cls) => cls.id === id).is_public;
  expect(publicity('id-Berserker')).toBe(false);
  expect(publicity(ASPIRANT_V1_CLASS_IDS.Berserker)).toBe(true);
});

// The owner authorised exactly these classes to be made visible. Widening the set
// publishes a class nobody approved, so the list is pinned rather than trusted.
test('the load publishes the classes the owner authorised and no others', () => {
  expect(book.publishedByLoad).toEqual(['Ardent', 'Offdriver', 'Squire', 'Drachentöter', 'Charlatan']);
});

const createdPlan = (name, gear) => ({ row: null, matches: [], payload: { name, gear } });

test('a class the load publishes contributes its names to the post-import catalogue', () => {
  const projected = projectImport([], [
    createdPlan('Ardent', [{ name: 'Reliquary' }]),
    createdPlan('Unapproved', [{ name: 'Contraband' }])
  ], book);
  const names = catalogueNames(projected);
  expect([...names.gear]).toEqual(['Reliquary']);
});

test('an existing private class the load publishes contributes its names too', () => {
  const row = {
    id: 'class-1', name: 'Drachentöter', is_public: false, is_player_created: false,
    rules_edition: 'advent', gear: [{ name: 'Flask of Mead' }]
  };
  const plans = [{ row, matches: [row], payload: { name: 'Drachentöter', gear: [{ name: 'Ichor' }] } }];
  expect([...catalogueNames(projectImport([row], plans, book)).gear]).toEqual(['Ichor']);
});

// A `to` the import does not add renames live rows to a name that resolves to
// nothing -- the breakage the remap exists to prevent, caused by the fix.
test('a remap target the post-import catalogue does not carry is reported', () => {
  const after = { abilities: new Set(['Froth at the Mouth']), gear: new Set(['Bindle']) };
  const entry = (kind, to) => ({ class_id: 'class-1', kind, from: 'Toolbox', to });
  expect(unresolvableTargets([entry('gear', 'Bindle')], after)).toEqual([]);
  expect(unresolvableTargets([entry('gear', 'Bindl')], after)).toHaveLength(1);
  expect(unresolvableTargets([entry('ability', 'Bindle')], after)).toHaveLength(1);
});

test('every committed remap target survives the import into its own kind', () => {
  const after = {
    abilities: new Set(artifactNames('ability')),
    gear: new Set(artifactNames('gear'))
  };
  expect(unresolvableTargets(remap, after)).toEqual([]);
});

// The FORK heading is how a human running the dry run confirms the twelve
// parents before the next task writes anything -- it names both the class and
// the parent id it is about to descend from.
test('reportPlan prints the FORK heading with the class name and parent id', () => {
  const plan = {
    payload: { name: 'Berserker' }, row: null, parent: { id: 'parent-id-1' },
    disposition: 'fork', changes: []
  };
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    reportPlan([plan]);
  } finally {
    console.log = originalLog;
  }
  expect(lines).toContain('\nFORK Berserker from parent-id-1');
});
