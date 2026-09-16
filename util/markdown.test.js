const { test, expect, describe } = require('bun:test');
const { renderMarkdown, renderPowerRatings } = require('./markdown');

test('renders basic markdown to HTML', () => {
  expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
});

test('strips script tags', () => {
  const out = renderMarkdown('hello <script>alert(1)</script>');
  expect(out).not.toContain('<script');
  expect(out).not.toContain('alert(1)');
});

test('strips on* handlers', () => {
  const out = renderMarkdown('<img src=x onerror="alert(1)">');
  expect(out).not.toContain('onerror');
});

test('blocks javascript: hrefs', () => {
  const out = renderMarkdown('[click](javascript:alert(1))');
  expect(out).not.toContain('javascript:');
});

test('allows http and https links', () => {
  const out = renderMarkdown('[ok](https://example.com)');
  expect(out).toContain('href="https://example.com"');
});

test('returns empty string for nullish input', () => {
  expect(renderMarkdown(null)).toBe('');
  expect(renderMarkdown(undefined)).toBe('');
  expect(renderMarkdown('')).toBe('');
});

test('links carry rel=noopener noreferrer and target=_blank', () => {
  const out = renderMarkdown('[x](https://example.com)');
  expect(out).toContain('rel="noopener noreferrer"');
  expect(out).toContain('target="_blank"');
});

test('strips iframe/object/embed', () => {
  expect(renderMarkdown('<iframe src="https://x"></iframe>')).not.toContain('<iframe');
  expect(renderMarkdown('<object data="x"></object>')).not.toContain('<object');
  expect(renderMarkdown('<embed src="x">')).not.toContain('<embed');
});

test('blocks data: and vbscript: schemes', () => {
  expect(renderMarkdown('![x](data:image/svg+xml,<svg/>)')).not.toContain('data:');
  expect(renderMarkdown('[x](vbscript:msgbox)')).not.toContain('vbscript');
});

test('strips style and srcset attributes', () => {
  const out = renderMarkdown('<img src="https://x/y" style="color:red" srcset="y">');
  expect(out).not.toContain('style=');
  expect(out).not.toContain('srcset=');
});

describe('renderPowerRatings', () => {
  test('keeps a superscript power rating', () => {
    expect(renderPowerRatings('are Boosted <sup>L–H</sup>'))
      .toBe('are Boosted <sup>L–H</sup>');
  });

  test('strips a script tag and its contents', () => {
    expect(renderPowerRatings('<script>alert(1)</script>tail')).toBe('tail');
  });

  test('strips an image with an event handler', () => {
    expect(renderPowerRatings('<img src=x onerror=alert(1)>')).toBe('');
  });

  test('strips a javascript: link but keeps its text', () => {
    expect(renderPowerRatings('<a href="javascript:alert(1)">x</a>')).toBe('x');
  });

  test('strips an event handler from the sup tag itself', () => {
    expect(renderPowerRatings('<sup onclick="x">L</sup>')).toBe('<sup>L</sup>');
  });

  test('escapes stray angle brackets', () => {
    expect(renderPowerRatings('5 < 6')).toBe('5 &lt; 6');
  });

  test('does not interpret markdown syntax', () => {
    expect(renderPowerRatings('*not* _em_ # nor')).toBe('*not* _em_ # nor');
  });

  test('empty input yields an empty string', () => {
    expect(renderPowerRatings(null)).toBe('');
    expect(renderPowerRatings(undefined)).toBe('');
  });
});
