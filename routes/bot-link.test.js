// routes/bot-link.test.js
const { test, expect } = require('bun:test');
const {
  createPendingLink,
  consumePendingLink
} = require('../models/bot-link');
const { supabaseAdmin } = require('../models/_base');

const DISCORD_ID = '222222222222222222';

// These tests require the remote/local Supabase to be reachable AND the
// migrations from Tasks A1 and A5 to be applied. They create and clean up
// their own rows.

const cleanup = async () => {
  await supabaseAdmin.from('pending_bot_links').delete().eq('discord_user_id', DISCORD_ID);
};

test('createPendingLink inserts a row and returns a code', async () => {
  await cleanup();
  const { data, error } = await createPendingLink(DISCORD_ID);
  expect(error).toBe(null);
  expect(data.code).toMatch(/^[A-Z0-9]{8}$/);
  expect(data.discord_user_id).toBe(DISCORD_ID);
});

test('consumePendingLink rejects pending rows (no token yet)', async () => {
  await cleanup();
  const { data: pending } = await createPendingLink(DISCORD_ID);
  const { error } = await consumePendingLink({ code: pending.code, discordUserId: DISCORD_ID });
  expect(error).toBe('pending');
});

test('consumePendingLink rejects wrong discord_user_id', async () => {
  await cleanup();
  const { data: pending } = await createPendingLink(DISCORD_ID);
  const { error } = await consumePendingLink({ code: pending.code, discordUserId: '999999999999999999' });
  expect(error).toBe('mismatch');
});

test('createPendingLink blocks more than 3 pending for one Discord ID', async () => {
  await cleanup();
  await createPendingLink(DISCORD_ID);
  await createPendingLink(DISCORD_ID);
  await createPendingLink(DISCORD_ID);
  const { error } = await createPendingLink(DISCORD_ID);
  expect(error?.message).toBe('Too many pending codes');
  await cleanup();
});
