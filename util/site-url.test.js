const { test, expect, afterEach } = require('bun:test');
const { resolveBaseUrl } = require('./site-url');

const originalSiteUrl = process.env.SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

const request = ({ protocol = 'http', host = 'localhost:3000', headers = {} } = {}) => ({
  protocol,
  get: (name) => headers[name.toLowerCase()]
    ?? (name.toLowerCase() === 'host' ? host : undefined)
});

test('SITE_URL wins over the request, with trailing slashes trimmed', () => {
  process.env.SITE_URL = 'https://agent-resources.vip//';
  expect(resolveBaseUrl(request())).toBe('https://agent-resources.vip');
});

test('a blank SITE_URL falls back to the request scheme and host', () => {
  process.env.SITE_URL = '   ';
  expect(resolveBaseUrl(request({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
});

test('X-Forwarded-Proto beats req.protocol behind a TLS-terminating proxy', () => {
  delete process.env.SITE_URL;
  const req = request({ protocol: 'http', host: 'app.test', headers: { 'x-forwarded-proto': 'https, http' } });
  expect(resolveBaseUrl(req)).toBe('https://app.test');
});
