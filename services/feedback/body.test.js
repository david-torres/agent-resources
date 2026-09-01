const { test, expect, describe } = require('bun:test');
const { buildIssueBody, buildIssueTitle, labelsFor } = require('./body');

const report = {
  kind: 'bug',
  title: 'Character sheet fails to save',
  description: 'I pressed save and nothing happened.',
  pageUrl: 'https://agent-resources.vip/characters/1',
  browserInfo: null,
  consoleLog: null,
  reporter: { name: 'Ada', profileId: 'profile-1' },
  submittedAt: '2026-08-31T12:00:00.000Z'
};

describe('buildIssueTitle / labelsFor', () => {
  test('a bug is titled and labelled as one', () => {
    expect(buildIssueTitle(report)).toBe('[Bug] Character sheet fails to save');
    expect(labelsFor(report)).toEqual(['bug']);
  });

  test('a feature request is titled and labelled as one', () => {
    const feature = { ...report, kind: 'feature', title: 'Sort missions by date' };
    expect(buildIssueTitle(feature)).toBe('[Feature] Sort missions by date');
    expect(labelsFor(feature)).toEqual(['enhancement']);
  });
});

describe('buildIssueBody', () => {
  test('carries the description, reporter, page and timestamp', () => {
    const body = buildIssueBody(report);
    expect(body).toContain('I pressed save and nothing happened.');
    expect(body).toContain('Ada');
    expect(body).toContain('profile-1');
    expect(body).toContain('https://agent-resources.vip/characters/1');
    expect(body).toContain('2026-08-31T12:00:00.000Z');
  });

  test('omits every optional section when nothing was attached', () => {
    const body = buildIssueBody(report);
    expect(body).not.toContain('### Screenshot');
    expect(body).not.toContain('### Browser');
    expect(body).not.toContain('### Console');
  });

  test('embeds an uploaded screenshot as an image', () => {
    const body = buildIssueBody({ ...report, screenshotUrl: 'https://cdn.example/bug.jpg' });
    expect(body).toContain('### Screenshot');
    expect(body).toContain('![Screenshot supplied by the reporter](https://cdn.example/bug.jpg)');
  });

  test('says so when a screenshot was attached but could not be stored', () => {
    const body = buildIssueBody({ ...report, screenshotUrl: null, screenshotFailed: true });
    expect(body).toContain('### Screenshot');
    expect(body).toContain('could not be stored');
    expect(body).not.toContain('![Screenshot');
  });

  test('renders browser info as a table inside a collapsed block', () => {
    const body = buildIssueBody({ ...report, browserInfo: { userAgent: 'Mozilla/5.0', viewport: '1280x800' } });
    expect(body).toContain('<details>');
    expect(body).toContain('| userAgent | Mozilla/5.0 |');
    expect(body).toContain('| viewport | 1280x800 |');
  });

  test('renders console entries in a fenced, collapsed block', () => {
    const body = buildIssueBody({
      ...report,
      consoleLog: [{ level: 'error', at: '2026-08-31T11:59:00.000Z', message: 'Save failed: 500' }]
    });
    expect(body).toContain('Last 1 console entries');
    expect(body).toContain('```');
    expect(body).toContain('[2026-08-31T11:59:00.000Z] ERROR: Save failed: 500');
  });

  // A console line containing its own fence would end the block early and let
  // the rest of the log render as Markdown -- including any HTML in it.
  test('a console entry containing a code fence cannot break out of the block', () => {
    const body = buildIssueBody({
      ...report,
      consoleLog: [{ level: 'log', at: 'now', message: '```\n# not a heading' }]
    });
    expect(body).toContain('````');
    const openingFence = body.slice(body.indexOf('Last 1 console entries')).match(/`{4,}/);
    expect(openingFence).not.toBeNull();
  });

  // Otherwise a report titled "@maintainer please look" pings a real person,
  // and "#123" silently cross-links an unrelated issue.
  test('defuses @mentions and issue references in user text', () => {
    const body = buildIssueBody({
      ...report,
      description: 'cc @octocat, this is like #42',
      reporter: { name: '@ada', profileId: 'profile-1' }
    });
    expect(body).not.toContain('@octocat');
    expect(body).toContain('@<!---->octocat');
    expect(body).not.toContain('#42');
    expect(body).toContain('#<!---->42');
    expect(body).toContain('@<!---->ada');
  });

  test('a feature request asks for the feature rather than the failure', () => {
    const body = buildIssueBody({ ...report, kind: 'feature' });
    expect(body).toContain('### What would you like');
    expect(body).not.toContain('### What happened');
  });
});
