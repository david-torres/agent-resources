const { mock, test, expect, describe, afterAll } = require('bun:test');

const realBase = require('./_base');
const realRulesRepo = require('../services/rules/repository');
const realClassRepo = require('../services/class/repository');
const { CORE_CLASS_UNLOCKS } = require('../util/starter-content');

const ADVENT_LIBRARIAN = CORE_CLASS_UNLOCKS.advent.Librarian;
const ASPIRANT_VESSEL = CORE_CLASS_UNLOCKS.aspirant.Vessel;
const LIBRARIAN_V2 = 'librarian-v2-fork';
const PRIVATE_CLASS = 'some-other-class';

// Every class row the family resolver needs to see.
const classFamilyRows = [
  { id: ADVENT_LIBRARIAN, base_class_id: null, rules_edition: 'advent' },
  { id: LIBRARIAN_V2, base_class_id: ADVENT_LIBRARIAN, rules_edition: 'advent' },
  { id: ASPIRANT_VESSEL, base_class_id: null, rules_edition: 'aspirant' },
  { id: PRIVATE_CLASS, base_class_id: null, rules_edition: 'advent' }
];

// Full class rows, keyed by id, for the classRowsByIds hydration read that
// getUnlockedClasses uses once the id set is resolved.
const classRowById = {
  [ADVENT_LIBRARIAN]: { id: ADVENT_LIBRARIAN, name: 'Librarian' },
  [LIBRARIAN_V2]: { id: LIBRARIAN_V2, name: 'Librarian v2' },
  [ASPIRANT_VESSEL]: { id: ASPIRANT_VESSEL, name: 'Vessel' },
  [PRIVATE_CLASS]: { id: PRIVATE_CLASS, name: 'Private Class' }
};

// Rewire the two repositories the resolver reads through. `state` is mutated
// per test to describe what the user owns.
const state = { books: [], directIds: [], familyRows: classFamilyRows, rowsByIdsOptions: null };

mock.module('./_base', () => realBase);
mock.module('../services/rules/repository', () => ({
  ...realRulesRepo,
  fetchActiveBooksForUser: async () => ({ data: state.books, error: null })
}));
mock.module('../services/class/repository', () => ({
  ...realClassRepo,
  fetchClassFamilyRows: async () => state.familyRows,
  unlockedClassIdRows: async () => ({
    data: state.directIds.map(id => ({ class_id: id })),
    error: null
  }),
  classRowsByIds: async (classIds, options) => {
    state.rowsByIdsOptions = options || null;
    return { data: classIds.map(id => classRowById[id]).filter(Boolean), error: null };
  },
  fetchClassByIdAdmin: async (id) => ({
    data: classFamilyRows.find(r => r.id === id) || null,
    error: null
  })
}));

delete require.cache[require.resolve('./class')];
const {
  getEffectiveClassUnlocks,
  getEffectiveClassAccess,
  getUnlockedClasses,
  isClassUnlocked,
  getUnlockedClassIdsForUser,
  canViewClassPdf
} = require('./class');

afterAll(() => {
  mock.module('../services/rules/repository', () => realRulesRepo);
  mock.module('../services/class/repository', () => realClassRepo);
  delete require.cache[require.resolve('./class')];
});

const reset = () => {
  state.books = [];
  state.directIds = [];
  state.familyRows = classFamilyRows;
  state.rowsByIdsOptions = null;
};

test('a free pre-release row is playable without a user or product entitlement', async () => {
  reset();
  state.familyRows = classFamilyRows.map(row =>
    row.id === PRIVATE_CLASS ? { ...row, free_play_access: true } : row);

  const access = await getEffectiveClassUnlocks(null);

  expect(access.ids.has(PRIVATE_CLASS)).toBe(true);
  expect(access.productIds.has(PRIVATE_CLASS)).toBe(false);
  expect(access.sourceById.get(PRIVATE_CLASS)).toEqual({ source: 'free_prerelease' });
});

test('free pre-release access does not spread to another row in its version family', async () => {
  reset();
  state.familyRows = classFamilyRows.map(row =>
    row.id === ADVENT_LIBRARIAN ? { ...row, free_play_access: true } : row);

  const access = await getEffectiveClassUnlocks(null);

  expect(access.ids.has(ADVENT_LIBRARIAN)).toBe(true);
  expect(access.ids.has(LIBRARIAN_V2)).toBe(false);
});

test('free pre-release plaintext does not grant the class PDF', async () => {
  reset();
  state.familyRows = classFamilyRows.map(row =>
    row.id === PRIVATE_CLASS ? { ...row, free_play_access: true } : row);

  expect(await getEffectiveClassAccess('u1', PRIVATE_CLASS)).toEqual({
    data: {
      unlocked: true,
      productUnlocked: false,
      accessSource: 'free_prerelease',
      expiresAt: null
    },
    error: null
  });
  expect(await canViewClassPdf(
    { userId: 'u1' },
    { id: PRIVATE_CLASS, pdf_storage_path: 'classes/private.pdf' }
  )).toEqual({ data: false, error: null });
});

test('a direct unlock still grants product access over the free fallback', async () => {
  reset();
  state.directIds = [PRIVATE_CLASS];
  state.familyRows = classFamilyRows.map(row =>
    row.id === PRIVATE_CLASS ? { ...row, free_play_access: true } : row);

  const { data } = await getEffectiveClassAccess('u1', PRIVATE_CLASS);

  expect(data.productUnlocked).toBe(true);
  expect(data.accessSource).toBe('direct');
});

describe('book-derived class unlocks', () => {
  test('an Advent book unlocks an Advent core class with no direct unlock', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    expect(await isClassUnlocked('u1', ADVENT_LIBRARIAN)).toEqual({ data: true, error: null });
  });

  test('an Advent book covers the v2 fork of a core class', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    expect(await isClassUnlocked('u1', LIBRARIAN_V2)).toEqual({ data: true, error: null });
  });

  test('an Advent book does not unlock an Aspirant core class', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    expect(await isClassUnlocked('u1', ASPIRANT_VESSEL)).toEqual({ data: false, error: null });
  });

  test('no book and no direct unlock leaves the class locked', async () => {
    reset();

    expect(await isClassUnlocked('u1', ADVENT_LIBRARIAN)).toEqual({ data: false, error: null });
  });

  test('a direct unlock still resolves when the user holds no book', async () => {
    reset();
    state.directIds = [PRIVATE_CLASS];

    expect(await isClassUnlocked('u1', PRIVATE_CLASS)).toEqual({ data: true, error: null });
  });

  test('getUnlockedClassIdsForUser unions direct and book-derived ids', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.directIds = [PRIVATE_CLASS];

    const { data } = await getUnlockedClassIdsForUser('u1');

    expect(data.has(PRIVATE_CLASS)).toBe(true);
    expect(data.has(ADVENT_LIBRARIAN)).toBe(true);
    expect(data.has(LIBRARIAN_V2)).toBe(true);
    expect(data.has(ASPIRANT_VESSEL)).toBe(false);
  });

  test('sources tag direct unlocks as direct and book grants with the title', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.directIds = [PRIVATE_CLASS];

    const { sourceById } = await getEffectiveClassUnlocks('u1');

    expect(sourceById.get(PRIVATE_CLASS)).toEqual({ source: 'direct' });
    expect(sourceById.get(ADVENT_LIBRARIAN)).toEqual({ source: 'book', title: 'Enclave: Advent' });
  });

  test('a class held both directly and via a book tags as direct', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.directIds = [ADVENT_LIBRARIAN];

    const { sourceById } = await getEffectiveClassUnlocks('u1');

    expect(sourceById.get(ADVENT_LIBRARIAN)).toEqual({ source: 'direct' });
  });

  test('getUnlockedClasses surfaces the book title on a book-derived row', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    const { data, error } = await getUnlockedClasses('u1');

    expect(error).toBeNull();
    const librarian = data.find(cls => cls.id === ADVENT_LIBRARIAN);
    expect(librarian).toMatchObject({
      unlock_source: 'book',
      unlock_book_title: 'Enclave: Advent'
    });
  });

  test('getUnlockedClasses tags a fork of a book-granted class as book, not direct', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    const { data, error } = await getUnlockedClasses('u1');

    expect(error).toBeNull();
    const fork = data.find(cls => cls.id === LIBRARIAN_V2);
    expect(fork).toMatchObject({
      unlock_source: 'book',
      unlock_book_title: 'Enclave: Advent'
    });
  });

  // The hydration read filters family-expanded ids down to what the user can
  // actually open (services/class/repository.js#classRowsByIds), so it needs
  // to know which ids came from an explicit class_unlocks row: those were
  // listed before book grants existed and stay listed, private or not.
  test('getUnlockedClasses exempts the raw direct-unlock ids from the visibility filter', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.directIds = [PRIVATE_CLASS];

    await getUnlockedClasses('u1');

    expect(state.rowsByIdsOptions.alwaysVisibleIds).toEqual([PRIVATE_CLASS]);
  });

  // Raw, not expanded: an unpublished fork of a directly-unlocked class is
  // reached by expansion, not held, so it gets no exemption.
  test('the exemption set is the raw direct ids, not their expanded families', async () => {
    reset();
    state.directIds = [ADVENT_LIBRARIAN];

    const { ids } = await getEffectiveClassUnlocks('u1');
    await getUnlockedClasses('u1');

    expect(ids.has(LIBRARIAN_V2)).toBe(true);
    expect(state.rowsByIdsOptions.alwaysVisibleIds).toEqual([ADVENT_LIBRARIAN]);
  });

  test('a failed book lookup degrades to direct unlocks rather than erroring', async () => {
    reset();
    state.books = null; // repository signals failure with null
    state.directIds = [PRIVATE_CLASS];

    const { data } = await getUnlockedClassIdsForUser('u1');

    expect(data.has(PRIVATE_CLASS)).toBe(true);
    expect(data.has(ADVENT_LIBRARIAN)).toBe(false);
  });

  test('a failed class projection still returns unexpanded ids', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];
    state.familyRows = null;

    const { data } = await getUnlockedClassIdsForUser('u1');

    expect(data.has(ADVENT_LIBRARIAN)).toBe(true);
    expect(data.has(LIBRARIAN_V2)).toBe(false);
  });

  // Two core books of the same edition (unique on (edition, title)) can both
  // be held at once. The badge must name a book whose grant expiry matches
  // the class's effective (least-restrictive) expiry, regardless of the
  // order the repository happens to return the rows in.
  test('badge names the least-restrictive book deterministically across row orders', async () => {
    reset();
    const expiring = {
      rules_edition: 'advent',
      title: 'Enclave: Advent',
      expires_at: '2026-09-01T00:00:00.000Z'
    };
    const permanent = {
      rules_edition: 'advent',
      title: 'Enclave: Advent v2',
      expires_at: null
    };

    state.books = [expiring, permanent];
    const first = await getEffectiveClassUnlocks('u1');
    expect(first.sourceById.get(ADVENT_LIBRARIAN)).toEqual({ source: 'book', title: 'Enclave: Advent v2' });
    expect(first.expiryById.get(ADVENT_LIBRARIAN)).toBeNull();

    state.books = [permanent, expiring];
    const reversed = await getEffectiveClassUnlocks('u1');
    expect(reversed.sourceById.get(ADVENT_LIBRARIAN)).toEqual({ source: 'book', title: 'Enclave: Advent v2' });
    expect(reversed.expiryById.get(ADVENT_LIBRARIAN)).toBeNull();
  });

  test('no user id yields no unlocks', async () => {
    reset();
    state.books = [{ rules_edition: 'advent', title: 'Enclave: Advent' }];

    const { data } = await getUnlockedClassIdsForUser(null);

    expect(data).toEqual(new Set());
  });
});
