// A failure inside the MCP transport must reach the app's central error
// handler, so the client gets a prompt generic 500 instead of a hung request.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// mock.module resolves this specifier to the SDK's ESM build while routes/mcp.js
// requires the CJS build, so the CJS class is patched directly instead.
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const realHandleRequest = StreamableHTTPServerTransport.prototype.handleRequest;
const realNavLoader = require('../util/nav-loader');
const realAgentToken = require('../models/agent-token');

const TRANSPORT_ERROR_TEXT = 'transport exploded: secret internals';
const VALID_TOKEN = 'ar_pat_valid_secret_value';

mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next()
}));
mock.module('../models/agent-token', () => ({
  ...realAgentToken,
  verifyAgentToken: async (token) => (token === VALID_TOKEN
    ? { data: { userId: 'u1', profile: { id: 'p1', user_id: 'u1', name: 'Agent Owner', role: 'admin', timezone: 'UTC' }, tokenId: 't1', tokenName: 'Bot', tokenHint: 'alue' }, error: null }
    : { data: null, error: new Error('bad token') })
}));

const forget = (path) => {
  try {
    delete require.cache[require.resolve(path)];
  } catch {
    // Not every module exists yet; nothing cached to forget.
  }
};
const forgetAll = () => ['../routes/mcp', '../app'].forEach(forget);

let server;
let baseUrl;
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

beforeAll(async () => {
  StreamableHTTPServerTransport.prototype.handleRequest = async () => {
    throw new Error(TRANSPORT_ERROR_TEXT);
  };
  forgetAll();
  const { createApp } = require('../app');
  ({ server, baseUrl } = await startHttpServer(createApp()));
});

afterAll(async () => {
  server.closeAllConnections?.();
  await stopHttpServer(server);
  StreamableHTTPServerTransport.prototype.handleRequest = realHandleRequest;
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/agent-token', () => realAgentToken);
  forgetAll();
});

test('a transport failure answers a prompt generic 500 without leaking the error', async () => {
  const res = await fetch(`${baseUrl}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${VALID_TOKEN}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(2000)
  });
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error: 'An unexpected error occurred. Please try again.' });
  expect(text).not.toContain('transport exploded');
  expect(text).not.toContain('secret internals');
});
