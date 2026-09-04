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
  // Interior double spaces, an en dash (U+2013) and a curly apostrophe
  // (U+2019) on purpose: the editor seeds itself from this object and posts it
  // back, so a round trip that reflows or renormalizes has to fail here.
  abilities: [{
    name: 'Bulwark',
    description: 'Plant the shield \u2013 and don\u2019t  give ground.',
    paired_action: 'Brace a neighbour\u2019s stance.',
    meters: [{ label: 'Essence Cost', value: 'Low' }],
    notes: [{
      text: 'Lasts  until the line breaks \u2013 or you do.',
      children: [{ text: 'Ends early if you step off the mark.', children: [] }],
    }],
  }],
  gear: [{
    name: 'Tower shield',
    description: 'Heavy \u2013 and it doesn\u2019t  move for anyone.',
    category: 'elective',
    meters: [{ label: 'Accuracy Boost', value: 'Mid' }],
    notes: [{
      text: 'Splinters  after a hard parry \u2013 the smith\u2019s warning.',
      children: [{ text: 'Replaced free of charge, once.', children: [] }],
    }],
  }],
};

test('the edit form renders a populated class', () => {
  const html = renderForm('admin', { isNew: false, class: populatedClass });

  expect(html).toContain(`hx-put="/classes/${populatedClass.id}"`);
  expect(html).toContain('value="Vanguard"');
  expect(html).toContain('name="gear[0][name]"');
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

// ---------------------------------------------------------------------------
// Task 15: the repeatable ability editor.
//
// The abilities block is no longer three fixed blocks posting flat
// ability_name[] / ability_description[] arrays. It is a repeater whose rows
// are SERVER-RENDERED with their real names and values -- Alpine only clones a
// blank row in and takes one out -- so most assertions here can read the raw
// markup, and the interaction ones drive real DOM.
const ABILITY_SECTION = SRC.slice(
  SRC.indexOf('<div class="field" x-data="abilityEditor('),
  SRC.indexOf('{{!-- Repeatable gear editor:')
);

// Four of the assertions below are `not.toContain`, which an empty slice
// satisfies for free. String.indexOf answers -1 for a boundary that has been
// edited away, and slice(-1, -1) is ''. This runs first so that a moved
// boundary fails as a missing section rather than silently passing every
// guard it was supposed to enforce.
test('the ability section slice is non-empty and bounded where it claims', () => {
  expect(SRC).toContain('<div class="field" x-data="abilityEditor(');
  expect(SRC).toContain('{{!-- Repeatable gear editor:');
  expect(ABILITY_SECTION.length).toBeGreaterThan(1000);
  // The whole editor, and nothing of the gear block that follows it.
  expect(ABILITY_SECTION).toContain('name="abilities[{{ai}}][name]"');
  expect(ABILITY_SECTION).toContain('data-prototype="child"');
  expect(ABILITY_SECTION).not.toContain('gear[{{gi}}]');
});

const renderAbilities = async (cls) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  await render(hb.compile(ABILITY_SECTION)({ class: cls }));
  await tick();
};

const abilityNameFields = () => Array.from(document.querySelectorAll('[name^="abilities["]'))
  .map((el) => el.name)
  .filter((name) => /^abilities\[\d+\]\[name\]$/.test(name));

const postedNames = () => Array.from(document.querySelectorAll('[name^="abilities["]'))
  .map((el) => el.name);

const postedValue = (name) => document.querySelector(`[name="${name}"]`).value;

const clickButton = async (label, index = 0) => {
  const button = Array.from(document.querySelectorAll('button'))
    .filter((el) => el.textContent.trim() === label)[index];
  if (!button) throw new Error(`no button labelled "${label}"`);
  button.click();
  await tick();
};

test('the abilities block is the repeater, not the flat arrays', () => {
  expect(SRC).toContain('x-data="abilityEditor()"');
  expect(SRC).not.toContain('ability_name[]');
  expect(SRC).not.toContain('ability_description[]');
});

// views/layouts/main.handlebars puts hx-boost="true" on <body> and htmx
// snapshots the LIVE DOM into its history cache. Anything x-for generated comes
// back in that snapshot AND gets regenerated by Alpine, so every row doubles on
// Back and the enlarged DOM is what gets snapshotted next. The stale half
// throws on every binding -- `ability` and `ai` live only in the x-for scope
// the restored markup has lost -- and Alpine, re-evaluating `:name` into that
// throw, removes the name attribute, so those rows accept typing and then post
// nothing. Same rule partials/stat-blocks.handlebars records at length.
test('the ability rows are server-rendered, never x-for output', () => {
  expect(ABILITY_SECTION).not.toContain('x-for');
});

// The other half of that rule: a field whose only source of truth is Alpine
// state renders empty until Alpine boots, and permanently if the pinned CDN is
// blocked -- so a save from that state writes the blanks over real prose.
test('every ability field carries its value in the served markup', () => {
  expect(ABILITY_SECTION).not.toContain('x-model');
  expect(ABILITY_SECTION).toContain('value="{{ability.name}}"');
  expect(ABILITY_SECTION).toContain('>{{ability.description}}</textarea>');
});

// Proves the two rules above rather than trusting them: htmx restores Back
// from document.body.innerHTML, so re-rendering a live snapshot must give back
// exactly the rows it captured.
test('an hx-boost history snapshot restores the same rows, not twice as many', async () => {
  await renderAbilities(populatedClass);
  const before = abilityNameFields();

  await render(document.body.innerHTML);
  await tick();

  expect(abilityNameFields()).toEqual(before);
});

// A repeater's blank row is a normal intermediate state and routes/classes.js
// drops it server-side. `required` on a dynamically added blank row silently
// blocks submission with no visible error anywhere near the field.
test('no repeated ability input is required', () => {
  expect(ABILITY_SECTION).not.toContain('required');
});

// _initToastUIEditors runs on page load and on htmx afterSwap only, so a row
// added later would get no editor at all -- and ToastUI writes its value back
// through getMarkdown(), which reflows the verbatim source prose.
test('no repeated ability input carries a markdown editor', () => {
  expect(ABILITY_SECTION).not.toContain('data-toast-editor');
});

test('a new class starts on three blank ability rows', async () => {
  await renderAbilities(null);
  expect(abilityNameFields())
    .toEqual(['abilities[0][name]', 'abilities[1][name]', 'abilities[2][name]']);
  expect(postedValue('abilities[0][name]')).toBe('');
});

test('an existing ability posts every nested field under its bracket name', async () => {
  await renderAbilities(populatedClass);
  const ability = populatedClass.abilities[0];

  expect(postedValue('abilities[0][name]')).toBe(ability.name);
  expect(postedValue('abilities[0][description]')).toBe(ability.description);
  expect(postedValue('abilities[0][paired_action]')).toBe(ability.paired_action);
  expect(postedValue('abilities[0][meters][0][label]')).toBe(ability.meters[0].label);
  expect(postedValue('abilities[0][meters][0][value]')).toBe(ability.meters[0].value);
  expect(postedValue('abilities[0][notes][0][text]')).toBe(ability.notes[0].text);
  expect(postedValue('abilities[0][notes][0][children][0][text]'))
    .toBe(ability.notes[0].children[0].text);
});

// A seeded class has exactly the rows it has -- the three-blank-row default is
// for a class with no abilities at all, and padding an existing class would
// post rows the admin never saw.
test('an existing class renders only the abilities it has', async () => {
  await renderAbilities(populatedClass);
  expect(abilityNameFields()).toEqual(['abilities[0][name]']);
});

// The inert <template> prototypes hold a copy of the row markup. They must not
// contribute fields to the form, or every save would carry a phantom ability.
test('the row prototypes post nothing', async () => {
  await renderAbilities(populatedClass);
  expect(document.querySelectorAll('template[data-prototype]').length).toBe(4);
  expect(abilityNameFields()).toEqual(['abilities[0][name]']);
});

test('adding an ability appends a blank row at the next index', async () => {
  await renderAbilities(populatedClass);
  await clickButton('Add ability');

  expect(abilityNameFields())
    .toEqual(['abilities[0][name]', 'abilities[1][name]']);
  expect(postedValue('abilities[1][name]')).toBe('');
  expect(postedValue('abilities[0][name]')).toBe(populatedClass.abilities[0].name);
  expect(document.querySelectorAll('[name$="[paired_action]"]').length).toBe(2);
});

// Removing a row has to renumber the ones after it: the posted index is the
// print order, so a gap or a duplicate index silently reorders or overwrites.
test('removing an ability renumbers the rows that follow it', async () => {
  await renderAbilities(null);
  document.querySelector('[name="abilities[0][name]"]').value = 'First';
  document.querySelector('[name="abilities[2][name]"]').value = 'Third';

  await clickButton('Remove ability', 1);

  expect(abilityNameFields()).toEqual(['abilities[0][name]', 'abilities[1][name]']);
  expect(postedValue('abilities[0][name]')).toBe('First');
  expect(postedValue('abilities[1][name]')).toBe('Third');
});

test('removing an ability renumbers its meters and notes with it', async () => {
  await renderAbilities({
    abilities: [
      { name: 'First', meters: [], notes: [] },
      {
        name: 'Second',
        meters: [{ label: 'Essence Cost', value: 'Low' }],
        notes: [{ text: 'Parent.', children: [{ text: 'Child.', children: [] }] }],
      },
    ],
  });

  await clickButton('Remove ability', 0);

  expect(postedValue('abilities[0][name]')).toBe('Second');
  expect(postedValue('abilities[0][meters][0][label]')).toBe('Essence Cost');
  expect(postedValue('abilities[0][notes][0][text]')).toBe('Parent.');
  expect(postedValue('abilities[0][notes][0][children][0][text]')).toBe('Child.');
  expect(postedNames().filter((name) => name.startsWith('abilities[1]'))).toEqual([]);
});

test('meters, notes and sub-notes can each be added and removed', async () => {
  await renderAbilities(null);

  await clickButton('Add meter');
  expect(postedNames()).toContain('abilities[0][meters][0][label]');
  expect(postedNames()).toContain('abilities[0][meters][0][value]');

  await clickButton('Add note');
  expect(postedNames()).toContain('abilities[0][notes][0][text]');

  await clickButton('Add sub-note');
  expect(postedNames()).toContain('abilities[0][notes][0][children][0][text]');

  await clickButton('Remove sub-note');
  expect(postedNames()).not.toContain('abilities[0][notes][0][children][0][text]');

  await clickButton('Remove note');
  expect(postedNames()).not.toContain('abilities[0][notes][0][text]');

  await clickButton('Remove meter');
  expect(postedNames()).not.toContain('abilities[0][meters][0][label]');
});

// An added row belongs to the ability whose button was clicked, not to the
// first one on the page.
test('a meter is added to the ability whose button was clicked', async () => {
  await renderAbilities(null);
  await clickButton('Add meter', 2);

  expect(postedNames()).toContain('abilities[2][meters][0][label]');
  expect(postedNames()).not.toContain('abilities[0][meters][0][label]');
});

// Every ability row is numbered in the served markup, not only after Alpine
// renumbers: three rows all reading "Ability" is what the raw HTML would show
// before Alpine boots.
test('ability headings are numbered in the served markup', async () => {
  await renderAbilities(null);
  expect(Array.from(document.querySelectorAll('[data-ability-heading]'))
    .map((el) => el.textContent.trim()))
    .toEqual(['Ability 1', 'Ability 2', 'Ability 3']);
});

// A cloned row arrives carrying the prototype's ids. Two controls sharing an id
// send every duplicated <label for> to whichever the browser finds first, so
// clicking the new row's "Name" would focus the first row's field.
test('added rows get unique ids and keep their labels pointed at them', async () => {
  await renderAbilities(populatedClass);
  await clickButton('Add ability');

  const ids = Array.from(document.querySelectorAll('[data-field][id]')).map((el) => el.id);
  expect(new Set(ids).size).toBe(ids.length);

  const rows = document.querySelectorAll('[data-ability-row]');
  for (const row of rows) {
    for (const label of row.querySelectorAll('[data-label-for]')) {
      const field = row.querySelector(`[data-field="${label.dataset.labelFor}"]`);
      expect(label.htmlFor).toBe(field.id);
    }
  }
  expect(Array.from(document.querySelectorAll('[data-ability-heading]'))
    .map((el) => el.textContent.trim())).toEqual(['Ability 1', 'Ability 2']);
});

// 57 live abilities carry a pronunciation guide that no view renders and no
// input edits. Without a hidden round-trip field, an admin opening one of the
// 19 imported classes and pressing Save deletes it.
test('an ability pronunciation round-trips through a hidden field', async () => {
  await renderAbilities({
    abilities: [{ name: 'Koōan', pronunciation: 'KOH-ahn', description: '', meters: [], notes: [] }],
  });

  const hidden = document.querySelector('[name="abilities[0][pronunciation]"]');
  expect(hidden.type).toBe('hidden');
  expect(hidden.value).toBe('KOH-ahn');
});

test('an ability without a pronunciation posts no pronunciation field', async () => {
  await renderAbilities(populatedClass);
  expect(document.querySelector('[name="abilities[0][pronunciation]"]')).toBeNull();
});

// ---------------------------------------------------------------------------
// Task 16: the repeatable gear editor.
//
// The gear block is no longer six fixed blocks posting flat gear_name[] /
// gear_description[] arrays. It is the ability editor's twin: rows
// SERVER-RENDERED with bracket names carrying the row index, Alpine only
// cloning a blank row in and taking one out. The one field with no ability
// counterpart is the category <select>.
const GEAR_SECTION = SRC.slice(
  SRC.indexOf('{{!-- Repeatable gear editor:'),
  SRC.indexOf('<button class="button is-primary" type="submit">Save</button>')
);

// Four of the assertions below are `not.toContain`, which an empty slice
// satisfies for free. String.indexOf answers -1 for a boundary that has been
// edited away, and slice(-1, -1) is ''. This runs first so that a moved
// boundary fails as a missing section rather than silently passing every guard
// it was supposed to enforce.
test('the gear section slice is non-empty and bounded where it claims', () => {
  expect(SRC).toContain('{{!-- Repeatable gear editor:');
  expect(SRC).toContain('<button class="button is-primary" type="submit">Save</button>');
  expect(GEAR_SECTION.length).toBeGreaterThan(1000);
  // The whole editor, and nothing of the ability block that precedes it.
  expect(GEAR_SECTION).toContain('name="gear[{{gi}}][name]"');
  expect(GEAR_SECTION).toContain('data-prototype="child"');
  expect(GEAR_SECTION).not.toContain('abilities[{{ai}}]');
});

const renderGear = async (cls) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  await render(hb.compile(GEAR_SECTION)({ class: cls }));
  await tick();
};

const gearNameFields = () => Array.from(document.querySelectorAll('[name^="gear["]'))
  .map((el) => el.name)
  .filter((name) => /^gear\[\d+\]\[name\]$/.test(name));

const postedGearNames = () => Array.from(document.querySelectorAll('[name^="gear["]'))
  .map((el) => el.name);

test('the gear block is the repeater, not the flat arrays', () => {
  expect(SRC).toContain('x-data="gearEditor()"');
  expect(SRC).not.toContain('gear_name[]');
  expect(SRC).not.toContain('gear_description[]');
});

// Same rule, same reason as the ability rows: htmx snapshots the live DOM into
// its history cache, so x-for output comes back in the snapshot AND gets
// regenerated on Back.
test('the gear rows are server-rendered, never x-for output', () => {
  expect(GEAR_SECTION).not.toContain('x-for');
});

// The other half of that rule: a field whose only source of truth is Alpine
// state renders empty until Alpine boots, and permanently if the pinned CDN is
// blocked -- so a save from that state writes the blanks over real prose. The
// <select> carries its server state in a per-option `selected` attribute, which
// is the mechanism test/x-model-server-value.test.js excludes selects for.
test('every gear field carries its value in the served markup', () => {
  expect(GEAR_SECTION).not.toContain('x-model');
  expect(GEAR_SECTION).toContain('value="{{gear.name}}"');
  expect(GEAR_SECTION).toContain('>{{gear.description}}</textarea>');
  expect(GEAR_SECTION).toContain('selected');
});

test('an hx-boost history snapshot restores the same gear rows, not twice as many', async () => {
  await renderGear(populatedClass);
  const before = gearNameFields();

  await render(document.body.innerHTML);
  await tick();

  expect(gearNameFields()).toEqual(before);
});

// A repeater's blank row is a normal intermediate state and routes/classes.js
// drops it server-side. `required` on a dynamically added blank row silently
// blocks submission with no visible error anywhere near the field. The six
// fixed gear inputs this replaces were all `required`.
test('no repeated gear input is required', () => {
  expect(GEAR_SECTION).not.toContain('required');
});

// The gear descriptions used to carry data-toast-editor. _initToastUIEditors
// runs on page load and on htmx afterSwap only, so a row added later would get
// no editor at all -- and ToastUI writes its value back through getMarkdown(),
// which reflows the verbatim source prose.
test('no repeated gear input carries a markdown editor', () => {
  expect(GEAR_SECTION).not.toContain('data-toast-editor');
});

test('a new class starts on six blank gear rows', async () => {
  await renderGear(null);
  expect(gearNameFields()).toEqual(
    [0, 1, 2, 3, 4, 5].map((i) => `gear[${i}][name]`)
  );
  expect(postedValue('gear[0][name]')).toBe('');
});

// The positional default the six blank rows open on is the same split
// normalizeGear and the backfill migration use, so a create that touches no
// category still fills both columns.
test('the six blank rows open on three Base and three Elective', async () => {
  await renderGear(null);
  expect(Array.from(document.querySelectorAll('[data-field="category"]')).map((el) => el.value))
    .toEqual(['default', 'default', 'default', 'elective', 'elective', 'elective']);
});

test('an existing gear item posts every nested field under its bracket name', async () => {
  await renderGear(populatedClass);
  const gear = populatedClass.gear[0];

  expect(postedValue('gear[0][name]')).toBe(gear.name);
  expect(postedValue('gear[0][description]')).toBe(gear.description);
  expect(postedValue('gear[0][category]')).toBe(gear.category);
  expect(postedValue('gear[0][meters][0][label]')).toBe(gear.meters[0].label);
  expect(postedValue('gear[0][meters][0][value]')).toBe(gear.meters[0].value);
  expect(postedValue('gear[0][notes][0][text]')).toBe(gear.notes[0].text);
  expect(postedValue('gear[0][notes][0][children][0][text]'))
    .toBe(gear.notes[0].children[0].text);
});

// An explicit category wins over the row's position: this item sits first and
// still opens on Elective, which is what makes the <select> a round trip rather
// than a re-derivation.
test('an explicit gear category selects its option against the row position', async () => {
  await renderGear(populatedClass);
  expect(postedValue('gear[0][category]')).toBe('elective');
});

// util/class-import.js's AI path writes gear with no category at all, so the
// form has to answer the positional default rather than showing every row as
// Base and then saving that.
test('uncategorised gear opens on the positional default, not all Base', async () => {
  await renderGear({ gear: [0, 1, 2, 3, 4, 5].map((i) => ({ name: `G${i}` })) });

  expect(Array.from(document.querySelectorAll('[data-field="category"]')).map((el) => el.value))
    .toEqual(['default', 'default', 'default', 'elective', 'elective', 'elective']);
});

// A seeded class has exactly the rows it has -- the six-blank-row default is
// for a class with no gear at all, and padding an existing class would post
// rows the admin never saw.
test('an existing class renders only the gear it has', async () => {
  await renderGear(populatedClass);
  expect(gearNameFields()).toEqual(['gear[0][name]']);
});

test('the gear row prototypes post nothing', async () => {
  await renderGear(populatedClass);
  expect(document.querySelectorAll('template[data-prototype]').length).toBe(4);
  expect(gearNameFields()).toEqual(['gear[0][name]']);
});

test('adding gear appends a blank row at the next index', async () => {
  await renderGear(populatedClass);
  await clickButton('Add gear');

  expect(gearNameFields()).toEqual(['gear[0][name]', 'gear[1][name]']);
  expect(postedValue('gear[1][name]')).toBe('');
  expect(postedValue('gear[0][name]')).toBe(populatedClass.gear[0].name);
  expect(document.querySelectorAll('[name$="[category]"]').length).toBe(2);
});

// Removing a row has to renumber the ones after it: the posted index is the
// print order, so a gap or a duplicate index silently reorders or overwrites.
test('removing gear renumbers the rows that follow it', async () => {
  await renderGear(null);
  document.querySelector('[name="gear[0][name]"]').value = 'First';
  document.querySelector('[name="gear[2][name]"]').value = 'Third';

  await clickButton('Remove gear', 1);

  expect(gearNameFields()).toEqual(
    [0, 1, 2, 3, 4].map((i) => `gear[${i}][name]`)
  );
  expect(postedValue('gear[0][name]')).toBe('First');
  expect(postedValue('gear[1][name]')).toBe('Third');
});

// Renumbering rewrites names and ids, never values: a category the admin chose
// is a curation decision, not a consequence of where the row happens to sit.
test('removing gear leaves the surviving categories alone', async () => {
  await renderGear(null);
  await clickButton('Remove gear', 0);

  expect(Array.from(document.querySelectorAll('[data-field="category"]')).map((el) => el.value))
    .toEqual(['default', 'default', 'elective', 'elective', 'elective']);
});

test('removing gear renumbers its meters and notes with it', async () => {
  await renderGear({
    gear: [
      { name: 'First', category: 'default', meters: [], notes: [] },
      {
        name: 'Second',
        category: 'elective',
        meters: [{ label: 'Accuracy Boost', value: 'Mid' }],
        notes: [{ text: 'Parent.', children: [{ text: 'Child.', children: [] }] }],
      },
    ],
  });

  await clickButton('Remove gear', 0);

  expect(postedValue('gear[0][name]')).toBe('Second');
  expect(postedValue('gear[0][category]')).toBe('elective');
  expect(postedValue('gear[0][meters][0][label]')).toBe('Accuracy Boost');
  expect(postedValue('gear[0][notes][0][text]')).toBe('Parent.');
  expect(postedValue('gear[0][notes][0][children][0][text]')).toBe('Child.');
  expect(postedGearNames().filter((name) => name.startsWith('gear[1]'))).toEqual([]);
});

test('gear meters, notes and sub-notes can each be added and removed', async () => {
  await renderGear(null);

  await clickButton('Add meter');
  expect(postedGearNames()).toContain('gear[0][meters][0][label]');
  expect(postedGearNames()).toContain('gear[0][meters][0][value]');

  await clickButton('Add note');
  expect(postedGearNames()).toContain('gear[0][notes][0][text]');

  await clickButton('Add sub-note');
  expect(postedGearNames()).toContain('gear[0][notes][0][children][0][text]');

  await clickButton('Remove sub-note');
  expect(postedGearNames()).not.toContain('gear[0][notes][0][children][0][text]');

  await clickButton('Remove note');
  expect(postedGearNames()).not.toContain('gear[0][notes][0][text]');

  await clickButton('Remove meter');
  expect(postedGearNames()).not.toContain('gear[0][meters][0][label]');
});

// An added row belongs to the gear item whose button was clicked, not to the
// first one on the page.
test('a meter is added to the gear item whose button was clicked', async () => {
  await renderGear(null);
  await clickButton('Add meter', 2);

  expect(postedGearNames()).toContain('gear[2][meters][0][label]');
  expect(postedGearNames()).not.toContain('gear[0][meters][0][label]');
});

// Every gear row is numbered in the served markup, not only after Alpine
// renumbers: six rows all reading "Gear" is what the raw HTML would show before
// Alpine boots.
test('gear headings are numbered in the served markup', async () => {
  await renderGear(null);
  expect(Array.from(document.querySelectorAll('[data-gear-heading]'))
    .map((el) => el.textContent.trim()))
    .toEqual(['Gear 1', 'Gear 2', 'Gear 3', 'Gear 4', 'Gear 5', 'Gear 6']);
});

// A cloned row arrives carrying the prototype's ids. Two controls sharing an id
// send every duplicated <label for> to whichever the browser finds first, so
// clicking the new row's "Name" would focus the first row's field.
test('added gear rows get unique ids and keep their labels pointed at them', async () => {
  await renderGear(populatedClass);
  await clickButton('Add gear');

  const ids = Array.from(document.querySelectorAll('[data-field][id]')).map((el) => el.id);
  expect(new Set(ids).size).toBe(ids.length);

  for (const row of document.querySelectorAll('[data-gear-row]')) {
    for (const label of row.querySelectorAll('[data-label-for]')) {
      const field = row.querySelector(`[data-field="${label.dataset.labelFor}"]`);
      expect(label.htmlFor).toBe(field.id);
    }
  }
  expect(Array.from(document.querySelectorAll('[data-gear-heading]'))
    .map((el) => el.textContent.trim())).toEqual(['Gear 1', 'Gear 2']);
});

// views/class-view.handlebars splits the two columns by an exact string match,
// so the only two values it can render are the only two the select offers.
test('the category select offers exactly the two values the class page renders', async () => {
  await renderGear(null);
  const options = Array.from(document.querySelectorAll('[data-field="category"] option'));
  expect(options.map((el) => el.value)).toEqual(
    ['default', 'elective', 'default', 'elective', 'default', 'elective',
      'default', 'elective', 'default', 'elective', 'default', 'elective']
  );
});
