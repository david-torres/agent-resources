const { test, expect } = require('bun:test');
const { canClaimByPossession, canAttachToken } = require('./policy');

const attachedLink = () => ({
  code: 'ABCD1234',
  discord_user_id: 'discord-1',
  consumed_at: null,
  agent_token_id: 'token-1'
});

test('canClaimByPossession allows an exact code+discord match on an attached, unconsumed link', () => {
  expect(canClaimByPossession(attachedLink(), { code: 'ABCD1234', discordUserId: 'discord-1' })).toBe(true);
});

test('canClaimByPossession rejects a mismatched discord_user_id', () => {
  expect(canClaimByPossession(attachedLink(), { code: 'ABCD1234', discordUserId: 'someone-else' })).toBe(false);
});

test('canClaimByPossession rejects a mismatched code', () => {
  expect(canClaimByPossession(attachedLink(), { code: 'WRONGCOD', discordUserId: 'discord-1' })).toBe(false);
});

test('canClaimByPossession rejects an already-consumed link', () => {
  const link = { ...attachedLink(), consumed_at: '2020-01-01T00:00:00.000Z' };
  expect(canClaimByPossession(link, { code: 'ABCD1234', discordUserId: 'discord-1' })).toBe(false);
});

test('canClaimByPossession rejects a link with no token attached yet (still pending)', () => {
  const link = { ...attachedLink(), agent_token_id: null };
  expect(canClaimByPossession(link, { code: 'ABCD1234', discordUserId: 'discord-1' })).toBe(false);
});

test('canClaimByPossession rejects a missing link', () => {
  expect(canClaimByPossession(null, { code: 'ABCD1234', discordUserId: 'discord-1' })).toBe(false);
  expect(canClaimByPossession(undefined, { code: 'ABCD1234', discordUserId: 'discord-1' })).toBe(false);
});

test('canAttachToken allows an authenticated actor to attach to an unattached link', () => {
  expect(canAttachToken({ profileId: 'profile-1', role: 'user' }, { agent_token_id: null })).toBe(true);
});

test('canAttachToken rejects an anonymous/profile-less actor', () => {
  expect(canAttachToken({ profileId: null, role: 'user' }, { agent_token_id: null })).toBe(false);
  expect(canAttachToken(null, { agent_token_id: null })).toBe(false);
});

test('canAttachToken rejects a link that already has a token attached', () => {
  expect(canAttachToken({ profileId: 'profile-1', role: 'user' }, { agent_token_id: 'token-1' })).toBe(false);
});

test('canAttachToken allows the system actor regardless of link state', () => {
  expect(canAttachToken({ role: 'system' }, { agent_token_id: 'token-1' })).toBe(true);
  expect(canAttachToken({ role: 'system' }, null)).toBe(true);
});
