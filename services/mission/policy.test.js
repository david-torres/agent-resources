const { test, expect } = require('bun:test');
const { canEditMission, isMissionCreator } = require('./policy');

const MISSION = { creator_id: 'creator-1', host_id: 'host-1' };

test('the creator may edit their mission', () => {
  expect(canEditMission({ profileId: 'creator-1', role: 'user' }, { mission: MISSION })).toBe(true);
});

test('the host may edit the mission', () => {
  expect(canEditMission({ profileId: 'host-1', role: 'user' }, { mission: MISSION })).toBe(true);
});

test('an editor (pre-loaded editor row) may edit the mission', () => {
  const editorRow = { profile_id: 'editor-1' };
  expect(canEditMission({ profileId: 'editor-1', role: 'user' }, { mission: MISSION, editorRow })).toBe(true);
});

test('an admin may edit any mission', () => {
  expect(canEditMission({ profileId: 'admin-1', role: 'admin' }, { mission: MISSION })).toBe(true);
});

test('the system actor may edit any mission', () => {
  expect(canEditMission({ role: 'system' }, { mission: MISSION })).toBe(true);
});

test('a stranger with no editor row may not edit the mission', () => {
  expect(canEditMission({ profileId: 'stranger', role: 'user' }, { mission: MISSION })).toBe(false);
});

test('canEditMission is false without a loaded mission unless system/admin', () => {
  expect(canEditMission({ profileId: 'creator-1', role: 'user' }, {})).toBe(false);
  expect(canEditMission({ role: 'admin' }, {})).toBe(true);
});

test('the creator is the mission creator', () => {
  expect(isMissionCreator({ profileId: 'creator-1', role: 'user' }, MISSION)).toBe(true);
});

test('the host is NOT the mission creator', () => {
  expect(isMissionCreator({ profileId: 'host-1', role: 'user' }, MISSION)).toBe(false);
});

test('an admin counts as the mission creator', () => {
  expect(isMissionCreator({ profileId: 'admin-1', role: 'admin' }, MISSION)).toBe(true);
});

test('the system actor counts as the mission creator', () => {
  expect(isMissionCreator({ role: 'system' }, MISSION)).toBe(true);
});

test('a stranger is not the mission creator', () => {
  expect(isMissionCreator({ profileId: 'stranger', role: 'user' }, MISSION)).toBe(false);
});
