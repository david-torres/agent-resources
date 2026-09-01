// Behavior of the `feedbackWidget` Alpine component
// (public/js/alpine-components.js), driven through a real Alpine mount the
// way views/partials/modal.test.js drives the shared modal.
//
// The rules worth pinning are the privacy ones: nothing about the browser
// leaves the page unless the user ticked the box for it, a capture that fails
// must not leave a ticked box claiming an attachment that does not exist, and
// a feature request never carries diagnostics at all.
const { test, expect, beforeAll, beforeEach } = require('bun:test');
const { setupAlpine, render, tick } = require('./helpers/alpine-dom');

let appCalls;

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

// The component reaches for the App global (public/js/app.js), which owns the
// auth token and every browser API involved. Here it is a spy.
beforeEach(() => {
  appCalls = { submitted: [], screenshots: 0 };
  globalThis.App = {
    getBrowserInfo: () => ({ userAgent: 'Mozilla/5.0 (Test)' }),
    getConsoleLog: () => [{ level: 'error', at: 'now', message: 'boom' }],
    captureScreenshot: async () => {
      appCalls.screenshots += 1;
      return { dataUrl: 'data:image/jpeg;base64,AAAA', blob: { size: 4 } };
    },
    submitFeedback: async (payload) => {
      appCalls.submitted.push(payload);
      return { url: 'https://github.com/o/r/issues/9', number: 9 };
    }
  };
  document.body.classList.remove('modal-open');
});

const WIDGET = `
  <div id="w" data-feedback-widget x-data="feedbackWidget()"
       @open-modal.window="open($event.detail)"
       @keydown.escape.window="close()">
    <button id="fab" @click="openReporter()"></button>
    <div id="m" class="modal" :class="{ 'is-active': show }"></div>
  </div>
`;

const mount = async () => {
  await render(WIDGET);
  return Alpine.$data(document.getElementById('w'));
};

const fill = (widget, overrides = {}) => {
  widget.title = 'Character sheet fails to save';
  widget.description = 'I pressed save and nothing happened.';
  Object.assign(widget, overrides);
};

test('the reporter starts closed and opens from the bug button', async () => {
  const widget = await mount();
  expect(document.getElementById('m').classList.contains('is-active')).toBe(false);

  document.getElementById('fab').click();
  await tick();

  expect(widget.show).toBe(true);
  expect(document.getElementById('m').classList.contains('is-active')).toBe(true);
  expect(document.body.classList.contains('modal-open')).toBe(true);
});

test('every diagnostic starts opted out', async () => {
  const widget = await mount();
  expect(widget.withScreenshot).toBe(false);
  expect(widget.withBrowserInfo).toBe(false);
  expect(widget.withConsoleLog).toBe(false);
});

test('an untouched report sends no browser data at all', async () => {
  const widget = await mount();
  fill(widget);

  await widget.submit();

  expect(appCalls.submitted).toHaveLength(1);
  expect(appCalls.submitted[0].browserInfo).toBeNull();
  expect(appCalls.submitted[0].consoleLog).toBeNull();
  expect(appCalls.submitted[0].screenshotBlob).toBeNull();
});

test('opted-in diagnostics are collected and sent', async () => {
  const widget = await mount();
  fill(widget, { withBrowserInfo: true, withConsoleLog: true, withScreenshot: true });
  widget.toggleBrowserInfo();
  widget.toggleConsoleLog();
  await widget.toggleScreenshot();

  await widget.submit();

  const payload = appCalls.submitted[0];
  expect(payload.browserInfo).toEqual({ userAgent: 'Mozilla/5.0 (Test)' });
  expect(payload.consoleLog).toEqual([{ level: 'error', at: 'now', message: 'boom' }]);
  expect(payload.screenshotBlob).toEqual({ size: 4 });
});

test('ticking the screenshot box captures once and previews the result', async () => {
  const widget = await mount();
  widget.withScreenshot = true;

  await widget.toggleScreenshot();

  expect(appCalls.screenshots).toBe(1);
  expect(widget.screenshotDataUrl).toBe('data:image/jpeg;base64,AAAA');
});

test('unticking the box discards the captured image', async () => {
  const widget = await mount();
  widget.withScreenshot = true;
  await widget.toggleScreenshot();

  widget.withScreenshot = false;
  await widget.toggleScreenshot();

  expect(widget.screenshotDataUrl).toBe('');
  expect(widget.screenshotBlob).toBeNull();
});

// A ticked box with no image behind it would promise the maintainer a
// screenshot the issue never gets.
test('a failed capture unticks the box and says why', async () => {
  const widget = await mount();
  globalThis.App.captureScreenshot = async () => { throw new Error('The screenshot tool could not be loaded.'); };
  widget.withScreenshot = true;

  await widget.toggleScreenshot();

  expect(widget.withScreenshot).toBe(false);
  expect(widget.screenshotBlob).toBeNull();
  expect(widget.error).toBe('The screenshot tool could not be loaded.');
});

test('a feature request sends no diagnostics even when the boxes were ticked as a bug', async () => {
  const widget = await mount();
  fill(widget, { withBrowserInfo: true, withConsoleLog: true, withScreenshot: true });
  widget.toggleBrowserInfo();
  widget.toggleConsoleLog();
  await widget.toggleScreenshot();
  widget.kind = 'feature';

  await widget.submit();

  const payload = appCalls.submitted[0];
  expect(payload.kind).toBe('feature');
  expect(payload.browserInfo).toBeNull();
  expect(payload.consoleLog).toBeNull();
  expect(payload.screenshotBlob).toBeNull();
});

test('a too-short report is refused before any request is made', async () => {
  const widget = await mount();
  fill(widget, { title: 'oops' });

  await widget.submit();

  expect(appCalls.submitted).toHaveLength(0);
  expect(widget.error).toContain('5 characters');
});

test('a filed report shows its issue link', async () => {
  const widget = await mount();
  fill(widget);

  await widget.submit();

  expect(widget.issueUrl).toBe('https://github.com/o/r/issues/9');
  expect(widget.error).toBe('');
});

// A failed submit must stay on the form with the reason: clearing it, or
// showing an issue link, would tell the user their report was filed.
test('a failed submit reports the reason and files nothing', async () => {
  const widget = await mount();
  globalThis.App.submitFeedback = async () => { throw new Error('Your session has expired. Sign in again and retry.'); };
  fill(widget);

  await widget.submit();

  expect(widget.issueUrl).toBe('');
  expect(widget.error).toContain('session has expired');
  expect(widget.submitting).toBe(false);
});

test('reopening the reporter starts a new report rather than resubmitting the last one', async () => {
  const widget = await mount();
  fill(widget, { withBrowserInfo: true });
  widget.toggleBrowserInfo();
  await widget.submit();
  widget.close();

  document.getElementById('fab').click();
  await tick();

  expect(widget.issueUrl).toBe('');
  expect(widget.title).toBe('');
  expect(widget.description).toBe('');
  expect(widget.withBrowserInfo).toBe(false);
  expect(widget.browserInfo).toBeNull();
  expect(widget.consoleEntries).toEqual([]);
  expect(widget.show).toBe(true);
});

// Both diagnostics are snapshotted at tick time and shown back, so the
// reporter reads exactly what the report will carry -- the same contract the
// screenshot preview provides.
test('ticking browser info snapshots it for preview, and unticking drops it', async () => {
  const widget = await mount();

  widget.withBrowserInfo = true;
  widget.toggleBrowserInfo();
  expect(widget.browserInfo).toEqual({ userAgent: 'Mozilla/5.0 (Test)' });

  widget.withBrowserInfo = false;
  widget.toggleBrowserInfo();
  expect(widget.browserInfo).toBeNull();
});

test('ticking the console option snapshots the entries rather than re-reading them at send time', async () => {
  const widget = await mount();
  fill(widget, { withConsoleLog: true });
  widget.toggleConsoleLog();

  // Anything logged after the preview was shown must not sneak into the
  // report: the user approved what they saw.
  globalThis.App.getConsoleLog = () => [{ level: 'error', at: 'later', message: 'logged after the preview' }];

  await widget.submit();

  expect(widget.consoleEntries).toEqual([{ level: 'error', at: 'now', message: 'boom' }]);
  expect(appCalls.submitted[0].consoleLog).toEqual([{ level: 'error', at: 'now', message: 'boom' }]);
});

test('an empty console buffer sends no console section at all', async () => {
  const widget = await mount();
  globalThis.App.getConsoleLog = () => [];
  fill(widget, { withConsoleLog: true });
  widget.toggleConsoleLog();

  await widget.submit();

  expect(appCalls.submitted[0].consoleLog).toBeNull();
});
