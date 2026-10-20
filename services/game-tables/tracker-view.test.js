// What a tracker shows: pool bars sized to the member's budget, and each
// source's count, cooldown, uses left and Limiters.
const { test, expect } = require('bun:test');
const { buildTrackerView } = require('./tracker-view');
const { emptyState } = require('../../util/exertion');
const { sourcesFor } = require('../../util/source-meters');

const HAMMER = { abilities: [], gear: [{ id: 'g1', name: 'Hammer', meters: [{ label: 'Uses', value: '3x' }, { label: 'Cooldown', value: 'Low' }] }] };

test('pool bars are segmented into the budget, filled up to spent', () => {
  const state = { ...emptyState(), essence: { threshold: 1, spent: 2 } };
  const view = buildTrackerView({ state, version: 4, sources: sourcesFor(null), stats: { will: 1 }, canTrack: true, isConduit: false, actionUrl: '/a' });
  const essence = view.pools.find((p) => p.name === 'essence');
  expect(essence).toMatchObject({ label: 'Essence', threshold: 1, thresholdLabel: 'Yellow', spent: 2, budget: 7, approximate: false });
  expect(essence.segments).toEqual([true, true, false, false, false, false, false]);
  expect(view.version).toBe(4);
});

test('a source shows its count, uses left and cooldown', () => {
  const state = { ...emptyState(), useCounts: { 'gear:g1': 2 }, cooldowns: { 'gear:g1': true } };
  const view = buildTrackerView({ state, version: 0, sources: sourcesFor(HAMMER), stats: {}, canTrack: true, isConduit: false, actionUrl: '/a' });
  expect(view.sources[0]).toMatchObject({ key: 'gear:g1', used: 2, remaining: 1, cooldownOn: true, hasCooldown: true });
});

test('a rated use shows the count against its approximation', () => {
  const rated = { abilities: [], gear: [{ id: 'g2', name: 'Salt', meters: [{ label: 'Uses', value: 'Low' }] }] };
  const view = buildTrackerView({ state: { ...emptyState(), useCounts: { 'gear:g2': 4 } }, version: 0, sources: sourcesFor(rated), stats: {}, canTrack: false, isConduit: false, actionUrl: '/a' });
  expect(view.sources[0].remaining).toBe('about 6');
});

test('imposed Limiters are listed with their index so they can be lifted', () => {
  const state = { ...emptyState(), imposedLimiters: { 'mechanic:pitch': [{ kind: 'Cooldown', rating: 'Mid' }] } };
  const view = buildTrackerView({ state, version: 0, sources: sourcesFor(null), stats: {}, canTrack: true, isConduit: true, actionUrl: '/a' });
  expect(view.sources.find((s) => s.key === 'mechanic:pitch').imposed).toEqual([{ kind: 'Cooldown', rating: 'Mid', index: 0 }]);
});

test('a stale source key is ignored', () => {
  const state = { ...emptyState(), useCounts: { 'ability:gone': 3 }, cooldowns: { 'ability:gone': true } };
  const view = buildTrackerView({ state, version: 0, sources: sourcesFor(null), stats: {}, canTrack: true, isConduit: false, actionUrl: '/a' });
  expect(view.sources.some((s) => s.key === 'ability:gone')).toBe(false);
});
