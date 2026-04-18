const { test, expect } = require('bun:test');
const { generateLinkCode, formatLinkCode } = require('./bot-link');

test('generateLinkCode returns 8 uppercase alphanumeric characters', () => {
  const code = generateLinkCode();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
});

test('generateLinkCode returns distinct values across calls', () => {
  const codes = new Set();
  for (let i = 0; i < 100; i++) codes.add(generateLinkCode());
  expect(codes.size).toBe(100);
});

test('formatLinkCode inserts a dash after the first four characters', () => {
  expect(formatLinkCode('A3F79K2P')).toBe('A3F7-9K2P');
});

test('formatLinkCode throws on malformed codes', () => {
  expect(() => formatLinkCode('short')).toThrow();
  expect(() => formatLinkCode('lowercase')).toThrow();
});

const { normalizeLinkCode, isValidDiscordUserId } = require('./bot-link');

test('normalizeLinkCode strips dashes and uppercases', () => {
  expect(normalizeLinkCode('a3f7-9k2p')).toBe('A3F79K2P');
  expect(normalizeLinkCode('A3F7 9K2P')).toBe('A3F79K2P');
});

test('normalizeLinkCode returns null on bad input', () => {
  expect(normalizeLinkCode('short')).toBe(null);
  expect(normalizeLinkCode('BAD!CODE')).toBe(null);
  expect(normalizeLinkCode(null)).toBe(null);
});

test('isValidDiscordUserId accepts numeric strings, rejects everything else', () => {
  expect(isValidDiscordUserId('123456789012345678')).toBe(true);
  expect(isValidDiscordUserId('0')).toBe(true);
  expect(isValidDiscordUserId('123abc')).toBe(false);
  expect(isValidDiscordUserId('')).toBe(false);
  expect(isValidDiscordUserId(null)).toBe(false);
});
