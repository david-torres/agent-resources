const { test, expect, describe } = require('bun:test');
const { filterClassListsByIds, partitionProfileClasses } = require('./class-filter');

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

describe('partitionProfileClasses', () => {
  const cls = (id, { pcc = false, status = 'release' } = {}) =>
    ({ id, is_player_created: pcc, status });

  test('official (non-PCC) classes go to released regardless of status', () => {
    const list = [cls('off-rel'), cls('off-alpha', { status: 'alpha' })];
    const { released, pcc } = partitionProfileClasses(list);
    expect(released.map(c => c.id)).toEqual(['off-rel', 'off-alpha']);
    expect(pcc).toEqual([]);
  });

  test('a released PCC is incorporated into the released (official) section', () => {
    const list = [cls('pcc-rel', { pcc: true, status: 'release' })];
    const { released, pcc } = partitionProfileClasses(list);
    expect(released.map(c => c.id)).toEqual(['pcc-rel']);
    expect(pcc).toEqual([]);
  });

  test('non-released PCCs (alpha/beta) stay in the PCC section only', () => {
    const list = [
      cls('pcc-alpha', { pcc: true, status: 'alpha' }),
      cls('pcc-beta', { pcc: true, status: 'beta' })
    ];
    const { released, pcc } = partitionProfileClasses(list);
    expect(released).toEqual([]);
    expect(pcc.map(c => c.id)).toEqual(['pcc-alpha', 'pcc-beta']);
  });

  test('no class appears in both sections', () => {
    const list = [
      cls('off'),
      cls('pcc-rel', { pcc: true, status: 'release' }),
      cls('pcc-beta', { pcc: true, status: 'beta' })
    ];
    const { released, pcc } = partitionProfileClasses(list);
    const ids = [...released, ...pcc].map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(released.map(c => c.id)).toEqual(['off', 'pcc-rel']);
    expect(pcc.map(c => c.id)).toEqual(['pcc-beta']);
  });

  test('handles non-array input', () => {
    expect(partitionProfileClasses(null)).toEqual({ released: [], pcc: [] });
    expect(partitionProfileClasses(undefined)).toEqual({ released: [], pcc: [] });
  });
});
