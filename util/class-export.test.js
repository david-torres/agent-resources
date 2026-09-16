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
    { name: 'Whip', description: 'Cracks.', category: 'default', meters: [{ label: 'Reach', value: 'Mid' }], notes: [{ text: 'Cracks loudly.', children: [{ text: 'Startles beasts.', children: [] }] }], default_enchantment: { name: 'Barbed Lash', description: 'Adds bleed on a hit.', dedication: 'In Honor of Roy Horn' } },
    { name: 'Snare', description: 'Holds.', category: 'elective', meters: [], notes: [], default_enchantment: null },
  ],
  abilities: [{
    name: 'Tame',
    description: 'Bonds a beast.',
    paired_action: 'Hold out a hand.',
    pronunciation: 'taym',
    meters: [{ label: 'Essence Cost', value: 'Low' }],
    notes: [{ text: 'Bond lasts a Mid Duration.', children: [{ text: 'One beast at a time.', children: [] }] }],
    sample_perks: [{ name: 'Pack Leader', text: 'Your bonded beasts act on your turn.', dedication: 'In Honor of Siegfried & Roy', compound_text: 'All your bonded beasts act on your turn, sighted or not.' }],
  }],
  advanced_abilities: [{
    name: 'Alpha Call',
    description: 'Commands every bonded beast at once.',
    paired_action: 'Raise a fist.',
    meters: [{ label: 'Essence Cost', value: 'High' }],
    notes: [{ text: 'Requires a Perk to unlock.', children: [] }],
    sample_perks: [{ name: 'Herd Sense', text: 'The call reaches beasts out of sight.', dedication: null, compound_text: null }],
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
    '## ✨ Advanced Abilities',
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
    'advanced_abilities',
    'challenge_level',
    'conduit_notes',
    'content_format',
    'designer',
    'examples',
    'examples_heading',
    'expanded_tips',
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
  // The absent case, not the populated one, is what almost every gear item on
  // every Advent class hits -- so it is the branch most worth pinning here.
  expect(gear[1].default_enchantment).toBeNull();
});

// The spec's success criterion, stated as a test: an Advent class round-trips
// unchanged apart from picking up the two new keys at their absent values.
test('the JSON export gives a legacy item the full contract shape', () => {
  const { content } = exportClass(
    { name: 'Legacy', gear: [{ name: 'Sword', description: 'Sharp.' }], abilities: [{ name: 'Swing', description: 'Hits.' }] },
    'json'
  );
  const parsed = JSON.parse(content);
  expect(parsed.abilities[0]).toEqual({ name: 'Swing', description: 'Hits.', paired_action: '', meters: [], notes: [], sample_perks: [] });
  expect(parsed.gear[0]).toEqual({ name: 'Sword', description: 'Sharp.', category: 'default', meters: [], notes: [], default_enchantment: null });
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

/*
 * Markdown is the default export format (routes/classes.js:416, behind the
 * control at views/class-view.handlebars:68), so a key that renders only in the
 * JSON export is a key the author who picks the default silently loses -- for
 * an Aspirant class that is every one of its twelve Signature Items'
 * Enchantments (ENCLAVE: Aspirant, pg. 8), with no error and no warning.
 */
test('the Markdown export prints a gear item default enchantment', () => {
  const { content } = exportClass(BEASTMASTER, 'markdown');
  expect(content).toContain('Barbed Lash');
  expect(content).toContain('Adds bleed on a hit.');
  expect(content).toContain('In Honor of Roy Horn');
});

test('the Markdown export prints ability sample perks with both optional halves', () => {
  const { content } = exportClass(BEASTMASTER, 'markdown');
  expect(content).toContain('Pack Leader');
  expect(content).toContain('Your bonded beasts act on your turn.');
  expect(content).toContain('In Honor of Siegfried & Roy');
  expect(content).toContain('*Compounded:* All your bonded beasts act on your turn, sighted or not.');
});

// Advanced Abilities carry the ability contract whole, `sample_perks` included
// (util/class-abilities.js), and print through the same item builder as the
// Core Abilities -- asserted against the Advanced section alone so a builder
// that only ever reached the Core Abilities cannot pass.
test('the Markdown export prints sample perks on advanced abilities too', () => {
  const { content } = exportClass(BEASTMASTER, 'markdown');
  const advanced = content.slice(content.indexOf('## ✨ Advanced Abilities'));
  expect(advanced).toContain('Alpha Call');
  expect(advanced).toContain('Herd Sense');
  expect(advanced).toContain('The call reaches beasts out of sight.');
});

// The absent values are what every Advent gear item and ability holds, and they
// render nothing at all -- the rule empty `meters` and `notes` already follow.
test('the Markdown export prints no enchantment or sample perk label when there is none', () => {
  const { content } = exportClass({
    name: 'Legacy',
    gear: [{ name: 'Sword', description: 'Sharp.', default_enchantment: null }],
    abilities: [{ name: 'Swing', description: 'Hits.', sample_perks: [] }],
  }, 'markdown');
  expect(content).not.toContain('Enchantment');
  expect(content).not.toContain('Sample Perks');
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
