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
const { bootWizard, fixture, twelveItems, sixItems } = require('./helpers/wizard-fixture');
const { economyFigures } = require('../util/merx-economy');
const { statCapFigures } = require('../util/stat-caps');
const { MERX_PER_MISSION_SUCCESS } = require('../util/enclave-consts');

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

  // Whole-plan review, Minor 6: the allotment read STAT_FIGURES.creationPluses
  // [DATA.mode] while the server keys CREATION_PLUSES on the resolved economy
  // (util/stat-caps.js plusAllotment). The two agree on today's figures, so
  // only the served mapping can tell them apart: the client must take the
  // economy the server assigned this class, whatever mode the URL carries.
  test('the plus allotment follows the class economy the server served, not the mode', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant',
      classes: [{ id: 'c1', name: 'Borrowed', content_format: 'aspirant', gear: [] }],
      economyByClassId: { c1: 'aspiring' },
      statCaps: statCapFigures()
    }));
    wizard.getState().classId = 'c1';
    wizard.getState().level = 1;
    expect(wizard.getTotalPoints()).toBe(statCapFigures().creationPluses.aspiring);
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

describe('the free-gear floor reads what syncBaseGear actually loaded, not a mode/economy rule', () => {
  test('an advent wizard has the served free-base count', () => {
    const wizard = bootWizard(fixture({ mode: 'advent' }));
    expect(wizard.getFreeBaseCount())
      .toBe(require('../util/character-derived').ADVENT_DEFAULT_SIGNATURES);
  });

  // Three real shop picks carry the cost pickShopItem stamps, never 0, so the
  // leading-run count must not swallow them as free however the class's
  // economy resolves.
  test('real picks are never counted as free base gear', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant',
      classes: [{ id: 'c-v1', name: 'Old Guard', content_format: 'advent', gear: [] }],
      economyByClassId: { 'c-v1': 'advent' }
    }));
    wizard.getState().classId = 'c-v1';
    wizard.getState().gear = [
      { name: 'Item A', kind: 'class', cost: 2, origin_class_id: 'c-v1' },
      { name: 'Item B', kind: 'class', cost: 2, origin_class_id: 'c-v1' },
      { name: 'Item C', kind: 'class', cost: 3, origin_class_id: 'other' }
    ];
    expect(wizard.getFreeBaseCount()).toBe(0);
  });

  // Whole-plan review, Important 3: syncBaseGear returned on DATA.mode ===
  // 'aspirant' before it ever consulted the economy. Six live pre-release
  // classes carry content_format 'advent' and can be picked under aspirant
  // mode, which economyFor (util/merx-economy.js) resolves to the ADVENT
  // economy: a 2-Merx grant and three Default Signatures free. The player
  // was handed one Signature instead of four, and the save reported spend 0
  // either way -- a silent under-grant, not a rejection.
  test('an aspirant wizard on an advent-content class still gets its 3 free Defaults', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant',
      classes: [{
        id: 'c-v1',
        name: 'Old Guard',
        content_format: 'advent',
        gear: [],
        base_gear: [{ name: 'Default A' }, { name: 'Default B' }, { name: 'Default C' }]
      }],
      economyByClassId: { 'c-v1': 'advent' }
    }));
    wizard.getState().classId = 'c-v1';
    wizard.syncBaseGear();

    const gear = wizard.getState().gear;
    expect(gear).toHaveLength(3);
    expect(gear.every((g) => g.cost === 0)).toBe(true);
    expect(wizard.getFreeBaseCount())
      .toBe(require('../util/character-derived').ADVENT_DEFAULT_SIGNATURES);
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.advent);
    expect(wizard.getMerxSpent()).toBe(0);
  });

  // The free Defaults belong to the economy that granted them, so a class
  // change that crosses economies must not carry them into a budget that
  // charges for the same items.
  test('changing to an aspirant-content class drops the Defaults advent granted', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant',
      classes: [
        {
          id: 'c-advent', name: 'Old Guard', content_format: 'advent', gear: [],
          base_gear: [{ name: 'Default A' }, { name: 'Default B' }, { name: 'Default C' }]
        },
        { id: 'c-v1', name: 'Gunslinger', content_format: 'aspirant', gear: [], base_gear: [] }
      ],
      economyByClassId: { 'c-advent': 'advent', 'c-v1': 'aspirant' }
    }));
    const state = wizard.getState();
    state.classId = 'c-advent';
    wizard.syncBaseGear();
    expect(wizard.getFreeBaseCount()).toBe(3);

    state.classId = 'c-v1';
    wizard.syncBaseGear();
    expect(state.gear).toEqual([]);
    expect(wizard.getFreeBaseCount()).toBe(0);
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.aspirant);
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

describe('step 4 offers the whole class and its purchases', () => {
  const FIGURES = economyFigures();
  const twelveNames = () => twelveItems().map((g) => g.name);
  const v1Class = () => ({
    id: 'c-v1',
    name: 'Gunslinger',
    content_format: 'aspirant',
    stat_spread: {},
    gear: [],
    class_gear: twelveItems(),
    base_gear: [],
    abilities: [],
    advanced_abilities: []
  });
  const otherV1Class = () => ({
    id: 'c-other',
    name: 'Drifter',
    content_format: 'aspirant',
    stat_spread: {},
    gear: [],
    class_gear: twelveItems(),
    base_gear: [],
    abilities: [],
    advanced_abilities: []
  });
  const adventClass = () => ({
    id: 'c-advent',
    name: 'Vizier',
    content_format: 'advent',
    stat_spread: {},
    gear: [],
    class_gear: sixItems(),
    base_gear: sixItems().slice(0, 3).map((g) => ({ name: g.name })),
    abilities: [],
    advanced_abilities: []
  });
  // An aspiring character has no class row: its Signatures are the three
  // items picked in the step-1 builder, which pg. 90 treats as its own.
  const seedAspiringPicks = (wizard, names) => {
    wizard.getState().classBuild.classGear = names.map((name) => ({
      classId: 'c-v1', itemName: name
    }));
  };

  test('the grid lists every Signature the class carries, in printed order', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.renderGearStep();
    const names = [...document.querySelectorAll('[data-signature-name]')]
      .map((el) => el.getAttribute('data-signature-name'));
    expect(names).toEqual(twelveNames());
  });

  test('buying a Signature and its Default spends both prices', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    wizard.setEnchantment('Cowboy Hat', { source: 'default' });
    expect(wizard.getMerxSpent())
      .toBe(FIGURES.prices.signature.own + FIGURES.prices.defaultEnchantment.own);
  });

  test('a Default stores its source alone -- the text stays on the class', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    wizard.setEnchantment('Cowboy Hat', { source: 'default' });
    const bought = wizard.getState().gear[0];
    expect(bought.enchantment).toEqual({ source: 'default' });
    expect(bought.class_id).toBe('c-v1');
    expect(bought.mods).toEqual([]);
  });

  test('an enchanted Signature uses two of the twelve slots', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    wizard.setEnchantment('Cowboy Hat', { source: 'default' });
    expect(wizard.getSlotsUsed()).toBe(2);
  });

  test('a purchase that would breach the budget is refused', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    for (const name of twelveNames()) wizard.buySignature(name);
    expect(wizard.getMerxSpent()).toBeLessThanOrEqual(wizard.getMerxBudget());
    expect(wizard.getState().gear)
      .toHaveLength(FIGURES.grants.aspirant / FIGURES.prices.signature.own);
  });

  test('a cross-class Signature is priced at the +1 tier', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant', classes: [v1Class(), otherV1Class()]
    }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Sharps Rifle', 'c-other');
    expect(wizard.getMerxSpent()).toBe(FIGURES.prices.signature.cross);
  });

  // The grid sells the character's own class; the shop's Signature tab is
  // what is left, so an own-class item is never on sale twice.
  test('the shop offers the other classes, not the one the grid holds', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant', classes: [v1Class(), otherV1Class()]
    }));
    wizard.getState().classId = 'c-v1';
    wizard.renderGearStep();
    const shop = document.getElementById('spendList').innerHTML;
    expect(shop).toContain('Drifter');
    expect(shop).not.toContain('Gunslinger');
  });

  test('an aspiring pick is own-class priced despite its origin (pg. 90)', () => {
    const wizard = bootWizard(fixture({ mode: 'aspiring', classes: [v1Class()] }));
    seedAspiringPicks(wizard, ['Cowboy Hat']);
    wizard.buySignature('Cowboy Hat', 'c-v1');
    expect(wizard.getMerxSpent()).toBe(FIGURES.prices.signature.own);
  });

  test('an aspiring grid holds the three picks the builder made', () => {
    const wizard = bootWizard(fixture({ mode: 'aspiring', classes: [v1Class()] }));
    seedAspiringPicks(wizard, ['Cowboy Hat', 'Lasso', 'Tin Star']);
    wizard.renderGearStep();
    const names = [...document.querySelectorAll('[data-signature-name]')]
      .map((el) => el.getAttribute('data-signature-name'));
    expect(names).toEqual(['Cowboy Hat', 'Lasso', 'Tin Star']);
  });

  test('an advent character sees no Enchantment controls', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
    wizard.getState().classId = 'c-advent';
    wizard.renderGearStep();
    expect(document.body.innerHTML).not.toContain('Default Enchantment');
    // The advent economy prints no entry to open: there is no grid, and its
    // own class is sold as shop cards instead.
    expect(document.querySelectorAll('[data-signature-name]')).toHaveLength(0);
    expect(document.getElementById('signaturePanel').hidden).toBe(true);
    expect(document.getElementById('spendList').innerHTML).toContain('Cowboy Hat');
  });

  // The advent economy grants three Defaults and 2 Merx; the grant is not a
  // purchase, so the free run at the front of state.gear is never priced.
  test('advent still spends nothing on the Defaults it is granted', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
    wizard.getState().classId = 'c-advent';
    wizard.syncBaseGear();
    expect(wizard.getMerxSpent()).toBe(0);
  });


  // The wizard mounts the shared component: opening a cell is what puts the
  // printed entry and its controls on the page.
  test('opening a cell reveals the entry the component renders', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.renderGearStep();
    document.querySelector('[data-signature-name="Cowboy Hat"]').click();
    const drawer = document.getElementById('signatureDrawer');
    expect(drawer.hidden).toBe(false);
    expect(drawer.innerHTML).toContain('Cowboy Hat Enchantment');
    expect(drawer.innerHTML).toContain('Default Enchantment');
    // Enchantment and Mod controls belong to a Signature the character owns.
    expect(drawer.querySelector('input[name="enchantment"]')).toBeNull();
    expect(drawer.querySelector('[data-signature-buy]')).not.toBeNull();
  });

  test('the drawer buys the Signature and then its Default', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.renderGearStep();
    document.querySelector('[data-signature-name="Cowboy Hat"]').click();
    document.querySelector('[data-signature-buy]').click();
    expect(wizard.getMerxSpent()).toBe(FIGURES.prices.signature.own);

    const drawer = document.getElementById('signatureDrawer');
    const defaultRadio = drawer.querySelector('input[name="enchantment"][value="default"]');
    defaultRadio.checked = true;
    defaultRadio.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(wizard.getState().gear[0].enchantment).toEqual({ source: 'default' });
    expect(document.getElementById('merxSpent').textContent)
      .toBe(String(FIGURES.prices.signature.own + FIGURES.prices.defaultEnchantment.own));
  });

  // pg. 8: the cap is counted in slots, and an Enchantment takes one. It is
  // judged apart from the Merx, exactly as validateEconomyLimits judges it.
  //
  // The printed aspirant cap sits far above anything its grant can buy -- the
  // cheapest slot costs a Signature's own-class price either way -- so a
  // creation cannot reach it with the real figures. Every figure the wizard
  // uses comes from the server, so the gate is exercised by serving a cap a
  // creation can reach.
  test('an Enchantment that would breach the Signature Cap is refused, Merx in hand', () => {
    const cap = 2;
    const wizard = bootWizard(fixture({
      mode: 'aspirant',
      classes: [v1Class()],
      economy: { ...FIGURES, signatureCap: { ...FIGURES.signatureCap, aspirant: cap } }
    }));
    wizard.getState().classId = 'c-v1';
    const names = twelveNames();
    for (let i = 0; i < cap; i++) wizard.buySignature(names[i]);
    expect(wizard.getSlotsUsed()).toBe(cap);
    expect(wizard.getMerxBudget() - wizard.getMerxSpent())
      .toBeGreaterThanOrEqual(FIGURES.prices.defaultEnchantment.own);

    expect(wizard.setEnchantment(names[0], { source: 'default' })).toBe(false);
    expect(wizard.getSlotsUsed()).toBe(cap);
  });


  // A walk back through the wizard is not a change of class. A Custom
  // Enchantment's and a Mod's text are the player's own writing, so losing
  // them on a re-entry loses something no re-pick brings back.
  test('returning to step 4 unchanged keeps the Signature, its Enchantment and its Mods', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.syncBaseGear();
    wizard.renderGearStep();
    document.querySelector('[data-signature-name="Cowboy Hat"]').click();
    document.querySelector('[data-signature-buy]').click();

    const drawer = document.getElementById('signatureDrawer');
    const custom = drawer.querySelector('input[name="enchantment"][value="custom"]');
    custom.checked = true;
    custom.dispatchEvent(new window.Event('change', { bubbles: true }));
    const customName = drawer.querySelector('[data-custom-name]');
    customName.value = 'Hex of the Long Ride';
    customName.dispatchEvent(new window.Event('change', { bubbles: true }));
    const modName = drawer.querySelector('[data-mod-name]');
    modName.value = 'Wide Brim';
    modName.dispatchEvent(new window.Event('change', { bubbles: true }));

    const spent = wizard.getMerxSpent();
    wizard.syncBaseGear();

    const gear = wizard.getState().gear;
    expect(gear).toHaveLength(1);
    expect(gear[0].enchantment)
      .toEqual({ source: 'custom', name: 'Hex of the Long Ride', description: '' });
    expect(gear[0].mods).toEqual([{ name: 'Wide Brim', description: '' }]);
    expect(wizard.getMerxSpent()).toBe(spent);
  });

  // A V1 shop pool spans every class, so a Signature bought before a change
  // of class is still offered, still priced and still removable after it --
  // and it carries the player's own writing, which no re-pick brings back.
  test('a V1 change of class keeps a bought Signature, its Enchantment and its Mods', () => {
    const wizard = bootWizard(fixture({
      mode: 'aspirant', classes: [v1Class(), otherV1Class()]
    }));
    const state = wizard.getState();
    state.classId = 'c-v1';
    wizard.syncBaseGear();
    wizard.renderGearStep();
    document.querySelector('[data-signature-name="Cowboy Hat"]').click();
    document.querySelector('[data-signature-buy]').click();

    const drawer = document.getElementById('signatureDrawer');
    const custom = drawer.querySelector('input[name="enchantment"][value="custom"]');
    custom.checked = true;
    custom.dispatchEvent(new window.Event('change', { bubbles: true }));
    const customName = drawer.querySelector('[data-custom-name]');
    customName.value = 'Hex of the Long Ride';
    customName.dispatchEvent(new window.Event('change', { bubbles: true }));
    const modName = drawer.querySelector('[data-mod-name]');
    modName.value = 'Wide Brim';
    modName.dispatchEvent(new window.Event('change', { bubbles: true }));

    state.classId = 'c-other';
    wizard.syncBaseGear();

    const gear = state.gear;
    expect(gear).toHaveLength(1);
    expect(gear[0].name).toBe('Cowboy Hat');
    expect(gear[0].class_id).toBe('c-v1');
    expect(gear[0].enchantment)
      .toEqual({ source: 'custom', name: 'Hex of the Long Ride', description: '' });
    expect(gear[0].mods).toEqual([{ name: 'Wide Brim', description: '' }]);
    // Repriced against the new class as a Cross-Class Signature, and still
    // inside the grant -- nothing about the change strands the player.
    expect(wizard.getMerxSpent()).toBeLessThanOrEqual(wizard.getMerxBudget());
  });

  // Advent's shop offers the selected class's gear alone, so anything held
  // from the previous class would have no card to remove it from and would
  // reprice as Cross-Class above the whole grant. It drops the lot.
  test('an advent change of class drops the old class\u2019s free Defaults and its picks', () => {
    const otherAdvent = {
      ...adventClass(),
      id: 'c-advent-2',
      name: 'Warden',
      class_gear: sixItems().map((g) => ({ ...g, name: 'Warden ' + g.name })),
      base_gear: sixItems().slice(0, 3).map((g) => ({ name: 'Warden ' + g.name }))
    };
    const wizard = bootWizard(fixture({
      mode: 'advent', classes: [adventClass(), otherAdvent]
    }));
    const state = wizard.getState();
    state.classId = 'c-advent';
    wizard.syncBaseGear();
    const granted = state.gear.map((g) => g.name);
    expect(granted).toHaveLength(adventClass().base_gear.length);
    state.gear.push({
      name: 'Bought Elective', kind: 'class', subtype: 'elective', class_id: 'c-advent',
      class_name: 'Vizier', owned: true, enchantment: null, mods: [],
      cost: FIGURES.prices.signature.own
    });
    state.commonItems = [{ name: 'Bedroll' }];

    state.classId = 'c-advent-2';
    wizard.syncBaseGear();

    const after = state.gear.map((g) => g.name);
    expect(after).toEqual(otherAdvent.base_gear.map((g) => g.name));
    for (const name of granted) expect(after).not.toContain(name);
    expect(state.commonItems).toEqual([]);
    expect(wizard.getMerxSpent()).toBe(0);
  });

  test('re-entering advent step 4 does not reload the Defaults it was granted', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
    wizard.getState().classId = 'c-advent';
    wizard.syncBaseGear();
    wizard.syncBaseGear();
    expect(wizard.getState().gear).toHaveLength(wizard.getFreeBaseCount());
    expect(wizard.getMerxSpent()).toBe(0);
  });


  // A draft restored from localStorage may name the printing class
  // `origin_class_id`. Losing that name is silent three times over, so the
  // restore keeps it: the tier, the saved attribution and the shop's own
  // sense of what is held all read it.
  test('a restored draft keeps a Signature\'s printing class', () => {
    const wizardData = () => fixture({
      mode: 'aspirant', classes: [v1Class(), otherV1Class()]
    });
    // A whole saved state, as writeStorage persists it, with one Signature
    // bought from the other class and named the way a draft names it.
    const draft = {
      ...bootWizard(wizardData()).getState(),
      classId: 'c-v1',
      gear: [{
        name: 'Sharps Rifle',
        kind: 'class',
        subtype: 'elective',
        cost: 3,
        origin_class_id: 'c-other',
        origin_class_name: 'Drifter'
      }]
    };
    const wizard = bootWizard(wizardData(), { draft });

    const restored = wizard.getState().gear[0];
    expect(restored.class_id).toBe('c-other');
    expect(wizard.getMerxSpent()).toBe(FIGURES.prices.signature.cross);
    expect(wizard.buildSubmitPayload().gear)
      .toEqual([{ name: 'Sharps Rifle', class_id: 'c-other', enchantment: null, mods: [] }]);
  });

  // The hidden attribute alone does not hide an element carrying a Bulma
  // class that sets display -- the stylesheet has to say so. jsdom mounts
  // these bare, so only the stylesheet itself can be asked.
  test('step 4\'s hidden toggles are backed by the stylesheet', () => {
    const css = require('fs').readFileSync('public/css/styles.css', 'utf8');
    for (const id of ['slotsReadout', 'signatureDrawer', 'baseGearColumn']) {
      expect(css).toContain('#' + id + '[hidden]');
    }
  });

  // pg. 85: an economy with no cap has no readout to show.
  test('the slot readout appears only where the economy caps Signatures', () => {
    const aspirant = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    aspirant.getState().classId = 'c-v1';
    aspirant.renderGearStep();
    expect(document.getElementById('slotsReadout').hidden).toBe(false);
    expect(document.getElementById('slotsCap').textContent)
      .toBe(String(FIGURES.signatureCap.aspirant));

    const advent = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
    advent.getState().classId = 'c-advent';
    advent.renderGearStep();
    expect(document.getElementById('slotsReadout').hidden).toBe(true);
  });

  // serializePayload puts each Signature's Enchantment and Mods on its gear
  // entry, alongside name and class_id. setMods isn't on the exposed handle
  // (only pure reads and buySignature/setEnchantment are), so a Mod is
  // stamped directly on the purchase the same way other tests here reach
  // into state.gear.
  test('the payload carries each Signature\'s Enchantment and Mods', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    wizard.setEnchantment('Cowboy Hat', { source: 'default' });
    wizard.getState().gear[0].mods = [{ name: 'Scope', description: 'Sees far' }];
    const [item] = wizard.buildSubmitPayload().gear;
    expect(item).toMatchObject({
      name: 'Cowboy Hat',
      class_id: 'c-v1',
      enchantment: { source: 'default' },
      mods: [{ name: 'Scope', description: 'Sees far' }]
    });
  });

  test('a Default Enchantment submits no copy of the class\'s text', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    wizard.setEnchantment('Cowboy Hat', { source: 'default' });
    const [item] = wizard.buildSubmitPayload().gear;
    expect(item.enchantment).toEqual({ source: 'default' });
    expect(item.enchantment.name).toBeUndefined();
    expect(item.enchantment.description).toBeUndefined();
  });

  test('an unenchanted Signature submits an explicit null, not an absent key', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    const [item] = wizard.buildSubmitPayload().gear;
    expect('enchantment' in item).toBe(true);
    expect(item.enchantment).toBeNull();
  });

  test('commissary_reward is no longer hardcoded to zero', () => {
    const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
    wizard.getState().classId = 'c-v1';
    wizard.buySignature('Cowboy Hat');
    const payload = wizard.buildSubmitPayload();
    expect(payload.commissary_reward).toBe(wizard.getMerxBudget() - wizard.getMerxSpent());
  });

  test('an advent payload is unchanged in shape', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
    wizard.getState().classId = 'c-advent';
    wizard.syncBaseGear();
    const [item] = wizard.buildSubmitPayload().gear;
    expect(item.enchantment).toBeNull();
    expect(item.mods).toEqual([]);
  });

  // Advent's own creation grant (2, the Elective) leaves no room to buy
  // anything and still owe a remainder worth asserting on, so missions are
  // added here purely to give the budget headroom above one paid purchase --
  // the same getMerxBudget/getMerxSpent arithmetic the aspirant test above
  // already covers, exercised once under the economy whose grant this plan
  // changed from 0.
  test('commissary_reward carries the unspent Merx under the advent economy', () => {
    const wizard = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
    const state = wizard.getState();
    state.classId = 'c-advent';
    // renderSummaryMeta clamps successfulMissions to missionsForLevel(level),
    // which is 0 at level 1 -- level 3 allows the 4 this test sets.
    state.level = 3;
    state.successfulMissions = 4;
    wizard.syncBaseGear();
    wizard.buySignature('Duster');
    const payload = wizard.buildSubmitPayload();
    expect(wizard.getMerxSpent()).toBeGreaterThan(0);
    expect(wizard.getMerxSpent()).toBeLessThan(wizard.getMerxBudget());
    expect(payload.commissary_reward).toBe(wizard.getMerxBudget() - wizard.getMerxSpent());
  });

  // pg. 3: 12 Merx "may be spent however they like or save for later" -- Next
  // is never gated on the budget being fully spent, and the unspent
  // remainder (asserted on above via commissary_reward) is called out for
  // the player rather than treated as an error.
  describe('the Next button is never gated on spending the whole budget (pg. 3)', () => {
    const classFor = (mode) => (mode === 'advent' ? adventClass() : v1Class());

    test.each(['advent', 'aspirant', 'aspiring'])(
      '%s may leave step 4 with Merx unspent', (mode) => {
        const wizard = bootWizard(fixture({ mode, classes: [classFor(mode)] }));
        wizard.getState().classId = classFor(mode).id;
        wizard.renderGearStep();
        expect(document.getElementById('step4Next').disabled).toBe(false);
      }
    );

    test('the remainder is shown as saved, not as an error', () => {
      const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
      wizard.getState().classId = 'c-v1';
      wizard.renderGearStep();
      expect(document.body.textContent).toContain('saved');
    });

    // Buying every printed Signature and enchanting each one costs far more
    // than the aspirant grant -- affordsChange (the gate on the purchase
    // itself, not on Next) must keep the total at or under budget throughout.
    test('over-budget is still impossible: purchases stop at the budget', () => {
      const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
      wizard.getState().classId = 'c-v1';
      for (const name of twelveNames()) {
        wizard.buySignature(name);
        wizard.setEnchantment(name, { source: 'custom', name: 'x', description: 'y' });
      }
      expect(wizard.getMerxSpent()).toBeLessThanOrEqual(wizard.getMerxBudget());
    });

    // Mission income lifts the budget well above what 8 Signatures cost, so
    // the Signature Cap -- not the budget -- is what has to stop this purchase
    // run; a low budget would let the test pass for the wrong reason.
    test('a purchase that would breach the Signature Cap is refused (aspiring)', () => {
      const wizard = bootWizard(fixture({ mode: 'aspiring', classes: [v1Class()] }));
      const state = wizard.getState();
      state.level = 12;
      state.successfulMissions = 20;
      seedAspiringPicks(wizard, twelveNames());
      for (const name of twelveNames()) wizard.buySignature(name, 'c-v1');
      expect(wizard.getSlotsUsed()).toBeLessThanOrEqual(FIGURES.signatureCap.aspiring);
    });
  });

  // Ruling 5: a rename is a delete plus an insert, so a Signature that
  // carries a paid Enchantment or Mods must be confirmed away, never
  // silently dropped. Both removal paths -- the grid drawer's Remove
  // button and the shop card's own Remove control -- are covered below.
  describe('replacing a purchased Signature warns first (Ruling 5)', () => {
    test('removing a bare Signature asks nothing', () => {
      const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
      wizard.getState().classId = 'c-v1';
      wizard.buySignature('Cowboy Hat');
      wizard.removeSignature('Cowboy Hat');
      expect(wizard.getPendingConfirmation()).toBeNull();
      expect(wizard.getState().gear).toHaveLength(0);
    });

    test('removing a purchased Signature asks first and keeps it until confirmed', () => {
      const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
      wizard.getState().classId = 'c-v1';
      wizard.buySignature('Cowboy Hat');
      wizard.setEnchantment('Cowboy Hat', { source: 'default' });
      wizard.removeSignature('Cowboy Hat');
      expect(wizard.getPendingConfirmation().lines).toContain(
        'Default Enchantment  ' + FIGURES.prices.defaultEnchantment.own + 'm');
      expect(wizard.getState().gear).toHaveLength(1);
      wizard.confirmPending();
      expect(wizard.getState().gear).toHaveLength(0);
    });

    test('cancelling leaves the purchase intact', () => {
      const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
      wizard.getState().classId = 'c-v1';
      wizard.buySignature('Cowboy Hat');
      wizard.setEnchantment('Cowboy Hat', { source: 'default' });
      wizard.removeSignature('Cowboy Hat');
      wizard.cancelPending();
      expect(wizard.getState().gear[0].enchantment).toEqual({ source: 'default' });
      expect(wizard.getPendingConfirmation()).toBeNull();
    });

    // Cancel must not remove-then-restore: a typed Custom name/description
    // and a Mod both have to come back exactly, not just the Enchantment's
    // source.
    test('cancelling preserves a Custom Enchantment\'s typed text and every Mod', () => {
      const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
      wizard.getState().classId = 'c-v1';
      wizard.buySignature('Cowboy Hat');
      wizard.setEnchantment('Cowboy Hat',
        { source: 'custom', name: 'Ricochet', description: 'Bounces once' });
      wizard.getState().gear[0].mods = [{ name: 'Scope', description: 'Sees far' }];
      wizard.removeSignature('Cowboy Hat');
      wizard.cancelPending();
      const kept = wizard.getState().gear[0];
      expect(kept.enchantment).toEqual({
        source: 'custom', name: 'Ricochet', description: 'Bounces once'
      });
      expect(kept.mods).toEqual([{ name: 'Scope', description: 'Sees far' }]);
    });

    // Path 1: the printed grid's drawer, whose Remove button (data-signature-
    // sell) is the only way to drop a Signature from there.
    test('the grid drawer\'s Remove button also asks before destroying a purchase', () => {
      const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
      wizard.getState().classId = 'c-v1';
      wizard.buySignature('Cowboy Hat');
      wizard.setEnchantment('Cowboy Hat', { source: 'default' });
      wizard.renderGearStep();
      document.querySelector('[data-signature-name="Cowboy Hat"]').click();
      document.querySelector('[data-signature-sell]').click();
      expect(wizard.getPendingConfirmation()).not.toBeNull();
      expect(wizard.getState().gear).toHaveLength(1);
      wizard.confirmPending();
      expect(wizard.getState().gear).toHaveLength(0);
    });

    // Path 2: the shop-card list's own Remove control (data-shop-remove),
    // reachable wherever a class Signature is sold as a card rather than in
    // the grid -- the advent economy sells its own class this way.
    test('the shop card\'s own Remove control also asks before destroying a purchase', () => {
      const wizard = bootWizard(fixture({ mode: 'advent', classes: [adventClass()] }));
      const state = wizard.getState();
      state.classId = 'c-advent';
      // Advent's own creation grant (2, the Elective) leaves no room to also
      // afford the Enchantment this test needs to be at stake -- mission
      // income lifts the budget, same as the commissary_reward test above.
      state.level = 3;
      state.successfulMissions = 4;
      wizard.syncBaseGear();
      wizard.buySignature('Duster');
      wizard.setEnchantment('Duster', { source: 'default' });
      wizard.renderGearStep();
      document.querySelector('[data-shop-remove="class:c-advent:Duster"]').click();
      expect(wizard.getPendingConfirmation()).not.toBeNull();
      expect(wizard.getState().gear.some((g) => g.name === 'Duster')).toBe(true);
      wizard.confirmPending();
      expect(wizard.getState().gear.some((g) => g.name === 'Duster')).toBe(false);
    });

    // The dialog itself: created lazily, shows the priced lines, and its own
    // buttons drive confirm/cancel -- not just the exposed handle.
    test('the dialog renders the priced lines and its buttons resolve it', () => {
      const wizard = bootWizard(fixture({ mode: 'aspirant', classes: [v1Class()] }));
      wizard.getState().classId = 'c-v1';
      wizard.buySignature('Cowboy Hat');
      wizard.setEnchantment('Cowboy Hat', { source: 'default' });
      wizard.removeSignature('Cowboy Hat');
      const dialog = document.getElementById('pendingRemovalDialog');
      expect(dialog.hidden).toBe(false);
      expect(dialog.textContent).toContain(
        'Default Enchantment  ' + FIGURES.prices.defaultEnchantment.own + 'm');
      document.querySelector('[data-cancel-removal]').click();
      expect(dialog.hidden).toBe(true);
      expect(wizard.getState().gear).toHaveLength(1);
    });
  });
});

// A creation declares completed_missions as a scalar count and writes no
// mission rows, and the character page prices earned Merx off the rows the
// character really has (routes/characters.js reads getRealMissions). So in an
// enforced economy the wizard's budget, the budget the save enforces, the
// leftover the save stores and the `earned` the page derives are all the
// creation grant -- crediting the declared count in any one of them puts that
// one out of step with the other three, and a character saved against a
// credit its own page will not repeat reads as a deficit whose next
// auto-calculated edit zeroes the stored Merx.
describe('an enforced creation prices the grant alone, everywhere', () => {
  const { CharacterService } = require('../services/character/service');
  const { deriveMerxBreakdown } = require('../util/character-derived');

  const MISSION_CLASS = {
    id: 'c1',
    name: 'Test Class',
    content_format: 'aspirant',
    stat_spread: {},
    gear: twelveItems(),
    abilities: [],
    advanced_abilities: []
  };

  const ok = (data) => ({ data, error: null });
  const UNREACHED_ADAPTER_METHODS = [
    'levelUpAtomic', 'createBackfillMission', 'getAvailableHostedMissions',
    'createOffscreenMissionRow', 'findUpgradeTargets', 'getOffscreenMissionRow',
    'getSourceMissionForCredit', 'getConduitCredits', 'insertOffscreenMission',
    'updateOffscreenMissionRow', 'deleteOffscreenMissionRow'
  ];
  const serviceOnAspirantClass = () => {
    const saved = {};
    const adapter = {
      getRulesVersion: async () => 'v1',
      resolveClassReference: async (input) => ({ ...input }),
      getCharacter: async () => ok({ id: 'character-1', creator_id: 'profile-1', abilities: [] }),
      createCharacterRow: async () => ok([{ id: 'new-character' }]),
      updateCharacterRow: async (id) => ok([{ id }]),
      getChildRows: async () => ok([]),
      insertChildRows: async () => ok(true),
      updateChildRow: async () => ok(true),
      deleteChildRows: async () => ok(true),
      getClassContentLookupMaps: async () => ({
        gearNameToClassId: new Map(),
        gearNameToDescription: new Map(),
        abilityNameToClassId: new Map(),
        abilityNameToDescription: new Map(),
        itemsByClassId: new Map(),
        classesByName: new Map(),
        classRows: [{ id: 'c1', content_format: 'aspirant', rules_version: 'v1' }]
      }),
      getRealMissions: async () => ok([]),
      listOffscreenMissions: async () => ok([]),
      fetchCharacterOwnership: async () => ok({ id: 'character-1', creator_id: 'profile-1' }),
      deleteCharacter: async () => ok(null),
      setDeceased: async () => ok([{ id: 'character-1' }]),
      updateClass: async () => ok([{ id: 'character-1' }]),
      updateOwnedFields: async () => ok({ id: 'character-1' }),
      getClassRulesVersion: async () => ok('v1'),
      fetchAllowedAbilityIds: async () => ok([]),
      fetchExistingPerks: async () => ok([]),
      saveCharacterAtomic: async (args) => {
        Object.assign(saved, args.character);
        return ok({ id: 'character-1', ...args.character });
      }
    };
    // Creation reaches none of these, but the constructor checks the whole
    // adapter surface, so they stand present and unreachable.
    for (const method of UNREACHED_ADAPTER_METHODS) {
      adapter[method] = async () => { throw new Error(`${method} is not part of creation`); };
    }
    return { service: new CharacterService(adapter), saved };
  };

  // `count` own-class Signatures, bought against a declared mission history.
  // Six fit the aspirant grant exactly; seven do not, at any declared count.
  const buildWith = (wizard, count, successes) => {
    const state = wizard.getState();
    state.classId = 'c1';
    state.level = 3;
    state.successfulMissions = successes;
    state.traits = ['brave', 'bold', 'lucky'];
    state.gear = twelveItems().slice(0, count).map((item) => ({
      name: item.name, kind: 'class', subtype: 'elective', class_id: 'c1',
      class_name: 'Test Class', owned: true, enchantment: null, mods: []
    }));
    return state;
  };

  const bootMissionWizard = () => bootWizard(fixture({
    mode: 'aspirant',
    preselectedClassId: 'c1',
    classes: [MISSION_CLASS],
    statList: STAT_LIST,
    personalityMap: PERSONALITY_MAP
  }));

  test('the wizard budget is the grant, whatever history is declared', () => {
    const wizard = bootMissionWizard();
    buildWith(wizard, 6, 4);
    expect(wizard.getMerxBudget()).toBe(economyFigures().grants.aspirant);
  });

  test('the save stores the remainder the wizard showed, and the page derives it', async () => {
    const wizard = bootMissionWizard();
    buildWith(wizard, 6, 4);
    const budget = wizard.getMerxBudget();
    const spent = wizard.getMerxSpent();
    const payload = wizard.buildSubmitPayload();
    expect(payload.completed_missions).toBe(4);

    const { service, saved } = serviceOnAspirantClass();
    const result = await service.createCharacter(payload, { id: 'profile-1' });
    expect(result.error).toBeNull();
    expect(saved.commissary_reward).toBe(budget - spent);
    expect(saved.commissary_reward).toBe(payload.commissary_reward);

    // The character page's own figures, derived the way routes/characters.js
    // derives them: off the mission ROWS the character has, of which a
    // creation writes none.
    const page = deriveMerxBreakdown({
      realMissions: [],
      offscreenMissions: [],
      gear: payload.gear,
      commonItems: payload.common_items,
      characterClassId: payload.class_id,
      economy: 'aspirant'
    });
    expect(page.earned).toBe(budget);
    expect(page.spend).toBe(spent);
    expect(page.reward).toBe(saved.commissary_reward);
    expect(page.deficit).toBe(0);
  });

  test('a build past the grant is refused however much history it declares', async () => {
    const wizard = bootMissionWizard();
    buildWith(wizard, 7, 4);
    const payload = wizard.buildSubmitPayload();
    const { service } = serviceOnAspirantClass();
    const result = await service.createCharacter(payload, { id: 'profile-1' });
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/Merx/);
  });
});

// Whole-plan review, Important 4: step 4's opening sentence was keyed on the
// URL's mode while the badge beside it reads the selected class's economy, so
// an advent wizard on a V1 class read "base gear is included for free" and
// "2 Merx" against a live 12 and no free column. The sentence is written by
// the same render that writes the badge now, from the same two sources.
describe('step 4 prose follows the class economy the readouts follow', () => {
  const introText = () => document.getElementById('gearStepIntro').textContent;

  const bootOnClass = (mode, contentFormat) => {
    const wizard = bootWizard(fixture({
      mode,
      classes: [{
        id: 'c1', name: 'Test Class', content_format: contentFormat, gear: twelveItems(),
        base_gear: [{ name: 'Default A' }], stat_spread: {}, abilities: [], advanced_abilities: []
      }],
      statList: STAT_LIST,
      personalityMap: PERSONALITY_MAP
    }));
    wizard.getState().classId = 'c1';
    wizard.renderGearStep();
    return wizard;
  };

  test('an advent wizard on a V1 class is told the aspirant budget, with no free column', () => {
    const wizard = bootOnClass('advent', 'aspirant');
    expect(introText()).toContain(String(wizard.getMerxBudget()));
    expect(introText()).not.toContain('free');
    expect(document.getElementById('merxBudget').textContent)
      .toBe(String(economyFigures().grants.aspirant));
  });

  test('an aspirant wizard on an advent-content class is told about its free base gear', () => {
    const wizard = bootOnClass('aspirant', 'advent');
    expect(introText()).toContain('free');
    expect(introText()).toContain(String(wizard.getMerxBudget()));
    expect(document.getElementById('merxBudget').textContent)
      .toBe(String(economyFigures().grants.advent));
  });

  // pg. 85: 2 Merx for your own class's Signature, 3 for a cross-class one.
  // The wizard charges both, so the sentence that introduces the step has to
  // name both.
  test('the aspirant sentence names both Signature prices', () => {
    bootOnClass('aspirant', 'aspirant');
    expect(introText()).toContain(String(economyFigures().prices.signature.own) + ' Merx');
    expect(introText()).toContain(String(economyFigures().prices.signature.cross) + ' Merx');
  });

  // Advent is the one economy whose budget still moves with the declared
  // successes, so it is where the sentence and the badge can disagree.
  test('the sentence reports the budget the badge reports, advent income included', () => {
    const wizard = bootOnClass('advent', 'advent');
    wizard.getState().successfulMissions = 4;
    wizard.renderGearStep();
    const budget = economyFigures().grants.advent + 4 * MERX_PER_MISSION_SUCCESS;
    expect(wizard.getMerxBudget()).toBe(budget);
    expect(introText()).toContain('You have ' + budget + ' Merx');
    expect(document.getElementById('merxBudget').textContent).toBe(String(budget));
  });

  // The enforced economies spend the grant alone: the count declares a
  // history no mission row backs, and the save and the character page both
  // price the rows.
  test('a declared history moves neither the sentence nor the badge in aspirant', () => {
    const wizard = bootOnClass('aspirant', 'aspirant');
    wizard.getState().successfulMissions = 4;
    wizard.renderGearStep();
    const grant = economyFigures().grants.aspirant;
    expect(wizard.getMerxBudget()).toBe(grant);
    expect(introText()).toContain('You have ' + grant + ' Merx');
    expect(document.getElementById('merxBudget').textContent).toBe(String(grant));
  });
});
