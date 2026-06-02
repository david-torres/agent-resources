// util/http-error.test.js
const { test, expect } = require('bun:test');
const { classifyError } = require('./http-error');

const FRIENDLY = "We couldn't find that, or you don't have access to it.";

test('PGRST116 maps to a friendly 404', () => {
  const d = classifyError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
  expect(d.status).toBe(404);
  expect(d.title).toBe('Not found');
  expect(d.message).toBe(FRIENDLY);
});

test('42501 (RLS/permission) maps to a friendly 403', () => {
  const d = classifyError({ code: '42501', message: 'permission denied' });
  expect(d.status).toBe(403);
  expect(d.title).toBe('No access');
  expect(d.message).toBe(FRIENDLY);
});

test('23505 (unique violation) maps to 409', () => {
  const d = classifyError({ code: '23505', message: 'duplicate key' });
  expect(d.status).toBe(409);
  expect(d.title).toBe('Already exists');
});

test('null error falls back to 404 Not found', () => {
  const d = classifyError(null);
  expect(d.status).toBe(404);
  expect(d.message).toBe(FRIENDLY);
});

test('fallback overrides win over the default mapping', () => {
  const d = classifyError(null, { status: 403, title: 'No access', message: 'Custom.' });
  expect(d.status).toBe(403);
  expect(d.title).toBe('No access');
  expect(d.message).toBe('Custom.');
});

test('unknown error is 500; non-production exposes the raw message', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const d = classifyError({ message: 'boom' });
  expect(d.status).toBe(500);
  expect(d.message).toBe('boom');
  process.env.NODE_ENV = prev;
});

test('unknown error in production hides the raw message', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const d = classifyError({ message: 'boom' });
  expect(d.status).toBe(500);
  expect(d.message).toBe('An unexpected error occurred. Please try again.');
  process.env.NODE_ENV = prev;
});

test('unknown error with NODE_ENV unset fails safe and hides the raw message', () => {
  const prev = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const d = classifyError({ message: 'boom' });
  expect(d.status).toBe(500);
  expect(d.message).toBe('An unexpected error occurred. Please try again.');
  if (prev === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prev;
});

const { sendError } = require('./http-error');

function mockRes() {
  const res = { statusCode: 200, headers: {}, headersSent: false };
  res.status = (s) => { res.statusCode = s; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.json = (b) => { res.body = b; res.headersSent = true; return res; };
  res.render = (view, data) => { res.rendered = { view, data }; res.headersSent = true; return res; };
  return res;
}
function mockReq({ htmx = false, html = true } = {}) {
  return {
    get: (h) => (h === 'HX-Request' && htmx ? 'true' : undefined),
    accepts: (t) => (t === 'html' ? html : false),
  };
}

test('sendError (HTMX) renders error-inline and retargets #alerts', () => {
  const res = mockRes();
  sendError(mockReq({ htmx: true }), res, { code: 'PGRST116' });
  expect(res.statusCode).toBe(404);
  expect(res.headers['HX-Retarget']).toBe('#alerts');
  expect(res.headers['HX-Reswap']).toBe('innerHTML');
  expect(res.rendered.view).toBe('error-inline');
  expect(res.rendered.data.layout).toBe(false);
});

test('sendError (HTML) renders the full error page', () => {
  const res = mockRes();
  sendError(mockReq({ htmx: false, html: true }), res, { code: 'PGRST116' });
  expect(res.statusCode).toBe(404);
  expect(res.rendered.view).toBe('error');
  expect(res.rendered.data.title).toBe('Not found');
});

test('sendError (API/JSON) returns json error', () => {
  const res = mockRes();
  sendError(mockReq({ htmx: false, html: false }), res, { code: 'PGRST116' });
  expect(res.statusCode).toBe(404);
  expect(res.body.error).toBeDefined();
});

test('sendError short-circuits when headers already sent', () => {
  const res = mockRes();
  res.headersSent = true;
  sendError(mockReq(), res, { code: 'PGRST116' });
  expect(res.rendered).toBeUndefined();
  expect(res.body).toBeUndefined();
});
