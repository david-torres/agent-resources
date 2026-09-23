const { test, expect, describe } = require('bun:test');
const { filterClassListsByIds, partitionProfileClasses, partitionClassGroups, partitionClassCatalog } = require('./class-filter');

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

describe('partitionClassCatalog', () => {
  const group = (id, { status = 'release', is_player_created = false, prerelease_section = null } = {}) => ({
    primary: { id, status, is_player_created, prerelease_section }, previous: []
  });

  test('places each group in the first section whose rule its primary meets', () => {
    const teaser = group('teaser', { prerelease_section: 'exclusive' });
    const pcc = group('pcc', { status: 'alpha', is_player_created: true });
    const owned = group('owned');
    const other = group('other');
    expect(partitionClassCatalog([teaser, pcc, owned, other], new Set(['owned']))).toEqual({
      ownedReleases: [owned],
      otherReleases: [other],
      prerelease: [teaser],
      pcc: [pcc]
    });
  });

  // The Aspirant book's roster grants the six pre-release aspirant-section
  // classes (util/starter-content.js), so ownership must not pull them out.
  test('a pre-release class stays pre-release when a book the viewer owns grants it', () => {
    const teaser = group('berserker-teaser', { prerelease_section: 'aspirant' });
    const out = partitionClassCatalog([teaser], new Set(['berserker-teaser']));
    expect(out.prerelease).toEqual([teaser]);
    expect(out.ownedReleases).toEqual([]);
  });

  test('a pre-release PCC is pre-release whatever its status', () => {
    const released = group('pcc-teaser', { prerelease_section: 'pcc', is_player_created: true });
    const alpha = group('pcc-alpha-teaser', {
      status: 'alpha', prerelease_section: 'pcc', is_player_created: true
    });
    const out = partitionClassCatalog([released, alpha]);
    expect(out.prerelease).toEqual([released, alpha]);
    expect(out.pcc).toEqual([]);
  });

  // Only an unfinished PCC carries alpha or beta; status alone never makes an
  // official class a teaser.
  test('an official class with no pre-release section is released whatever its status', () => {
    const beta = group('official-beta', { status: 'beta' });
    const out = partitionClassCatalog([beta]);
    expect(out.otherReleases).toEqual([beta]);
    expect(out.prerelease).toEqual([]);
  });

  test('a released PCC with no pre-release section is a released class', () => {
    const graduated = group('graduated', { is_player_created: true });
    const out = partitionClassCatalog([graduated], new Set(['graduated']));
    expect(out.ownedReleases).toEqual([graduated]);
    expect(out.pcc).toEqual([]);
  });

  test("an Advent-book owner's catalog: the Advent six theirs, the Aspirant twelve other", () => {
    const advent = ['gun', 'ill', 'lib', 'tha', 'thu', 'wan'].map((id) => group(`${id}-v2`));
    const aspirant = Array.from({ length: 12 }, (_, i) => group(`v1-${i}`));
    const teasers = Array.from({ length: 20 }, (_, i) => group(`pre-${i}`, {
      prerelease_section: i < 11 ? 'pcc' : i < 14 ? 'exclusive' : 'aspirant',
      is_player_created: i < 11
    }));
    const pccs = [group('alpha-pcc', { status: 'alpha', is_player_created: true }),
      group('beta-pcc', { status: 'beta', is_player_created: true })];
    const bookIds = new Set(advent.map((g) => g.primary.id));
    const out = partitionClassCatalog([...teasers, ...aspirant, ...pccs, ...advent], bookIds);
    expect(out).toEqual({ ownedReleases: advent, otherReleases: aspirant, prerelease: teasers, pcc: pccs });
  });
});

describe('partitionClassGroups', () => {
  const grp = (id, { pcc = false, status = 'release' } = {}) => ({
    primary: { id, is_player_created: pcc, status },
    previous: []
  });

  test('groups with official primaries go to released regardless of status', () => {
    const groups = [grp('off-rel'), grp('off-alpha', { status: 'alpha' })];
    const { released, pcc } = partitionClassGroups(groups);
    expect(released.map(g => g.primary.id)).toEqual(['off-rel', 'off-alpha']);
    expect(pcc).toEqual([]);
  });

  test('a released-PCC group graduates into the released section', () => {
    const { released, pcc } = partitionClassGroups([grp('pcc-rel', { pcc: true, status: 'release' })]);
    expect(released.map(g => g.primary.id)).toEqual(['pcc-rel']);
    expect(pcc).toEqual([]);
  });

  test('unreleased PCC groups go to the pcc partition, order preserved', () => {
    const groups = [
      grp('pcc-beta', { pcc: true, status: 'beta' }),
      grp('off'),
      grp('pcc-alpha', { pcc: true, status: 'alpha' })
    ];
    const { released, pcc } = partitionClassGroups(groups);
    expect(released.map(g => g.primary.id)).toEqual(['off']);
    expect(pcc.map(g => g.primary.id)).toEqual(['pcc-beta', 'pcc-alpha']);
  });

  test('no group appears in both partitions', () => {
    const groups = [
      grp('off'),
      grp('pcc-rel', { pcc: true, status: 'release' }),
      grp('pcc-beta', { pcc: true, status: 'beta' })
    ];
    const { released, pcc } = partitionClassGroups(groups);
    const ids = [...released, ...pcc].map(g => g.primary.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(groups.length);
  });

  test('handles non-array input', () => {
    expect(partitionClassGroups(null)).toEqual({ released: [], pcc: [] });
    expect(partitionClassGroups(undefined)).toEqual({ released: [], pcc: [] });
  });
});
