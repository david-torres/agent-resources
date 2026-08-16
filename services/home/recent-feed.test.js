const { test, expect } = require('bun:test');
const { toFeedItem, mergeRecent } = require('./recent-feed');

test('toFeedItem normalizes a character row', () => {
  const item = toFeedItem('character', {
    id: 'c1', name: 'Vex', class: 'Gunslinger', level: 3,
    updated_at: '2026-08-01T00:00:00+00:00'
  });
  expect(item).toEqual({
    type: 'character',
    id: 'c1',
    name: 'Vex',
    href: '/characters/c1',
    meta: 'Level 3 Gunslinger',
    updated_at: '2026-08-01T00:00:00+00:00'
  });
});

test('toFeedItem normalizes a mission row, capitalizing the outcome', () => {
  const item = toFeedItem('mission', {
    id: 'm1', name: 'The Long Dark', outcome: 'success',
    date: '2026-07-04T00:00:00+00:00', updated_at: '2026-07-05T00:00:00+00:00'
  });
  expect(item.type).toBe('mission');
  expect(item.href).toBe('/missions/m1');
  expect(item.meta).toBe('Success · Jul 4, 2026');
});

test('toFeedItem normalizes a class row', () => {
  const item = toFeedItem('class', {
    id: 'k1', name: 'Tinkerer', status: 'beta', rules_edition: 'advent',
    updated_at: '2026-06-01T00:00:00+00:00'
  });
  expect(item.href).toBe('/classes/k1');
  expect(item.meta).toBe('Beta · Advent');
});

test('toFeedItem returns null for an unknown type or a falsy row', () => {
  expect(toFeedItem('badge', { id: 'b1' })).toBeNull();
  expect(toFeedItem('character', null)).toBeNull();
});

test('mergeRecent sorts across types by updated_at descending', () => {
  const characters = [toFeedItem('character', {
    id: 'c1', name: 'Vex', class: 'Gunslinger', level: 3,
    updated_at: '2026-08-01T00:00:00+00:00'
  })];
  const classes = [toFeedItem('class', {
    id: 'k1', name: 'Tinkerer', status: 'beta', rules_edition: 'advent',
    updated_at: '2026-08-09T00:00:00+00:00'
  })];
  expect(mergeRecent([characters, classes], 6).map(i => i.id)).toEqual(['k1', 'c1']);
});

test('mergeRecent compares instants, not strings, across UTC offsets', () => {
  // 13:00+02:00 is 11:00Z, which is EARLIER than 12:00Z. A lexical string
  // sort would get this backwards.
  const a = [{ type: 'character', id: 'later', name: 'A', href: '/x', meta: '', updated_at: '2026-08-01T12:00:00+00:00' }];
  const b = [{ type: 'character', id: 'earlier', name: 'B', href: '/y', meta: '', updated_at: '2026-08-01T13:00:00+02:00' }];
  expect(mergeRecent([a, b], 6).map(i => i.id)).toEqual(['later', 'earlier']);
});

test('mergeRecent sorts an offset-less timestamp (classes) against an offset-bearing one (characters/missions) as UTC, not local time', () => {
  // classes.updated_at is a plain `timestamp` and serializes without an
  // offset, e.g. '2026-08-14T10:00:00' (10:00 UTC). A character/mission row
  // is timestamptz and serializes with an offset, e.g.
  // '2026-08-14T13:00:00+00:00' (13:00 UTC -- three hours newer). Sorting
  // via Date.parse would read the offset-less value as LOCAL time on the
  // server, potentially placing the older class row above the newer
  // character row. moment.utc must treat both as UTC instants.
  const olderClass = [{ type: 'class', id: 'the-class', name: 'A', href: '/k', meta: '', updated_at: '2026-08-14T10:00:00' }];
  const newerCharacter = [{ type: 'character', id: 'the-character', name: 'B', href: '/c', meta: '', updated_at: '2026-08-14T13:00:00+00:00' }];
  expect(mergeRecent([olderClass, newerCharacter], 6).map(i => i.id)).toEqual(['the-character', 'the-class']);
});

test('mergeRecent breaks ties by name so ordering is deterministic', () => {
  const at = '2026-08-01T00:00:00+00:00';
  const rows = [
    { type: 'character', id: '1', name: 'Zara', href: '/1', meta: '', updated_at: at },
    { type: 'character', id: '2', name: 'Alba', href: '/2', meta: '', updated_at: at }
  ];
  expect(mergeRecent([rows], 6).map(i => i.name)).toEqual(['Alba', 'Zara']);
});

test('mergeRecent truncates to the limit and tolerates empty or missing groups', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map(n => ({
    type: 'character', id: String(n), name: `C${n}`, href: `/${n}`, meta: '',
    updated_at: `2026-08-0${n > 6 ? 1 : n}T00:00:00+00:00`
  }));
  expect(mergeRecent([rows, [], null], 6)).toHaveLength(6);
});

test('mergeRecent drops nulls left by unknown types', () => {
  expect(mergeRecent([[null, null]], 6)).toEqual([]);
});
