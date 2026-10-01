const { test, expect } = require('bun:test');
const { resolveCharacterMechanics, characterRulesVersion, assertPublishedClassRules } = require('./character-rules');

for (const creatorMode of [null, '', 'advent', 'aspirant', 'aspiring']) {
  for (const [edition, version, expected] of [
    ['advent', 'v1', 'advent-v1'], ['advent', 'v2', 'advent-v2'],
    ['aspirant', 'v1', 'advent-v2'], ['aspirant', 'v2', 'advent-v2']
  ]) {
    for (const content_format of ['advent', 'aspirant']) {
      test(`${edition} ${version}, mode ${creatorMode}, format ${content_format}`, () => {
        const classRules = { rules_edition: edition, rules_version: version, content_format };
        const mechanics = ['aspirant', 'aspiring'].includes(creatorMode) ? 'advent-v2' : expected;
        expect(resolveCharacterMechanics({ classRules, creatorMode })).toBe(mechanics);
        expect(characterRulesVersion({ classRules, creatorMode })).toBe(mechanics === 'advent-v2' ? 'v2' : 'v1');
      });
    }
  }
  test(`classless, mode ${creatorMode}`, () => {
    expect(resolveCharacterMechanics({ classRules: null, creatorMode })).toBe(['aspirant', 'aspiring'].includes(creatorMode) ? 'advent-v2' : 'advent-v1');
  });
}

test('invalid identity is rejected before mode overrides', () => {
  for (const classRules of [undefined, {}, { rules_edition: 'unknown', rules_version: 'v1' }, { rules_edition: 'advent', rules_version: 'v3' }]) {
    expect(() => resolveCharacterMechanics({ classRules, creatorMode: 'aspirant' })).toThrow();
  }
  expect(() => resolveCharacterMechanics({ classRules: null, creatorMode: 'unknown' })).toThrow();
});
test('published writes reject legacy Aspirant v2', () => {
  expect(() => assertPublishedClassRules({ rules_edition: 'aspirant', rules_version: 'v2' })).toThrow();
  expect(assertPublishedClassRules({ rules_edition: 'aspirant', rules_version: 'v1' }).rules_version).toBe('v1');
});
