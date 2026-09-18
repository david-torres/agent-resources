const { test, expect } = require('bun:test');
const { classesStub } = require('../test/helpers/classes-family-stub');
const { findUpgradeTargetsFor } = require('./character');

// Three Gunslinger rows as the catalogue actually holds them: the Advent v1
// original, its same-family v2, and the Aspirant V1 fork, which differs on
// both axes (rules_edition AND content_format).
const GUNSLINGER_V1 = {
  id: 'gunslinger-v1',
  name: 'Gunslinger',
  rules_edition: 'advent',
  rules_version: 'v1',
  content_format: 'advent',
  base_class_id: null
};
const GUNSLINGER_V2 = {
  ...GUNSLINGER_V1,
  id: 'gunslinger-v2',
  rules_version: 'v2',
  base_class_id: 'gunslinger-v1'
};
const GUNSLINGER_ASPIRANT_FORK = {
  ...GUNSLINGER_V1,
  id: 'gunslinger-aspirant-v1',
  rules_edition: 'aspirant',
  content_format: 'aspirant',
  base_class_id: 'gunslinger-v1'
};

const targetIdsFor = async (classId, rows) => {
  const targets = await findUpgradeTargetsFor(classId, classesStub(rows));
  return targets.map(t => t.id);
};

test('findUpgradeTargetsFor does not offer a format fork as an upgrade of its parent', async () => {
  expect(await targetIdsFor('gunslinger-v1', [GUNSLINGER_V1, GUNSLINGER_ASPIRANT_FORK])).toEqual([]);
});

test('findUpgradeTargetsFor still offers a same-format v1 -> v2 sibling', async () => {
  expect(await targetIdsFor('gunslinger-v1', [GUNSLINGER_V1, GUNSLINGER_V2]))
    .toEqual(['gunslinger-v2']);
});

test('findUpgradeTargetsFor keeps the in-family sibling and drops the fork from the same parent', async () => {
  expect(await targetIdsFor('gunslinger-v1', [GUNSLINGER_V1, GUNSLINGER_V2, GUNSLINGER_ASPIRANT_FORK]))
    .toEqual(['gunslinger-v2']);
});

// An edition fork whose content shape is unchanged is still a different family:
// the six pre-release Aspirant classes are rules_edition 'aspirant' with
// content_format 'advent', so the two axes genuinely differ per row.
test('findUpgradeTargetsFor does not offer an edition fork that kept its parent format', async () => {
  const editionFork = {
    ...GUNSLINGER_V1,
    id: 'gunslinger-prerelease',
    rules_edition: 'aspirant',
    base_class_id: 'gunslinger-v1'
  };
  expect(await targetIdsFor('gunslinger-v1', [GUNSLINGER_V1, editionFork])).toEqual([]);
});

// Fail closed: with no parent row there is nothing to compare against, so no
// edge counts. Splitting a family beats bridging two on a row we cannot see.
test('findUpgradeTargetsFor offers nothing when the parent row is not readable', async () => {
  expect(await targetIdsFor('gunslinger-v1', [GUNSLINGER_V2])).toEqual([]);
});

test('findUpgradeTargetsFor never offers the character its own class', async () => {
  expect(await targetIdsFor('gunslinger-v1', [GUNSLINGER_V1])).toEqual([]);
});
