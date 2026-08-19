// The pure half of "Log this game": who may log an LFG post, and what the
// pre-filled mission draft contains. Kept out of the route so the party
// filtering (approved only) is testable without an HTTP round trip -- the old
// blind "Create Mission" button this replaces got that filtering wrong by
// posting every join request regardless of status.
const { test, expect } = require('bun:test');
const { canLogGame, buildMissionDraft } = require('./lfg-mission-draft');

const CREATOR = '11111111-1111-1111-1111-111111111111';
const CONDUIT = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';
const POST = '44444444-4444-4444-4444-444444444444';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const PAST = '2026-08-18T20:00:00.000Z';
const FUTURE = '2026-08-20T20:00:00.000Z';

// getLfgPost runs applyConduitMeta before returning, so host_id on the loaded
// post is already the approved conduit rather than the stale column value.
const post = (overrides = {}) => ({
  id: POST,
  title: 'The Sunken Vault',
  date: PAST,
  creator_id: CREATOR,
  host_id: CONDUIT,
  host_name: 'Vega',
  join_requests: [],
  ...overrides
});

const joinRequest = (status, character, extra = {}) => ({
  status,
  join_type: 'player',
  character,
  ...extra
});

test('the post creator may log a game whose date has passed', () => {
  expect(canLogGame(post(), CREATOR, NOW)).toBe(true);
});

test('the approved conduit may log a game whose date has passed', () => {
  expect(canLogGame(post(), CONDUIT, NOW)).toBe(true);
});

test('nobody else may log the game, however public the post', () => {
  expect(canLogGame(post(), STRANGER, NOW)).toBe(false);
});

test('a signed-out viewer may not log the game', () => {
  expect(canLogGame(post(), null, NOW)).toBe(false);
});

test('a game that has not happened yet cannot be logged', () => {
  expect(canLogGame(post({ date: FUTURE }), CREATOR, NOW)).toBe(false);
  expect(canLogGame(post({ date: FUTURE }), CONDUIT, NOW)).toBe(false);
});

test('a post with no conduit is still loggable by its creator', () => {
  expect(canLogGame(post({ host_id: null, host_name: null }), CREATOR, NOW)).toBe(true);
});

test('a missing post is not loggable', () => {
  expect(canLogGame(null, CREATOR, NOW)).toBe(false);
});

test('the draft carries the post title, date, conduit, and back-link', () => {
  const draft = buildMissionDraft(post());
  expect(draft.name).toBe('The Sunken Vault');
  expect(draft.date).toBe(PAST);
  expect(draft.host).toEqual({ id: CONDUIT, name: 'Vega' });
  expect(draft.host_name).toBe('Vega');
  expect(draft.lfg_post_id).toBe(POST);
});

test('a conduit-less post drafts with no host rather than a phantom one', () => {
  const draft = buildMissionDraft(post({ host_id: null, host_name: null }));
  expect(draft.host).toBe(null);
  expect(draft.host_name).toBe('');
});

test('the draft party is exactly the characters on approved join requests', () => {
  const draft = buildMissionDraft(post({
    join_requests: [
      joinRequest('approved', { id: 'c-1', name: 'Ash', class: 'Seeker', level: 3 }),
      joinRequest('pending', { id: 'c-2', name: 'Bly', class: 'Warden', level: 2 }),
      joinRequest('rejected', { id: 'c-3', name: 'Cass', class: 'Herald', level: 5 }),
      joinRequest('approved', { id: 'c-4', name: 'Dex', class: 'Seeker', level: 1 })
    ]
  }));
  expect(draft.characters.map(c => c.id)).toEqual(['c-1', 'c-4']);
  expect(draft.characters[0].name).toBe('Ash');
});

test('approved requests with no character contribute nothing to the draft party', () => {
  // The conduit's own request carries no character, and neither does a player
  // request whose character row was deleted (the FK is ON DELETE SET NULL).
  const draft = buildMissionDraft(post({
    join_requests: [
      joinRequest('approved', null, { join_type: 'conduit' }),
      joinRequest('approved', null),
      joinRequest('approved', { id: 'c-1', name: 'Ash', class: 'Seeker', level: 3 })
    ]
  }));
  expect(draft.characters.map(c => c.id)).toEqual(['c-1']);
});

test('a post with no approved players drafts an empty party, not undefined', () => {
  expect(buildMissionDraft(post()).characters).toEqual([]);
});
