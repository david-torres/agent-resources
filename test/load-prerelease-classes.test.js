// Pure-function cover for scripts/load-prerelease-classes.mjs. The loader's
// resolution step decides whether a class is updated in place or inserted
// again, so it is exercised here against both spellings of every renamed class
// -- the state before a load and the state after one.
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIELDS, buildPayload, displayName, fold, isLocalTarget, planLoad, resolveTarget, sectionEnum,
  trimEnds, unremapped
} from '../scripts/load-prerelease-classes.mjs';
import { catalogueNames, groupUnresolvable } from '../scripts/lib/character-impact.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const records = JSON.parse(
    readFileSync(join(root, 'docs', 'data', 'prerelease-classes-2026-08.json'), 'utf8'));
const remap = JSON.parse(
    readFileSync(join(root, 'docs', 'data', 'prerelease-name-remap.json'), 'utf8'));

const ITEM_KEY = { ability: 'abilities', gear: 'gear' };
const artifactNames = (kind) =>
    records.flatMap((record) => (record[ITEM_KEY[kind]] ?? []).map((item) => item.name.trim()));
const codepoints = (text) => [...text].map((character) => character.codePointAt(0));

const row = (name) => ({ id: `id-${name}`, name });

const FORBIDDEN = ['is_public', 'status', 'rules_edition', 'rules_version', 'teaser',
  'image_url', 'image_crop', 'base_class_id'];

// The catalogue names as they stand before any load has run.
const namesBeforeLoad = ['Beastmaster', 'Berserker', 'Bogatyr', 'Brainiac', 'Drachentöter',
  'Freerunner', 'Greybeard', 'Infiltrator', 'Lithomancer', 'Oddball', 'Raubritter', 'Samaritan',
  'Shonen', 'Vessel', 'Witchhunter', 'Zoologist'];

const split = (rows) => {
  const plans = planLoad(records, rows.map(row));
  return {
    update: plans.filter((plan) => plan.row).length,
    create: plans.filter((plan) => !plan.row).length,
    ambiguous: plans.filter((plan) => plan.matches.length > 1).length
  };
};

test('an aliased class resolves against the catalogue spelling', () => {
  const matches = resolveTarget({ name: 'Witchfinder' }, [row('Witchhunter')]);
  expect(matches.map((m) => m.name)).toEqual(['Witchhunter']);
});

test('an aliased class still resolves once it carries the document spelling', () => {
  const matches = resolveTarget({ name: 'Witchfinder' }, [row('Witchfinder')]);
  expect(matches.map((m) => m.name)).toEqual(['Witchfinder']);
});

test('resolution folds diacritics and trims stored whitespace', () => {
  expect(resolveTarget({ name: 'Shōnen' }, [row('Shonen')])).toHaveLength(1);
  expect(resolveTarget({ name: 'Zoologist' }, [row('Zoologist ')])).toHaveLength(1);
  expect(resolveTarget({ name: 'Drachentöter' }, [row('Drachentöter')])).toHaveLength(1);
});

test('a name matching several rows is reported rather than silently picked', () => {
  const plans = planLoad([records[0]], [row('Beastmaster'), row('beastmaster')]);
  expect(plans[0].matches).toHaveLength(2);
  expect(plans[0].row).toBeNull();
});

test('the load resolves 16 updates and 3 creates against the pre-load catalogue', () => {
  expect(split(namesBeforeLoad)).toEqual({ update: 16, create: 3, ambiguous: 0 });
});

test('re-running after a load creates nothing', () => {
  const afterLoad = records.map((record) => displayName(record.name));
  expect(split(afterLoad)).toEqual({ update: 19, create: 0, ambiguous: 0 });
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
  expect(counts).toEqual({ pcc: 10, exclusive: 3, aspirant: 6 });
});

test('trimming takes the ends only and leaves rich-text runs alone', () => {
  expect(trimEnds({ overview: '  text  ' })).toEqual({ overview: 'text' });
  expect(trimEnds({ quote: 'a  b' })).toEqual({ quote: 'a  b' });
  expect(trimEnds({ notes: [{ text: 'bold ', children: [{ text: 'word' }] }] }))
      .toEqual({ notes: [{ text: 'bold ', children: [{ text: 'word' }] }] });
});

test('the payload carries the allowlist and nothing else', () => {
  for (const record of records) {
    const payload = buildPayload(record);
    expect(Object.keys(payload).sort()).toEqual([...FIELDS].sort());
    for (const field of FORBIDDEN) expect(payload).not.toHaveProperty(field);
    expect(payload).not.toHaveProperty('page_range');
  }
});

test('tips are written as a markdown bullet list', () => {
  const payload = buildPayload(records[0]);
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
      .flatMap((record) => buildPayload(record).abilities)
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
