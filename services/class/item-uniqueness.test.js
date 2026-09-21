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

// Advanced Abilities are authored into their own column (classes.advanced_
// abilities) and share the Ability name space with Core ones. The Perk economy
// prices a submitted ability by resolving its type from its NAME, and Core vs
// Advanced is the 1-vs-2 Perk difference (util/perk-economy.js), so a name that
// is Core for one class and Advanced for another has no single price.
test('flags an advanced ability name already defined by a public class in another family', () => {
  const classRows = [classRow('th-v1', 'Thane', { advanced_abilities: [{ name: 'Shieldwall' }] })];
  const candidate = candidateClass({ advanced_abilities: [{ name: 'Shieldwall' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([
    { field: 'advanced_abilities', name: 'Shieldwall', ownerClassId: 'th-v1', ownerClassName: 'Thane' }
  ]);
});

test('flags an advanced ability name another family already defines as a core ability', () => {
  const classRows = [classRow('th-v1', 'Thane', { abilities: [{ name: 'Shieldwall' }] })];
  const candidate = candidateClass({ advanced_abilities: [{ name: 'Shieldwall' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([
    { field: 'advanced_abilities', name: 'Shieldwall', ownerClassId: 'th-v1', ownerClassName: 'Thane' }
  ]);
});

test('flags a core ability name another family already defines as an advanced ability', () => {
  const classRows = [classRow('th-v1', 'Thane', { advanced_abilities: [{ name: 'To Arms' }] })];
  const candidate = candidateClass({ abilities: [{ name: 'To Arms' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([
    { field: 'abilities', name: 'To Arms', ownerClassId: 'th-v1', ownerClassName: 'Thane' }
  ]);
});

// Gear stays its own name space: a Signature and an Ability may share a name.
test('allows an advanced ability name that only collides with another family\'s gear', () => {
  const classRows = [classRow('gs-v1', 'Gunslinger', { gear: [{ name: 'Revolver' }] })];
  const candidate = candidateClass({ advanced_abilities: [{ name: 'Revolver' }] });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([]);
});

test('allows an advanced ability name shared with a sibling in the same version family', () => {
  const classRows = [
    classRow('gs-v1', 'Gunslinger', { advanced_abilities: [{ name: 'Trickshot' }] }),
    classRow('gs-v2', 'Gunslinger v2', { base_class_id: 'gs-v1', advanced_abilities: [{ name: 'Trickshot' }] })
  ];
  const candidate = candidateClass({
    id: 'gs-v2', base_class_id: 'gs-v1', advanced_abilities: [{ name: 'Trickshot' }]
  });

  expect(findItemNameConflicts({ candidate, classRows })).toEqual([]);
});

// A class may promote a Core Ability to Advanced between versions, so the
// grandfather set has to span the whole Ability name space, not one column.
test('grandfathers an advanced ability the class previously stored as a core ability', () => {
  const classRows = [
    classRow('th-v1', 'Thane', { abilities: [{ name: 'Gairethinx' }] }),
    classRow('gs-v1', 'Gunslinger', { abilities: [{ name: 'Gairethinx' }] })
  ];
  const candidate = candidateClass({ id: 'th-v1', advanced_abilities: [{ name: 'Gairethinx' }] });

  expect(findItemNameConflicts({
    candidate, classRows, previous: { abilities: [{ name: 'Gairethinx' }] }
  })).toEqual([]);
});
