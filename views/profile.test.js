const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

// `badge-shelf` pulls in further partials and is irrelevant to the unlocked
// classes table, so it is stubbed out rather than registered for real.
function renderProfile(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', fs.readFileSync(
    path.join(__dirname, 'partials', 'breadcrumbs.handlebars'), 'utf8'
  ));
  hb.registerPartial('private-badge', fs.readFileSync(
    path.join(__dirname, 'partials', 'private-badge.handlebars'), 'utf8'
  ));
  hb.registerPartial('badge-shelf', '');
  const src = fs.readFileSync(path.join(__dirname, 'profile.handlebars'), 'utf8');
  return hb.compile(src)(context);
}

const baseContext = {
  profile: { name: 'Alice', is_public: true },
  badges: {}
};

const CLASS_TEMPORARY = {
  id: 'lib-v1',
  name: 'Librarian',
  status: 'release',
  rules_edition: 'advent',
  rules_version: 'v1',
  unlock_expires_at: '2026-09-16T00:00:00Z'
};

const CLASS_PERMANENT = {
  id: 'sen-v1',
  name: 'Sentinel',
  status: 'release',
  rules_edition: 'advent',
  rules_version: 'v1',
  unlock_expires_at: null
};

test('the unlocked classes table has an Access column', () => {
  const html = renderProfile({ ...baseContext, unlockedClasses: [CLASS_PERMANENT] });
  expect(html).toContain('<th>Access</th>');
});

test('a temporary unlock renders an Expires tag', () => {
  const html = renderProfile({ ...baseContext, unlockedClasses: [CLASS_TEMPORARY] });
  expect(html).toContain('Expires');
  expect(html).toContain('tag is-warning is-light');
  // date_tz is called here with no timezone argument, so it defaults to the
  // `lll` format in the SERVER's guessed local timezone (moment.tz.guess()),
  // not the viewer's -- same intentional pattern as views/library.handlebars.
  expect(html).toMatch(/Expires\s+Sep 1[56], 2026/);
});

test('a permanent unlock renders no expiry tag', () => {
  const html = renderProfile({ ...baseContext, unlockedClasses: [CLASS_PERMANENT] });
  expect(html).toContain('Sentinel');
  expect(html).not.toContain('Expires');
});

test('a permanent unlock still renders its own row cells', () => {
  const html = renderProfile({ ...baseContext, unlockedClasses: [CLASS_PERMANENT] });
  // Guards against the Access cell being added to <thead> only, which would
  // silently misalign every column after Status.
  const headCells = (html.match(/<th>/g) || []).length;
  const bodyCells = (html.match(/<td>/g) || []).length;
  expect(bodyCells).toBe(headCells);
});
