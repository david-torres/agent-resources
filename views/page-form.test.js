const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  // pageSlug is registered via Alpine.data() inside the alpine:init
  // listener, not a bare x-data object, so it must be required and the
  // event replayed manually -- mirrors views/character-list.test.js.
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

const source = () => fs.readFileSync(path.join(__dirname, 'page-form.handlebars'), 'utf8');

// Compiles the real page-form.handlebars with the app's actual helper set
// (it uses `or`, `not`, `eq` from handlebars-helpers, and `json` from
// util/handlebars). Mirrors the pattern in
// views/partials/lfg-form.test.js / character-ability-perk.test.js.
const renderPageForm = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', fs.readFileSync(
    path.join(__dirname, 'partials', 'breadcrumbs.handlebars'), 'utf8'
  ));
  return render(hb.compile(source())(context));
};

// A minimal harness matching the brief's shape, for the behavior tests
// that don't need the full template (access level, published checkbox,
// etc.) in the way.
//
// Note the x-data attribute is single-quoted, not double-quoted. The
// brief's own draft used double quotes with a bare
// `${JSON.stringify(title)}` interpolation, which breaks the instant
// title/slug is an empty string: JSON.stringify('') is `""`, and those
// embedded double quotes terminate the HTML attribute early, truncating
// x-data to the literal text "pageSlug(" -- confirmed by running it and
// watching Alpine's expression evaluator report exactly that truncated
// string. Single-quoting the attribute avoids the collision, since
// JSON.stringify never emits single quotes for these plain seed values.
// (This harness is only for values without embedded apostrophes -- the
// adversarial-title cases below go through the real template and its
// {{json}} HTML-escaping instead, which is the actually-safe path.)
const FORM = (title, slug) => `
  <div x-data='pageSlug(${JSON.stringify(title)}, ${JSON.stringify(slug)})'>
    <input id="title" name="title" x-model="title" @input="onTitle()">
    <input id="slug" name="slug" x-model="slug" @input="auto = false">
  </div>
`;

test('slug follows the title for a new page', async () => {
  await render(FORM('', ''));
  const title = document.getElementById('title');
  title.value = 'The Silent Harbor';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('the-silent-harbor');
});

test('punctuation is stripped and spaces collapse to single dashes', async () => {
  await render(FORM('', ''));
  const title = document.getElementById('title');
  title.value = "  Vex's   Last!! Stand  ";
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('vexs-last-stand');
});

test('editing the slug stops it following the title', async () => {
  await render(FORM('', ''));
  const slug = document.getElementById('slug');
  slug.value = 'custom-slug';
  slug.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();

  const title = document.getElementById('title');
  title.value = 'Some New Title';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('custom-slug');
});

test('an existing page whose slug was hand-written is left alone', async () => {
  await render(FORM('Original Title', 'hand-written'));
  const title = document.getElementById('title');
  title.value = 'Changed Title';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('hand-written');
});

test('an existing page whose slug still matches its title keeps syncing', async () => {
  await render(FORM('Original Title', 'original-title'));
  const title = document.getElementById('title');
  title.value = 'Changed Title';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('changed-title');
});

// --- Regression pin: underscores pass through untouched ---
//
// The brief's first-draft slugify regex collapsed underscores into
// dashes (`[\s_-]+`); the deleted inline script never did, because `\w`
// already includes `_` and none of its later replace() calls target it.
// Ruling: preserve the old script's behavior exactly -- underscores are
// valid in URLs and changing the rule would silently flip the on-load
// `auto` derivation for any existing page whose title has an underscore.
// These values are the measured old-script outputs, not hand-guessed.
test('underscores are left untouched by the slug rule (regression pin)', async () => {
  await render(FORM('', ''));
  const title = document.getElementById('title');
  const slug = document.getElementById('slug');

  title.value = 'foo_bar';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(slug.value).toBe('foo_bar');

  title.value = 'Foo__Bar Baz';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(slug.value).toBe('foo__bar-baz');

  title.value = '_leading';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(slug.value).toBe('_leading');
});

// --- Adversarial titles seeded through the real template ---
//
// {{json page.title}} must be used (not {{{json page.title}}}) so the
// JSON is HTML-escaped into the attribute; page titles can plausibly
// contain apostrophes, quotes, or angle brackets. These mount the real
// compiled template (not the hand-written FORM harness above) so a
// broken escape that produces invalid HTML/JS actually shows up as
// Alpine failing to parse the expression.
test('an apostrophe in the title survives seeding and syncs to the slug', async () => {
  await renderPageForm({ page: { title: "Vex's Folly", slug: '', id: 7 } });
  const title = document.getElementById('title');
  expect(title.value).toBe("Vex's Folly");
  title.value = "Vex's Reckoning";
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('vexs-reckoning');
});

test('a double quote in the title survives seeding and syncs to the slug', async () => {
  await renderPageForm({ page: { title: 'The "Silent" Harbor', slug: '', id: 8 } });
  const title = document.getElementById('title');
  expect(title.value).toBe('The "Silent" Harbor');
  title.value = 'The "Loud" Harbor';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('the-loud-harbor');
});

test('an angle bracket in the title survives seeding and syncs to the slug', async () => {
  await renderPageForm({ page: { title: 'A <script> tag', slug: '', id: 9 } });
  const title = document.getElementById('title');
  expect(title.value).toBe('A <script> tag');
  title.value = 'A <style> tag';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('slug').value).toBe('a-style-tag');
});

test('a brand-new page (no page in context) seeds empty title/slug and still syncs', async () => {
  await renderPageForm({});
  const title = document.getElementById('title');
  const slug = document.getElementById('slug');
  expect(title.value).toBe('');
  expect(slug.value).toBe('');
  title.value = 'Fresh Page';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(slug.value).toBe('fresh-page');
});

test('an existing page with a hand-chosen slug is not rewritten on load, via the real template', async () => {
  await renderPageForm({ page: { title: 'Original Title', slug: 'totally-custom', id: 10 } });
  const title = document.getElementById('title');
  const slug = document.getElementById('slug');
  expect(slug.value).toBe('totally-custom');
  title.value = 'Retitled Page';
  title.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(slug.value).toBe('totally-custom');
});

// --- Assertions against the real template ---

test('the real template carries x-data and the new directives', () => {
  const src = source();
  expect(src).toMatch(/<form[^>]*x-data="pageSlug\(\{\{json page\.title\}\}, \{\{json page\.slug\}\}\)"/);
  expect(src).toMatch(/id="title"[^>]*x-model="title"[^>]*@input="onTitle\(\)"/);
  expect(src).toMatch(/id="slug"[^>]*x-model="slug"[^>]*@input="auto = false"/);
});

test('the real template still posts title and slug by name', () => {
  const src = source();
  expect(src).toMatch(/name="title"/);
  expect(src).toMatch(/name="slug"/);
});

test('the real template does not use the unescaped triple-stache for json seeding', () => {
  const src = source();
  expect(src).not.toContain('{{{json page.title}}}');
  expect(src).not.toContain('{{{json page.slug}}}');
});

test('the real template no longer contains the inline script or its autoGenerated flag', () => {
  const src = source();
  expect(src).not.toContain('<script>');
  expect(src).not.toContain('data-autoGenerated');
  expect(src).not.toContain('autoGenerated');
  expect(src).not.toContain('DOMContentLoaded');
});
