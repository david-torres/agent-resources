const { test, expect } = require('bun:test');
const { parseImageCrop } = require('./crop');

test('returns undefined for nullish or empty input', () => {
  expect(parseImageCrop(null)).toBeUndefined();
  expect(parseImageCrop(undefined)).toBeUndefined();
  expect(parseImageCrop('')).toBeUndefined();
  expect(parseImageCrop('null')).toBeUndefined();
  expect(parseImageCrop('undefined')).toBeUndefined();
});

test('returns undefined for invalid JSON string', () => {
  expect(parseImageCrop('{not json')).toBeUndefined();
  expect(parseImageCrop('[1,2,3')).toBeUndefined();
});

test('returns undefined for non-string non-object', () => {
  expect(parseImageCrop(42)).toBeUndefined();
  expect(parseImageCrop(true)).toBeUndefined();
});

test('returns undefined for array', () => {
  expect(parseImageCrop([0.1, 0.2, 0.3, 0.4])).toBeUndefined();
  expect(parseImageCrop('[0.1,0.2,0.3,0.4]')).toBeUndefined();
});

test('parses valid object input', () => {
  const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
  expect(parseImageCrop(crop)).toEqual(crop);
});

test('parses valid JSON string input', () => {
  const result = parseImageCrop('{"x":0.1,"y":0.2,"width":0.5,"height":0.4}');
  expect(result).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
});

test('rejects missing required fields', () => {
  expect(parseImageCrop({ x: 0.1, y: 0.2, width: 0.5 })).toBeUndefined();
  expect(parseImageCrop({ y: 0.2, width: 0.5, height: 0.4 })).toBeUndefined();
});

test('rejects non-number coordinates', () => {
  expect(parseImageCrop({ x: '0.1', y: 0.2, width: 0.5, height: 0.4 })).toBeUndefined();
  expect(parseImageCrop({ x: 0.1, y: null, width: 0.5, height: 0.4 })).toBeUndefined();
});

test('rejects out-of-range coordinates', () => {
  expect(parseImageCrop({ x: -0.1, y: 0.2, width: 0.5, height: 0.4 })).toBeUndefined();
  expect(parseImageCrop({ x: 1.1, y: 0.2, width: 0.5, height: 0.4 })).toBeUndefined();
  expect(parseImageCrop({ x: 0, y: 0, width: 0, height: 0.4 })).toBeUndefined();
  expect(parseImageCrop({ x: 0, y: 0, width: 1.5, height: 0.4 })).toBeUndefined();
});

test('accepts boundary values', () => {
  expect(parseImageCrop({ x: 0, y: 0, width: 1, height: 1 })).toEqual({
    x: 0, y: 0, width: 1, height: 1
  });
});

test('includes natural dimensions when valid', () => {
  const result = parseImageCrop({
    x: 0.1, y: 0.2, width: 0.5, height: 0.4,
    naturalWidth: 1920, naturalHeight: 1080
  });
  expect(result).toEqual({
    x: 0.1, y: 0.2, width: 0.5, height: 0.4,
    naturalWidth: 1920, naturalHeight: 1080
  });
});

test('rejects invalid natural dimensions', () => {
  const base = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
  expect(parseImageCrop({ ...base, naturalWidth: 0 })).toBeUndefined();
  expect(parseImageCrop({ ...base, naturalWidth: -100 })).toBeUndefined();
  expect(parseImageCrop({ ...base, naturalWidth: Infinity })).toBeUndefined();
  expect(parseImageCrop({ ...base, naturalHeight: NaN })).toBeUndefined();
});

test('omits absent natural dimensions from result', () => {
  const result = parseImageCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 });
  expect(result).not.toHaveProperty('naturalWidth');
  expect(result).not.toHaveProperty('naturalHeight');
});

test('strips extra fields', () => {
  const result = parseImageCrop({
    x: 0.1, y: 0.2, width: 0.5, height: 0.4,
    extra: 'ignored', malicious: '<script>'
  });
  expect(result).not.toHaveProperty('extra');
  expect(result).not.toHaveProperty('malicious');
});
