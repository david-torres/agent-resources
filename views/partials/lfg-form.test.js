const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../util/handlebars');
const { setupAlpine, render, tick, settle } = require('../../test/helpers/alpine-dom');

beforeAll(async () => { await setupAlpine(); });

// Compiles the real offscreen-mission-form.handlebars with the app's actual
// helper set. The shared harness's renderPartial() uses a bare Handlebars
// instance with no helpers registered, which throws "Missing helper" on
// this template (it uses eq, date, and others). Mirrors the pattern in
// character-ability-perk.test.js.
const renderOffscreenForm = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  const src = fs.readFileSync(
    path.join(__dirname, 'offscreen-mission-form.handlebars'),
    'utf8'
  );
  return hb.compile(src)(context);
};

// x-show's post-mount toggles are deferred to a real animation frame (not a
// microtask) by Alpine's own transition-cascade hook — see settle()'s doc
// comment in test/helpers/alpine-dom.js for the full mechanism. Every
// assertion below that follows a click/change on an x-show-bound element
// uses settle() rather than tick() for that reason.

test('checkbox reveals the character select', async () => {
  await render(`
    <div x-data="{ bringing: false }">
      <input type="checkbox" id="toggle" x-model="bringing">
      <div id="character-select" x-show="bringing" x-cloak></div>
    </div>
  `);
  const panel = document.getElementById('character-select');
  expect(panel.style.display).toBe('none');

  document.getElementById('toggle').click();
  await settle();
  expect(panel.style.display).not.toBe('none');
});

test('radio selection switches which panel is visible', async () => {
  await render(`
    <div x-data="{ mode: 'existing' }">
      <input type="radio" id="r-existing" value="existing" x-model="mode">
      <input type="radio" id="r-new" value="new" x-model="mode">
      <div id="pick" x-show="mode === 'existing'"></div>
      <div id="create" x-show="mode === 'new'"></div>
    </div>
  `);
  expect(document.getElementById('pick').style.display).not.toBe('none');
  expect(document.getElementById('create').style.display).toBe('none');

  document.getElementById('r-new').click();
  await settle();
  expect(document.getElementById('pick').style.display).toBe('none');
  expect(document.getElementById('create').style.display).not.toBe('none');
});

test('select reveals the other-text field only for __other__', async () => {
  await render(`
    <div x-data="{ choice: 'a' }">
      <select id="choice" x-model="choice">
        <option value="a">A</option>
        <option value="__other__">Other</option>
      </select>
      <input id="other" x-show="choice === '__other__'">
    </div>
  `);
  expect(document.getElementById('other').style.display).toBe('none');

  const select = document.getElementById('choice');
  select.value = '__other__';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  expect(document.getElementById('other').style.display).not.toBe('none');
});

// --- Per-row isolation: two independent "Details" rows must not share state.
// Mirrors the real lfg-post.handlebars shape: one <tbody x-data="{ open: false }">
// per participant, so opening one row's details never opens another's.
test('per-participant details toggle stays scoped to its own row', async () => {
  await render(`
    <table>
      <tbody x-data="{ open: false }">
        <tr><td><button id="details-1" @click="open = !open">Details</button></td></tr>
        <tr><td><div id="character-details-1" x-show="open" x-cloak>Row 1 details</div></td></tr>
      </tbody>
      <tbody x-data="{ open: false }">
        <tr><td><button id="details-2" @click="open = !open">Details</button></td></tr>
        <tr><td><div id="character-details-2" x-show="open" x-cloak>Row 2 details</div></td></tr>
      </tbody>
    </table>
  `);
  const row1 = document.getElementById('character-details-1');
  const row2 = document.getElementById('character-details-2');
  expect(row1.style.display).toBe('none');
  expect(row2.style.display).toBe('none');

  document.getElementById('details-1').click();
  await settle();
  expect(row1.style.display).not.toBe('none');
  expect(row2.style.display).toBe('none');

  document.getElementById('details-2').click();
  await settle();
  expect(row1.style.display).not.toBe('none');
  expect(row2.style.display).not.toBe('none');
});

// --- Calendar buttons: mutually-exclusive show/hide pair collapsed to one boolean.
test('calendar buttons pair starts with only the Calendar button visible', async () => {
  await render(`
    <div x-data="{ calendarOpen: false }">
      <button id="calendar-buttons-show" x-show="!calendarOpen" @click="calendarOpen = true">Calendar</button>
      <div id="calendar-buttons" x-show="calendarOpen" x-cloak>
        <button id="calendar-buttons-hide" @click="calendarOpen = false"></button>
      </div>
    </div>
  `);
  expect(document.getElementById('calendar-buttons-show').style.display).not.toBe('none');
  expect(document.getElementById('calendar-buttons').style.display).toBe('none');

  document.getElementById('calendar-buttons-show').click();
  await settle();
  expect(document.getElementById('calendar-buttons-show').style.display).toBe('none');
  expect(document.getElementById('calendar-buttons').style.display).not.toBe('none');

  document.getElementById('calendar-buttons-hide').click();
  await settle();
  expect(document.getElementById('calendar-buttons-show').style.display).not.toBe('none');
  expect(document.getElementById('calendar-buttons').style.display).toBe('none');
});

// --- Real template assertions: each source file must carry its new
// directives and must no longer carry the inline handler it replaced.

const readPartial = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const readView = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('real lfg-form.handlebars uses x-model/x-show and drops the hx-on:click toggle', () => {
  const html = readPartial('lfg-form.handlebars');
  expect(html).toContain('x-data="{ hosting:');
  expect(html).toContain('x-model="hosting"');
  expect(html).toContain('x-show="!hosting"');
  expect(html).toContain('x-cloak');
  expect(html).not.toContain('hx-on:click');
  expect(html).not.toContain("htmx.toggleClass(htmx.find('#character-select')");
});

test('real lfg-join-form.handlebars binds both radios to one shared variable', () => {
  const html = readPartial('lfg-join-form.handlebars');
  expect(html).toContain("x-data=\"{ joinType: 'player' }\"");
  const modelMatches = html.match(/x-model="joinType"/g) || [];
  expect(modelMatches.length).toBe(2);
  expect(html).toContain('x-show="joinType === \'player\'"');
  expect(html).not.toContain('hx-on:click');
});

test('real offscreen-mission-form.handlebars reveals the other field only for __other__', () => {
  const html = readPartial('offscreen-mission-form.handlebars');
  expect(html).toContain('x-model="sourceId"');
  expect(html).toContain("x-show=\"sourceId === '__other__'\"");
  expect(html).toContain('x-cloak');
  expect(html).not.toContain('onchange');

  // The seed reads the select's own scoped $refs value, not a document-wide
  // getElementById lookup — refactor-safe (no id-string duplication) and
  // safe if this partial is ever rendered twice on one page.
  expect(html).toContain('x-ref="sourceSelect"');
  expect(html).toContain('x-init="sourceId = $refs.sourceSelect.value"');
  expect(html).not.toContain('getElementById');
});

// --- Behavioral coverage for the x-init seed, mounting the real template
// with real Handlebars helpers for all three data shapes it needs to
// distinguish. Unlike the synthetic x-data="{ choice: 'a' }" test above,
// these exercise the actual $refs-based DOM read this partial relies on.
test('real offscreen-mission-form: new form starts with the other fields hidden', async () => {
  const html = renderOffscreenForm({
    formAction: '/characters/c1/offscreen-missions',
    character: { id: 'c1' },
    mode: 'new',
    availableHostedMissions: [
      { id: 'm1', name: 'Mission One', date: '2024-01-01' }
    ],
    offscreenMission: undefined
  });
  await render(html);
  await settle();

  // No option is explicitly selected in this shape, so the browser's own
  // default (first option in DOM order) wins — a real hosted mission, not
  // '__other__'. The seed reflects that real state rather than a
  // placeholder empty string.
  expect(document.getElementById('om-source-select').value).toBe('m1');
  expect(document.getElementById('om-source-other').style.display).toBe('none');
});

test('real offscreen-mission-form: editing a mission linked to a real source keeps the other fields hidden and preserves the selected option', async () => {
  // This is the human-approved behavior change from the initial pass: the
  // old style="display: ;" CSS quirk rendered these fields *visible* here
  // (an invalid declaration falling back to the div's default display).
  // This assertion is the whole point of this test.
  const html = renderOffscreenForm({
    formAction: '/characters/c1/offscreen-missions/om1',
    character: { id: 'c1' },
    mode: 'edit',
    availableHostedMissions: [
      { id: 'm1', name: 'Mission One', date: '2024-01-01' },
      { id: 'm2', name: 'Mission Two', date: '2024-02-02' }
    ],
    offscreenMission: {
      id: 'om1',
      character_id: 'c1',
      name: 'Old mission',
      summary: 'A summary',
      merx_gained: 5,
      source_mission_id: 'm2',
      source_mission_name: null,
      source_mission_date: null
    }
  });
  await render(html);
  await settle();

  // The regression an unscoped/faked seed would cause: the select must
  // still show the actually-linked mission, not '__other__'.
  expect(document.getElementById('om-source-select').value).toBe('m2');
  expect(document.getElementById('om-source-other').style.display).toBe('none');
});

test('real offscreen-mission-form: editing an "other" mission reveals the other fields with the select on __other__', async () => {
  const html = renderOffscreenForm({
    formAction: '/characters/c1/offscreen-missions/om2',
    character: { id: 'c1' },
    mode: 'edit',
    availableHostedMissions: [
      { id: 'm1', name: 'Mission One', date: '2024-01-01' }
    ],
    offscreenMission: {
      id: 'om2',
      character_id: 'c1',
      name: 'Foo',
      summary: 'bar',
      merx_gained: 3,
      source_mission_id: null,
      source_mission_name: 'Homebrew mission',
      source_mission_date: '2024-03-03'
    }
  });
  await render(html);
  await settle();

  expect(document.getElementById('om-source-select').value).toBe('__other__');
  expect(document.getElementById('om-source-other').style.display).not.toBe('none');
  expect(document.getElementById('om-source-name').value).toBe('Homebrew mission');
});

test('real lfg-post.handlebars converts the calendar toggle and the per-participant toggle', () => {
  const html = readView('lfg-post.handlebars');

  // Calendar buttons: one shared boolean, two x-show directives.
  expect(html).toContain('x-data="{ calendarOpen: false }"');
  expect(html).toContain('x-show="!calendarOpen"');
  expect(html).toContain('x-show="calendarOpen"');

  // Per-participant details: local x-data on the row, not a shared variable.
  expect(html).toContain('x-data="{ open: false }"');
  expect(html).toContain('x-show="open"');
  expect(html).toContain('@click="open = !open"');

  // Both elements that start hidden (calendar-buttons and the per-row
  // details) must carry x-cloak so they can't flash visible before Alpine
  // boots. calendar-buttons-show starts visible, so it correctly has none.
  const cloakMatches = html.match(/x-cloak/g) || [];
  expect(cloakMatches.length).toBe(2);

  // Old inline handlers for these two mechanisms are gone.
  expect(html).not.toContain("htmx.toggleClass(htmx.find('#calendar-buttons')");
  expect(html).not.toContain("htmx.toggleClass(htmx.find('#character-details-");

  // The join-requests reveal (line 22 in the source) is explicitly excluded
  // from this task and must still use its lazy-load latch untouched.
  expect(html).toContain("htmx.trigger(t,'revealed')");
  expect(html).toContain("t.dataset.loaded");
  expect(html).toContain('class="block is-hidden"');
});
