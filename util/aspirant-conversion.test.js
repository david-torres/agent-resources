const { test, expect, describe, spyOn } = require('bun:test');
const { findAspirantFork } = require('./aspirant-conversion');

// The catalogue shapes conversion meets: an Advent class at v1 and v2 (one
// version family) with its Aspirant fork of the v1 row, a second such class
// for cross-class items, a pre-release class with its fork, and a class with
// no fork at all.
const advent = (id, name, extra = {}) => ({
  id, name, rules_edition: 'advent', content_format: 'advent', base_class_id: null,
  gear: [], abilities: [], advanced_abilities: [], ...extra
});
const fork = (id, name, baseClassId, extra = {}) => ({
  id, name, rules_edition: 'aspirant', content_format: 'aspirant', base_class_id: baseClassId,
  gear: [], abilities: [], advanced_abilities: [], ...extra
});

const GUNSLINGER_V1 = advent('gunslinger-v1', 'Gunslinger');
const GUNSLINGER_V2 = advent('gunslinger-v2', 'Gunslinger', { base_class_id: 'gunslinger-v1' });
const GUNSLINGER_FORK = fork('gunslinger-aspirant', 'Gunslinger', 'gunslinger-v1', {
  gear: [{ name: 'Revolver', description: 'A six-shooter.' }, { name: 'Duster', description: 'Long coat.' }],
  abilities: [{ name: 'Trickshot' }, { name: 'Standoff' }, { name: 'Shootout' }],
  advanced_abilities: [{ name: 'Last Word' }, { name: 'Dead Eye' }, { name: 'High Noon' }]
});
const WANDERER_V1 = advent('wanderer-v1', 'Wanderer');
const WANDERER_V2 = advent('wanderer-v2', 'Wanderer', { base_class_id: 'wanderer-v1' });
const WANDERER_FORK = fork('wanderer-aspirant', 'Wanderer', 'wanderer-v1', {
  gear: [{ name: 'Satchel' }], abilities: [{ name: 'Familiar Face' }]
});
const BERSERKER_PRERELEASE = {
  id: 'berserker-pre', name: 'Berserker', rules_edition: 'aspirant', content_format: 'advent',
  base_class_id: null, gear: [], abilities: [], advanced_abilities: []
};
const BERSERKER_FORK = fork('berserker-aspirant', 'Berserker', 'berserker-pre');
const HOMEBREW = advent('homebrew', 'Homebrew Class', { gear: [{ name: 'Hand Cannon' }] });

const CATALOGUE = [
  GUNSLINGER_V1, GUNSLINGER_V2, GUNSLINGER_FORK, WANDERER_V1, WANDERER_V2, WANDERER_FORK,
  BERSERKER_PRERELEASE, BERSERKER_FORK, HOMEBREW
];

describe('findAspirantFork', () => {
  test('the v1 member of a family finds the fork of the v1 row', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-v1')).toBe(GUNSLINGER_FORK);
  });

  test('the v2 member of the same family finds the same fork', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-v2')).toBe(GUNSLINGER_FORK);
  });

  test('a pre-release class finds its fork', () => {
    expect(findAspirantFork(CATALOGUE, 'berserker-pre')).toBe(BERSERKER_FORK);
  });

  test('a class with no fork has none', () => {
    expect(findAspirantFork(CATALOGUE, 'homebrew')).toBeNull();
  });

  test('a fork has no fork of its own', () => {
    expect(findAspirantFork(CATALOGUE, 'gunslinger-aspirant')).toBeNull();
  });

  test('a character with no class has no fork, even beside a parentless Aspirant class', () => {
    const parentless = fork('orphan-aspirant', 'Orphan', null);
    expect(findAspirantFork([...CATALOGUE, parentless], null)).toBeNull();
  });

  test('two forks of one family are ambiguous: none is offered and it is logged', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const second = fork('gunslinger-aspirant-2', 'Gunslinger', 'gunslinger-v2');
      expect(findAspirantFork([...CATALOGUE, second], 'gunslinger-v2')).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('gunslinger-aspirant-2');
    } finally {
      warn.mockRestore();
    }
  });
});
