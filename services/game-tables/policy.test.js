// The pure rules behind a game table: guest validation and what a viewer may do.
const { test, expect } = require('bun:test');
const { normalizeGuestInput, normalizeTableName, toDisplayMember, capabilitiesFor } = require('./policy');
const { statList } = require('../../util/enclave-consts');

test('a guest needs a name; class is optional; missing stats are zero', () => {
  expect(normalizeGuestInput({ name: '  ' }).errors).toContain('Give the character a name.');
  const { data } = normalizeGuestInput({ name: ' Mira ', class_label: '', might: '2' });
  expect(data.guest_name).toBe('Mira');
  expect(data.guest_class_label).toBeNull();
  expect(data.guest_stats.might).toBe(2);
  expect(data.guest_stats.luck).toBe(0);
  expect(Object.keys(data.guest_stats).sort()).toEqual([...statList].sort());
});

test('guest stats are whole numbers from 0 to 100, and every bad one is named in stat order', () => {
  const { errors } = normalizeGuestInput({ name: 'Mira', might: '101', luck: '1.5', will: '-1' });
  const named = statList.filter((stat) => ['might', 'luck', 'will'].includes(stat)).join(', ');
  expect(errors).toEqual([`Stats must be whole numbers from 0 to 100: ${named}.`]);
});

test('guest names and class labels are capped at 60 characters', () => {
  expect(normalizeGuestInput({ name: 'x'.repeat(61) }).errors).toContain('Keep the name to 60 characters.');
  expect(normalizeGuestInput({ name: 'Mira', class_label: 'x'.repeat(61) }).errors).toContain('Keep the class to 60 characters.');
});

test('a table name is trimmed and 1–80 characters', () => {
  expect(normalizeTableName('  Friday game ')).toEqual({ name: 'Friday game' });
  expect(normalizeTableName('').error).toBe('Give the table a name.');
  expect(normalizeTableName('x'.repeat(81)).error).toBe('Keep the table name to 80 characters.');
});

test('a guest displays as a public, removable-by-manager member keyed by its member id', () => {
  const member = toDisplayMember({ id: 'm1', guest_name: 'Mira', guest_class_label: null, guest_stats: { might: 3 } }, 'p1');
  expect(member).toMatchObject({ memberId: 'm1', id: 'm1', isGuest: true, name: 'Mira', is_public: true, might: 3, luck: 0, canViewDetails: false });
});

test('a private seated character shows details only to its owner', () => {
  const row = { id: 'm2', lfg_join_request_id: 'r1', character: { id: 'c1', name: 'Ash', creator_id: 'owner', is_public: false, might: 1 } };
  expect(toDisplayMember(row, 'owner')).toMatchObject({ memberId: 'm2', id: 'c1', ownerId: 'owner', fromLfg: true, canViewDetails: true });
  expect(toDisplayMember(row, 'someone-else').canViewDetails).toBe(false);
});

test('capabilities follow creator, Conduit and admin', () => {
  const table = { creator_id: 'creator', conduit_id: 'conduit' };
  expect(capabilitiesFor(table, { profileId: 'creator' })).toEqual({ signedIn: true, isCreator: true, canManage: true, isConduit: false });
  expect(capabilitiesFor(table, { profileId: 'conduit' })).toEqual({ signedIn: true, isCreator: false, canManage: true, isConduit: true });
  expect(capabilitiesFor(table, { profileId: 'p', role: 'admin' })).toEqual({ signedIn: true, isCreator: true, canManage: true, isConduit: true });
  expect(capabilitiesFor(table, { profileId: null })).toEqual({ signedIn: false, isCreator: false, canManage: false, isConduit: false });
});

test('the Conduit is the table\'s conduit_id, or an admin', () => {
  const table = { creator_id: 'creator', conduit_id: 'conduit' };
  expect(capabilitiesFor(table, { profileId: 'conduit' }).isConduit).toBe(true);
  expect(capabilitiesFor(table, { profileId: 'creator' }).isConduit).toBe(false);
  expect(capabilitiesFor(table, { profileId: 'x', role: 'admin' }).isConduit).toBe(true);
});

test('unregistered stats above five are accepted', () => {
  expect(normalizeGuestInput({ name: 'Mira', will: '7', might: '100' }).data.guest_stats).toMatchObject({ will: 7, might: 100 });
});
