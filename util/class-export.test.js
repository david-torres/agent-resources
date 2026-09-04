// util/class-export.test.js
//
// Both export paths used to emit `classes.description`, the assembled prose
// blob Task 13 retires. Neither path had a test, so nothing would have caught
// an export that silently lost every prose field when the column went away.
// These pin the Markdown section list and the JSON key set.
const { test, expect } = require('bun:test');
const { exportClass } = require('./class-export');

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
  gear: [{ name: 'Whip', description: 'Cracks.' }],
  abilities: [{ name: 'Tame', description: 'Bonds a beast.' }],
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
