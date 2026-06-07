const { test, expect, describe } = require('bun:test');
const { diffChildRows } = require('./reconcile');

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
});
