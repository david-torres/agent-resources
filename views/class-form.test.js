// The class form's stat spread is a native POST using bracket notation
// (stat_spread[might]=2), parsed by parseStatSpread in routes/classes.js.
// Swapping the number inputs for blocks must not disturb those names --
// parseStatSpread reads body['stat_spread[<stat>]'] literally, so a renamed
// field silently yields an empty spread and the class ships with no stats.
const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../util/handlebars');
const { statList } = require('../util/enclave-consts');
const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

const SRC = fs.readFileSync(path.join(__dirname, 'class-form.handlebars'), 'utf8');

const renderSpread = async (statSpread) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerPartial('stat-blocks', fs.readFileSync(
    path.join(__dirname, 'partials', 'stat-blocks.handlebars'), 'utf8'
  ));
  const section = SRC.slice(
    SRC.indexOf('<label class="label">Class Stats</label>'),
    SRC.indexOf('<label class="label" for="class-image">')
  );
  await render(hb.compile(section)({ statList, class: { stat_spread: statSpread } }));
  await tick();
};

test('class-form renders stat blocks instead of number inputs', () => {
  expect(SRC).toContain('{{> stat-blocks');
  expect(SRC).not.toMatch(/name="stat_spread\[\{\{this\}\}\]"\s*value=/);
  expect(SRC).not.toContain('type="number"');
});

test('every stat posts under its bracket-notation name', async () => {
  await renderSpread({ might: 2, resilience: 1 });
  const posted = Array.from(document.querySelectorAll('input[type="hidden"]'))
    .map((el) => el.name);
  expect(posted.sort()).toEqual(statList.map((s) => `stat_spread[${s}]`).sort());
});

test('a class spread renders three blocks per stat, not five', async () => {
  await renderSpread({ might: 2 });
  const might = document.querySelector('.stat-blocks[data-stat="might"]');
  expect(might.querySelectorAll('[role="radio"]').length).toBe(3);
});

test('seeded points fill and unseeded stats start empty', async () => {
  await renderSpread({ might: 2 });
  expect(document.querySelector('input[name="stat_spread[might]"]').value).toBe('2');
  expect(document.querySelector('input[name="stat_spread[luck]"]').value).toBe('0');
});

test('clicking a block updates the value that would post', async () => {
  await renderSpread({ might: 2 });
  document.querySelectorAll('.stat-blocks[data-stat="might"] [role="radio"]')[2].click();
  await tick();
  expect(document.querySelector('input[name="stat_spread[might]"]').value).toBe('3');
});

// Task 13: routes/classes.js hands req.body to createClass/updateClass
// wholesale, so a `description` textarea writes straight to a column that no
// longer exists -- a hard 500 on both create and edit. Structured prose inputs
// arrive in Task 14.
test('the form posts no description field', () => {
  expect(SRC).not.toContain('name="description"');
  expect(SRC).not.toContain('{{class.description}}');
});

// The two constrained selects must submit the values classes_challenge_level_check
// and classes_prerelease_section_check accept. prerelease_section is the trap:
// the source document's headings are PCCs / EXCLUSIVES / ASPIRANT CLASSES, but
// the column stores the lowercase enum the loader maps those headings to.
test('prerelease_section options submit the enum, not the document headings', () => {
  const options = Array.from(SRC.matchAll(/name="prerelease_section"[\s\S]*?<\/select>/g))
    .flatMap((match) => Array.from(match[0].matchAll(/<option value="([^"]*)"/g), (m) => m[1]));
  expect(options).toEqual(['', 'pcc', 'exclusive', 'aspirant']);
});

test('challenge_level options are capitalised and offer a blank', () => {
  const options = Array.from(SRC.matchAll(/name="challenge_level"[\s\S]*?<\/select>/g))
    .flatMap((match) => Array.from(match[0].matchAll(/<option value="([^"]*)"/g), (m) => m[1]));
  expect(options).toEqual(['', 'Low', 'Mid', 'High']);
});

// The thirteen structured columns the pre-release import populates all need an
// input, or an admin editing a class silently blanks the ones the form omits.
test('every class-level structured column has an input', () => {
  const structuredColumns = [
    'challenge_level', 'stat_line', 'stat_note', 'quote', 'quote_source',
    'overview', 'conduit_notes', 'grounding', 'examples_heading', 'examples',
    'tips_heading', 'designer', 'prerelease_section'
  ];
  for (const column of structuredColumns) {
    expect(SRC).toContain(`name="${column}"`);
  }
});

// 31 of the 50 live classes have a NULL overview. A required prose input would
// stop an admin opening one of them to toggle is_public from saving at all
// without inventing text, on a branch whose whole point is that the class prose
// is a verbatim copy of a source document. Every structured column is nullable.
test('no prose input is required', () => {
  for (const field of ['overview', 'conduit_notes', 'grounding', 'examples', 'quote']) {
    const tag = SRC.match(new RegExp(`<(?:textarea|input)[^>]*name="${field}"[^>]*>`))[0];
    expect(tag).not.toContain('required');
  }
});

// challenge_level and prerelease_section are provenance and curation, not
// player-editable metadata: a player-created class must not be able to tag
// itself as printed in the pre-release bundle. Gated the way is_player_created
// already is in this template.
const renderForm = (role, context = { isNew: true, class: null }) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerPartial('breadcrumbs', '');
  hb.registerPartial('stat-blocks', fs.readFileSync(
    path.join(__dirname, 'partials', 'stat-blocks.handlebars'), 'utf8'
  ));
  return hb.compile(SRC)({ statList, profile: { role }, ...context });
};

test('the admin-only class metadata renders for an admin and not for a player', () => {
  const adminOnly = ['challenge_level', 'prerelease_section', 'designer'];
  const asAdmin = renderForm('admin');
  const asPlayer = renderForm('player');
  for (const field of adminOnly) {
    expect(asAdmin).toContain(`name="${field}"`);
    expect(asPlayer).not.toContain(`name="${field}"`);
  }
  // The prose fields are not gated -- any creator writes those.
  expect(asPlayer).toContain('name="overview"');
});

// _syncToastUIEditorsToTextareas writes editor.getMarkdown() back on submit,
// which reflows lines and renormalizes punctuation. The structured prose is a
// verbatim copy of the source document, so these fields stay plain textareas.
test('the structured prose fields carry no markdown editor', () => {
  const proseFields = ['overview', 'conduit_notes', 'grounding', 'examples'];
  for (const field of proseFields) {
    const tag = SRC.match(new RegExp(`<textarea[^>]*name="${field}"[^>]*>`))[0];
    expect(tag).not.toContain('data-toast-editor');
  }
});

// The create case renders `class: null`, which exercises none of the value
// bindings. Tasks 15 and 16 add Alpine repeaters to the abilities and gear
// blocks below, so the edit case needs a guard now rather than an assumption.
const populatedClass = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Vanguard',
  teaser: 'Holds the line.',
  tips: 'Stand still.',
  is_public: true,
  is_player_created: false,
  status: 'release',
  rules_edition: 'advent',
  rules_version: 'v2',
  stat_spread: { might: 2, resilience: 1 },
  image_url: 'https://example.test/vanguard.png',
  image_crop: { x: 0, y: 0, width: 100, height: 100 },
  challenge_level: 'Mid',
  prerelease_section: 'exclusive',
  designer: 'D. Torres',
  stat_line: 'Might 2  \u00b7  Resilience 1',
  stat_note: 'Spend the third point where the table needs it.',
  quote: '\u201cHold the line \u2013 and mean it.\u201d',
  quote_source: 'Sgt. Aldo Vance',
  overview: 'A frontline anchor who trades reach for footing.',
  conduit_notes: 'Telegraph the shield wall a round early.',
  grounding: 'Grounded in the long siege of the Ninth Gate.',
  examples_heading: 'Example Vanguards',
  examples: ['Watch-captain of a wall town', 'Bodyguard turned drill sergeant'],
  tips_heading: 'Playing a Vanguard',
  abilities: [{ name: 'Bulwark', description: 'Plant the shield.' }],
  gear: [{ name: 'Tower shield', description: 'Heavy.' }],
};

test('the edit form renders a populated class', () => {
  const html = renderForm('admin', { isNew: false, class: populatedClass });

  expect(html).toContain(`hx-put="/classes/${populatedClass.id}"`);
  expect(html).toContain('value="Vanguard"');
  expect(html).toContain('name="ability_name[]"');
  expect(html).toContain('value="Bulwark"');
  expect(html).toContain('value="Tower shield"');
});

test('the edit form round-trips every structured scalar into its input', () => {
  const html = renderForm('admin', { isNew: false, class: populatedClass });
  const scalars = [
    'stat_line', 'stat_note', 'quote', 'quote_source', 'overview',
    'conduit_notes', 'grounding', 'examples_heading', 'tips_heading', 'designer',
  ];
  for (const field of scalars) {
    // Handlebars escapes on the way out; compare against the escaped form.
    const escaped = Handlebars.escapeExpression(populatedClass[field]);
    expect(html).toContain(escaped);
  }
  expect(html).toMatch(/<option value="Mid"[^>]*selected/);
  expect(html).toMatch(/<option value="exclusive"[^>]*selected/);
});

// The textarea is the round-trip partner of parseExamples: one example per
// line, so what renders here re-parses to the array it came from.
test('examples render one per line in the textarea', () => {
  const html = renderForm('admin', { isNew: false, class: populatedClass });
  const textarea = html.match(/<textarea[^>]*name="examples"[^>]*>([\s\S]*?)<\/textarea>/)[1];
  expect(textarea.split('\n').map((line) => line.trim()).filter(Boolean))
    .toEqual(populatedClass.examples);
});
