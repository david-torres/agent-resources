const { test, expect } = require('bun:test');
const { characterRulesVersion } = require('./character-rules');

const CASES = [
  ['an Advent character follows a v1 class', { classRulesVersion: 'v1', creatorMode: null }, 'v1'],
  ['an Advent character follows a v2 class', { classRulesVersion: 'v2', creatorMode: 'advent' }, 'v2'],
  ['an Aspirant character on a v1 class is on v2', { classRulesVersion: 'v1', creatorMode: 'aspirant' }, 'v2'],
  ['an Aspirant character on a v2 class is on v2', { classRulesVersion: 'v2', creatorMode: 'aspirant' }, 'v2'],
  ['an Aspiring character, which has no class, is on v2', { classRulesVersion: undefined, creatorMode: 'aspiring' }, 'v2'],
  ['a character with no class and no mode is on v1', { classRulesVersion: null, creatorMode: null }, 'v1'],
  ['an unrecognised class version is v1', { classRulesVersion: 'v3', creatorMode: '' }, 'v1']
];

for (const [name, args, expected] of CASES) {
  test(name, () => {
    expect(characterRulesVersion(args)).toBe(expected);
  });
}

test('no arguments is v1', () => {
  expect(characterRulesVersion()).toBe('v1');
});
