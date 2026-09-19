// test/character-wizard-client.test.js
//
// Exercises public/js/character-wizard.js's own logic under jsdom. The
// browser IIFE has no other unit coverage -- routes/character-wizard.test.js
// only asserts against the server-rendered HTML string; it never runs the
// script. Pattern follows test/toast-editor-autofocus.test.js: read the
// source with fs, evaluate it with `new Function` against a jsdom window,
// then drive the exposed { buildSubmitPayload, getState } handle.
//
// Task 10's brief names `public/js/character-wizard.test.js` as this file's
// home, but scripts/run-tests.mjs's file scan only walks
// ['models', 'routes', 'services', 'test', 'util', 'views'] -- `public` is
// absent, so a test placed there would never run under `bun run test:unit`
// or `test:http`. This file lives under test/ instead, matching where the
// existing app.js client-logic tests already live (toast-editor-autofocus,
// history-restore-auth-header, ...).
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const COMMON_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'character-common.js'),
  'utf8'
);
const WIZARD_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'character-wizard.js'),
  'utf8'
);

const STAT_LIST = [
  'vitality', 'might', 'resilience', 'spirit',
  'arcane', 'will', 'sensory', 'reflex',
  'vigor', 'skill', 'intelligence', 'luck'
];

// Minimal fixture markup: only the ids character-wizard.js reads via
// getElementById/querySelectorAll on the paths these tests exercise (init,
// step 1's kiosk shell + Next button, step 2's personality/stat panel, and
// the always-present summary level input). Steps 3-5 are never visited here,
// so their elements are omitted -- character-wizard.js guards every lookup
// with `if (el)` except the step-1 kiosk internals, which only run when
// `DATA.mode !== 'aspiring'` and are included below for that case.
const buildHtml = () => `
  <script type="application/json" id="wizard-data"></script>
  <div id="summaryClass"></div>
  <div id="summaryStats"></div>
  <div id="summaryAbilities"></div>
  <div id="summaryGear"></div>
  <input id="wizardLevel" value="1">
  <input id="summarySuccessful" value="0">
  <ul class="wizard-steps">
    <li data-step="1"></li><li data-step="2"></li><li data-step="3"></li>
    <li data-step="4"></li><li data-step="5"></li>
  </ul>

  <section class="wizard-step" data-step-panel="1" hidden>
    <div class="wizard-kiosk" id="classKiosk">
      <div class="wizard-kiosk-frame"></div>
      <div class="wizard-kiosk-track" id="classKioskTrack"></div>
      <p id="classKioskEmpty" hidden></p>
      <span id="classKioskEmptyTerm"></span>
    </div>
    <input id="classSearch">
    <div id="selectedClassPanel"></div>
    <button id="step1Next"></button>
    <input id="pseudoClassName">
    <input id="pseudoClassTagline">
    <textarea id="pseudoClassDescription"></textarea>
    <div id="builderStep"></div>
  </section>

  <section class="wizard-step" data-step-panel="2" hidden>
    <span id="trait1StatLabel"></span>
    <span id="trait2StatLabel"></span>
    <select id="trait1Select"><option value="">-</option></select>
    <select id="trait2Select"><option value="">-</option></select>
    <select id="trait3Select"><option value="">-</option></select>
    <select id="trait1StatSelect"></select>
    <input id="trait1Custom">
    <datalist id="trait1Datalist"></datalist>
    <select id="trait2StatSelect"></select>
    <input id="trait2Custom">
    <datalist id="trait2Datalist"></datalist>
    <select id="trait3StatSelect"></select>
    <input id="trait3Custom">
    <datalist id="trait3Datalist"></datalist>
    <div id="statsBox">
      <p class="wizard-stats-prompt"></p>
    </div>
    <p id="statPointsLine" hidden>
      <strong id="statPointsTotal">0</strong>
      <strong id="statPointsAssigned">0</strong>
      <strong id="statPointsRemaining">0</strong>
    </p>
    <div id="statGrid" hidden></div>
    <button id="step2Next"></button>
  </section>
`;

// Boots a fresh jsdom window, embeds `data` as the wizard's server-supplied
// DATA, runs character-common.js then character-wizard.js against it (both
// are `window.X = (function(){...})()` browser IIFEs -- no exports to
// require), and returns the exposed CharacterWizard handle.
const bootWizard = (data) => {
  const dom = new JSDOM(`<!doctype html><html><body>${buildHtml()}</body></html>`, {
    url: `http://localhost/characters/wizard?mode=${data.mode}`,
    pretendToBeVisual: true
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  // jsdom's own rAF is fine functionally, but firing it on a real frame
  // schedule slows every boot for no benefit here -- these tests never
  // assert on the kiosk's visual ring, only on state and rendered text.
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

  window.document.getElementById('wizard-data').textContent = JSON.stringify(data);

  new Function(COMMON_SOURCE)();
  globalThis.CharacterCommon = window.CharacterCommon;

  new Function(WIZARD_SOURCE)();

  return window.CharacterWizard;
};

const ASPIRANT_CLASS = {
  id: 'c1',
  name: 'Test Class',
  stat_spread: { vitality: 2, might: 1 },
  gear: [],
  abilities: [],
  advanced_abilities: []
};

const PERSONALITY_MAP = {
  might: ['brave'],
  vitality: ['bold'],
  luck: ['lucky']
};

test('aspirant submit payload: an explicit Stat pick wins over a vocabulary match, a vocabulary match still resolves when nothing was picked, and a custom word keeps its picked Stat', () => {
  const wizard = bootWizard({
    mode: 'aspirant',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  });

  const state = wizard.getState();
  // Slot 0: "brave" maps to `might` via the vocabulary, but the player
  // explicitly picked `vitality` in the split UI's Stat dropdown -- pg. 3's
  // "fully customizable" Traits mean the explicit pick must win.
  state.traits[0] = 'brave';
  state.traitStats[0] = 'vitality';
  // Slot 1: "bold" maps to `vitality`; no explicit pick was made, so the
  // vocabulary match is the only source.
  state.traits[1] = 'bold';
  state.traitStats[1] = null;
  // Slot 2: a self-made word, unrecognized by the vocabulary, with an
  // explicitly picked Stat -- the case the false "no stat bonus" copy used
  // to describe.
  state.traits[2] = 'zzz-custom-word';
  state.traitStats[2] = 'luck';

  const payload = wizard.buildSubmitPayload();

  expect(payload.trait0).toBe('brave');
  expect(payload.trait0_stat).toBe('vitality');
  expect(payload.trait1).toBe('bold');
  expect(payload.trait1_stat).toBe('vitality');
  expect(payload.trait2).toBe('zzz-custom-word');
  expect(payload.trait2_stat).toBe('luck');
});

test('advent submit payload: every Trait Stat resolves via the vocabulary even though advent has no Stat picker', () => {
  const wizard = bootWizard({
    mode: 'advent',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  });

  const state = wizard.getState();
  // Advent's trait selects are vocabulary-only <select>s -- traitStats is
  // never populated in this economy -- so trait_stat must come entirely
  // from getStatForTrait.
  state.traits[0] = 'brave';
  state.traits[1] = 'bold';
  state.traits[2] = 'lucky';

  const payload = wizard.buildSubmitPayload();

  expect(payload.trait0_stat).toBe('might');
  expect(payload.trait1_stat).toBe('vitality');
  expect(payload.trait2_stat).toBe('luck');
});

test('aspiring creation allots 4 pluses: one pinned to each of the three Traits\' Stats, one free', () => {
  const wizard = bootWizard({
    mode: 'aspiring',
    preselectedClassId: null,
    classes: [],
    statList: STAT_LIST,
    personalityMap: {},
    commonItems: []
  });

  const state = wizard.getState();
  // Names deliberately outside the vocabulary -- ruling 8 pins one plus to
  // each Trait's Stat regardless of whether the name is recognized.
  state.traits[0] = 'first-word';
  state.traitStats[0] = 'vitality';
  state.traits[1] = 'second-word';
  state.traitStats[1] = 'might';
  state.traits[2] = 'third-word';
  state.traitStats[2] = 'luck';

  // Aspiring's step1Next is gated on the 6-slot class builder (out of scope
  // for this test, which is about step 2's point arithmetic) -- force it
  // enabled to reach step 2 the same way clicking through the builder would.
  document.getElementById('step1Next').disabled = false;
  document.getElementById('step1Next').click();

  expect(document.getElementById('statPointsTotal').textContent).toBe('4');
  expect(document.getElementById('statPointsAssigned').textContent).toBe('3');
  expect(document.getElementById('statPointsRemaining').textContent).toBe('1');
});

test('aspiring creation grows by 2 pluses per level, same as the other two economies', () => {
  const wizard = bootWizard({
    mode: 'aspiring',
    preselectedClassId: null,
    classes: [],
    statList: STAT_LIST,
    personalityMap: {},
    commonItems: []
  });

  const state = wizard.getState();
  state.traits[0] = 'first-word';
  state.traitStats[0] = 'vitality';
  state.traits[1] = 'second-word';
  state.traitStats[1] = 'might';
  state.traits[2] = 'third-word';
  state.traitStats[2] = 'luck';
  document.getElementById('step1Next').disabled = false;
  document.getElementById('step1Next').click();

  const levelInput = document.getElementById('wizardLevel');
  levelInput.value = '2';
  levelInput.dispatchEvent(new window.Event('input', { bubbles: true }));

  expect(document.getElementById('statPointsTotal').textContent).toBe('6');
});

test('aspirant creation keeps its 6-plus allotment: 3 to the class spread, 1 to the third Trait, 2 free', () => {
  const wizard = bootWizard({
    mode: 'aspirant',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  });

  const state = wizard.getState();
  state.traits[0] = 'brave';
  state.traitStats[0] = 'might';
  state.traits[1] = 'bold';
  state.traitStats[1] = 'vitality';
  state.traits[2] = 'lucky';
  state.traitStats[2] = 'luck';

  document.getElementById('step1Next').click();

  expect(document.getElementById('statPointsTotal').textContent).toBe('6');
  expect(document.getElementById('statPointsAssigned').textContent).toBe('4');
  expect(document.getElementById('statPointsRemaining').textContent).toBe('2');
});

// --- a Trait's +1 Cap has to be spendable ---------------------------------
//
// pg. 3, restated pg. 6: each Personality Trait raises its affiliated Stat's
// Cap by +1. views/character-wizard.handlebars promises the player exactly
// that, and statCapFor (util/stat-caps.js) grants it server-side off the
// stored trait.stat -- so the grid has to offer the box. The +++ creation
// ceiling still binds at level 1, because it counts every source.

const statBoxes = (stat) => Array.from(
  document.querySelectorAll('.wizard-stat-row[data-stat="' + stat + '"] .wizard-stat-box')
);
const classesOn = (stat) => statBoxes(stat).map((box) => box.className.replace('wizard-stat-box ', ''));

const bootAspirantAtStep2 = () => {
  const wizard = bootWizard({
    mode: 'aspirant',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  });
  const state = wizard.getState();
  state.traits[0] = 'brave';
  state.traitStats[0] = 'might';
  state.traits[1] = 'bold';
  state.traitStats[1] = 'vitality';
  state.traits[2] = 'lucky';
  state.traitStats[2] = 'luck';
  document.getElementById('step1Next').click();
  return wizard;
};

const setLevel = (level) => {
  const input = document.getElementById('wizardLevel');
  input.value = String(level);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};

test('above level 1 a Trait raises its Stat\'s ceiling by one, and only that Stat\'s', () => {
  bootAspirantAtStep2();
  setLevel(2);

  // luck carries Trait 3; reflex carries no Trait and no class spread.
  expect(statBoxes('luck')).toHaveLength(6);
  expect(statBoxes('reflex')).toHaveLength(5);
  expect(classesOn('luck')).not.toContain('is-locked');
  expect(classesOn('reflex')).not.toContain('is-locked');
});

test('at level 1 the +++ ceiling still binds on a Trait-raised Stat', () => {
  bootAspirantAtStep2();

  // Cap 6 (5 + the Trait), but only +++ = 3 may be reached at creation, and
  // the Trait's own +1 counts toward it -- so 3 of the 6 boxes stay locked.
  expect(statBoxes('luck')).toHaveLength(6);
  expect(classesOn('luck').filter((cls) => cls === 'is-locked')).toHaveLength(3);
});

// advent has no Trait-Cap mechanic at all: the +1 per Trait is an Aspirant rule
// (pg. 3, restated pg. 6), the wizard's own step-2 copy scopes the claim to the
// two V1 modes, and statCapMap (util/stat-caps.js) returns a flat BASE_STAT_CAP
// for advent on every server surface. advent is also the wizard's DEFAULT mode
// (routes/characters.js), so an unbranched Cap here is what most wizard sessions
// would get.
test('advent gets no Trait Cap bonus, at any level', () => {
  const wizard = bootWizard({
    mode: 'advent',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  });
  const state = wizard.getState();
  state.traits[0] = 'brave';
  state.traits[1] = 'bold';
  state.traits[2] = 'lucky';
  document.getElementById('step1Next').click();
  setLevel(2);

  // luck carries Trait 3 and would read as a Cap of 6 under the Aspirant rule.
  expect(statBoxes('luck')).toHaveLength(5);
  for (const stat of STAT_LIST) expect(statBoxes(stat)).toHaveLength(5);
});
