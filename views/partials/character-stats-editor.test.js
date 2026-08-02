const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../../util/handlebars');
const { statList } = require('../../util/enclave-consts');
const { setupAlpine, render, tick, settle } = require('../../test/helpers/alpine-dom');

const STATS = { vitality: 3, might: 2, resilience: 1 };

// The x-data attribute is single-quote delimited (not double) because
// JSON.stringify(stats) produces double-quoted keys; embedding that inside
// a double-quoted attribute truncates it at the first key's opening quote
// -- the same collision the plan's Global Constraints warn about for
// {{json}} vs {{{json}}} in the real templates, just triggered here by the
// test's own literal HTML instead of Handlebars.
const mount = (stats) => render(`
  <div x-data='characterStats(${JSON.stringify('char-1')}, ${JSON.stringify(stats)})'>
    <button id="edit" x-show="!editing" @click="edit()"></button>
    <div id="readonly" x-show="!editing"></div>
    <form id="editor" x-show="editing" @submit.prevent="save()">
      <input class="stats-input" type="number" x-model.number="stats.vitality">
      <input class="stats-input" type="number" x-model.number="stats.might">
      <input class="stats-input" type="number" x-model.number="stats.resilience">
      <strong id="statsTotalSum" x-text="total"></strong>
      <button id="cancel" type="button" @click="cancel()"></button>
      <button id="save" type="submit" :disabled="saving"></button>
    </form>
    <div id="err" x-show="error" x-text="error"></div>
  </div>
`);

beforeAll(async () => {
  await setupAlpine();
  globalThis.CharacterCommon = { getAuthHeader: () => ({}) };
  require('../../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

test('starts in read-only mode with the editor hidden', async () => {
  await mount(STATS);
  expect(document.getElementById('editor').style.display).toBe('none');
  expect(document.getElementById('readonly').style.display).not.toBe('none');
});

test('Edit reveals the editor and hides the read-only grid', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await settle();
  expect(document.getElementById('editor').style.display).not.toBe('none');
  expect(document.getElementById('readonly').style.display).toBe('none');
});

test('Edit moves focus to the first stats input', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await settle();
  const first = document.querySelector('.stats-input');
  expect(document.activeElement).toBe(first);
});

test('total sums the seeded stats', async () => {
  await mount(STATS);
  expect(document.getElementById('statsTotalSum').textContent).toBe('6');
});

test('total recomputes as inputs change', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await tick();
  const input = document.querySelector('.stats-input');
  input.value = '10';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('statsTotalSum').textContent).toBe('13');
});

test('Cancel restores the original values and exits edit mode', async () => {
  await mount(STATS);
  document.getElementById('edit').click();
  await tick();
  const input = document.querySelector('.stats-input');
  input.value = '19';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();

  document.getElementById('cancel').click();
  await settle();
  expect(document.getElementById('editor').style.display).toBe('none');
  expect(document.getElementById('statsTotalSum').textContent).toBe('6');
});

test('save PATCHes clamped integers to the stats endpoint', async () => {
  await mount(STATS);
  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ character: {} }) };
  };
  // Stub navigation at the jsdom boundary rather than adding a test seam to
  // the component. jsdom's window.location is a non-configurable,
  // non-writable own property (confirmed: Object.defineProperty throws
  // "Cannot redefine property: location", and plain reassignment routes
  // through jsdom's real navigation setter and logs "Not implemented"
  // instead of replacing anything), so the property itself cannot be
  // redefined. Proxy the `window` global instead so `window.location`
  // resolves to a stub, without touching jsdom's real Location object or
  // adding a reload seam to the component.
  let reloaded = false;
  const realWindow = window;
  const locationStub = { reload: () => { reloaded = true; } };
  globalThis.window = new Proxy(realWindow, {
    get(target, prop, receiver) {
      if (prop === 'location') return locationStub;
      return Reflect.get(target, prop, receiver);
    }
  });

  try {
    document.getElementById('edit').click();
    await tick();
    const input = document.querySelector('.stats-input');
    input.value = '99';                       // above the 0-20 range
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await tick();

    document.getElementById('editor').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true })
    );
    await tick();
    await tick();
  } finally {
    globalThis.window = realWindow;
  }

  expect(captured.url).toBe('/characters/char-1/stats');
  expect(captured.options.method).toBe('PATCH');
  expect(JSON.parse(captured.options.body).vitality).toBe(20);
  expect(reloaded).toBe(true);
});

test('save surfaces a server error and re-enables the button', async () => {
  await mount(STATS);
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });

  document.getElementById('edit').click();
  await settle();
  // Before the failed save, the error box must actually be hidden, not
  // merely empty of text -- x-text and x-show are independent bindings,
  // so a broken or dropped x-show would leave this element visible (with
  // no text) the whole time and a text-only assertion would never notice.
  expect(document.getElementById('err').style.display).toBe('none');

  document.getElementById('editor').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true })
  );
  await settle();

  expect(document.getElementById('err').style.display).not.toBe('none');
  expect(document.getElementById('err').textContent).toContain('Forbidden');
  expect(document.getElementById('save').disabled).toBe(false);
});

test('character.handlebars carries the Alpine directives and drops the old script tag', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'character.handlebars'),
    'utf8'
  );

  expect(src).toContain('x-data="characterStats({{json character.id}}');
  expect(src).toContain('x-show="!editing" @click="edit()"');
  expect(src).toContain('id="statsReadOnly" class="wizard-stat-grid" x-show="!editing"');
  expect(src).toContain('id="statsEditor" x-show="editing" x-cloak');

  // The ownership guard around the Edit button must be untouched.
  expect(src).toContain("{{#if (eq character.creator_id profile.id)}}");

  expect(src).not.toContain('character-stats.js');
  expect(src).not.toContain('CharacterStats');
  expect(src).not.toContain('id="statsEditor" hidden');
});

test('character-stats-editor.handlebars carries the Alpine bindings', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'character-stats-editor.handlebars'),
    'utf8'
  );

  expect(src).toContain('x-text="total"');
  expect(src).toContain('x-model.number="stats.{{this}}"');
  expect(src).toContain('@submit.prevent="save()"');
  expect(src).toContain('@click="cancel()"');
  expect(src).toContain(':disabled="saving"');
  expect(src).toContain(":class=\"saving && 'is-loading'\"");
  expect(src).toContain('x-show="error" x-text="error"');

  expect(src).not.toContain('character-stats.js');
  expect(src).not.toContain('CharacterStats');
});

// --- ar-7v3k fix wave, Fix 3 --------------------------------------------
//
// The x-data seed above only asserted its *prefix*
// (`x-data="characterStats({{json character.id}}`), which never exercised
// the per-stat loop building the rest of the object literal. That loop
// used `{{lookup ../character this}}` for each stat's value with no
// wrapping helper: Handlebars renders a null/undefined stat as an empty
// string, so a missing stat emits e.g. `luck:  })` -- invalid JS. Alpine
// throws evaluating that expression, and the WHOLE characterStats
// component fails to initialize (not just that one stat): Edit does
// nothing and #statsEditor stays permanently hidden behind x-cloak. The DB
// declares every stat column NOT NULL, so this is latent, not live -- one
// nullable column away from a total feature outage.
//
// This extracts the REAL x-data expression straight off #statsBox in
// character.handlebars (still containing its Handlebars syntax) and
// compiles it with the app's real helpers, mirroring the technique in
// views/mission-list.test.js's extractRootXData -- mounting the actual
// expression, not a hand-copied stand-in, so a regression in the real
// template is what makes this fail.
const CHARACTER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'character.handlebars'),
  'utf8'
);

const extractStatsXData = () => {
  const marker = 'id="statsBox"';
  const idx = CHARACTER_SRC.indexOf(marker);
  if (idx === -1) throw new Error('#statsBox not found in character.handlebars');
  const attrStart = CHARACTER_SRC.indexOf('x-data="', idx) + 'x-data="'.length;
  const attrEnd = CHARACTER_SRC.indexOf('"', attrStart);
  return CHARACTER_SRC.slice(attrStart, attrEnd);
};

const mountRealStatsSeed = (character) => {
  const hb = Handlebars.create();
  hb.registerHelper(customHelpers);
  const template = hb.compile(`
    <div id="stats-root" x-data="${extractStatsXData()}">
      <strong id="statsTotalSum" x-text="total"></strong>
    </div>
  `);
  return render(template({ character, statList }));
};

const ELEVEN_STATS = {
  vitality: 3, might: 2, resilience: 1, spirit: 0, arcane: 4,
  will: 2, sensory: 1, reflex: 3, vigor: 2, skill: 1, intelligence: 0
};

test('the real #statsBox x-data seed mounts and totals correctly with well-formed stats', async () => {
  await mountRealStatsSeed({ id: 'char-well-formed', ...ELEVEN_STATS, luck: 5 });
  await tick();
  expect(document.getElementById('statsTotalSum').textContent).toBe('24');
});

test('the real #statsBox x-data seed survives a null stat instead of throwing a SyntaxError', async () => {
  await mountRealStatsSeed({ id: 'char-null-luck', ...ELEVEN_STATS, luck: null });
  await tick();
  // luck coerces to 0 in characterStats' `total` getter, same as any other
  // nullable-in-practice value -- the point of this test is that the
  // component initializes AT ALL, not a specific null-handling rule.
  expect(document.getElementById('statsTotalSum').textContent).toBe('19');
});

test('the real #statsBox x-data seed survives a missing (undefined) stat', async () => {
  const { luck, ...withoutLuck } = { id: 'char-missing-luck', ...ELEVEN_STATS, luck: 0 };
  await mountRealStatsSeed(withoutLuck);
  await tick();
  expect(document.getElementById('statsTotalSum').textContent).toBe('19');
});
