// util/character-export.test.js
//
// character.traits is `[{name, stat}]` (Task 5). Both export paths read a
// trait off the row, and a missed `.name` renders `[object Object]` in the
// Markdown export or serializes the whole row (leaking `stat`) into the
// documented JSON interchange format. These pin both.
const { test, expect } = require('bun:test');
const { exportCharacter, EXPORT_FORMATS } = require('./character-export');

const CHARACTER = {
  name: 'Vex',
  class: 'Gunslinger',
  level: 3,
  completed_missions: 2,
  commissary_reward: 1,
  is_deceased: false,
  traits: [
    { name: 'brave', stat: 'might' },
    { name: 'curious', stat: 'intelligence' },
  ],
};

test('markdown export renders each trait name, not [object Object]', () => {
  const { content } = exportCharacter(CHARACTER, EXPORT_FORMATS.MARKDOWN);
  expect(content).toContain('`Brave`');
  expect(content).toContain('`Curious`');
  expect(content).not.toContain('[object Object]');
});

// This export is a published interchange format users already have files
// from. The internal read shape is `{name, stat}`, but `traits` here stays
// an array of names -- a projection at the serialization boundary, derived
// from the one internal shape at write time -- so an already-exported file
// never needs to be reconciled with a later internal shape change.
test('JSON export keeps traits as an array of names, not {name, stat} objects', () => {
  const { content } = exportCharacter(CHARACTER, EXPORT_FORMATS.JSON);
  const parsed = JSON.parse(content);
  expect(parsed.traits).toEqual(['brave', 'curious']);
});
