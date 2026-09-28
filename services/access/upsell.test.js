const { test, expect, spyOn } = require('bun:test');
const { getEditionUpsell } = require('./upsell');
const { CORE_CLASS_UNLOCKS, ASPIRANT_V1_CLASS_IDS } = require('../../util/starter-content');

const rowsFor = (ids) => ids.map((id, i) => ({ id, name: `Class ${i}`, teaser: i === 0 ? null : `Teaser ${i}.`, overview: 'not sent' }));
const rosterOf = (edition) => new Set(Object.values(CORE_CLASS_UNLOCKS[edition]).flat());
const rosterIdsByEdition = { advent: rosterOf('advent'), aspirant: rosterOf('aspirant') };
const noUnlocks = async () => ({ ids: new Set(), rosterIdsByEdition, error: null });
const recorder = (effectiveUnlocks = noUnlocks) => {
  const calls = [];
  return { calls, deps: { effectiveUnlocks, classRowsByIds: async (ids) => { calls.push(ids); return { data: rowsFor(ids), error: null }; } } };
};

test('a lapsed Advent and an unowned Aspirant each get a panel of their own printings', async () => {
  const { calls, deps } = recorder();
  const upsell = await getEditionUpsell({ advent: { state: 'expired', endedAt: 'x' }, aspirant: { state: 'none' } }, 'u1', deps);

  expect(calls[0]).toEqual(Object.values(CORE_CLASS_UNLOCKS.advent).map(ids => ids[0]));
  expect(new Set(calls[1])).toEqual(new Set(Object.values(ASPIRANT_V1_CLASS_IDS)));
  expect(upsell.map(u => ({ edition: u.edition, label: u.label, count: u.count }))).toEqual([
    { edition: 'advent', label: 'Advent', count: 6 },
    { edition: 'aspirant', label: 'Aspirant', count: 12 }
  ]);
  expect(upsell[0].classes[1]).toEqual({ id: calls[0][1], name: 'Class 1', teaser: 'Teaser 1.' });
  expect(upsell[0].classes[0].teaser).toBeNull();
});

test('a trial or owned edition gets no panel', async () => {
  const { calls, deps } = recorder();
  const upsell = await getEditionUpsell({ advent: { state: 'trial' }, aspirant: { state: 'owned' } }, 'u1', deps);
  expect(upsell).toEqual([]);
  expect(calls).toHaveLength(0);
});

test('no edition status, no panels', async () => {
  const { deps } = recorder();
  expect(await getEditionUpsell(null, 'u1', deps)).toEqual([]);
  expect(await getEditionUpsell(undefined, 'u1', deps)).toEqual([]);
});

test('a failed class read drops the panels rather than the page', async () => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  const upsell = await getEditionUpsell({ advent: { state: 'none' }, aspirant: { state: 'none' } }, 'u1', {
    effectiveUnlocks: noUnlocks,
    classRowsByIds: async () => ({ data: null, error: { message: 'boom' } })
  });
  expect(upsell).toEqual([]);
  expect(errorSpy).toHaveBeenCalled();
  errorSpy.mockRestore();
});

test('panels list classes in the order the repository returns them (by name, public only)', async () => {
  const deps = { effectiveUnlocks: noUnlocks, classRowsByIds: async () => ({ data: [{ id: 'a', name: 'Alpha' }, { id: 'z', name: 'Zed', teaser: 'Z.' }], error: null }) };
  const [panel] = await getEditionUpsell({ advent: { state: 'none' }, aspirant: { state: 'owned' } }, 'u1', deps);
  expect(panel.classes.map(c => c.name)).toEqual(['Alpha', 'Zed']);
  expect(panel.count).toBe(2);
});

test('a class the viewer can already play is left out of its panel and the count', async () => {
  const [playable, ...rest] = Object.values(CORE_CLASS_UNLOCKS.advent).map(ids => ids[0]);
  const { calls, deps } = recorder(async (userId) => {
    expect(userId).toBe('u1');
    return { ids: new Set([playable]), rosterIdsByEdition, error: null };
  });
  const [panel] = await getEditionUpsell({ advent: { state: 'expired', endedAt: 'x' }, aspirant: { state: 'owned' } }, 'u1', deps);
  expect(calls[0]).toEqual(rest);
  expect(panel.count).toBe(rest.length);
  expect(panel.classes.map(c => c.id)).toEqual(rest);
});

test('an unreadable unlock set drops the panels rather than the page', async () => {
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  const { deps } = recorder(async () => ({ ids: new Set(), rosterIdsByEdition: {}, error: { message: 'boom' } }));
  expect(await getEditionUpsell({ advent: { state: 'none' }, aspirant: { state: 'owned' } }, 'u1', deps)).toEqual([]);
  errorSpy.mockRestore();
});
