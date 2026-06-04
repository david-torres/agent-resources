const { test, expect, describe } = require('bun:test');
const { computeVersionFamily, expandIdsToFamilies } = require('./class-family');

// Minimal class row shape used by the family resolver.
const cls = (id, base = null, edition = 'advent') => ({
  id,
  base_class_id: base,
  rules_edition: edition
});

describe('computeVersionFamily', () => {
  test('v1 and its same-edition v2 fork form one family (walk down)', () => {
    const classes = [cls('v1'), cls('v2', 'v1')];
    expect(computeVersionFamily(classes, 'v1')).toEqual(new Set(['v1', 'v2']));
  });

  test('v2 fork reaches its v1 base (walk up)', () => {
    const classes = [cls('v1'), cls('v2', 'v1')];
    expect(computeVersionFamily(classes, 'v2')).toEqual(new Set(['v1', 'v2']));
  });

  test('deep chains are fully connected: v1 -> v2 -> v3', () => {
    const classes = [cls('v1'), cls('v2', 'v1'), cls('v3', 'v2')];
    expect(computeVersionFamily(classes, 'v3')).toEqual(new Set(['v1', 'v2', 'v3']));
    expect(computeVersionFamily(classes, 'v1')).toEqual(new Set(['v1', 'v2', 'v3']));
  });

  test('edition forks are excluded: advent family does not include aspirant fork', () => {
    const classes = [
      cls('adv-v1'),
      cls('adv-v2', 'adv-v1'),
      cls('asp-v1', 'adv-v1', 'aspirant')
    ];
    expect(computeVersionFamily(classes, 'adv-v1')).toEqual(new Set(['adv-v1', 'adv-v2']));
  });

  test('aspirant sub-family is its own component (chain stops at the edition change)', () => {
    const classes = [
      cls('adv-v1'),
      cls('asp-v1', 'adv-v1', 'aspirant'),
      cls('asp-v2', 'asp-v1', 'aspirant')
    ];
    expect(computeVersionFamily(classes, 'asp-v1')).toEqual(new Set(['asp-v1', 'asp-v2']));
    expect(computeVersionFamily(classes, 'asp-v2')).toEqual(new Set(['asp-v1', 'asp-v2']));
    // And from the advent side, neither aspirant class joins.
    expect(computeVersionFamily(classes, 'adv-v1')).toEqual(new Set(['adv-v1']));
  });

  test('cycle in base_class_id links terminates', () => {
    const classes = [cls('a', 'b'), cls('b', 'a')];
    expect(computeVersionFamily(classes, 'a')).toEqual(new Set(['a', 'b']));
  });

  test('unknown class id yields a singleton family', () => {
    expect(computeVersionFamily([cls('v1')], 'nope')).toEqual(new Set(['nope']));
  });

  test('class with no links yields a singleton family', () => {
    const classes = [cls('solo'), cls('other')];
    expect(computeVersionFamily(classes, 'solo')).toEqual(new Set(['solo']));
  });

  test('base pointing at a missing class is ignored', () => {
    const classes = [cls('v2', 'deleted-id')];
    expect(computeVersionFamily(classes, 'v2')).toEqual(new Set(['v2']));
  });
});

describe('expandIdsToFamilies', () => {
  test('expands each unlocked id to its whole family', () => {
    const classes = [
      cls('lib-v1'), cls('lib-v2', 'lib-v1'),
      cls('gun-v1'), cls('gun-v2', 'gun-v1'),
      cls('thane-v1')
    ];
    const expanded = expandIdsToFamilies(classes, new Set(['lib-v1', 'thane-v1']));
    expect(expanded).toEqual(new Set(['lib-v1', 'lib-v2', 'thane-v1']));
  });

  test('does not cross editions when expanding', () => {
    const classes = [
      cls('adv-v1'),
      cls('adv-v2', 'adv-v1'),
      cls('asp-v1', 'adv-v1', 'aspirant')
    ];
    const expanded = expandIdsToFamilies(classes, new Set(['adv-v1']));
    expect(expanded).toEqual(new Set(['adv-v1', 'adv-v2']));
  });

  test('empty input set stays empty', () => {
    expect(expandIdsToFamilies([cls('a')], new Set())).toEqual(new Set());
  });
});
