const { test, expect } = require('bun:test');
const { findItemNameConflicts } = require('./item-uniqueness');

const classRow = (id, name, overrides = {}) => ({
  id,
  name,
  is_public: true,
  base_class_id: null,
  rules_edition: 'advent',
  gear: [],
  abilities: [],
  ...overrides
});

const candidateClass = (overrides = {}) => ({
  id: null,
  is_public: true,
  base_class_id: null,
  rules_edition: 'advent',
  gear: [],
  abilities: [],
  ...overrides
});

test('flags a gear name already defined by a public class in another version family', () => {
  const classRows = [classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver' }] })];
  const candidate = candidateClass({ gear: [{ name: 'Revolver' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([
    { field: 'gear', name: 'Revolver', ownerClassId: 'gs-v1', ownerClassName: 'Gunslinger' }
  ]);
});

test('allows a gear name shared with a same-edition sibling in the same version family', () => {
  const classRows = [
    classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver' }] }),
    classRow('gs-v2', 'Gunslinger v2', { base_class_id: 'gs-v1', gear: [{ name: 'Revolver' }] })
  ];
  const candidate = candidateClass({ id: 'gs-v2', base_class_id: 'gs-v1', gear: [{ name: 'Revolver' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([]);
});

test('allows an update whose gear names collide only with the candidate class itself', () => {
  const classRows = [classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver' }] })];
  const candidate = candidateClass({ id: 'gs-v1', gear: [{ name: 'Revolver' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([]);
});

test('allows a gear name owned only by a non-public class', () => {
  const classRows = [classRow('draft-1', 'Unpublished draft', { is_public: false, gear: [{ name: 'Revolver' }] })];
  const candidate = candidateClass({ gear: [{ name: 'Revolver' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([]);
});

test('allows any colliding gear name when the candidate class is not public', () => {
  const classRows = [classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver' }] })];
  const candidate = candidateClass({ is_public: false, gear: [{ name: 'Revolver' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([]);
});

test('matches item names ignoring surrounding whitespace', () => {
  const classRows = [classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver ' }] })];
  const candidate = candidateClass({ gear: [{ name: '  Revolver' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([
    { field: 'gear', name: 'Revolver', ownerClassId: 'gs-v1', ownerClassName: 'Gunslinger' }
  ]);
});

test('allows a gear name the class already stores, even though another family owns it too', () => {
  const classRows = [
    classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver' }] }),
    classRow('pcc-1', 'Seamus McGlide — Gunslinger (PCC)', { gear: [{ name: 'Revolver' }] })
  ];
  const candidate = candidateClass({ id: 'gs-v1', gear: [{ name: 'Revolver' }] });
  const previous = { gear: [{ name: 'Revolver' }], abilities: [] };

  expect(findItemNameConflicts({ candidate, classRows, previous })).toEqual([]);
});

test('flags only the newly introduced gear name when a colliding name is grandfathered alongside it', () => {
  const classRows = [
    classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver' }] }),
    classRow('pcc-1', 'Seamus McGlide — Gunslinger (PCC)', { gear: [{ name: 'Revolver' }, { name: 'Spyglass' }] })
  ];
  const candidate = candidateClass({ id: 'gs-v1', gear: [{ name: 'Revolver' }, { name: 'Spyglass' }] });
  const previous = { gear: [{ name: 'Revolver' }], abilities: [] };

  expect(findItemNameConflicts({ candidate, classRows, previous })).toEqual([
    { field: 'gear', name: 'Spyglass', ownerClassId: 'pcc-1', ownerClassName: 'Seamus McGlide — Gunslinger (PCC)' }
  ]);
});

test('does not let a name grandfathered in gear excuse the same name newly added under abilities', () => {
  const classRows = [
    classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver' }] }),
    classRow('pcc-1', 'Seamus McGlide — Gunslinger (PCC)', {
      gear: [{ name: 'Revolver' }],
      abilities: [{ name: 'Revolver' }]
    })
  ];
  const candidate = candidateClass({
    id: 'gs-v1',
    gear: [{ name: 'Revolver' }],
    abilities: [{ name: 'Revolver' }]
  });
  const previous = { gear: [{ name: 'Revolver' }], abilities: [] };

  expect(findItemNameConflicts({ candidate, classRows, previous })).toEqual([
    { field: 'abilities', name: 'Revolver', ownerClassId: 'pcc-1', ownerClassName: 'Seamus McGlide — Gunslinger (PCC)' }
  ]);
});

test('flags an ability name conflict independently of gear names', () => {
  const classRows = [classRow('bucc', 'Buccaneer', {
    gear: [{ name: 'Spyglass' }],
    abilities: [{ name: 'Dead Reckoning' }]
  })];
  const candidate = candidateClass({
    gear: [{ name: 'Cutlass' }],
    abilities: [{ name: 'Dead Reckoning' }]
  });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([
    { field: 'abilities', name: 'Dead Reckoning', ownerClassId: 'bucc', ownerClassName: 'Buccaneer' }
  ]);
});
