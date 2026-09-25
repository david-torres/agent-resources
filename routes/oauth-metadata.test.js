const { test, expect, beforeAll, afterAll, afterEach, mock } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next()
}));

const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;
const originalSiteUrl = process.env.SITE_URL;

beforeAll(async () => {
  const { createApp } = require('../app');
  ({ server, baseUrl } = await startHttpServer(createApp()));
});
afterAll(async () => { await stopHttpServer(server); });
afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

const expected = (origin) => ({
  resource: `${origin}/api/mcp`,
  authorization_servers: ['https://test.invalid/auth/v1'],
  scopes_supported: ['openid', 'email', 'profile'],
  bearer_methods_supported: ['header'],
  resource_name: 'AgentResources'
});

test.each([
  '/.well-known/oauth-protected-resource/api/mcp',
  '/.well-known/oauth-protected-resource'
])('%s describes the MCP resource and its authorization server', async (path) => {
  process.env.SITE_URL = 'https://agent-resources.vip/';
  const res = await fetch(`${baseUrl}${path}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(await res.json()).toEqual(expected('https://agent-resources.vip'));
});

test('SITE_URL wins over a spoofed Host header', async () => {
  process.env.SITE_URL = 'https://agent-resources.vip';
  const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/api/mcp`, { headers: { Host: 'evil.example.test' } });
  expect((await res.json()).resource).toBe('https://agent-resources.vip/api/mcp');
});
