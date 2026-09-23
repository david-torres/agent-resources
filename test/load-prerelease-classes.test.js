// Pure-function cover for scripts/load-prerelease-classes.mjs. The loader's
// resolution step decides whether a class is updated in place or inserted
// again, so it is exercised here against both spellings of every renamed class
// -- the state before a load and the state after one.
import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import {
  buildPayload, diffFields, displayName, fieldsFor, fold, forkParentId, insertRow, isLocalTarget,
  planLoad, publishPatch, reportPlan, resolveTarget, sectionEnum, trimEnds, unremapped,
  unresolvableTargets
} from '../scripts/load-prerelease-classes.mjs';
import { bookFor } from '../scripts/lib/books.mjs';
import {
  catalogueNames, groupUnresolvable, projectImport
} from '../scripts/lib/character-impact.mjs';
import { ASPIRANT_V1_CLASS_IDS } from '../util/starter-content.js';

const book = bookFor('prerelease');
// The extracted book content is gitignored (private-data/, or CLASS_DATA_DIR)
// and absent on CI and a fresh clone, so the read is guarded and the tests
// that need real artifact data are skipped rather than failed when it's gone.
const records = existsSync(book.artifact) ? JSON.parse(readFileSync(book.artifact, 'utf8')) : null;
const remap = JSON.parse(readFileSync(book.remap, 'utf8'));

// The second book forks the classes it shares with the catalogue instead of
// overwriting them, so every disposition below is exercised against a real
// record of each book rather than a hand-built one.
const forkBook = bookFor('aspirant-v1');
const forkRecords = existsSync(forkBook.artifact) ? JSON.parse(readFileSync(forkBook.artifact, 'utf8')) : null;
const forkRecordFor = (name) => forkRecords?.find((record) => displayName(record.name) === name);
const berserkerRecord = forkRecordFor('Berserker');
const gunslingerRecord = forkRecordFor('Gunslinger');
const prereleaseRecord = records?.[0];

const ITEM_KEY = { ability: 'abilities', gear: 'gear' };
const artifactNames = (kind) =>
    records.flatMap((record) => (record[ITEM_KEY[kind]] ?? []).map((item) => item.name.trim()));
const codepoints = (text) => [...text].map((character) => character.codePointAt(0));

const row = (name, over = {}) => ({ id: `id-${name}`, name, rules_edition: 'advent',
  content_format: 'advent', rules_version: 'v1', is_player_created: false, ...over });

// The rows the twelve V1 classes fork from, pinned to their values: the six
// Advent originals and the six pre-release aspirant-section rows.
const PARENT_IDS = {
  Gunslinger: 'b6ce893b-8207-4f89-abfc-a02ae0e9b65d',
  Illusionist: '018fcdba-39cf-4cc8-8f4d-92e2023719cf',
  Librarian: 'f0de4397-5e71-4ed6-a16a-26dc72c46801',
  Thane: 'aa0f9690-37a6-4784-9119-1b2117f798a7',
  Thunderbird: 'a605940b-f27f-45d8-af76-abda848b3e12',
  Wanderer: 'ebd55f52-9768-400a-94d6-392cd07e2b24',
  Berserker: '3c8f036f-06f0-4f72-9336-aa9c3fdd5541',
  Freerunner: '42d39b55-7db1-49a1-a53b-b1cd5fc9bc47',
  Infiltrator: 'c687840c-a781-4d46-9570-b344e1b9be04',
  Samaritan: 'f0726c9b-bfaf-4c22-9318-75c50c8e3cbf',
  Vessel: '3a863d9c-8454-4326-87ad-ed105fccbbd4',
  Witchfinder: '79721ac8-378e-4b3e-b1e3-8266689da89e'
};
const ADVENT_NAMES = ['Gunslinger', 'Illusionist', 'Librarian', 'Thane', 'Thunderbird', 'Wanderer'];
const parentRow = (name, over = {}) => row(name, { id: PARENT_IDS[name], ...over });

// Columns the owner controls: no payload may flip a row's visibility, its
// status, whether it is player-created, its marketing copy, or the
// `rules_version` an owner set -- the insert that creates a row is the only
// thing that writes those.
const FORBIDDEN = ['is_public', 'status', 'is_player_created', 'teaser', 'image_url', 'image_crop',
  'rules_version'];

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

test.skipIf(!records)('a name matching several rows is reported rather than silently picked', () => {
  const plans = planLoad([records[0]], [row('Beastmaster'), row('beastmaster')], book);
  expect(plans[0].matches).toHaveLength(2);
  expect(plans[0].row).toBeNull();
});

// A name shared across content formats names two different classes: this
// document describes the Advent-shaped one, and the Aspirant-shaped row of the
// same name is not its to update.
test.skipIf(!records)('a name shared with another content format resolves within this format', () => {
  const rows = [row('Beastmaster'),
    row('Beastmaster', { id: 'id-aspirant', content_format: 'aspirant', rules_edition: 'aspirant' })];
  const [plan] = planLoad([records[0]], rows, book);
  expect(plan.disposition).toBe('update');
  expect(plan.row.id).toBe('id-Beastmaster');
});

// The ambiguity report prints `plan.matches`, so the scoping has to reach it
// too: a row the disposition ignored must never be offered as a reason the name
// could not be resolved.
test.skipIf(!records)("the matches a plan carries hold only rows of the book's own format", () => {
  const aspirant = (id) =>
      row('Beastmaster', { id, content_format: 'aspirant', rules_edition: 'aspirant' });
  const [plan] = planLoad([records[0]], [row('Beastmaster'), aspirant('a1'), aspirant('a2')], book);
  expect(plan.matches.map((match) => match.id)).toEqual(['id-Beastmaster']);
});

test.skipIf(!records)("two rows of the book's own format are ambiguous as they always were", () => {
  const rows = [row('Beastmaster'), row('Beastmaster', { id: 'id-other' })];
  const [plan] = planLoad([records[0]], rows, book);
  expect(plan.matches).toHaveLength(2);
  expect(plan.row).toBeNull();
});

// Charlatan's case: the document carries a class the catalogue does not. A row
// of that name in another format is still not a row this book may write.
test.skipIf(!records)('a name no row of this format carries is created', () => {
  const charlatan = records.find((record) => displayName(record.name) === 'Charlatan');
  expect(planLoad([charlatan], [], book)[0].disposition).toBe('create');
  const elsewhere = [row('Charlatan', { content_format: 'aspirant', rules_edition: 'aspirant' })];
  expect(planLoad([charlatan], elsewhere, book)[0].disposition).toBe('create');
});

test.skipIf(!records)('the load resolves 16 updates and 4 creates against the pre-load catalogue', () => {
  expect(split(namesBeforeLoad)).toEqual({ update: 16, create: 4, ambiguous: 0 });
});

test.skipIf(!records)('re-running after a load creates nothing', () => {
  const afterLoad = records.map((record) => displayName(record.name));
  expect(split(afterLoad)).toEqual({ update: 20, create: 0, ambiguous: 0 });
});

test.skipIf(!forkRecords)('each V1 class forks off the roster id already in the catalogue, not its own', () => {
  for (const record of forkRecords) {
    const name = displayName(record.name);
    expect(forkParentId(name)).toBe(PARENT_IDS[name]);
  }
  expect(forkParentId('Nobody')).toBeNull();
});

test.skipIf(!forkRecords)('a class with an advent-format parent forks rather than updating it', () => {
  const rows = [parentRow('Berserker', { rules_edition: 'aspirant' })];
  const [plan] = planLoad([berserkerRecord], rows, forkBook);
  expect(plan.disposition).toBe('fork');
  expect(plan.row).toBeNull();
  expect(plan.parent.id).toBe(PARENT_IDS.Berserker);
});

test.skipIf(!forkRecords)('the fork payload carries the parent pointer and both axes', () => {
  const [plan] = planLoad([berserkerRecord], [parentRow('Berserker', { rules_edition: 'aspirant' })],
      forkBook);
  expect(plan.payload.base_class_id).toBe(PARENT_IDS.Berserker);
  expect(plan.payload.rules_edition).toBe('aspirant');
  expect(plan.payload.content_format).toBe('aspirant');
  expect(plan.payload.id).toBe(ASPIRANT_V1_CLASS_IDS.Berserker);
});

// The production shape a first load has to survive: no fork exists yet, the
// pre-release parents are v2, and every Advent name also carries a v2 row of
// its own descending from the original.
test.skipIf(!forkRecords)('a first load forks all twelve off their roster parents, whatever version the rows carry', () => {
  const names = forkRecords.map((record) => displayName(record.name));
  const rows = [
    ...names.map((name) => parentRow(name, { rules_version: 'v2' })),
    ...ADVENT_NAMES.map((name) =>
        row(name, { id: `id-${name}-v2`, rules_version: 'v2', base_class_id: PARENT_IDS[name] }))
  ];
  const plans = planLoad(forkRecords, rows, forkBook);
  expect(plans.map((plan) => [plan.payload.name, plan.disposition, plan.parent.id, plan.matches.length]))
      .toEqual(names.map((name) => [name, 'fork', PARENT_IDS[name], 1]));
});

test.skipIf(!forkRecords)('the roster row is the parent when an Advent class has a v1 and a v2 row', () => {
  const rows = [parentRow('Gunslinger'),
    row('Gunslinger', { id: 'id-v2', rules_version: 'v2', base_class_id: PARENT_IDS.Gunslinger })];
  const [plan] = planLoad([gunslingerRecord], rows, forkBook);
  expect(plan.disposition).toBe('fork');
  expect(plan.parent.id).toBe(PARENT_IDS.Gunslinger);
});

test.skipIf(!forkRecords)("a player's own class of the same name is not a fork parent", () => {
  const rows = [row('Gunslinger', { id: 'id-mine', is_player_created: true })];
  expect(() => planLoad([gunslingerRecord], rows, forkBook)).toThrow('no fork parent for "Gunslinger"');
});

test.skipIf(!forkRecords)('re-running after a fork updates the fork and never creates a second one', () => {
  const rows = [parentRow('Berserker', { rules_edition: 'aspirant' }),
    row('Berserker', { id: 'id-v1fork', rules_edition: 'aspirant', content_format: 'aspirant' })];
  const [plan] = planLoad([berserkerRecord], rows, forkBook);
  expect(plan.disposition).toBe('update');
  expect(plan.row.id).toBe('id-v1fork');
});

// Six of the Advent-format parents (Berserker among them) are themselves
// pre-release rows carrying art the extraction never printed. That art has to
// travel onto the fork it seeds, since nothing else will ever set it.
test.skipIf(!forkRecords)('a fork carries art from a pre-release aspirant-section parent', () => {
  const parent = parentRow('Berserker', {
    rules_edition: 'aspirant', prerelease_section: 'aspirant',
    image_url: 'https://example.com/berserker.png', image_crop: { x: 1, y: 2 }
  });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  expect(plan.payload.image_url).toBe('https://example.com/berserker.png');
  expect(plan.payload.image_crop).toEqual({ x: 1, y: 2 });
});

// The six Advent originals (Gunslinger among them) lend their art the same way.
test.skipIf(!forkRecords)('a fork of an Advent class carries its Advent parent\'s art', () => {
  const parent = parentRow('Gunslinger', {
    image_url: 'https://example.com/gunslinger.png', image_crop: { x: 0, y: 0 }
  });
  const [plan] = planLoad([gunslingerRecord], [parent], forkBook);
  expect(plan.payload.image_url).toBe('https://example.com/gunslinger.png');
  expect(plan.payload.image_crop).toEqual({ x: 0, y: 0 });
});

test.skipIf(!forkRecords)('a fork of a parent with no art carries no art', () => {
  const parent = parentRow('Gunslinger', { image_url: null, image_crop: null });
  const [plan] = planLoad([gunslingerRecord], [parent], forkBook);
  expect(plan.payload).not.toHaveProperty('image_url');
  expect(plan.payload).not.toHaveProperty('image_crop');
});

// A re-run finds the fork it made last time; if that fork never received its
// parent's art, the update has to carry it the way the original fork would
// have.
test.skipIf(!forkRecords)("an update carries art from its parent when the fork's own art is unset", () => {
  const parent = parentRow('Berserker', {
    rules_edition: 'aspirant', prerelease_section: 'aspirant',
    image_url: 'https://example.com/berserker.png', image_crop: { x: 1, y: 2 }
  });
  const existingFork = row('Berserker', {
    id: 'id-v1fork', rules_edition: 'aspirant', content_format: 'aspirant',
    base_class_id: PARENT_IDS.Berserker, image_url: null, image_crop: null
  });
  const [plan] = planLoad([berserkerRecord], [parent, existingFork], forkBook);
  expect(plan.disposition).toBe('update');
  expect(plan.payload.image_url).toBe('https://example.com/berserker.png');
  expect(plan.payload.image_crop).toEqual({ x: 1, y: 2 });
});

// Once a fork carries its own art -- set by whoever owns the row -- a later
// re-run must never clobber it with the parent's.
test.skipIf(!forkRecords)("an update never overwrites art the fork's own row already carries", () => {
  const parent = parentRow('Berserker', {
    rules_edition: 'aspirant', prerelease_section: 'aspirant',
    image_url: 'https://example.com/berserker.png', image_crop: { x: 1, y: 2 }
  });
  const existingFork = row('Berserker', {
    id: 'id-v1fork', rules_edition: 'aspirant', content_format: 'aspirant',
    base_class_id: PARENT_IDS.Berserker,
    image_url: 'https://example.com/owner-set.png', image_crop: { x: 9, y: 9 }
  });
  const [plan] = planLoad([berserkerRecord], [parent, existingFork], forkBook);
  expect(plan.disposition).toBe('update');
  expect(plan.payload).not.toHaveProperty('image_url');
  expect(plan.payload).not.toHaveProperty('image_crop');
});

// Both axes decide it: a row in this book's content format but another
// rules_edition is not this book's fork, and reading it as one would overwrite a
// class this book never described.
test.skipIf(!forkRecords)("a row matching one axis only is neither this book's fork nor a parent", () => {
  const rows = [row('Berserker', { content_format: 'aspirant', rules_edition: 'advent' })];
  expect(() => planLoad([berserkerRecord], rows, forkBook)).toThrow('no fork parent for "Berserker"');
});

// A parent and its own fork share a name for good, so the name alone cannot
// decide the row. Two forks is the ambiguity, reported rather than picked from;
// a second row of the parent's name is simply not the parent.
test.skipIf(!forkRecords)('two forks of one name are ambiguous, and a second row of the parent name is not a parent', () => {
  const [byParent] = planLoad([berserkerRecord],
      [parentRow('Berserker'), row('Berserker', { id: 'id-other' })], forkBook);
  expect(byParent.parent.id).toBe(PARENT_IDS.Berserker);
  expect(byParent.matches).toHaveLength(1);

  const fork = (id) => row('Berserker', { id, rules_edition: 'aspirant', content_format: 'aspirant' });
  const [byFork] = planLoad([berserkerRecord], [parentRow('Berserker'), fork('f1'), fork('f2')], forkBook);
  expect(byFork.matches).toHaveLength(2);
  expect(byFork.row).toBeNull();
});

// An id Postgres mints instead would differ between local and production, which
// is the one thing minting them by hand exists to prevent -- and a payload with
// no `id` key is exactly what makes Postgres mint one.
test.skipIf(!forkRecords)('a forked class with no minted id stops the run', () => {
  const unnamed = { ...berserkerRecord, name: 'Nobody' };
  expect(() => planLoad([unnamed], [row('Nobody')], forkBook)).toThrow('no minted class id for "Nobody"');
});

test.skipIf(!forkRecords)('every V1 class has one minted id of its own', () => {
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

test.skipIf(!records)('every record maps to one of the three enum values', () => {
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

test.skipIf(!records)('the payload carries the allowlist and nothing else', () => {
  for (const record of records) {
    const payload = buildPayload(record, book);
    expect(Object.keys(payload).sort()).toEqual([...fieldsFor(book)].sort());
    for (const field of [...FORBIDDEN, ...FORK_ONLY]) expect(payload).not.toHaveProperty(field);
    expect(payload).not.toHaveProperty('page_range');
    expect(payload.free_play_access).toBe(true);
  }
});

const forkPlans = () =>
    planLoad(forkRecords, forkRecords.map((record) => parentRow(displayName(record.name))), forkBook);

test.skipIf(!forkRecords)('a fork payload carries the allowlist plus the four fields it mints', () => {
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
test.skipIf((!records || !forkRecords))('only the pre-release book grants free play access', () => {
  expect(buildPayload(berserkerRecord, forkBook).free_play_access).toBe(false);
  expect(buildPayload(prereleaseRecord, bookFor('prerelease')).free_play_access).toBe(true);
});

// The field list and buildPayload are compared against each other above, so
// widening the list alone stays green while buildPayload silently omits the key
// for every record. Both columns are NOT NULL with a shaped default, so an
// omitted key stores that default in place of the book's own content.
test.skipIf(!records)('every payload carries an advanced_abilities array', () => {
  for (const record of records) {
    expect(Array.isArray(buildPayload(record, book).advanced_abilities)).toBe(true);
  }
});

test.skipIf((!records || !forkRecords))('every payload carries expanded_tips, whether its book has any or not', () => {
  expect(buildPayload(prereleaseRecord, bookFor('prerelease')).expanded_tips)
      .toEqual({ player: [], conduit: [] });
  expect(buildPayload(berserkerRecord, forkBook).expanded_tips)
      .toEqual(berserkerRecord.expanded_tips);
});

test.skipIf(!records)('tips are written as a markdown bullet list', () => {
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

test.skipIf(!records)('ability pronunciation survives into the payload', () => {
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

test.skipIf(!records)('each remap target is a name this document introduces and each source is not', () => {
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

test.skipIf(!forkRecords)('a fork leaves its parent untouched in the post-import projection', () => {
  const parent = parentRow('Berserker', { rules_edition: 'aspirant', gear: [{ name: 'Old Axe' }] });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const after = projectImport([parent], [plan], forkBook);
  expect(after.find((c) => c.id === PARENT_IDS.Berserker).gear).toEqual([{ name: 'Old Axe' }]);
  expect(after).toHaveLength(2);
});

test.skipIf(!forkRecords)("the parent's item names survive the fork, so nothing is orphaned", () => {
  const parent = parentRow('Berserker', { is_public: true, rules_edition: 'aspirant',
    gear: [{ name: 'Old Axe' }], abilities: [] });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const names = catalogueNames(projectImport([parent], [plan], forkBook));
  expect(names.gear.has('Old Axe')).toBe(true);
});

test.skipIf(!forkRecords)('the projected fork stands under the id the load will give it', () => {
  const parent = parentRow('Berserker', { rules_edition: 'aspirant' });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  expect(projectImport([parent], [plan], forkBook).map((cls) => cls.id))
      .toEqual([PARENT_IDS.Berserker, ASPIRANT_V1_CLASS_IDS.Berserker]);
});

// Both rows are named Berserker and the book publishes that name, but only the
// fork is this load's to publish: a projection that published by name would make
// a private parent public and count its item names as catalogued.
test.skipIf(!forkRecords)('the projection publishes the fork and not the parent it descends from', () => {
  const parent = parentRow('Berserker', { rules_edition: 'aspirant', is_public: false });
  const [plan] = planLoad([berserkerRecord], [parent], forkBook);
  const projected = projectImport([parent], [plan], forkBook);
  const publicity = (id) => projected.find((cls) => cls.id === id).is_public;
  expect(publicity(PARENT_IDS.Berserker)).toBe(false);
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

test.skipIf(!records)('every committed remap target survives the import into its own kind', () => {
  const after = {
    abilities: new Set(artifactNames('ability')),
    gear: new Set(artifactNames('gear'))
  };
  expect(unresolvableTargets(remap, after)).toEqual([]);
});

const captureLog = (run) => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines;
};

// The FORK heading is how a human running the dry run confirms the twelve
// parents before anything is written -- it names both the class and the parent
// id it is about to descend from.
test('reportPlan prints the FORK heading with the class name and parent id', () => {
  const plan = {
    payload: { name: 'Berserker' }, row: null, parent: { id: 'parent-id-1' },
    disposition: 'fork', changes: []
  };
  const lines = captureLog(() => reportPlan([plan], forkBook));
  expect(lines).toContain('\nFORK Berserker from parent-id-1');
  expect(lines).toContain('  + rules_version: "v1"');
});

test.skipIf(!records)('the dry run reports the fields only an insert writes', () => {
  const charlatan = records.find((record) => displayName(record.name) === 'Charlatan');
  const [plan] = planLoad([charlatan], [], book);
  plan.changes = diffFields(plan.payload, plan.row);
  const lines = captureLog(() => reportPlan([plan], book));
  expect(lines).toContain('\nCREATE Charlatan');
  expect(lines).toContain('  + rules_version: "v2"');
  expect(lines).toContain('  + status: "release"');
  expect(lines).toContain('  + is_player_created: true');
});

// `rules_version` has no column default, `status` defaults to 'alpha' and
// `is_player_created` to false, so the insert is where a book states all
// three. Both books' classes are released content, each at its own rules
// version, and only a pre-release PCC is player-created.
test.skipIf(!forkRecords)('an Aspirant V1 fork is inserted released, at v1, and not player-created', () => {
  const [plan] = planLoad([berserkerRecord], [parentRow('Berserker', { rules_edition: 'aspirant' })],
      forkBook);
  const inserted = insertRow(plan, forkBook);
  expect(inserted.status).toBe('release');
  expect(inserted.rules_version).toBe('v1');
  expect(inserted.is_player_created).toBe(false);
  expect(inserted.id).toBe(ASPIRANT_V1_CLASS_IDS.Berserker);
});

test.skipIf(!records)('a pre-release create is inserted released, at v2', () => {
  const charlatan = records.find((record) => displayName(record.name) === 'Charlatan');
  const [plan] = planLoad([charlatan], [], book);
  const inserted = insertRow(plan, book);
  expect(inserted.status).toBe('release');
  expect(inserted.rules_version).toBe('v2');
});

test.skipIf(!records)('a pre-release PCC is inserted player-created and an exclusive is not', () => {
  const recordFor = (name) => records.find((record) => displayName(record.name) === name);
  const [charlatan, ardent] = planLoad([recordFor('Charlatan'), recordFor('Ardent')], [], book);
  expect(insertRow(charlatan, book).is_player_created).toBe(true);
  expect(insertRow(ardent, book).is_player_created).toBe(false);
});

// Re-running a load is what corrects rows an earlier load left at another
// status, so its publish step brings status along with visibility.
test('publishing an Aspirant V1 row already public brings its status to release', () => {
  expect(publishPatch({ id: 'x', is_public: true, status: 'alpha' }, forkBook))
      .toEqual({ status: 'release' });
});

test('publishing a private Aspirant V1 row sets both visibility and release status', () => {
  expect(publishPatch({ id: 'x', is_public: false, status: 'alpha' }, forkBook))
      .toEqual({ is_public: true, status: 'release' });
});

test('an Aspirant V1 row already public and released needs no publish write', () => {
  expect(publishPatch({ id: 'x', is_public: true, status: 'release' }, forkBook)).toBeNull();
});

test('publishing a pre-release row brings its status to release', () => {
  expect(publishPatch({ id: 'x', is_public: false, status: 'alpha' }, book))
      .toEqual({ is_public: true, status: 'release' });
  expect(publishPatch({ id: 'x', is_public: true, status: 'release' }, book)).toBeNull();
});
