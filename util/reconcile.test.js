const { test, expect, describe } = require('bun:test');
const { diffChildRows, resolveCompoundLinks } = require('./reconcile');

// Options used by the gear/abilities helpers: key = class_id + name,
// updatable field = description.
const OPTS = {
  keyOf: (r) => `${r.class_id}:${r.name}`,
  rowFields: (item) => ({ name: item.name, class_id: item.class_id, description: item.description ?? null })
};

const row = (id, name, class_id, description = null) => ({ id, name, class_id, description });
const item = (name, class_id, description) => ({ name, class_id, description });

describe('diffChildRows', () => {
  test('identical existing and desired produces an empty diff', () => {
    const existing = [row('r1', 'Strike', 'c1', 'hits hard')];
    const desired = [item('Strike', 'c1', 'hits hard')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: [] });
  });

  test('changed field on a matched row produces an update with only the changed fields', () => {
    const existing = [row('r1', 'Strike', 'c1', 'old text')];
    const desired = [item('Strike', 'c1', 'new text')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({
      toInsert: [],
      toUpdate: [{ id: 'r1', description: 'new text' }],
      toDelete: []
    });
  });

  test('undefined desired field equals null stored field (no update)', () => {
    const existing = [row('r1', 'Strike', 'c1', null)];
    const desired = [{ name: 'Strike', class_id: 'c1' }]; // description omitted

    expect(diffChildRows(existing, desired, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: [] });
  });

  test('unmatched desired item becomes an insert carrying its rowFields', () => {
    const existing = [];
    const desired = [item('Guard', 'c1', 'blocks')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({
      toInsert: [{ name: 'Guard', class_id: 'c1', description: 'blocks' }],
      toUpdate: [],
      toDelete: []
    });
  });

  test('leftover existing rows become deletes (ids only)', () => {
    const existing = [row('r1', 'Strike', 'c1'), row('r2', 'Guard', 'c1')];
    const desired = [item('Strike', 'c1')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: ['r2'] });
  });

  test('duplicate keys: two desired, one existing -> one matched, one inserted', () => {
    const existing = [row('r1', 'Medkit', 'c1')];
    const desired = [item('Medkit', 'c1'), item('Medkit', 'c1')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({
      toInsert: [{ name: 'Medkit', class_id: 'c1', description: null }],
      toUpdate: [],
      toDelete: []
    });
  });

  test('duplicate keys: one desired, two existing -> first kept (FIFO), second deleted', () => {
    const existing = [row('r1', 'Medkit', 'c1'), row('r2', 'Medkit', 'c1')];
    const desired = [item('Medkit', 'c1')];

    expect(diffChildRows(existing, desired, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: ['r2'] });
  });

  test('empty existing (create path) -> pure insert', () => {
    const desired = [item('Strike', 'c1', 'd1'), item('Guard', 'c1', 'd2')];

    expect(diffChildRows([], desired, OPTS)).toEqual({
      toInsert: [
        { name: 'Strike', class_id: 'c1', description: 'd1' },
        { name: 'Guard', class_id: 'c1', description: 'd2' }
      ],
      toUpdate: [],
      toDelete: []
    });
  });

  test('empty desired -> full delete', () => {
    const existing = [row('r1', 'Strike', 'c1'), row('r2', 'Guard', 'c1')];

    expect(diffChildRows(existing, [], OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: ['r1', 'r2'] });
  });

  test('non-array inputs are treated as empty', () => {
    expect(diffChildRows(null, undefined, OPTS)).toEqual({ toInsert: [], toUpdate: [], toDelete: [] });
  });

  test('does not mutate inputs', () => {
    const existing = [row('r1', 'Strike', 'c1', 'old')];
    const desired = [item('Strike', 'c1', 'new'), item('Guard', 'c1')];
    const existingSnap = JSON.parse(JSON.stringify(existing));
    const desiredSnap = JSON.parse(JSON.stringify(desired));

    diffChildRows(existing, desired, OPTS);

    expect(existing).toEqual(existingSnap);
    expect(desired).toEqual(desiredSnap);
  });

  test('update carries all changed fields when multiple differ', () => {
    const opts = {
      keyOf: (r) => `${r.class_id}:${r.name}`,
      rowFields: (it) => ({ name: it.name, class_id: it.class_id, description: it.description ?? null, cooldown: it.cooldown ?? null })
    };
    const existing = [{ id: 'r1', name: 'Strike', class_id: 'c1', description: 'old', cooldown: '1' }];
    const desired = [{ name: 'Strike', class_id: 'c1', description: 'new', cooldown: '2' }];

    expect(diffChildRows(existing, desired, opts)).toEqual({
      toInsert: [],
      toUpdate: [{ id: 'r1', description: 'new', cooldown: '2' }],
      toDelete: []
    });
  });
});

// Current character_perks rows as persisted (compounds_with is a row id or null).
const perkRow = (id, class_ability_id, position, compounds_with = null) =>
  ({ id, class_ability_id, position, compounds_with });
// Desired perks as normalized from the form (compounds_with is a
// 'position-N' sentinel, a row UUID from the agent/API path, or null).
const desiredPerk = (class_ability_id, position, compounds_with = null) =>
  ({ class_ability_id, position, text: 'x', compounds_with });

describe('resolveCompoundLinks', () => {
  test('resolves a position-N sentinel to the peer row id on the same ability', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a1', 1)];
    const desired = [desiredPerk('a1', 0), desiredPerk('a1', 1, 'position-0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p1', compounds_with: 'p0' }]);
  });

  test('keeps a UUID link that references a current row on the same ability', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a1', 1)];
    const desired = [desiredPerk('a1', 0), desiredPerk('a1', 1, 'p0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p1', compounds_with: 'p0' }]);
  });

  test('rejects a UUID link to a row on a different ability (clears stored link)', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a2', 0, 'p0')];
    const desired = [desiredPerk('a1', 0), desiredPerk('a2', 0, 'p0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p1', compounds_with: null }]);
  });

  test('rejects a self-referencing link', () => {
    const rows = [perkRow('p0', 'a1', 0, 'pX')];
    const desired = [desiredPerk('a1', 0, 'position-0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p0', compounds_with: null }]);
  });

  test('clears a stale stored link when the desired perk has none', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a1', 1, 'p0')];
    const desired = [desiredPerk('a1', 0), desiredPerk('a1', 1, null)];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p1', compounds_with: null }]);
  });

  test('emits nothing when the stored link already matches', () => {
    const rows = [perkRow('p0', 'a1', 0), perkRow('p1', 'a1', 1, 'p0')];
    const desired = [desiredPerk('a1', 0), desiredPerk('a1', 1, 'position-0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([]);
  });

  test('skips desired perks with no surviving row', () => {
    const rows = [perkRow('p0', 'a1', 0)];
    const desired = [desiredPerk('a1', 0), desiredPerk('a9', 5, 'position-0')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([]);
  });

  test('unresolvable sentinel clears the stored link', () => {
    const rows = [perkRow('p0', 'a1', 0, 'pX')];
    const desired = [desiredPerk('a1', 0, 'position-7')];

    expect(resolveCompoundLinks(desired, rows)).toEqual([{ id: 'p0', compounds_with: null }]);
  });

  test('non-array inputs are treated as empty', () => {
    expect(resolveCompoundLinks(null, undefined)).toEqual([]);
  });
});
