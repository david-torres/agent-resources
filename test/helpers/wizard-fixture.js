// test/helpers/wizard-fixture.js
//
// Shared boot recipe for public/js/character-wizard.js's jsdom tests. Moved
// out of test/character-wizard-client.test.js so any test file under test/
// can boot the wizard IIFE the same way, and so `fixture()` is the one place
// that fills in the wizardData keys every boot needs -- economy, statCaps and
// the other server-served figures the client now reads instead of keeping
// its own copies.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { economyFor, economyFigures } = require('../../util/merx-economy');
const { statCapFigures } = require('../../util/stat-caps');
const { perkFigures } = require('../../util/perk-economy');
const { MERX_PER_MISSION_SUCCESS } = require('../../util/enclave-consts');

// Boots a wizard in aspiring mode with its class-build slots (and, for
// mode-aware assertions, the acquired-abilities list) pre-filled, skipping
// the step-1 UI walkthrough entirely. `build.coreAbilities` and
// `build.advancedAbility` take the same { classId, abilityName } shape the
// builder itself stores; `build.acquired` takes { classId, abilityName,
// type } and becomes state.acquiredAbilities.
const aspiringStateWithBuild = (build = {}) => {
  const wizard = bootWizard(fixture({ mode: 'aspiring', classes: [], preselectedClassId: null }));
  const state = wizard.getState();
  state.classBuild.coreAbilities = (build.coreAbilities || []).map((c) => ({
    classId: c.classId, abilityName: c.abilityName
  }));
  state.classBuild.advancedAbility = build.advancedAbility
    ? { classId: build.advancedAbility.classId, abilityName: build.advancedAbility.abilityName }
    : { classId: null, abilityName: null };
  state.acquiredAbilities = (build.acquired || []).map((a) => ({
    classId: a.classId, abilityName: a.abilityName, type: a.type
  }));
  return wizard;
};

// A V1 class's twelve printed Signatures, three to a column across the four
// columns the book prints (ENCLAVE: Aspirant, pg. 11). `sixItems()` is the
// first two columns, the shape an Advent class's six-item roster carries.
const TWELVE_SIGNATURE_NAMES = [
  'Cowboy Hat', 'Sharps Rifle', 'Bandolier', 'Bowie Knife', 'Wild Rag', 'Duster',
  'Rollups', 'Lasso', 'Spurs', 'Canteen', 'Saddlebag', 'Tin Star'
];
const signatureItem = (name, column, position) => ({
  name,
  description: `${name} description.`,
  meters: [],
  column,
  position,
  default_enchantment: { name: `${name} Enchantment`, description: 'Does a thing.' }
});
const twelveItems = () => TWELVE_SIGNATURE_NAMES.map((name, i) =>
  signatureItem(name, Math.floor(i / 3) + 1, (i % 3) + 1));
const sixItems = () => twelveItems().slice(0, 6);

// character-wizard.js's own localStorage key, for seeding a draft to resume.
const STORAGE_KEY = 'agentResources.characterWizard';

const COMMON_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'character-common.js'),
  'utf8'
);
const SIGNATURE_ENTRY_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'signature-entry.js'),
  'utf8'
);
const WIZARD_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'character-wizard.js'),
  'utf8'
);

// Minimal fixture markup: only the ids character-wizard.js reads via
// getElementById/querySelectorAll on the paths these tests exercise (init,
// step 1's kiosk shell + Next button, step 2's personality/stat panel, step
// 4's Signature grid, drawer, shop and readouts, and the always-present
// summary level input). Steps 3 and 5 are never visited here, so their
// elements are omitted -- character-wizard.js guards every lookup
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

  <section class="wizard-step" data-step-panel="4" hidden>
    <p id="gearStepIntro"></p>
    <span id="merxSpent">0</span> / <span id="merxBudget">0</span>
    <p id="merxRemainderNote" hidden></p>
    <span id="slotsReadout" hidden><span id="slotsUsed">0</span> / <span id="slotsCap">0</span></span>
    <div id="signaturePanel" hidden>
      <div id="signatureGrid"></div>
      <div id="signatureDrawer" hidden></div>
    </div>
    <div id="baseGearColumn"><div id="baseGearList"></div></div>
    <div id="spendMerxColumn"></div>
    <input id="gearSearch">
    <p id="gearClassFilterWrap" hidden><select id="gearClassFilter"></select></p>
    <ul>
      <li data-shop-tab="class"><span id="classCountBadge">0</span></li>
      <li data-shop-tab="common"><span id="commonCountBadge">0</span></li>
    </ul>
    <input id="customCommonItemInput">
    <button id="customCommonItemAdd"></button>
    <div id="spendList"></div>
    <button id="step4Next"></button>
  </section>
`;

// Boots a fresh jsdom window, embeds `data` as the wizard's server-supplied
// DATA, runs character-common.js, signature-entry.js and character-wizard.js
// against it (all three are `window.X = (function(){...})()` browser IIFEs --
// no exports to require), and returns the exposed CharacterWizard handle.
const bootWizard = (data, options = {}) => {
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
  // `options.draft` is a saved wizard draft to resume: it goes into THIS
  // window's localStorage, which the wizard reads as it mounts. Each boot
  // builds a new jsdom window, so a caller cannot write it beforehand.
  if (options.draft) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options.draft));
  }

  new Function(COMMON_SOURCE)();
  globalThis.CharacterCommon = window.CharacterCommon;
  // The wizard reads window.SignatureEntry when it mounts, so the component
  // goes in first -- the same order views/character-wizard.handlebars loads
  // the two script tags in.
  new Function(SIGNATURE_ENTRY_SOURCE)();

  new Function(WIZARD_SOURCE)();

  return window.CharacterWizard;
};

// Fills in the wizardData keys a bootWizard caller doesn't care about for its
// own test, most of them the server-served figures the client reads instead
// of keeping its own copy (economy, statCaps, perks, merxPerMissionSuccess,
// economyByClassId, economyWhenClassless). The per-class and classless
// economy defaults are resolved with the real economyFor against the given
// mode/classes, the same function routes/characters.js calls, so a test
// that doesn't care about the economy mapping still gets a correct one.
// A non-aspiring boot with no classes on offer hits character-wizard.js's
// own random-initial-class pick with nothing to pick from, so a caller who
// doesn't care about the class roster still needs at least one entry here.
// base_gear carries 3 entries, like a real class row, so a boot that reaches
// step 4 (or calls syncBaseGear directly) has something realistic to
// auto-load -- freeBaseCount() now counts what's actually in state.gear, not
// a rule, so an empty base_gear here would silently read as "no free items"
// regardless of economy.
const DEFAULT_CLASS = {
  id: 'fixture-class',
  name: 'Fixture Class',
  content_format: 'advent',
  stat_spread: {},
  gear: [],
  class_gear: [
    { name: 'Default A', subtype: 'base' },
    { name: 'Default B', subtype: 'base' },
    { name: 'Default C', subtype: 'base' }
  ],
  base_gear: [
    { name: 'Default A' },
    { name: 'Default B' },
    { name: 'Default C' }
  ],
  abilities: [],
  advanced_abilities: []
};

const fixture = (overrides = {}) => {
  const mode = overrides.mode || 'advent';
  const classes = overrides.classes || [DEFAULT_CLASS];
  const economyByClassId = overrides.economyByClassId || Object.fromEntries(
    classes.map((c) => [c.id, economyFor({ contentFormat: c.content_format, creatorMode: mode })])
  );
  const economyWhenClassless = overrides.economyWhenClassless
    || economyFor({ contentFormat: null, creatorMode: mode });

  return {
    mode,
    preselectedClassId: null,
    classes,
    statList: [],
    personalityMap: {},
    commonItems: [],
    economy: economyFigures(),
    statCaps: statCapFigures(),
    perks: perkFigures(),
    merxPerMissionSuccess: MERX_PER_MISSION_SUCCESS,
    economyByClassId,
    economyWhenClassless,
    ...overrides
  };
};

module.exports = { bootWizard, fixture, twelveItems, sixItems, aspiringStateWithBuild };
