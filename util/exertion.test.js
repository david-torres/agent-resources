// The Stamina/Essence arithmetic and every tracker action
// (docs/superpowers/specs/2026-10-08-game-tables-design.md §3).
const { test, expect } = require('bun:test');
const { budgetFor, emptyState, applyAction, stateFromRow, stateToColumns, snapshotOf } = require('./exertion');
const { sourcesFor } = require('./source-meters');

const ctx = (stats = { will: 0, vigor: 0 }, character = null) => ({ stats, sources: sourcesFor(character) });
const BOLT = { abilities: [{ id: 'a1', name: 'Bolt', meters: [{ label: 'Essence Cost', value: 'Low–High' }, { label: 'Cooldown', value: 'Low' }] }], gear: [] };
const run = (state, action, context = ctx()) => {
  const result = applyAction(state, action, context);
  if (result.error) throw new Error(result.error);
  return result.state;
};

test('the budget follows the Will row: 6, 7, 9, 12, 15, 18, 24, then +6 a plus, approximate past six', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map((p) => budgetFor(p).budget)).toEqual([6, 7, 9, 12, 15, 18, 24]);
  expect(budgetFor(6).approximate).toBe(false);
  expect(budgetFor(8)).toEqual({ budget: 36, approximate: true });
  expect(budgetFor(null).budget).toBe(6);
});

test('spending past the budget drops a Threshold and carries the rest', () => {
  const state = run(emptyState(), { type: 'spend', pool: 'essence', amount: 'High' });
  expect(state.essence).toEqual({ threshold: 1, spent: 0 });
  const twice = run(run(emptyState(), { type: 'spend', pool: 'essence', amount: 'Mid' }), { type: 'spend', pool: 'essence', amount: 'High' });
  expect(twice.essence).toEqual({ threshold: 1, spent: 3 });
});

test('a big spend can drop more than one Threshold and stops at Below Red', () => {
  let state = emptyState();
  for (let i = 0; i < 4; i += 1) state = run(state, { type: 'spend', pool: 'stamina', amount: 'High' });
  expect(state.stamina).toEqual({ threshold: 3, spent: 0 });
  expect(run(state, { type: 'spend', pool: 'stamina', amount: 'Low' }).stamina).toEqual({ threshold: 3, spent: 0 });
});

test('restore climbs back up and stops at Green with nothing spent', () => {
  const low = { ...emptyState(), essence: { threshold: 1, spent: 1 } };
  expect(run(low, { type: 'restore', pool: 'essence', amount: 'Mid' }).essence).toEqual({ threshold: 0, spent: 4 });
  expect(run(low, { type: 'restore', pool: 'essence', amount: 'Threshold' }).essence).toEqual({ threshold: 0, spent: 1 });
  expect(run(emptyState(), { type: 'restore', pool: 'essence', amount: 'High' }).essence).toEqual({ threshold: 0, spent: 0 });
});

test('Will widens the Essence budget and Vigor the Stamina budget', () => {
  const strong = ctx({ will: 2, vigor: 0 });
  expect(run(emptyState(), { type: 'spend', pool: 'essence', amount: 'High' }, strong).essence).toEqual({ threshold: 0, spent: 6 });
  expect(run(emptyState(), { type: 'spend', pool: 'stamina', amount: 'High' }, strong).stamina).toEqual({ threshold: 1, spent: 0 });
});

test('using a source counts it, spends its chosen cost, and starts its Cooldown', () => {
  const state = run(emptyState(), { type: 'use', source: 'ability:a1', level: 'Mid' }, ctx(undefined, BOLT));
  expect(state.useCounts['ability:a1']).toBe(1);
  expect(state.essence).toEqual({ threshold: 0, spent: 3 });
  expect(state.cooldowns['ability:a1']).toBe(true);
});

test('a range cost needs a level inside the range', () => {
  expect(applyAction(emptyState(), { type: 'use', source: 'ability:a1' }, ctx(undefined, BOLT)).error)
    .toBe('Choose Low, Mid or High for this cost.');
  const single = { abilities: [{ id: 'a2', name: 'Spark', meters: [{ label: 'Essence Cost', value: 'Low–Mid' }] }], gear: [] };
  expect(applyAction(emptyState(), { type: 'use', source: 'ability:a2', level: 'High' }, ctx(undefined, single)).error)
    .toBe('Choose Low or Mid for this cost.');
});

test('a Conduit-imposed cost adds to the printed one, and an imposed Cooldown starts on use', () => {
  let state = run(emptyState(), { type: 'impose', source: 'mechanic:pitch', kind: 'Essence Cost', rating: 'Low' });
  state = run(state, { type: 'impose', source: 'mechanic:pitch', kind: 'Cooldown', rating: 'Mid' });
  state = run(state, { type: 'use', source: 'mechanic:pitch' });
  expect(state.essence.spent).toBe(1);
  expect(state.cooldowns['mechanic:pitch']).toBe(true);
  state = run(state, { type: 'lift', source: 'mechanic:pitch', index: 0 });
  expect(state.imposedLimiters['mechanic:pitch']).toEqual([{ kind: 'Cooldown', rating: 'Mid' }]);
});

test('cooldowns toggle, and set clamps to the pool', () => {
  const on = run(emptyState(), { type: 'toggle_cooldown', source: 'mechanic:pitch' });
  expect(run(on, { type: 'toggle_cooldown', source: 'mechanic:pitch' }).cooldowns['mechanic:pitch']).toBe(false);
  expect(run(emptyState(), { type: 'set', pool: 'stamina', threshold: 2, spent: 4 }).stamina).toEqual({ threshold: 2, spent: 4 });
  expect(applyAction(emptyState(), { type: 'set', pool: 'stamina', threshold: 4, spent: 0 }, ctx()).error).toBe('Pick a Threshold from Green to Below Red.');
  expect(applyAction(emptyState(), { type: 'set', pool: 'stamina', threshold: 1, spent: 6 }, ctx()).error).toBe('Spent must be from 0 to 5.');
});

test('bad input names its problem instead of changing anything', () => {
  expect(applyAction(emptyState(), { type: 'spend', pool: 'mana', amount: 'Low' }, ctx()).error).toBe('Unknown pool.');
  expect(applyAction(emptyState(), { type: 'spend', pool: 'essence', amount: 'Huge' }, ctx()).error).toBe('Pick Low, Mid or High.');
  expect(applyAction(emptyState(), { type: 'use', source: 'ability:nope' }, ctx()).error).toBe('That source is not on this sheet.');
  expect(applyAction(emptyState(), { type: 'impose', source: 'mechanic:pitch', kind: 'Range', rating: 'Low' }, ctx()).error).toBe('Pick a Limiter kind.');
  expect(applyAction(emptyState(), { type: 'dance' }, ctx()).error).toBe('Unknown action.');
});

test('state round-trips through table columns, and a snapshot holds no undo of its own', () => {
  const state = run(emptyState(), { type: 'spend', pool: 'essence', amount: 'Mid' });
  const columns = stateToColumns(state);
  expect(columns).toMatchObject({ essence_threshold: 0, essence_spent: 3, stamina_threshold: 0, stamina_spent: 0 });
  expect(stateFromRow({ ...columns, undo: { x: 1 }, version: 4 })).toEqual(state);
  expect(snapshotOf(state)).toEqual(columns);
});

test('names that exist on every object are not pools, amounts, kinds or sources', () => {
  const before = emptyState();
  const errorOf = (action) => {
    const result = applyAction(before, action, ctx());
    expect(result.state).toBeUndefined();
    return result.error;
  };
  expect(errorOf({ type: 'spend', pool: 'constructor', amount: 'Low' })).toBe('Unknown pool.');
  expect(errorOf({ type: 'spend', pool: 'essence', amount: 'toString' })).toBe('Pick Low, Mid or High.');
  expect(errorOf({ type: 'restore', pool: 'essence', amount: 'constructor' })).toBe('Pick Low, Mid or High.');
  expect(errorOf({ type: 'impose', source: 'mechanic:pitch', kind: 'toString', rating: 'Low' })).toBe('Pick a Limiter kind.');
  expect(errorOf({ type: 'lift', source: '__proto__', index: 0 })).toBe('That Limiter is already gone.');
  expect(errorOf({ type: 'lift', source: 'constructor', index: 0 })).toBe('That Limiter is already gone.');
  expect(before).toEqual(emptyState());
});

test('a missing action is an unknown action, not a crash', () => {
  expect(applyAction(emptyState(), null, ctx()).error).toBe('Unknown action.');
  expect(applyAction(emptyState(), undefined, ctx()).error).toBe('Unknown action.');
});
