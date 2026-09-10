const { test, expect } = require('bun:test');
const { buildClassTeaser } = require('./teaser');

test('buildClassTeaser returns the first non-empty line of overview with markdown stripped', () => {
  const overview = '## Heading\n\nSome **bold** prose about a thing.';
  expect(buildClassTeaser(overview, null)).toBe('Heading');
});

test('buildClassTeaser skips leading blank lines to find the first actual content line', () => {
  const overview = '\n\n   \nA wandering healer.';
  expect(buildClassTeaser(overview, null)).toBe('A wandering healer.');
});

test('buildClassTeaser skips lines that strip down to nothing, like a lone horizontal rule', () => {
  const overview = '---\n\nA wandering healer.';
  expect(buildClassTeaser(overview, null)).toBe('A wandering healer.');
});

test('buildClassTeaser skips lines that strip down to nothing, like a lone code fence marker', () => {
  const overview = '```\n\nA wandering healer.';
  expect(buildClassTeaser(overview, null)).toBe('A wandering healer.');
});

test('buildClassTeaser appends design credit when designer is a non-empty string', () => {
  const overview = 'A wandering healer.';
  expect(buildClassTeaser(overview, 'Jane Doe')).toBe('A wandering healer. Design by Jane Doe');
});

test('buildClassTeaser appends no credit when designer is blank, null, or undefined', () => {
  const overview = 'A wandering healer.';
  expect(buildClassTeaser(overview, null)).toBe('A wandering healer.');
  expect(buildClassTeaser(overview, undefined)).toBe('A wandering healer.');
  expect(buildClassTeaser(overview, '')).toBe('A wandering healer.');
  expect(buildClassTeaser(overview, '   ')).toBe('A wandering healer.');
});

test('buildClassTeaser returns null when overview is blank, null, undefined, or whitespace-only, regardless of designer', () => {
  expect(buildClassTeaser(null, 'Jane Doe')).toBeNull();
  expect(buildClassTeaser(undefined, 'Jane Doe')).toBeNull();
  expect(buildClassTeaser('', 'Jane Doe')).toBeNull();
  expect(buildClassTeaser('   \n  \n', 'Jane Doe')).toBeNull();
});

test('buildClassTeaser returns null when overview has no usable content line', () => {
  const overview = '\n---\n\n```\n\n   \n';
  expect(buildClassTeaser(overview, null)).toBeNull();
});

test('buildClassTeaser skips a leading "Class Stats:" line and uses the next line', () => {
  const overview = 'Class Stats: ++ LUCK / + VITALITY\n\nYou are an eclectic globetrotter who has seen more places than you can remember.';
  expect(buildClassTeaser(overview, null)).toBe('You are an eclectic globetrotter who has seen more places than you can remember.');
});

test('buildClassTeaser skips a leading "Class Stats:" line even when it is bold-wrapped in markdown', () => {
  const overview = '**Class Stats:** ++ LUCK / + VITALITY\r\n\r\nYou are an eclectic globetrotter who has seen more places than you can remember.';
  expect(buildClassTeaser(overview, null)).toBe('You are an eclectic globetrotter who has seen more places than you can remember.');
});
