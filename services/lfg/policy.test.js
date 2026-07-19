const { test, expect } = require('bun:test');
const {
  canManagePost,
  canModerateJoinRequest,
  canJoinAsCharacter,
  canManageOwnJoinRequest
} = require('./policy');

const POST = { id: 'post-1', creator_id: 'creator-1' };
const CHARACTER = { id: 'char-1', creator_id: 'owner-1', is_deceased: false };
const REQUEST = { id: 'req-1', profile_id: 'requester-1' };

// ─── canManagePost ─────────────────────────────────────────────────────────

test('the post creator may manage their post', () => {
  expect(canManagePost({ profileId: 'creator-1', role: 'user' }, POST)).toBe(true);
});

test('an admin may manage any post', () => {
  expect(canManagePost({ profileId: 'admin-1', role: 'admin' }, POST)).toBe(true);
});

test('the system actor may manage any post', () => {
  expect(canManagePost({ role: 'system' }, POST)).toBe(true);
});

test('a stranger may not manage the post', () => {
  expect(canManagePost({ profileId: 'stranger', role: 'user' }, POST)).toBe(false);
});

test('canManagePost is false without a loaded post unless system/admin', () => {
  expect(canManagePost({ profileId: 'creator-1', role: 'user' }, null)).toBe(false);
  expect(canManagePost({ role: 'admin' }, null)).toBe(true);
});

// ─── canModerateJoinRequest ─────────────────────────────────────────────────

test('the host may moderate join requests on their post', () => {
  expect(canModerateJoinRequest({ profileId: 'creator-1', role: 'user' }, POST)).toBe(true);
});

test('an admin may moderate join requests on any post', () => {
  expect(canModerateJoinRequest({ profileId: 'admin-1', role: 'admin' }, POST)).toBe(true);
});

test('the system actor may moderate join requests on any post', () => {
  expect(canModerateJoinRequest({ role: 'system' }, POST)).toBe(true);
});

test('a non-host may not moderate join requests', () => {
  expect(canModerateJoinRequest({ profileId: 'stranger', role: 'user' }, POST)).toBe(false);
});

// ─── canJoinAsCharacter ─────────────────────────────────────────────────────

test('the character owner may join with their living character', () => {
  expect(canJoinAsCharacter({ profileId: 'owner-1', role: 'user' }, CHARACTER)).toBe(true);
});

test('the system actor may always join', () => {
  expect(canJoinAsCharacter({ role: 'system' }, CHARACTER)).toBe(true);
});

test('a non-owner may not join with someone else\'s character', () => {
  expect(canJoinAsCharacter({ profileId: 'stranger', role: 'user' }, CHARACTER)).toBe(false);
});

test('the owner may not join with a deceased character', () => {
  const deceased = { ...CHARACTER, is_deceased: true };
  expect(canJoinAsCharacter({ profileId: 'owner-1', role: 'user' }, deceased)).toBe(false);
});

test('an admin has no special bypass for character ownership', () => {
  expect(canJoinAsCharacter({ profileId: 'admin-1', role: 'admin' }, CHARACTER)).toBe(false);
});

// ─── canManageOwnJoinRequest ────────────────────────────────────────────────

test('the requester may manage/withdraw their own join request', () => {
  expect(canManageOwnJoinRequest({ profileId: 'requester-1', role: 'user' }, REQUEST)).toBe(true);
});

test('an admin may manage any join request', () => {
  expect(canManageOwnJoinRequest({ profileId: 'admin-1', role: 'admin' }, REQUEST)).toBe(true);
});

test('the system actor may manage any join request', () => {
  expect(canManageOwnJoinRequest({ role: 'system' }, REQUEST)).toBe(true);
});

test('a stranger may not manage someone else\'s join request', () => {
  expect(canManageOwnJoinRequest({ profileId: 'stranger', role: 'user' }, REQUEST)).toBe(false);
});
