// Behavior of the `oauthConsent` Alpine component
// (public/js/alpine-components.js), driven through a real Alpine mount the
// way test/feedback-widget-component.test.js drives the feedback widget.
//
// The rule worth pinning hardest: OAuth clients register themselves through
// open dynamic client registration, so `redirect_uri`/`redirect_url` is
// attacker-controlled. leave() must never navigate anywhere but http(s), and
// the consent screen must tell the user which host they are about to be
// handed back to.
const { test, expect, beforeAll, beforeEach, afterEach } = require('bun:test');
const { setupAlpine, render, tick } = require('./helpers/alpine-dom');

const DETAILS = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://chatgpt.example.test/callback',
  client: { id: 'c1', name: 'ChatGPT' },
  user: { id: 'u1', email: 'user@example.com' },
  scope: 'openid email'
};

let oauthCalls;
let consoleErrors;
let realConsoleError;

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

beforeEach(() => {
  oauthCalls = { approve: 0, deny: 0 };
  globalThis.App = {
    oauth: {
      getAuthorizationDetails: async () => ({ data: DETAILS, error: null }),
      approveAuthorization: async () => {
        oauthCalls.approve += 1;
        return { data: { redirect_url: 'https://chatgpt.example.test/callback?code=abc' }, error: null };
      },
      denyAuthorization: async () => {
        oauthCalls.deny += 1;
        return { data: { redirect_url: 'https://chatgpt.example.test/callback?error=access_denied' }, error: null };
      }
    }
  };
  consoleErrors = [];
  realConsoleError = console.error;
  console.error = (...args) => { consoleErrors.push(args); };
});

afterEach(() => {
  console.error = realConsoleError;
});

const mount = async (authorizationId = 'auth-1') => {
  await render(`<div id="w" x-data="oauthConsent('${authorizationId}')"></div>`);
  return Alpine.$data(document.getElementById('w'));
};

test('load() shows the client, the requester, and the host the user will be sent back to', async () => {
  const widget = await mount();

  await widget.load();

  expect(widget.state).toBe('ready');
  expect(widget.clientName).toBe('ChatGPT');
  expect(widget.email).toBe('user@example.com');
  expect(widget.redirectHost).toBe('chatgpt.example.test');
});

test('a redirect_uri that is missing or unparseable shows no host line', async () => {
  globalThis.App.oauth.getAuthorizationDetails = async () => ({
    data: { ...DETAILS, redirect_uri: undefined },
    error: null
  });
  const widget = await mount();

  await widget.load();

  expect(widget.state).toBe('ready');
  expect(widget.redirectHost).toBe('');
});

test('load() refuses a javascript: redirect_url from an already-consented authorization, without navigating', async () => {
  globalThis.App.oauth.getAuthorizationDetails = async () => ({
    data: { redirect_url: 'javascript:alert(1)' },
    error: null
  });
  const widget = await mount();

  await widget.load();

  expect(widget.state).toBe('error');
  expect(widget.error).toContain('expired or is invalid');
});

test('load() refuses a data: redirect_url from an already-consented authorization, without navigating', async () => {
  globalThis.App.oauth.getAuthorizationDetails = async () => ({
    data: { redirect_url: 'data:text/html,<script>alert(1)</script>' },
    error: null
  });
  const widget = await mount();

  await widget.load();

  expect(widget.state).toBe('error');
  expect(widget.error).toContain('expired or is invalid');
});

test('load() follows an already-consented https redirect_url', async () => {
  globalThis.App.oauth.getAuthorizationDetails = async () => ({
    data: { redirect_url: 'https://chatgpt.example.test/callback?code=xyz' },
    error: null
  });
  const widget = await mount();

  await widget.load();

  expect(widget.state).toBe('redirecting');
});

test('decide() refuses a javascript: redirect_url from approveAuthorization, without navigating', async () => {
  globalThis.App.oauth.approveAuthorization = async () => ({
    data: { redirect_url: 'javascript:alert(1)' },
    error: null
  });
  const widget = await mount();
  await widget.load();

  await widget.decide('approve');

  expect(widget.state).toBe('error');
  expect(widget.error).toContain('expired or is invalid');
  expect(widget.busy).toBe(false);
});

test('decide() refuses a data: redirect_url from denyAuthorization, without navigating', async () => {
  globalThis.App.oauth.denyAuthorization = async () => ({
    data: { redirect_url: 'data:text/html,<script>alert(1)</script>' },
    error: null
  });
  const widget = await mount();
  await widget.load();

  await widget.decide('deny');

  expect(widget.state).toBe('error');
  expect(widget.error).toContain('expired or is invalid');
  expect(widget.busy).toBe(false);
});

test('decide() follows an https redirect_url from approveAuthorization', async () => {
  const widget = await mount();
  await widget.load();

  await widget.decide('approve');

  expect(widget.state).toBe('redirecting');
  expect(oauthCalls.approve).toBe(1);
});

test('an unexpected error is shown as a generic message and logged, not surfaced raw', async () => {
  globalThis.App.oauth.getAuthorizationDetails = async () => { throw new Error('fetch failed: ECONNRESET'); };
  const widget = await mount();

  await widget.load();

  expect(widget.state).toBe('error');
  expect(widget.error).not.toContain('ECONNRESET');
  expect(widget.error).toBe('An unexpected error occurred. Please try again.');
  expect(consoleErrors.length).toBe(1);
});

test('the sign-in library missing error is still shown verbatim', async () => {
  const err = new Error('This page could not load the sign-in library. Please reload and try again.');
  err.userFacing = true;
  globalThis.App.oauth.getAuthorizationDetails = async () => { throw err; };
  const widget = await mount();

  await widget.load();

  expect(widget.state).toBe('error');
  expect(widget.error).toBe('This page could not load the sign-in library. Please reload and try again.');
});
