const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

// ar-7v3k fix wave, Fix 1 -----------------------------------------------
//
// page-form's title/slug inputs, the lfg host checkbox, and the lfg-join
// player radio were all converted to x-model without keeping their
// server-rendered value/checked attribute. Alpine is `defer`red from a
// third-party CDN pinned by SRI: between first paint and Alpine's init --
// or permanently, if the CDN is blocked or the SRI hash ever mismatches --
// any field relying SOLELY on x-model to reflect server state renders
// empty/unchecked. routes/pages.js:123 treats an empty slug as "please
// auto-generate one", so a save from that blank-slug state could silently
// rewrite an existing page's URL.
//
// The general rule this is pinning: an <input>/<textarea> whose x-model
// seed reflects real server data must ALSO carry a plain
// value/checked/inner-text attribute with that same data, so the field is
// already correct in the raw HTML before Alpine ever runs (or if it never
// runs at all). This file scans every template for the next occurrence of
// that mistake, rather than only pinning the four sites fixed here.
//
// <select> elements are excluded entirely: their server state lives in
// per-<option> `selected` attributes, or (offscreen-mission-form) in an
// x-init read off the select's own real DOM value -- a fundamentally
// different mechanism, already covered by that template's own tests.
//
// A handful of x-model fields are legitimately client-only: they never
// reflect server data and always start from the same static literal
// regardless of what's in the DB. Those are named below, each with why --
// forcing any *new* client-only field through a reviewed, explicit
// addition here rather than silently passing or silently failing.
const ROOT = path.join(__dirname, '..');

const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => e.isDirectory()
    ? walk(path.join(dir, e.name))
    : e.name.endsWith('.handlebars') ? [path.join(dir, e.name)] : []);

const templateFiles = walk('views');

const CLIENT_ONLY = new Set([
  // Pure client-side filter state for the mission list -- never reflects
  // server data, always starts blank.
  'views/mission-list.handlebars::filterName',
  'views/mission-list.handlebars::filterCharacter',
  'views/mission-list.handlebars::filterConduit',
  // "Type the character's name to confirm" always starts empty -- there
  // is no server value it could lose.
  'views/character-form.handlebars::confirmName',
  // The "Conduit" join-type radio is correctly NEVER the initially-checked
  // option: the seed (`x-data="{ joinType: 'player' }"`) is a static
  // literal that is always 'player', so 'conduit' having no `checked`
  // attribute is not a dropped server value, it's the correct initial
  // state for every render.
  "views/partials/lfg-join-form.handlebars::joinType=conduit",
  // The bug reporter's form is composed entirely in the browser: it is never
  // rendered from a saved report, and every field starts from the same static
  // literal on every open (feedbackWidget.reset() in
  // public/js/alpine-components.js). There is no server value any of these
  // could drop.
  'views/partials/feedback-widget.handlebars::feedback-title',
  'views/partials/feedback-widget.handlebars::feedback-description',
  // Each diagnostic is opt-IN: an unchecked box is the correct initial state
  // for every render, not a lost `checked` attribute.
  'views/partials/feedback-widget.handlebars::feedback-screenshot',
  'views/partials/feedback-widget.handlebars::feedback-browser-info',
  'views/partials/feedback-widget.handlebars::feedback-console-log'
]);

const seen = new Set();

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
};

const keyFor = (relFile, tag) => {
  const id = attr(tag, 'id');
  const name = attr(tag, 'name');
  const value = attr(tag, 'value');
  const base = id || name || '(anonymous)';
  const suffix = (!id && value) ? `=${value}` : '';
  return `${relFile}::${base}${suffix}`;
};

const violations = [];

for (const file of templateFiles) {
  const relFile = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');

  for (const tag of src.match(/<input\b[^>]*>/g) || []) {
    if (!/\bx-model/.test(tag)) continue;
    const key = keyFor(relFile, tag);
    if (CLIENT_ONLY.has(key)) { seen.add(key); continue; }

    const type = attr(tag, 'type') || 'text';
    const ok = (type === 'checkbox' || type === 'radio')
      ? /\bchecked\b/.test(tag)
      : /\bvalue\s*=/.test(tag);
    if (!ok) violations.push(`${key} (<input>, type=${type})`);
  }

  for (const tag of src.match(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/g) || []) {
    const openTag = tag.slice(0, tag.indexOf('>') + 1);
    if (!/\bx-model/.test(openTag)) continue;
    const key = keyFor(relFile, openTag);
    if (CLIENT_ONLY.has(key)) { seen.add(key); continue; }

    const inner = tag.slice(openTag.length, tag.length - '</textarea>'.length);
    if (inner.trim() === '') violations.push(`${key} (<textarea>)`);
  }
}

test('every server-populated x-model field also carries a server-rendered value/checked/inner-text', () => {
  expect(violations).toEqual([]);
});

test('the CLIENT_ONLY exception list has no stale entries', () => {
  const stale = [...CLIENT_ONLY].filter((k) => !seen.has(k));
  expect(stale).toEqual([]);
});

// --- Direct regression pins for the four sites fixed in ar-7v3k Fix 1 ---

test('page-form title input keeps its server-rendered value alongside x-model', () => {
  const src = fs.readFileSync(path.join(ROOT, 'views', 'page-form.handlebars'), 'utf8');
  expect(src).toMatch(/id="title"[^>]*value="\{\{page\.title\}\}"[^>]*x-model="title"/);
});

test('page-form slug input keeps its server-rendered value alongside x-model', () => {
  const src = fs.readFileSync(path.join(ROOT, 'views', 'page-form.handlebars'), 'utf8');
  expect(src).toMatch(/id="slug"[^>]*value="\{\{page\.slug\}\}"[^>]*x-model="slug"/);
});

test('lfg-form host checkbox keeps its server-rendered checked alongside x-model', () => {
  const src = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'lfg-form.handlebars'), 'utf8');
  expect(src).toMatch(/name="host_id"[^>]*\{\{#if \(eq post\.host_id profile\.id\)\}\}checked\{\{\/if\}\}[^>]*x-model="hosting"/);
});

test('lfg-join-form player radio keeps checked alongside x-model', () => {
  const src = fs.readFileSync(path.join(ROOT, 'views', 'partials', 'lfg-join-form.handlebars'), 'utf8');
  expect(src).toMatch(/value="player"[^>]*id="join-player-opt"[^>]*checked[^>]*x-model="joinType"/);
});
