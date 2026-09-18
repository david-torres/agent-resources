const { test, expect, describe } = require('bun:test');
const { coreClassIdsForEditions } = require('./book-classes');
const { CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS } = require('./starter-content');
const { aspirantPreviewClassList } = require('./enclave-consts');

const adventIds = Object.values(CORE_CLASS_UNLOCKS.advent).flat();
const aspirantIds = Object.values(CORE_CLASS_UNLOCKS.aspirant).flat();

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

  // Pins the flattening: a name can carry more than one id, and dropping the
  // flatten collects twelve arrays instead of eighteen ids.
  test('a book grants every id under every name of its roster', () => {
    const ids = coreClassIdsForEditions(['aspirant']);
    expect(ids.size).toBe(18);
    for (const id of ids) expect(typeof id).toBe('string');
  });
});

describe('CORE_CLASS_UNLOCKS', () => {
  test('every roster value is a list of ids, in both editions', () => {
    for (const roster of Object.values(CORE_CLASS_UNLOCKS)) {
      for (const ids of Object.values(roster)) {
        expect(Array.isArray(ids)).toBe(true);
        expect(ids.every((id) => typeof id === 'string')).toBe(true);
      }
    }
  });

  test('the Aspirant roster grants all twelve V1 classes and keeps the pre-release six', () => {
    const granted = Object.values(CORE_CLASS_UNLOCKS.aspirant).flat();
    expect(granted).toHaveLength(18);
    for (const id of Object.values(ASPIRANT_V1_CLASS_IDS)) expect(granted).toContain(id);
  });

  test('Advent grants six ids under six names, Aspirant eighteen under twelve', () => {
    expect(Object.keys(CORE_CLASS_UNLOCKS.advent)).toHaveLength(6);
    expect(adventIds).toHaveLength(6);
    expect(Object.keys(CORE_CLASS_UNLOCKS.aspirant)).toHaveLength(12);
    expect(aspirantIds).toHaveLength(18);
  });

  test('the twelve V1 ids are distinct and collide with no pre-existing roster id', () => {
    const v1 = Object.values(ASPIRANT_V1_CLASS_IDS);
    expect(new Set(v1).size).toBe(12);
    const advent = Object.values(CORE_CLASS_UNLOCKS.advent).flat();
    for (const id of v1) expect(advent).not.toContain(id);
    // Also covers the six pre-release Aspirant ids, which share the roster
    // with the V1 ids and so cannot be asserted absent from it: 6 + 6 + 12
    // distinct ids only add up when no id is reused anywhere.
    expect(new Set([...adventIds, ...aspirantIds]).size).toBe(24);
  });

  // util/seed-classes.js takes roster[name][0], so the order inside a value is
  // a contract: swapping a pair would hand the pre-release row its fork's id.
  // The six paired names are the six the seed builds as aspirant rows, so the
  // pairing is checked against that list rather than a pasted copy of it.
  test('a name carrying two ids lists the pre-release id first and the V1 fork second', () => {
    const v1Ids = new Set(Object.values(ASPIRANT_V1_CLASS_IDS));
    const entries = Object.entries(CORE_CLASS_UNLOCKS.aspirant);

    const paired = entries.filter(([, ids]) => ids.length > 1);
    expect(paired.map(([name]) => name).sort()).toEqual([...aspirantPreviewClassList].sort());
    for (const [name, ids] of paired) {
      expect(ids).toHaveLength(2);
      expect(v1Ids.has(ids[0])).toBe(false);
      expect(ids[1]).toBe(ASPIRANT_V1_CLASS_IDS[name]);
    }

    const solo = entries.filter(([, ids]) => ids.length === 1);
    expect(solo).toHaveLength(6);
    for (const [name, ids] of solo) expect(ids[0]).toBe(ASPIRANT_V1_CLASS_IDS[name]);
  });
});
