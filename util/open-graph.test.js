const { test, expect } = require('bun:test');
const { buildOpenGraph, OG_DESCRIPTION_LIMIT } = require('./open-graph');

const BASE = 'https://agent-resources.vip';

test('joins the base URL and path into an absolute og:url', () => {
  const og = buildOpenGraph({ baseUrl: BASE, path: '/characters/abc/Vex', title: 'Vex' });
  expect(og.url).toBe('https://agent-resources.vip/characters/abc/Vex');
});

// The canonical URL of a shared page is the page, not whatever tracking or
// ?lfg= parameter the sharer happened to have on their address bar.
test('strips the query string and hash from og:url', () => {
  const og = buildOpenGraph({ baseUrl: BASE, path: '/characters/abc?lfg=1#stats', title: 'Vex' });
  expect(og.url).toBe('https://agent-resources.vip/characters/abc');
});

test('defaults og:type to website and honors an explicit type', () => {
  expect(buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x' }).type).toBe('website');
  expect(buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x', type: 'article' }).type).toBe('article');
});

test('passes an absolute http(s) image through unchanged', () => {
  const og = buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x', image: 'https://cdn.test/a.png' });
  expect(og.image).toBe('https://cdn.test/a.png');
});

test('makes a root-relative image absolute against the base URL', () => {
  const og = buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x', image: '/img/og-default.png' });
  expect(og.image).toBe('https://agent-resources.vip/img/og-default.png');
});

// A crawler that follows a junk og:image renders a broken card, which is worse
// than the no-image card it would otherwise have drawn.
test('drops an image that is neither absolute http(s) nor root-relative', () => {
  for (const junk of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'img/rel.png', 'ftp://h/a.png', '', null]) {
    expect(buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x', image: junk }).image).toBeUndefined();
  }
});

test('omits og:description when there is nothing to say', () => {
  expect(buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x' }).description).toBeUndefined();
  expect(buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x', description: '   ' }).description).toBeUndefined();
});

test('collapses whitespace and strips markup out of the description', () => {
  const og = buildOpenGraph({
    baseUrl: BASE, path: '/', title: 'x',
    description: '  A <em>brave</em> agent\n\nwho   runs.  '
  });
  expect(og.description).toBe('A brave agent who runs.');
});

test('truncates a long description on a word boundary with an ellipsis', () => {
  const og = buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x', description: 'word '.repeat(100) });

  expect(og.description.length).toBeLessThanOrEqual(OG_DESCRIPTION_LIMIT);
  expect(og.description).toEndWith('…');
  expect(og.description).not.toContain('wor…');
});

test('leaves a description under the limit untruncated', () => {
  const og = buildOpenGraph({ baseUrl: BASE, path: '/', title: 'x', description: 'Short and sweet.' });
  expect(og.description).toBe('Short and sweet.');
});

// Opting out of discovery has to mean the card carries no content either --
// the title and URL are already in the link the sharer pasted.
test('suppressed content keeps title, type and url but emits no description or image', () => {
  const og = buildOpenGraph({
    baseUrl: BASE, path: '/characters/abc', title: 'Vex',
    description: 'Secret backstory', image: 'https://cdn.test/a.png', suppress: true
  });

  expect(og).toEqual({ type: 'website', title: 'Vex', url: 'https://agent-resources.vip/characters/abc' });
});
