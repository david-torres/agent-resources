const { test, expect, describe } = require('bun:test');
const { normalizeFeedbackInput, MAX_TITLE, MAX_CONSOLE_ENTRIES } = require('./input');

const valid = {
  kind: 'bug',
  title: 'Character sheet fails to save',
  description: 'I pressed save and nothing happened at all.'
};

describe('normalizeFeedbackInput', () => {
  test('accepts a bug report and keeps its fields', () => {
    const { data, error } = normalizeFeedbackInput(valid);
    expect(error).toBeNull();
    expect(data.kind).toBe('bug');
    expect(data.title).toBe('Character sheet fails to save');
    expect(data.description).toBe('I pressed save and nothing happened at all.');
  });

  test('rejects an unknown kind', () => {
    const { data, error } = normalizeFeedbackInput({ ...valid, kind: 'complaint' });
    expect(data).toBeNull();
    expect(error.status).toBe(400);
  });

  test('rejects a too-short title and a too-short description', () => {
    expect(normalizeFeedbackInput({ ...valid, title: 'ugh' }).error.status).toBe(400);
    expect(normalizeFeedbackInput({ ...valid, description: 'broken' }).error.status).toBe(400);
  });

  test('collapses newlines in the title and caps its length', () => {
    const { data } = normalizeFeedbackInput({ ...valid, title: `Save\nfails\there ${'x'.repeat(200)}` });
    expect(data.title).not.toContain('\n');
    expect(data.title.length).toBeLessThanOrEqual(MAX_TITLE);
  });

  test('strips control characters from the description', () => {
    const { data } = normalizeFeedbackInput({ ...valid, description: 'save \u0000 fails \u001b[31mred\u001b[0m every time' });
    expect(data.description).not.toContain('\u0000');
    expect(data.description).not.toContain('\u001b');
    expect(data.description).toContain('fails');
  });

  test('accepts a JSON-encoded browser info object and drops unknown keys', () => {
    const { data } = normalizeFeedbackInput({
      ...valid,
      browser_info: JSON.stringify({ userAgent: 'Mozilla/5.0', viewport: '1280x800', authToken: 'secret' })
    });
    expect(data.browserInfo).toEqual({ userAgent: 'Mozilla/5.0', viewport: '1280x800' });
    expect(data.browserInfo.authToken).toBeUndefined();
  });

  test('non-object browser info becomes null rather than an error', () => {
    expect(normalizeFeedbackInput({ ...valid, browser_info: 'not json' }).data.browserInfo).toBeNull();
    expect(normalizeFeedbackInput({ ...valid, browser_info: '[1,2]' }).data.browserInfo).toBeNull();
  });

  test('keeps the most recent console entries and normalizes unknown levels', () => {
    const entries = Array.from({ length: MAX_CONSOLE_ENTRIES + 10 }, (_, i) => ({
      level: i === 0 ? 'trace' : 'warn',
      at: '2026-08-31T00:00:00.000Z',
      message: `entry ${i}`
    }));
    const { data } = normalizeFeedbackInput({ ...valid, console_log: JSON.stringify(entries) });

    expect(data.consoleLog).toHaveLength(MAX_CONSOLE_ENTRIES);
    // The tail, not the head: the entries nearest the report are the useful ones.
    expect(data.consoleLog[data.consoleLog.length - 1].message).toBe(`entry ${entries.length - 1}`);
    expect(data.consoleLog.every((entry) => ['log', 'info', 'warn', 'error', 'debug'].includes(entry.level))).toBe(true);
  });

  test('drops empty console entries entirely', () => {
    const { data } = normalizeFeedbackInput({ ...valid, console_log: JSON.stringify([{ level: 'warn', message: '   ' }]) });
    expect(data.consoleLog).toBeNull();
  });

  test('keeps an http(s) page URL and rejects any other scheme', () => {
    expect(normalizeFeedbackInput({ ...valid, page_url: 'https://agent-resources.vip/characters' }).data.pageUrl)
      .toBe('https://agent-resources.vip/characters');
    expect(normalizeFeedbackInput({ ...valid, page_url: 'javascript:alert(1)' }).data.pageUrl).toBeNull();
    expect(normalizeFeedbackInput({ ...valid, page_url: '/characters' }).data.pageUrl).toBeNull();
  });

  test('a feature request carries no diagnostics even when they are posted', () => {
    const { data } = normalizeFeedbackInput({
      ...valid,
      kind: 'feature',
      browser_info: JSON.stringify({ userAgent: 'Mozilla/5.0' }),
      console_log: JSON.stringify([{ level: 'error', message: 'boom' }])
    });
    expect(data.kind).toBe('feature');
    expect(data.browserInfo).toBeNull();
    expect(data.consoleLog).toBeNull();
  });
});
