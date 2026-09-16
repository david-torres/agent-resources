const { test, expect, describe } = require('bun:test');
const { coveredPages, maxCoveredPage } = require('./prerelease-pages');

describe('coveredPages', () => {
  test('covers every page in each inclusive range', () => {
    expect(coveredPages([{ page_range: [3, 5] }])).toEqual(new Set([3, 4, 5]));
  });

  test('a record with no page_range contributes nothing', () => {
    expect(coveredPages([{ page_range: [3, 4] }, { name: 'CHARLATAN' }]))
      .toEqual(new Set([3, 4]));
  });
});

describe('maxCoveredPage', () => {
  test('is the highest page of any range', () => {
    expect(maxCoveredPage([{ page_range: [3, 5] }, { page_range: [9, 12] }])).toBe(12);
  });

  test('a record with no page_range does not throw', () => {
    expect(maxCoveredPage([{ page_range: [3, 5] }, { name: 'CHARLATAN' }])).toBe(5);
  });

  test('no ranges at all yields 0 rather than -Infinity', () => {
    expect(maxCoveredPage([{ name: 'CHARLATAN' }])).toBe(0);
  });
});
