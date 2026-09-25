require('../util/require-local-supabase');

const crypto = require('node:crypto');
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { supabaseAdmin } = require('../models/_base');
const { getProfile } = require('../models/profile');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

const API = process.env.SUPABASE_URL.replace(/\/+$/, '');
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const AUTH = `${API}/auth/v1`;
const REDIRECT_URI = 'https://chatgpt.example.test/callback';
const EMAIL = `mcp-oauth-${crypto.randomUUID()}@example.test`;
const PASSWORD = `pw-${crypto.randomUUID()}`;
const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const base64url = (buffer) => buffer.toString('base64url');
let server;
let baseUrl;
let userId;
let clientId;
let sessionJwt;

const json = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

beforeAll(async () => {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  // createUser's own response omits confirmed_at (only email_confirmed_at is
  // set); getProfile only provisions when the user looks confirmed, so
  // re-fetch the user the way a verified session would see it.
  const { data: fetched, error: fetchError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (fetchError) throw fetchError;
  await getProfile(fetched.user);

  const signIn = await json(await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  }));
  sessionJwt = signIn.body.access_token;

  const registered = await json(await fetch(`${AUTH}/oauth/clients/register`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'MCP OAuth integration',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    })
  }));
  expect(registered.status).toBe(201);
  clientId = registered.body.client_id;

  const { createApp } = require('../app');
  ({ server, baseUrl } = await startHttpServer(createApp()));
});

// Runs one cleanup statement in isolation so a failure in an earlier one
// (e.g. a stale FK left by a previous partial run) can't skip the rest --
// every row this run created must still be attempted.
const cleanupStep = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.error(`afterAll cleanup step failed (${label}):`, err.message);
  }
};

afterAll(async () => {
  if (server) await stopHttpServer(server);
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    if (userId) {
      // getProfile's starter grant wrote a rules_pdf_unlocks row referencing
      // the profile; it must go before the profile can be deleted.
      await cleanupStep('rules_pdf_unlocks', () => db.query('delete from public.rules_pdf_unlocks where user_id = $1', [userId]));
      await cleanupStep('profiles', () => db.query('delete from public.profiles where user_id = $1', [userId]));
      await cleanupStep('auth.users', () => db.query('delete from auth.users where id = $1', [userId]));
    }
    // auth.oauth_authorizations and auth.oauth_consents both FK client_id
    // ON DELETE CASCADE, so this alone clears any authorization/consent rows
    // the flow created for this client.
    if (clientId) await cleanupStep('oauth_clients', () => db.query('delete from auth.oauth_clients where id = $1', [clientId]));
  } finally {
    await db.end();
  }
});

const mcp = (authorization) => fetch(`${baseUrl}/api/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(authorization ? { Authorization: authorization } : {})
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'getMe', arguments: {} } })
});

test('a ChatGPT-style OAuth grant yields a token that works on /api/mcp', async () => {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(8));
  const resource = 'https://agent-resources.vip/api/mcp';

  const authorize = new URL(`${AUTH}/oauth/authorize`);
  Object.entries({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'openid email profile',
    resource
  }).forEach(([key, value]) => authorize.searchParams.set(key, value));
  const started = await fetch(authorize, { redirect: 'manual', headers: { apikey: KEY } });
  expect(started.status).toBe(302);
  const consentUrl = new URL(started.headers.get('location'));
  expect(consentUrl.pathname).toBe('/oauth/consent');
  const authorizationId = consentUrl.searchParams.get('authorization_id');

  const userHeaders = { apikey: KEY, Authorization: `Bearer ${sessionJwt}`, 'Content-Type': 'application/json' };
  const details = await json(await fetch(`${AUTH}/oauth/authorizations/${authorizationId}`, { headers: userHeaders }));
  expect(details.status).toBe(200);
  expect(details.body.client.name).toBe('MCP OAuth integration');

  const approved = await json(await fetch(`${AUTH}/oauth/authorizations/${authorizationId}/consent`, {
    method: 'POST', headers: userHeaders, body: JSON.stringify({ action: 'approve' })
  }));
  expect(approved.status).toBe(200);
  const callback = new URL(approved.body.redirect_url);
  expect(callback.searchParams.get('state')).toBe(state);

  const token = await json(await fetch(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code'),
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource
    })
  }));
  expect(token.status).toBe(200);

  const res = await mcp(`Bearer ${token.body.access_token}`);
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.result.isError).toBeFalsy();
  expect(body.result.structuredContent.user).toEqual({ id: userId });
  expect(body.result.structuredContent.token).toEqual({ type: 'oauth', client_id: clientId });
});

test('the same user\'s website session token is refused', async () => {
  const res = await mcp(`Bearer ${sessionJwt}`);
  expect(res.status).toBe(401);
  expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
});
