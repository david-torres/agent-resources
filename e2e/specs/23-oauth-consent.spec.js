// e2e/specs/23-oauth-consent.spec.js
// Registers OAuth clients with real requests; must never reach the hosted project.
require('../../util/require-local-supabase');

const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { Client } = require('pg');
const { PLAYER_STATE, PLAYER_EMAIL } = require('../global-setup');

const API = process.env.SUPABASE_URL.replace(/\/+$/, '');
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const AUTH = `${API}/auth/v1`;
const REDIRECT_URI = 'https://chatgpt.example.test/callback';
const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: PLAYER_STATE });

let clientId;

test.beforeAll(async () => {
  const res = await fetch(`${AUTH}/oauth/clients/register`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'E2E Connector',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    })
  });
  clientId = (await res.json()).client_id;
});

test.afterAll(async () => {
  if (!clientId) return;
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query('delete from auth.oauth_clients where id = $1', [clientId]);
  } finally {
    await db.end();
  }
});

const startAuthorization = async () => {
  const state = crypto.randomBytes(8).toString('base64url');
  const challenge = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('base64url');
  const url = new URL(`${AUTH}/oauth/authorize`);
  Object.entries({
    client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state,
    scope: 'openid email profile', resource: 'https://agent-resources.vip/api/mcp'
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { redirect: 'manual', headers: { apikey: KEY } });
  const consent = new URL(res.headers.get('location'));
  return { state, path: `${consent.pathname}${consent.search}` };
};

// Runs before the approve test below: once a connector has been approved for
// this client+user, Supabase skips the consent screen on later authorizations
// (see "an already-approved connector" below), so there would be no Deny
// button left to click if this ran after approval.
test('a signed-in player denies a connector and is sent back with access_denied', async ({ page }) => {
  await page.route(`${REDIRECT_URI}**`, (route) => route.fulfill({ status: 200, body: 'callback' }));
  const { state, path } = await startAuthorization();

  await page.goto(path);
  await page.getByRole('button', { name: 'Deny' }).click();

  await page.waitForURL(`${REDIRECT_URI}**`);
  const callback = new URL(page.url());
  expect(callback.searchParams.get('error')).toBe('access_denied');
  expect(callback.searchParams.get('state')).toBe(state);
});

test('a signed-in player approves a connector and is sent back with a code', async ({ page }) => {
  await page.route(`${REDIRECT_URI}**`, (route) => route.fulfill({ status: 200, body: 'callback' }));
  const { state, path } = await startAuthorization();

  await page.goto(path);
  await expect(page.getByText('E2E Connector')).toBeVisible();
  await expect(page.getByText(PLAYER_EMAIL)).toBeVisible();
  await expect(page.getByText('chatgpt.example.test')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();

  await page.waitForURL(`${REDIRECT_URI}**`);
  const callback = new URL(page.url());
  expect(callback.searchParams.get('code')).toBeTruthy();
  expect(callback.searchParams.get('state')).toBe(state);
});

test('an already-approved connector goes straight back without asking again', async ({ page }) => {
  await page.route(`${REDIRECT_URI}**`, (route) => route.fulfill({ status: 200, body: 'callback' }));
  const { state, path } = await startAuthorization();

  await page.goto(path);
  await page.waitForURL(`${REDIRECT_URI}**`);
  expect(new URL(page.url()).searchParams.get('state')).toBe(state);
});

test('an unknown authorization shows an error instead of a blank page', async ({ page }) => {
  await page.goto('/oauth/consent?authorization_id=does-not-exist');
  await expect(page.getByText('expired or is invalid')).toBeVisible();
});
