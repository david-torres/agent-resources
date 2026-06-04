const { test, expect, describe } = require('bun:test');
const { filterClassListsByIds } = require('./class-filter');

const mk = (id, name, edition = 'advent') => ({ id, name, rules_edition: edition });

describe('filterClassListsByIds', () => {
  const lists = {
    advent: [mk('lib-v1', 'Librarian'), mk('lib-v2', 'Librarian'), mk('gun-v1', 'Gunslinger')],
    aspirant: [mk('lib-asp', 'Librarian', 'aspirant')],
    pcc: [mk('pcc-1', 'Homebrew')]
  };

  test('keeps only classes whose id is in the allowed set', () => {
    const out = filterClassListsByIds(lists, new Set(['lib-v1', 'lib-v2']));
    expect(out.advent.map(c => c.id)).toEqual(['lib-v1', 'lib-v2']);
    expect(out.pcc).toEqual([]);
  });

  test('same-name edition fork is NOT admitted by an advent unlock (the old name-leak)', () => {
    const out = filterClassListsByIds(lists, new Set(['lib-v1', 'lib-v2']));
    expect(out.aspirant).toEqual([]); // name-based filtering would have leaked lib-asp
  });

  test('exposes surviving class names for gear/ability map filtering', () => {
    const out = filterClassListsByIds(lists, new Set(['lib-v1', 'pcc-1']));
    expect(out.allowedNames).toEqual(new Set(['Librarian', 'Homebrew']));
  });

  test('empty allowed set filters everything', () => {
    const out = filterClassListsByIds(lists, new Set());
    expect(out.advent).toEqual([]);
    expect(out.aspirant).toEqual([]);
    expect(out.pcc).toEqual([]);
    expect(out.allowedNames).toEqual(new Set());
  });
});
