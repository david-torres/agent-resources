const { test, expect } = require('bun:test');
const { BadgeService } = require('./service');
const { AuthorizationError } = require('../../util/errors');

const MILESTONE_BADGE = { id: 'b-milestone', slug: 'newcomer-1', category: 'milestone', is_active: true };
const EVENT_BADGE = { id: 'b-event', slug: 'enclave-day-1', category: 'event', is_active: true };
const INACTIVE_BADGE = { id: 'b-inactive', slug: 'retired', category: 'event', is_active: false };

const makeRepo = ({ badgesBySlug = {} } = {}) => {
  const calls = [];
  return {
    calls,
    fetchGrantableBadgeBySlug: async (slug) => {
      calls.push(['fetchGrantableBadgeBySlug', slug]);
      return { data: badgesBySlug[slug] || null, error: null };
    },
    upsertGrantedBadge: async (row) => { calls.push(['upsertGrantedBadge', row]); return { data: row, error: null }; },
    deleteProfileBadge: async (args) => { calls.push(['deleteProfileBadge', args]); return { error: null }; }
  };
};

const ADMIN_ACTOR = { profileId: 'admin-1', role: 'admin' };
const USER_ACTOR = { profileId: 'p1', role: 'user' };

test('constructor requires every repository method', () => {
  expect(() => new BadgeService({})).toThrow(TypeError);
});

test('an admin may grant a non-milestone badge; the write reaches the repository', async () => {
  const repo = makeRepo({ badgesBySlug: { 'enclave-day-1': EVENT_BADGE } });
  const service = new BadgeService(repo);
  const result = await service.grantBadge(ADMIN_ACTOR, { profileId: 'p2', badgeSlug: 'enclave-day-1', grantedById: 'admin-1' });
  expect(result).toEqual({ data: { slug: 'enclave-day-1' }, error: null });
  expect(repo.calls).toEqual([
    ['fetchGrantableBadgeBySlug', 'enclave-day-1'],
    ['upsertGrantedBadge', { profile_id: 'p2', badge_id: 'b-event', granted_by: 'admin-1' }]
  ]);
});

test('a non-admin granting a badge throws AuthorizationError, never reaching the repository', async () => {
  const repo = makeRepo({ badgesBySlug: { 'enclave-day-1': EVENT_BADGE } });
  const service = new BadgeService(repo);
  await expect(service.grantBadge(USER_ACTOR, { profileId: 'p2', badgeSlug: 'enclave-day-1' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});

test('granting a milestone badge is rejected as a domain error, not an authorization error', async () => {
  const repo = makeRepo({ badgesBySlug: { 'newcomer-1': MILESTONE_BADGE } });
  const service = new BadgeService(repo);
  const result = await service.grantBadge(ADMIN_ACTOR, { profileId: 'p2', badgeSlug: 'newcomer-1' });
  expect(result.data).toBeNull();
  expect(result.error.message).toMatch(/milestone/i);
  expect(repo.calls).toEqual([['fetchGrantableBadgeBySlug', 'newcomer-1']]);
});

test('granting an unknown badge slug returns a not-found domain error', async () => {
  const repo = makeRepo();
  const service = new BadgeService(repo);
  const result = await service.grantBadge(ADMIN_ACTOR, { profileId: 'p2', badgeSlug: 'does-not-exist' });
  expect(result.error.message).toBe('Badge not found');
});

test('granting an inactive badge returns a not-found domain error', async () => {
  const repo = makeRepo({ badgesBySlug: { retired: INACTIVE_BADGE } });
  const service = new BadgeService(repo);
  const result = await service.grantBadge(ADMIN_ACTOR, { profileId: 'p2', badgeSlug: 'retired' });
  expect(result.error.message).toBe('Badge not found');
});

test('an admin may revoke a badge; the delete reaches the repository', async () => {
  const repo = makeRepo({ badgesBySlug: { 'enclave-day-1': EVENT_BADGE } });
  const service = new BadgeService(repo);
  const result = await service.revokeBadge(ADMIN_ACTOR, { profileId: 'p2', badgeSlug: 'enclave-day-1' });
  expect(result).toEqual({ data: { slug: 'enclave-day-1' }, error: null });
  expect(repo.calls).toEqual([
    ['fetchGrantableBadgeBySlug', 'enclave-day-1'],
    ['deleteProfileBadge', { profileId: 'p2', badgeId: 'b-event' }]
  ]);
});

test('a non-admin revoking a badge throws AuthorizationError, never reaching the repository', async () => {
  const repo = makeRepo({ badgesBySlug: { 'enclave-day-1': EVENT_BADGE } });
  const service = new BadgeService(repo);
  await expect(service.revokeBadge(USER_ACTOR, { profileId: 'p2', badgeSlug: 'enclave-day-1' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});

test('revoking a milestone badge is rejected as a domain error', async () => {
  const repo = makeRepo({ badgesBySlug: { 'newcomer-1': MILESTONE_BADGE } });
  const service = new BadgeService(repo);
  const result = await service.revokeBadge(ADMIN_ACTOR, { profileId: 'p2', badgeSlug: 'newcomer-1' });
  expect(result.error.message).toMatch(/milestone/i);
});
