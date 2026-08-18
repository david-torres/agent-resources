const { test, expect, describe } = require('bun:test');
const { coreClassIdsForEditions } = require('./book-classes');
const { CORE_CLASS_UNLOCKS } = require('./starter-content');

const adventIds = Object.values(CORE_CLASS_UNLOCKS.advent);
const aspirantIds = Object.values(CORE_CLASS_UNLOCKS.aspirant);

describe('coreClassIdsForEditions', () => {
  test('no editions yields no ids', () => {
    expect(coreClassIdsForEditions([])).toEqual(new Set());
  });

  test('advent yields exactly the advent core roster', () => {
    expect(coreClassIdsForEditions(['advent'])).toEqual(new Set(adventIds));
  });

  test('aspirant yields exactly the aspirant core roster', () => {
    expect(coreClassIdsForEditions(['aspirant'])).toEqual(new Set(aspirantIds));
  });

  test('both editions union their rosters', () => {
    expect(coreClassIdsForEditions(['advent', 'aspirant']))
      .toEqual(new Set([...adventIds, ...aspirantIds]));
  });

  test('an unknown ruleset contributes nothing rather than throwing', () => {
    expect(coreClassIdsForEditions(['zeitgeist'])).toEqual(new Set());
    expect(coreClassIdsForEditions(['advent', 'zeitgeist'])).toEqual(new Set(adventIds));
  });

  test('a repeated ruleset does not duplicate ids', () => {
    expect(coreClassIdsForEditions(['advent', 'advent'])).toEqual(new Set(adventIds));
  });

  test('a Set is accepted as well as an array', () => {
    expect(coreClassIdsForEditions(new Set(['advent']))).toEqual(new Set(adventIds));
  });

  test('null or undefined input yields no ids', () => {
    expect(coreClassIdsForEditions(null)).toEqual(new Set());
    expect(coreClassIdsForEditions(undefined)).toEqual(new Set());
  });
});

describe('CORE_CLASS_UNLOCKS', () => {
  test('each ruleset has six classes and no id is shared across rulesets', () => {
    expect(adventIds.length).toBe(6);
    expect(aspirantIds.length).toBe(6);
    expect(new Set([...adventIds, ...aspirantIds]).size).toBe(12);
  });
});
