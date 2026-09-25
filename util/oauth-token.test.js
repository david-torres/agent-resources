const { test, expect, beforeAll } = require('bun:test');
const { generateKeyPair, SignJWT } = require('jose');
const { createOAuthTokenVerifier } = require('./oauth-token');

const ISSUER = 'https://project.example.test/auth/v1';
let keys;
let otherKeys;
let verify;

beforeAll(async () => {
  keys = await generateKeyPair('ES256');
  otherKeys = await generateKeyPair('ES256');
  verify = createOAuthTokenVerifier({ issuer: ISSUER, keys: keys.publicKey });
});

const sign = (claims, { key = keys.privateKey, issuer = ISSUER, expiresIn = '1h', alg = 'ES256' } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);

test('accepts a token from an OAuth grant', async () => {
  const token = await sign({ sub: 'u1', client_id: 'client-1', aud: 'authenticated' });
  const result = await verify(token);
  expect(result.ok).toBe(true);
  expect(result.claims.sub).toBe('u1');
  expect(result.claims.client_id).toBe('client-1');
});

test('rejects a website session token, which has no client_id', async () => {
  const token = await sign({ sub: 'u1', aud: 'authenticated' });
  expect(await verify(token)).toEqual({ ok: false });
});

test('rejects an empty client_id', async () => {
  const token = await sign({ sub: 'u1', client_id: '' });
  expect(await verify(token)).toEqual({ ok: false });
});

test('rejects a token without a subject', async () => {
  const token = await sign({ client_id: 'client-1' });
  expect(await verify(token)).toEqual({ ok: false });
});

test('rejects an expired token', async () => {
  const token = await sign({ sub: 'u1', client_id: 'client-1' }, { expiresIn: Math.floor(Date.now() / 1000) - 60 });
  expect(await verify(token)).toEqual({ ok: false });
});

test('rejects a token from another issuer', async () => {
  const token = await sign({ sub: 'u1', client_id: 'client-1' }, { issuer: 'https://evil.example.test/auth/v1' });
  expect(await verify(token)).toEqual({ ok: false });
});

test('rejects a token signed by another key', async () => {
  const token = await sign({ sub: 'u1', client_id: 'client-1' }, { key: otherKeys.privateKey });
  expect(await verify(token)).toEqual({ ok: false });
});

test('rejects an HS256 token even when the secret is known', async () => {
  const secret = new TextEncoder().encode('shared-secret-shared-secret-shared');
  const token = await sign({ sub: 'u1', client_id: 'client-1' }, { key: secret, alg: 'HS256' });
  expect(await verify(token)).toEqual({ ok: false });
});

test('rejects a string that is not a JWT', async () => {
  expect(await verify('not-a-jwt')).toEqual({ ok: false });
});

test('an unreachable key set is an error, not an invalid token', async () => {
  const failing = createOAuthTokenVerifier({
    issuer: ISSUER,
    keys: async () => { throw new TypeError('fetch failed'); }
  });
  const token = await sign({ sub: 'u1', client_id: 'client-1' });
  await expect(failing(token)).rejects.toThrow('fetch failed');
});
