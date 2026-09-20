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
//
// bootWizard (the jsdom boot recipe) and fixture (the wizardData defaults
// builder) live in test/helpers/wizard-fixture.js so other test files can
// reuse them.
const { test, expect, describe } = require('bun:test');
const { bootWizard, fixture } = require('./helpers/wizard-fixture');
const { economyFigures } = require('../util/merx-economy');
const { statCapFigures } = require('../util/stat-caps');

const STAT_LIST = [
  'vitality', 'might', 'resilience', 'spirit',
  'arcane', 'will', 'sensory', 'reflex',
  'vigor', 'skill', 'intelligence', 'luck'
];

const ASPIRANT_CLASS = {
  id: 'c1',
  name: 'Test Class',
  content_format: 'aspirant',
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
  const wizard = bootWizard(fixture({
    mode: 'aspirant',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  }));

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
  const wizard = bootWizard(fixture({
    mode: 'advent',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  }));

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
  const wizard = bootWizard(fixture({
    mode: 'aspiring',
    preselectedClassId: null,
    classes: [],
    statList: STAT_LIST,
    personalityMap: {},
    commonItems: []
  }));

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
  const wizard = bootWizard(fixture({
    mode: 'aspiring',
    preselectedClassId: null,
    classes: [],
    statList: STAT_LIST,
    personalityMap: {},
    commonItems: []
  }));

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
  const wizard = bootWizard(fixture({
    mode: 'aspirant',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  }));

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
  const wizard = bootWizard(fixture({
    mode: 'aspirant',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  }));
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
  const wizard = bootWizard(fixture({
    mode: 'advent',
    preselectedClassId: 'c1',
    classes: [ASPIRANT_CLASS],
    // Pinned to the advent economy explicitly: ASPIRANT_CLASS carries
    // content_format 'aspirant' for the tests that need the aspirant
    // economy, but getStatCap now branches on the resolved economy, and
    // this test is about the advent branch specifically.
    economyByClassId: { 'c1': 'advent' },
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  }));
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

describe('the wizard reads its economy from the server', () => {
  test('an advent wizard on a V1 class uses the aspirant budget', () => {
    const wizard = bootWizard(fixture({
      mode: 'advent',
      classes: [{ id: 'c-v1', name: 'Gunslinger', content_format: 'aspirant', gear: [] }],
      economyByClassId: { 'c-v1': 'aspirant' }
    }));
    wizard.getState().classId = 'c-v1';
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.aspirant);
  });

  test('the budget follows a change of class', () => {
    const wizard = bootWizard(fixture({
      mode: 'advent',
      classes: [
        { id: 'c-advent', name: 'Vizier', content_format: 'advent', gear: [] },
        { id: 'c-v1', name: 'Gunslinger', content_format: 'aspirant', gear: [] }
      ],
      economyByClassId: { 'c-advent': 'advent', 'c-v1': 'aspirant' }
    }));
    wizard.getState().classId = 'c-advent';
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.advent);
    wizard.getState().classId = 'c-v1';
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.aspirant);
  });

  test('advent still earns per successful mission, from the served figure', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', economyWhenClassless: 'advent' }));
    wizard.getState().successfulMissions = 3;
    expect(wizard.getMerxBudget())
      .toBe(economyFigures().grants.advent + 3 * require('../util/enclave-consts').MERX_PER_MISSION_SUCCESS);
  });

  test('a class-less wizard uses the served fallback', () => {
    const wizard = bootWizard(fixture({ mode: 'aspiring', economyWhenClassless: 'aspiring' }));
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.aspiring);
  });

  test('the plus allotment comes from the served stat figures', () => {
    const wizard = bootWizard(fixture({ mode: 'aspiring', statCaps: statCapFigures() }));
    wizard.getState().level = 1;
    expect(wizard.getTotalPoints()).toBe(statCapFigures().creationPluses.aspiring);
    wizard.getState().level = 3;
    expect(wizard.getTotalPoints())
      .toBe(statCapFigures().creationPluses.aspiring + 2 * statCapFigures().levelPlusesPerLevel);
  });
});

describe('the free-gear floor follows the resolved economy, not the wizard mode', () => {
  test('an advent wizard has the served free-base count', () => {
    const wizard = bootWizard(fixture({ mode: 'advent' }));
    expect(wizard.getFreeBaseCount())
      .toBe(require('../util/character-derived').ADVENT_DEFAULT_SIGNATURES);
  });

  // Six live pre-release classes carry content_format 'advent' but can be
  // picked under aspirant mode; economyFor (util/merx-economy.js) resolves
  // that combination to the 'advent' economy, and freeBaseCount() is honest
  // about it. syncBaseGear's own aspirant-mode no-op stays keyed on
  // DATA.mode rather than economy (see its comment), so nothing is actually
  // auto-loaded for this particular combination -- a known, narrower gap
  // than the one this round closes, not asserted as fully wired up here.
  test('an aspirant wizard on an advent-content class resolves the advent free-base count', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant',
      classes: [{ id: 'c-v1', name: 'Old Guard', content_format: 'advent', gear: [] }],
      economyByClassId: { 'c-v1': 'advent' }
    }));
    wizard.getState().classId = 'c-v1';
    expect(wizard.getFreeBaseCount())
      .toBe(require('../util/character-derived').ADVENT_DEFAULT_SIGNATURES);
  });

  // The regression this round closes: an aspirant-content (V1) class picked
  // under advent mode -- the wizard's default mode, so any advent
  // playthrough on such a class hits this -- resolves to the aspirant
  // economy (economyFor), which has no free floor. Before this fix,
  // freeBaseCount() and syncBaseGear both read DATA.mode ('advent') and
  // granted + auto-loaded 3 free items the aspirant economy never budgeted
  // for, and the step-4 Next gate then forced spending the full 12-Merx
  // grant on top of them: nine Signatures submitted, priced by the server
  // at 18 against a 12-Merx grant.
  test('an advent-mode wizard on an aspirant-content class has no free base gear', () => {
    const wizard = bootWizard(fixture({
      mode: 'advent',
      classes: [{
        id: 'c-v1',
        name: 'Gunslinger',
        content_format: 'aspirant',
        gear: [],
        base_gear: [{ name: 'Default A' }, { name: 'Default B' }, { name: 'Default C' }]
      }],
      economyByClassId: { 'c-v1': 'aspirant' }
    }));
    wizard.getState().classId = 'c-v1';
    expect(wizard.getFreeBaseCount()).toBe(0);

    wizard.syncBaseGear();
    expect(wizard.getState().gear).toEqual([]);
  });

  test('an advent-mode wizard on an advent-content class still auto-loads its 3 free base items', () => {
    const wizard = bootWizard(fixture({
      mode: 'advent',
      classes: [{
        id: 'c-advent',
        name: 'Vizier',
        content_format: 'advent',
        gear: [],
        base_gear: [{ name: 'Default A' }, { name: 'Default B' }, { name: 'Default C' }]
      }],
      economyByClassId: { 'c-advent': 'advent' }
    }));
    wizard.getState().classId = 'c-advent';
    expect(wizard.getFreeBaseCount())
      .toBe(require('../util/character-derived').ADVENT_DEFAULT_SIGNATURES);

    wizard.syncBaseGear();
    const gear = wizard.getState().gear;
    expect(gear).toHaveLength(3);
    expect(gear.every((g) => g.cost === 0)).toBe(true);
  });
});

test('an aspirant wizard on an advent-content class gets no Trait Cap bonus, like advent', () => {
  const wizard = bootWizard(fixture({
    mode: 'aspirant',
    preselectedClassId: 'c-v1',
    classes: [{ id: 'c-v1', name: 'Old Guard', content_format: 'advent', stat_spread: { might: 1 }, gear: [] }],
    economyByClassId: { 'c-v1': 'advent' },
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP,
    commonItems: []
  }));
  const state = wizard.getState();
  state.traits[0] = 'brave';
  state.traitStats[0] = 'might';
  state.traits[1] = 'bold';
  state.traitStats[1] = 'vitality';
  state.traits[2] = 'lucky';
  state.traitStats[2] = 'luck';
  document.getElementById('step1Next').click();
  setLevel(2);

  // luck carries Trait 3 and would read as a Cap of 6 under the Aspirant
  // rule; statCapMap (util/stat-caps.js) grants advent's flat Cap here
  // because the resolved economy is 'advent', not because DATA.mode is.
  expect(statBoxes('luck')).toHaveLength(5);
});

test('no economy or stat figure is written down in the wizard client', () => {
  const source = require('fs').readFileSync('public/js/character-wizard.js', 'utf8');
  for (const name of [
    'CLASS_GEAR_COST', 'CROSS_CLASS_GEAR_COST', 'ADVENT_MERX_BUDGET',
    'ASPIRANT_MERX_BUDGET', 'ASPIRING_MERX_BUDGET', 'FREE_BASE_GEAR_COUNT',
    'BONUS_MERX_PER_SUCCESSFUL', 'COMMON_ITEM_COST',
    'CREATION_PLUSES', 'LEVEL_PLUSES_PER_LEVEL', 'BASE_STAT_CAP', 'CREATION_STAT_CAP'
  ]) {
    expect(source).not.toContain(name);
  }
});
