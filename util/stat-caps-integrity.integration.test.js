// util/stat-caps-integrity.integration.test.js
//
// traits_stat_known (supabase/migrations/20260919000000_traits_stat_affiliation.sql)
// restricts traits.stat to the twelve stat names, or NULL while the column is
// still nullable. This pins that constraint by attempting real writes and
// asserting on the error, not by reading the DDL.
//
// It mutates existing rows rather than inserting/deleting a fixture: a fixture
// character needs an auth.users row and a profile
// (models/character-atomic.integration.test.js), which is more setup than a
// CHECK constraint needs.
//
// Most of the writes here are reject-only -- the constraint refuses them, so
// nothing lands and nothing needs undoing. That is the pattern
// util/character-equipment.integration.test.js relies on, and its safety claim
// ("the test changes no data, which is what makes it safe against a restored
// production copy") holds only for writes that do not land. It is NOT a
// justification for the accepted-shape writes below, which really do land: a
// stat onto a live trait row, three purchase maps and 9999 into a live
// character's vitality, plus one real save_character_atomic call. Each of those
// restores the row inside a `finally`, so no throw between the write and the end
// of the test can leave a row of the restored production copy altered; afterAll
// restores again and asserts the row counts.
//
// Requires the local Supabase stack: SUPABASE_URL=http://127.0.0.1:54321
require('./require-local-supabase');

const { test, expect, afterAll } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');
const { statList } = require('./enclave-consts');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Runs `body`, then puts `values` back on the row whether body returned or
// threw. A failed restore is reported rather than thrown: rethrowing from a
// `finally` would replace body's own failure, and the afterAll hooks below
// re-restore and assert the row counts, so the real problem still surfaces.
const restoring = async (table, id, values, body) => {
  try {
    await body();
  } finally {
    const { error } = await sb.from(table).update(values).eq('id', id);
    if (error) {
      console.error(`stat-caps-integrity: FAILED to restore ${table} ${id}: ${error.message}`);
    }
  }
};

let fixtureId;
let fixtureOriginalStat;

const fixtureRow = async () => {
  if (fixtureId) return fixtureId;
  const { data, error } = await sb.from('traits').select('id,stat').order('id').limit(1);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  fixtureId = data[0].id;
  fixtureOriginalStat = data[0].stat;
  return fixtureId;
};

afterAll(async () => {
  if (fixtureId) {
    const { error } = await sb.from('traits').update({ stat: fixtureOriginalStat }).eq('id', fixtureId);
    expect(error).toBeNull();
  }
  const { count, error: countError } = await sb.from('traits').select('id', { count: 'exact', head: true });
  expect(countError).toBeNull();
  expect(count).toBe(981);
});

test('a stat outside the twelve names is rejected', async () => {
  const id = await fixtureRow();
  const { error } = await sb.from('traits').update({ stat: 'nonsense' }).eq('id', id);
  // 23514 is check_violation. Asserting the code, not just truthiness, keeps a
  // missing constraint from standing in for a working one.
  expect(error?.code).toBe('23514');
});

// traits.stat is NOT NULL as of supabase/migrations/20260919000003_stat_
// floor_and_trait_stat_notnull.sql, which completes the nullable-now/NOT-
// NULL-later split described in 20260919000000's header now that every write
// path supplies a value. Flipped from "accepted" (Task 2) to "rejected".
test('a null stat is rejected', async () => {
  const id = await fixtureRow();
  const { error } = await sb.from('traits').update({ stat: null }).eq('id', id);
  // 23502 is not_null_violation.
  expect(error?.code).toBe('23502');
});

test.each(statList)('%s is an accepted stat', async (stat) => {
  const id = await fixtureRow();
  await restoring('traits', id, { stat: fixtureOriginalStat }, async () => {
    const { error } = await sb.from('traits').update({ stat }).eq('id', id);
    expect(error).toBeNull();
  });
});

// public.save_character_atomic (supabase/migrations/
// 20260919000002_save_character_atomic_trait_stat.sql) is what every real
// save actually runs (services/character/repository.js wires it whenever
// supabaseAdmin.rpc exists), so this pins the RPC itself, not just the JS
// reconciler it can fall back to. It reuses one existing character's traits
// rather than a fresh fixture, for the same reason the CHECK-constraint tests
// above do -- and picks the LAST trait row (descending id) rather than the
// FIRST, so it never contends with fixtureRow()'s own mutate/restore above.
// Every one of the character's existing traits is resubmitted unchanged
// except the target's stat, because save_character_atomic deletes any of the
// character's stored traits missing from p_traits entirely.

let rpcCharacterId;
let rpcCreatorId;
let rpcOriginalTraits;

const rpcFixtureCharacter = async () => {
  if (rpcCharacterId) return rpcCharacterId;
  const { data: last, error } = await sb.from('traits').select('id,character_id').order('id', { ascending: false }).limit(1);
  expect(error).toBeNull();
  expect(last).toHaveLength(1);
  rpcCharacterId = last[0].character_id;

  const { data: character, error: characterError } = await sb.from('characters')
    .select('id,creator_id').eq('id', rpcCharacterId).single();
  expect(characterError).toBeNull();
  rpcCreatorId = character.creator_id;

  const { data: traits, error: traitsError } = await sb.from('traits')
    .select('id,name,stat').eq('character_id', rpcCharacterId).order('id');
  expect(traitsError).toBeNull();
  rpcOriginalTraits = traits;
  return rpcCharacterId;
};

// Puts every one of the character's trait stats back. Reports rather than
// throws, because it is also called from the test's own `finally`, where a throw
// would replace the failure that sent it there. afterAll is what asserts.
const restoreRpcTraits = async () => {
  for (const row of rpcOriginalTraits || []) {
    const { error } = await sb.from('traits').update({ stat: row.stat }).eq('id', row.id);
    if (error) {
      console.error(`stat-caps-integrity: FAILED to restore traits ${row.id}: ${error.message}`);
    }
  }
};

afterAll(async () => {
  await restoreRpcTraits();

  // Read the rows back and assert each stat, rather than asserting the update
  // calls reported no error. The row count cannot see a wrong stat at all, and
  // an update that matched no row reports no error either -- which is exactly
  // what a save_character_atomic that recreated these rows under new ids would
  // look like. Asserting the stored value is the only check that fails loudly
  // for both.
  if (rpcOriginalTraits) {
    const { data: restored, error: readError } = await sb.from('traits')
      .select('id,stat').eq('character_id', rpcCharacterId).order('id');
    expect(readError).toBeNull();
    expect(restored.map(row => [row.id, row.stat]))
      .toEqual(rpcOriginalTraits.map(row => [row.id, row.stat]));
  }

  const { count, error: countError } = await sb.from('traits').select('id', { count: 'exact', head: true });
  expect(countError).toBeNull();
  expect(count).toBe(981);
});

test('save_character_atomic persists a trait\'s stat', async () => {
  const characterId = await rpcFixtureCharacter();
  const target = rpcOriginalTraits[0];
  const testStat = statList.find(stat => stat !== target.stat);

  const payload = rpcOriginalTraits.map(row => ({
    name: row.name,
    stat: row.id === target.id ? testStat : row.stat
  }));

  // This write lands, and it lands through the RPC across every one of the
  // character's trait rows, so the whole set is put back in the `finally` --
  // not just the target's stat.
  try {
    // p_character: {} keeps every stored character field as-is (jsonb_populate_
    // record falls back to the current row for any key it omits); p_gear/
    // p_abilities/p_perks: null skip those blocks entirely, matching
    // rpcSaveGear's isolation approach in models/character-atomic.integration.
    // test.js.
    const { error } = await sb.rpc('save_character_atomic', {
      p_character_id: characterId,
      p_creator_id: rpcCreatorId,
      p_character: {},
      p_traits: payload,
      p_gear: null,
      p_abilities: null,
      p_perks: null
    });
    expect(error).toBeNull();

    const { data: rows, error: readError } = await sb.from('traits')
      .select('id,stat').eq('character_id', characterId).order('id');
    expect(readError).toBeNull();
    expect(rows).toHaveLength(rpcOriginalTraits.length);
    expect(rows.find(row => row.id === target.id).stat).toBe(testStat);
  } finally {
    await restoreRpcTraits();
  }
});

// characters_stat_cap_purchase_keys / characters_stat_cap_purchase_values
// (supabase/migrations/20260919000001_characters_stat_cap_purchases.sql)
// restrict stat_cap_purchases to the twelve stat names with non-negative
// integer values. This pins both constraints by attempting real writes and
// asserting on the error, exactly as the traits.stat tests above do -- same
// file, same house pattern, one existing character row mutated and restored
// in afterAll rather than a fresh auth.users/profiles/characters fixture.
//
// `{"might": null}` is included deliberately: a CHECK that evaluates to SQL
// NULL passes rather than fails, which is how {} and {"name":"Foo"} became
// storable as a free class_gear Enchantment
// (supabase/migrations/20260918000000_class_gear_enchantment_mods.sql,
// fixed in 20260918000002_class_gear_enchantment_source_notnull.sql). This
// column's constraints use jsonb_typeof(value), which reports JSON null as
// the string 'null' rather than as SQL NULL, so the comparison stays a
// boolean and the same trap does not reappear here -- but that reasoning is
// only as good as this test proving it out.

let characterFixtureId;
let characterFixtureOriginalPurchases;

const fixtureCharacterRow = async () => {
  if (characterFixtureId) return characterFixtureId;
  const { data, error } = await sb.from('characters').select('id,stat_cap_purchases').limit(1);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  characterFixtureId = data[0].id;
  characterFixtureOriginalPurchases = data[0].stat_cap_purchases;
  return characterFixtureId;
};

afterAll(async () => {
  if (characterFixtureId) {
    const { error } = await sb.from('characters')
      .update({ stat_cap_purchases: characterFixtureOriginalPurchases })
      .eq('id', characterFixtureId);
    expect(error).toBeNull();
  }
  const { count, error: countError } = await sb.from('characters').select('id', { count: 'exact', head: true });
  expect(countError).toBeNull();
  expect(count).toBe(327);
});

test.each([
  ['an unknown key', { nonsense: 1 }],
  ['a negative value', { might: -1 }],
  ['a non-integer value', { might: 1.5 }],
  ['a non-number value', { might: 'two' }],
  ['a JSON null value', { might: null }],
  // An ARRAY wrapping a legal value. The values CHECK's JSONPath was LAX, and
  // lax mode unwraps an array before applying a filter predicate, so the array
  // itself was never tested and `{"might": [1]}` was storable. Fixed by
  // 20260919000004_stat_cap_purchase_values_strict.sql.
  ['an array value', { might: [1] }],
  // A top-level non-object. Strict mode RAISES on `$.*` over a non-object
  // rather than returning false, so 20260919000004 guards the wildcard behind a
  // CASE on jsonb_typeof -- this asserts that a non-object is still an ordinary
  // check_violation (from characters_stat_cap_purchase_keys) and not a jsonpath
  // error.
  ['a top-level array', [1]]
])('stat_cap_purchases rejects %s', async (_label, shape) => {
  const id = await fixtureCharacterRow();
  const { error } = await sb.from('characters').update({ stat_cap_purchases: shape }).eq('id', id);
  // 23514 is check_violation. Asserting the code, not just truthiness, keeps a
  // missing constraint from standing in for a working one.
  expect(error?.code).toBe('23514');
});

test.each([
  ['an empty object', {}],
  ['a single known stat', { might: 1 }],
  ['two known stats', { might: 2, luck: 3 }]
])('stat_cap_purchases accepts %s', async (_label, shape) => {
  const id = await fixtureCharacterRow();
  await restoring('characters', id, { stat_cap_purchases: characterFixtureOriginalPurchases }, async () => {
    const { error } = await sb.from('characters').update({ stat_cap_purchases: shape }).eq('id', id);
    expect(error).toBeNull();
  });
});

// The twelve `<stat> >= 0` CHECK constraints (supabase/migrations/
// 20260919000003_stat_floor_and_trait_stat_notnull.sql). Reuses the same
// character-fixture pattern as stat_cap_purchases above -- one existing row
// mutated and restored in afterAll -- and pins both the floor and the
// deliberate absence of a ceiling: ENCLAVE: Aspirant pg. 3's "Scaling Beyond"
// sidebar states there is no theoretical maximum, and the real Cap is derived
// per stat from Traits and purchases, which a per-column CHECK cannot see.
// The application refuses an illegal value; the column does not.

let statColumnFixtureId;
let statColumnFixtureOriginalVitality;

const statColumnFixtureRow = async () => {
  if (statColumnFixtureId) return statColumnFixtureId;
  const { data, error } = await sb.from('characters').select('id,vitality').order('id').limit(1);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  statColumnFixtureId = data[0].id;
  statColumnFixtureOriginalVitality = data[0].vitality;
  return statColumnFixtureId;
};

afterAll(async () => {
  if (statColumnFixtureId) {
    const { error } = await sb.from('characters')
      .update({ vitality: statColumnFixtureOriginalVitality }).eq('id', statColumnFixtureId);
    expect(error).toBeNull();
  }
  const { count, error: countError } = await sb.from('characters').select('id', { count: 'exact', head: true });
  expect(countError).toBeNull();
  expect(count).toBe(327);
});

test('a negative stat is rejected', async () => {
  const id = await statColumnFixtureRow();
  const { error } = await sb.from('characters').update({ vitality: -1 }).eq('id', id);
  // 23514 is check_violation.
  expect(error?.code).toBe('23514');
});

test('a stat of 9999 is still accepted -- the database enforces only the floor, not a Cap it cannot compute', async () => {
  const id = await statColumnFixtureRow();
  await restoring('characters', id, { vitality: statColumnFixtureOriginalVitality }, async () => {
    const { error } = await sb.from('characters').update({ vitality: 9999 }).eq('id', id);
    expect(error).toBeNull();
  });
});
