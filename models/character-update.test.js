const { mock, test, expect, afterAll, beforeEach } = require('bun:test');

// Capture real `_base` so we can restore it after this file finishes —
// otherwise the mock leaks into later test files (see character.test.js).
const realBase = require('./_base');

// In-memory row stores. Tests mutate these arrays directly to control what
// each fake client "sees" — this models RLS: the anon `characters` array
// holds only rows where `is_public = true`; the admin store has everything.
const anonTables = {
  characters: [],
  traits: [],
  class_gear: [],
  class_abilities: [],
  classes: []
};
const adminTables = {
  characters: [],
  traits: [],
  class_gear: [],
  class_abilities: [],
  classes: []
};

// Build a tiny chainable PostgREST-shaped fake. Reads return whatever the
// store currently holds. `update()` mutates matching rows (filtered by the
// `eq()` predicates queued before it). `delete()` removes them. `insert()`
// appends. `.single()` reproduces PostgREST's PGRST116 error when the
// (filtered) result set has 0 rows or 2+ rows — which is the exact failure
// mode this regression is about.
const makeClient = (tables) => ({
  from(table) {
    const filters = [];
    let writeKind = null;
    let writePayload = null;

    const applyFilters = (rows) => rows.filter(r => filters.every(([col, val]) => r[col] === val));

    const settleRead = () => ({ data: applyFilters(tables[table] ?? []), error: null });

    const settleWrite = () => {
      const all = tables[table] ?? [];
      if (writeKind === 'update') {
        const updated = [];
        tables[table] = all.map(r => {
          if (filters.every(([c, v]) => r[c] === v)) {
            const next = { ...r, ...writePayload };
            updated.push(next);
            return next;
          }
          return r;
        });
        return { data: updated, error: null };
      }
      if (writeKind === 'delete') {
        const kept = [];
        const removed = [];
        for (const r of all) {
          if (filters.every(([c, v]) => r[c] === v)) removed.push(r);
          else kept.push(r);
        }
        tables[table] = kept;
        return { data: removed, error: null };
      }
      if (writeKind === 'insert') {
        const rows = Array.isArray(writePayload) ? writePayload : [writePayload];
        tables[table] = [...all, ...rows];
        return { data: rows, error: null };
      }
      return settleRead();
    };

    const settle = () => (writeKind ? settleWrite() : settleRead());

    const chain = {
      select() { return chain; },
      eq(col, val) { filters.push([col, val]); return chain; },
      in(col, vals) {
        filters.push([col, vals]);
        return Promise.resolve({
          data: (tables[table] ?? []).filter(r => vals.includes(r[col])),
          error: null
        });
      },
      order() { return chain; },
      limit() { return chain; },
      update(payload) { writeKind = 'update'; writePayload = payload; return chain; },
      insert(payload) { writeKind = 'insert'; writePayload = payload; return chain; },
      delete() { writeKind = 'delete'; return chain; },
      single() {
        const { data } = settle();
        const rows = Array.isArray(data) ? data : (data == null ? [] : [data]);
        if (rows.length === 0 || rows.length > 1) {
          return Promise.resolve({
            data: null,
            error: {
              code: 'PGRST116',
              message: 'JSON object requested, multiple (or no) rows returned',
              details: `The result contains ${rows.length} rows`
            }
          });
        }
        return Promise.resolve({ data: rows[0], error: null });
      },
      maybeSingle() {
        const { data } = settle();
        const row = Array.isArray(data) ? (data[0] ?? null) : data;
        return Promise.resolve({ data: row, error: null });
      },
      then(onF, onR) { return Promise.resolve(settle()).then(onF, onR); }
    };
    return chain;
  }
});

const fakeAnon = makeClient(anonTables);
const fakeAdmin = makeClient(adminTables);

mock.module('./_base', () => ({
  supabase: fakeAnon,
  supabaseAdmin: fakeAdmin,
  anonKey: 'test-anon-key',
  createUserClient: () => fakeAnon
}));

// character.js captures `supabase` / `supabaseAdmin` at module-load time, and
// an earlier test file may have already loaded it with real `_base`. Bust the
// cache so this require re-executes with the mocked exports in place.
delete require.cache[require.resolve('./character')];
const { updateCharacter } = require('./character');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./character')];
});

const PRIVATE_CHARACTER = {
  id: 'char-private-1',
  creator_id: 'profile-1',
  name: 'Private Pete',
  class_id: 'class-soldier',
  class: 'Soldier',
  level: 1,
  is_public: false,
  is_deceased: false,
  hide_from_search: false,
  common_items: []
};

beforeEach(() => {
  // Reset stores. Critically: a *private* character lives in admin only —
  // anon's RLS would hide it. This is the exact state that triggers the bug.
  anonTables.characters = [];
  anonTables.traits = [];
  anonTables.class_gear = [];
  anonTables.class_abilities = [];
  anonTables.classes = [];

  adminTables.characters = [{ ...PRIVATE_CHARACTER }];
  adminTables.traits = [];
  adminTables.class_gear = [];
  adminTables.class_abilities = [];
  adminTables.classes = [{ id: 'class-soldier', name: 'Soldier' }];
});

test('updateCharacter can flip is_public on a private character (regression)', async () => {
  const { data, error } = await updateCharacter(
    'char-private-1',
    { is_public: 'on' },
    { id: 'profile-1' }
  );

  // Before the fix this returns PostgREST PGRST116 because the ownership
  // probe inside updateCharacter reads through the anon client, which can't
  // see private rows under RLS.
  expect(error).toBeFalsy();
  expect(data).toBeTruthy();
  expect(data.is_public).toBe(true);
});

test('updateCharacter still rejects edits from non-owners on a private character', async () => {
  const { data, error } = await updateCharacter(
    'char-private-1',
    { is_public: 'on' },
    { id: 'someone-else' }
  );

  expect(error).toBe('Unauthorized');
  expect(data).toBeNull();
  // The row must not have been flipped.
  expect(adminTables.characters[0].is_public).toBe(false);
});
