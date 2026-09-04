// util/class-export.test.js
//
// Both export paths used to emit `classes.description`, the assembled prose
// blob Task 13 retires. Neither path had a test, so nothing would have caught
// an export that silently lost every prose field when the column went away.
// These pin the Markdown section list and the JSON key set.
const { test, expect } = require('bun:test');
const { exportClass } = require('./class-export');
const { classImportSchema } = require('./class-import');

const BEASTMASTER = {
  name: 'Beastmaster',
  rules_edition: 'advent',
  rules_version: 'v1',
  status: 'release',
  is_public: true,
  is_player_created: false,
  challenge_level: 'Mid',
  stat_line: '+Sensory, +Skill, +Vitality*',
  stat_note: 'Vitality is starred because your beasts share it.',
  quote: 'Better to have beasts that let themselves be killed than men who run away.',
  quote_source: 'Jean-Paul Sartre',
  overview: 'You are a domineering animal tamer.',
  conduit_notes: 'Conduits designing a mission for you should try to ensure there are some workable animals available.',
  grounding: 'Grounded in tropes surrounding animal handlers.',
  examples_heading: 'Examples from history and pop culture include:',
  examples: ['Siegfried & Roy', 'Rexxar (Warcraft)'],
  tips_heading: 'Tips for playing a Beastmaster:',
  tips: '- Keep a beast in reserve.',
  designer: 'Reece C. Downie',
  prerelease_section: 'pcc',
  teaser: 'A domineering animal tamer.',
  gear: [
    { name: 'Whip', description: 'Cracks.', category: 'default', meters: [{ label: 'Reach', value: 'Mid' }], notes: [{ text: 'Cracks loudly.', children: [{ text: 'Startles beasts.', children: [] }] }] },
    { name: 'Snare', description: 'Holds.', category: 'elective', meters: [], notes: [] },
  ],
  abilities: [{
    name: 'Tame',
    description: 'Bonds a beast.',
    paired_action: 'Hold out a hand.',
    pronunciation: 'taym',
    meters: [{ label: 'Essence Cost', value: 'Low' }],
    notes: [{ text: 'Bond lasts a Mid Duration.', children: [{ text: 'One beast at a time.', children: [] }] }],
  }],
  image_url: null,
  image_crop: null,
};

const sectionsOf = (markdown) =>
  markdown.split('\n').filter((line) => line.startsWith('## '));

test('the Markdown export carries the structured prose under an Overview section', () => {
  const { content } = exportClass(BEASTMASTER, 'markdown');
  expect(sectionsOf(content)).toEqual([
    '## 📖 Overview',
    '## 💡 Tips',
    '## 🎒 Gear',
    '## ⚔️ Abilities',
  ]);
  expect(content).toContain('+Sensory, +Skill, +Vitality*');
  expect(content).toContain('Vitality is starred because your beasts share it.');
  expect(content).toContain('Better to have beasts that let themselves be killed than men who run away.');
  expect(content).toContain('Jean-Paul Sartre');
  expect(content).toContain('You are a domineering animal tamer.');
  expect(content).toContain('Conduits designing a mission for you');
  expect(content).toContain('Grounded in tropes surrounding animal handlers.');
  expect(content).toContain('Examples from history and pop culture include:');
  expect(content).toContain('- Siegfried & Roy');
  expect(content).toContain('- Rexxar (Warcraft)');
  expect(content).toContain('Mid');
  expect(content).toContain('Reece C. Downie');
});

test('the Markdown export no longer emits a Description section', () => {
  const { content } = exportClass(BEASTMASTER, 'markdown');
  expect(content).not.toContain('## 📖 Description');
  expect(sectionsOf(content)).not.toContain('## 📖 Description');
});

// A class with none of the prose columns set (every PCC created through the
// admin form today) must not emit an empty Overview heading.
test('the Markdown export omits the Overview section when no prose is set', () => {
  const { content } = exportClass(
    { name: 'Bare', rules_edition: 'advent', rules_version: 'v1', status: 'alpha', gear: [], abilities: [] },
    'markdown'
  );
  expect(sectionsOf(content)).toEqual([]);
});

test('the JSON export carries every structured prose column and no description', () => {
  const { content } = exportClass(BEASTMASTER, 'json');
  const parsed = JSON.parse(content);
  expect(Object.keys(parsed)).not.toContain('description');
  expect(Object.keys(parsed).sort()).toEqual([
    'abilities',
    'challenge_level',
    'conduit_notes',
    'designer',
    'examples',
    'examples_heading',
    'gear',
    'grounding',
    'image_crop',
    'image_url',
    'is_player_created',
    'is_public',
    'name',
    'overview',
    'prerelease_section',
    'quote',
    'quote_source',
    'rules_edition',
    'rules_version',
    'stat_line',
    'stat_note',
    'status',
    'teaser',
    'tips',
    'tips_heading',
  ]);
  expect(parsed.overview).toBe('You are a domineering animal tamer.');
  expect(parsed.examples).toEqual(['Siegfried & Roy', 'Rexxar (Warcraft)']);
  expect(parsed.challenge_level).toBe('Mid');
  expect(parsed.designer).toBe('Reece C. Downie');
});

test('the JSON export defaults a missing examples array to empty, not null', () => {
  const { content } = exportClass({ name: 'Bare', gear: [], abilities: [] }, 'json');
  expect(JSON.parse(content).examples).toEqual([]);
});

// The assertion that matters is not "the keys are present" but the round trip:
// a key the AI importer can set that the exporter does not emit is a field an
// export -> import cycle silently drops. Compared as sets between the two
// modules rather than against a literal list, which would drift.
const importableKeys = (schema) => Object.keys(schema.shape);

// Keys the exporter emits on purpose that the importer must NOT accept. Each
// one is a decision, not an omission, so it is listed with its reason:
//   image_crop          a crop rectangle produced by the cropper widget; no
//                       class writeup contains one.
//   is_player_created   the importer always creates a PCC and forces it true.
//   challenge_level     curation, and
//   designer            provenance, and
//   prerelease_section  provenance: routes/classes.js strips all three from a
//                       non-admin save (ADMIN_ONLY_FIELDS) and /classes/import
//                       is open to any signed-in user.
const EXPORT_ONLY_KEYS = [
  'challenge_level', 'designer', 'image_crop', 'is_player_created', 'prerelease_section',
];

test('every key the AI importer can set is a key the JSON export emits', () => {
  const exported = Object.keys(JSON.parse(exportClass(BEASTMASTER, 'json').content));
  const missing = importableKeys(classImportSchema).filter((key) => !exported.includes(key));
  expect(missing).toEqual([]);
});

test('the JSON export emits nothing beyond the importable keys but the declared exceptions', () => {
  const exported = Object.keys(JSON.parse(exportClass(BEASTMASTER, 'json').content));
  const importable = importableKeys(classImportSchema);
  expect(exported.filter((key) => !importable.includes(key)).sort()).toEqual(EXPORT_ONLY_KEYS);
});

test('every ability key the importer can set survives the JSON export', () => {
  const { abilities } = JSON.parse(exportClass(BEASTMASTER, 'json').content);
  const importable = importableKeys(classImportSchema.shape.abilities.element);
  expect(importable.filter((key) => !(key in abilities[0]))).toEqual([]);
  expect(abilities[0]).toEqual(BEASTMASTER.abilities[0]);
});

test('every gear key the importer can set survives the JSON export', () => {
  const { gear } = JSON.parse(exportClass(BEASTMASTER, 'json').content);
  const importable = importableKeys(classImportSchema.shape.gear.element);
  expect(importable.filter((key) => !(key in gear[0]))).toEqual([]);
  expect(gear[0]).toEqual(BEASTMASTER.gear[0]);
});

// A legacy two-field item exports in the same contract shape a save would
// write, so a re-import cannot turn it into a different row.
test('the JSON export gives a legacy item the full contract shape', () => {
  const { content } = exportClass(
    { name: 'Legacy', gear: [{ name: 'Sword', description: 'Sharp.' }], abilities: [{ name: 'Swing', description: 'Hits.' }] },
    'json'
  );
  const parsed = JSON.parse(content);
  expect(parsed.abilities[0]).toEqual({ name: 'Swing', description: 'Hits.', paired_action: '', meters: [], notes: [] });
  expect(parsed.gear[0]).toEqual({ name: 'Sword', description: 'Sharp.', category: 'default', meters: [], notes: [] });
});

test('the Markdown export prints ability paired actions, meters and notes', () => {
  const { content } = exportClass(BEASTMASTER, 'markdown');
  expect(content).toContain('Hold out a hand.');
  expect(content).toContain('Essence Cost');
  expect(content).toContain('Bond lasts a Mid Duration.');
  expect(content).toContain('One beast at a time.');
});

test('the Markdown export prints gear meters and notes', () => {
  const { content } = exportClass(BEASTMASTER, 'markdown');
  expect(content).toContain('Reach');
  expect(content).toContain('Cracks loudly.');
  expect(content).toContain('Startles beasts.');
});

// The columns are `category`, not position: an item stored as Elective prints
// under Elective wherever it sits in the list.
test('the Markdown export splits gear by its stored category', () => {
  const { content } = exportClass({
    name: 'Split',
    gear: [
      { name: 'First', description: 'x', category: 'elective' },
      { name: 'Second', description: 'y', category: 'default' },
    ],
    abilities: [],
  }, 'markdown');
  const base = content.indexOf('### Base Gear');
  const elective = content.indexOf('### Elective Gear');
  expect(content.indexOf('**Second**')).toBeGreaterThan(base);
  expect(content.indexOf('**Second**')).toBeLessThan(elective);
  expect(content.indexOf('**First**')).toBeGreaterThan(elective);
});
