const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const WIDGET = fs.readFileSync(path.join(__dirname, 'feedback-widget.handlebars'), 'utf8');
const LAYOUT = fs.readFileSync(path.join(__dirname, '..', 'layouts', 'main.handlebars'), 'utf8');

const renderWidget = () => Handlebars.compile(WIDGET)({});

const renderLayout = (context) => {
  const handlebars = Handlebars.create();
  // Every other partial the layout pulls in is irrelevant here; only the
  // presence or absence of the widget is under test.
  for (const name of ['head', 'nav', 'alert/system-banner']) {
    handlebars.registerPartial(name, '');
  }
  handlebars.registerPartial('feedback-widget', '<div id="feedback-widget-rendered"></div>');
  handlebars.registerHelper('eq', (a, b) => a === b);
  return handlebars.compile(LAYOUT)(context);
};

test('the widget offers both a bug report and a feature request', () => {
  const html = renderWidget();
  expect(html).toContain('value="bug"');
  expect(html).toContain('value="feature"');
});

test('the trigger is a labelled bug icon, not a text button', () => {
  const html = renderWidget();
  expect(html).toContain('class="feedback-fab"');
  expect(html).toContain('fa-bug');
  expect(html).toContain('aria-label="Report a bug or request a feature"');
});

test('each diagnostic is its own opt-in control', () => {
  const html = renderWidget();
  expect(html).toContain('x-model="withScreenshot"');
  expect(html).toContain('x-model="withBrowserInfo"');
  expect(html).toContain('x-model="withConsoleLog"');
});

// App.captureScreenshot() excludes [data-feedback-widget] from the capture.
// Without this attribute the screenshot is a picture of the open report form.
test('the widget marks itself so it is excluded from its own screenshot', () => {
  expect(renderWidget()).toContain('data-feedback-widget');
});

test('the screenshot is previewed before it can be sent', () => {
  const html = renderWidget();
  expect(html).toContain(':src="screenshotDataUrl"');
  expect(html).toContain('untick the box if it shows anything private');
});

// The reporter decides what to publish, so every diagnostic -- not just the
// screenshot -- is shown back before the report can be sent.
test('browser info and console output are previewed too', () => {
  const html = renderWidget();
  expect(html).toContain('Object.entries(browserInfo || {})');
  expect(html).toContain('x-for="(entry, index) in consoleEntries"');
});

test('ticking a diagnostic snapshots it through the component', () => {
  const html = renderWidget();
  expect(html).toContain('@change="toggleBrowserInfo()"');
  expect(html).toContain('@change="toggleConsoleLog()"');
  expect(html).toContain('@change="toggleScreenshot()"');
});

test('the layout renders the widget for a signed-in user when reporting is configured', () => {
  const html = renderLayout({ profile: { id: 'p1' }, feedbackEnabled: true });
  expect(html).toContain('id="feedback-widget-rendered"');
});

// Both halves of the gate matter: signed-out users have no reporter at all,
// and a deploy without a GitHub token shows no button rather than one that
// fails on submit.
test('the layout omits the widget for a signed-out visitor', () => {
  const html = renderLayout({ profile: null, feedbackEnabled: true });
  expect(html).not.toContain('id="feedback-widget-rendered"');
});

test('the layout omits the widget when reporting is not configured', () => {
  const html = renderLayout({ profile: { id: 'p1' }, feedbackEnabled: false });
  expect(html).not.toContain('id="feedback-widget-rendered"');
});
