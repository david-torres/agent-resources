// routes/characters.test.js
//
// Tests for GET /characters/ability-perk-group, which renders the per-ability
// perk-group scaffold partial when the create form selects a Class Ability.
//
// The harness mirrors routes/character-wizard.test.js: mock the data layer,
// boot a real Express app with the full Handlebars engine (helpers + partials),
// and hit the live server with fetch.
const { test, expect, mock, beforeAll, beforeEach, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Mutable per-test state consulted by the mocks below. Reset before every
// test so no test inherits state another one installed: with it left
// standing, a test that never sets it up still gets a stale character (or
// class list, or family map) back and can pass on the previous test's
// fixture.
const pageState = {};

// Minimal no-op PostgREST-shaped fake — the ability-perk-group handler only
// checks query params and calls res.render, so an empty store is sufficient
// for most tests. The edit-form test below needs `classes` rows out of it
// too, for services/character/repository.js#getClassFamilyRows (reached via
// supabaseAdmin, which this same factory backs) — every other table keeps
// resolving to an empty list, unchanged.
const makeClient = () => ({
  from(table) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      update() { return chain; },
      insert() { return chain; },
      single() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(onF, onR) {
        const data = table === 'classes' ? (pageState.classFamilyRows || []) : table === 'mission_characters' ? (pageState.history || []).map(missions => ({missions})) : [];
        return Promise.resolve({ data, error: null }).then(onF, onR);
      },
    };
    return chain;
  },
});

// Capture real modules so afterAll can restore them — bun's mock.module is
// process-global and would otherwise leak into other test files.
//
// models/_base is captured and mocked FIRST, before any other require below:
// models/character.js (required next) pulls in services/character/
// repository.js, which destructures supabaseAdmin out of models/_base at
// REQUIRE TIME. Mocking _base after that require has already run would leave
// repository.js holding the real client for the rest of this process --
// every getClassFamilyRows/getRealMissions call the edit-form route makes
// would then hit a real, unreachable network address instead of this fake.
const realBase = require('../models/_base');
const realBookAccess = require('../services/access/service');
let aspirantBookState = 'owned';
mock.module('../services/access/service', () => ({ ...realBookAccess, getEditionAccess: async () => ({ aspirant: { state: aspirantBookState } }) }));
mock.module('../models/_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  createUserClient: () => makeClient(),
  anonKey: 'test-anon-key',
}));

const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realCharacter = require('../models/character');
const realClass = require('../models/class');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');

const { statList } = require('../util/enclave-consts');

const CHAR_ID = '22222222-2222-4222-8222-222222222222';

// A minimally complete character for the full character page (not the
// /details fragment, which needs far less): statList stats, a class,
// abilities and an advent economy (no content_format, no creator_mode).
const makePageCharacter = (abilityCount) => ({
  id: CHAR_ID,
  name: 'Ash',
  class: 'Mage',
  class_id: 'class-a',
  creator_id: 'profile-owner',
  creator_mode: null,
  is_public: true,
  level: 3,
  completed_missions: 0,
  ...Object.fromEntries(statList.map(stat => [stat, 2])),
  traits: [],
  abilities: Array.from({ length: abilityCount }, (_, i) => ({
    id: `ab-${i}`,
    name: `Ability ${i}`,
    class_id: 'class-a',
    type: 'core',
  })),
  gear: [],
  ability_perks: [],
  quirks: [],
  accessories: [],
  common_items: [],
  perks: '',
  additional_gear: '',
});

mock.module('../models/auth', () => ({
  // Consumed by the real authOptional/isAuthenticated middleware. No token
  // (the ability-perk-group and character-page tests above) resolves false;
  // the classic POST /characters test below sends a bearer token and needs a
  // user back.
  getUserFromToken: async (token) => (token ? { id: 'user-1' } : false),
}));
mock.module('../models/profile', () => ({
  // Consumed by isAuthenticated for the signed-in POST /characters test;
  // no token means no call reaches this in the other tests above.
  getProfile: async (user) => (user ? { id: 'profile-1', user_id: user.id } : null),
  getProfileById: async () => ({ data: null, error: null }),
}));

mock.module('../models/offscreen-mission', () => ({
  listOffscreenMissions: async () => ({ data: [], error: null }),
  getAvailableHostedMissionsForPicker: async () => ({ data: [], error: null }),
  createOffscreenMission: async () => ({ data: {}, error: null }),
  getOffscreenMissionById: async () => ({ data: null, error: null }),
  updateOffscreenMission: async () => ({ data: {}, error: null }),
  removeOffscreenMission: async () => ({ error: null }),
}));

mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../models/lfg', () => ({
  getPendingJoinRequestCount: async () => ({ count: 0 }),
  getLfgPost: async () => ({ data: null, error: null }),
}));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

// GET /characters/:id/:name? (the full character page) is the only test
// below that needs models/character and models/class; pageState drives
// what getCharacter returns.
mock.module('../models/character', () => ({
  // GET /:id/edit asks for the conversion preview on every render; a test
  // offers one by setting pageState.conversionPlan.
  planCharacterAspirantConversion: async (actor, id) => {
    pageState.lastPlanArgs = { actor, id };
    if (pageState.planThrows) throw new Error('plan exploded');
    return { data: pageState.conversionPlan || null, error: null };
  },
  convertCharacterToAspirant: async (actor, id) => {
    pageState.lastConvert = { actor, id };
    return pageState.conversionResult || { data: { id, name: 'Ash' }, error: null };
  },
  getCharacter: async () => (pageState.character
    ? { data: pageState.character, error: null }
    : { data: null, error: { code: 'PGRST116', message: 'not found' } }),
  getCharacterRecentMissions: async () => ({ data: [], error: null }),
  // The classic-POST-bypass test (Task 12) must never reach this: a rejected
  // build is refused by validateAspiringBuild before createCharacter is
  // called. A distinct error here makes a guard that silently lets the
  // request through fail loudly instead of passing for the wrong reason.
  createCharacter: async () => pageState.createResult
    || ({ data: null, error: 'createCharacter should not have been called' }),
  // Reached by GET /:id/edit whenever characterClass resolves (every test
  // below that authenticates does). Unused by upgradeTargets assertions here,
  // so an empty list is enough to keep the handler from throwing on a
  // destructured function it never got.
  findUpgradeTargetsFor: async () => pageState.upgradeTargets || [],
  // PUT /:id never reaches a real save layer here -- captures the body
  // applyAbilityPurchases and applyGearPurchases produced, the way pageState
  // feeds every other mock, so the abilities_json test below can assert on
  // what the route handed downstream without a real database.
  updateCharacter: async (id, body) => {
    pageState.lastUpdateBody = body;
    return pageState.updateResult || { data: { id, name: body.name || 'Ash' }, error: null };
  },
}));
// A V1 aspirant class carrying three Core Abilities and three Advanced ones
// (Task 3 of the Perk Economy Surfaces plan) -- the shape filterClassDataForUser
// reads via getClasses to build the classic picker's roster.
const ABILITY_CLASS = {
  id: 'class-adv',
  name: 'Gunslinger',
  is_public: true,
  is_player_created: false,
  rules_edition: 'aspirant',
  rules_version: 'v1',
  content_format: 'aspirant',
  gear: [],
  abilities: [
    { name: 'Quickdraw', description: '' },
    { name: 'Steady Aim', description: '' },
    { name: 'Fan the Hammer', description: '' },
  ],
  advanced_abilities: [
    { name: 'Trick Shot', description: '' },
    { name: 'Ricochet', description: '' },
    { name: 'Last Stand', description: '' },
  ],
};

// Two versions of one class family (Task 4 fix round 2), the shape
// util/class-list-grouping.js#latestClassVersions collapses: TRAILBLAZER_V2
// prints an ability TRAILBLAZER_V1 does not, and carries a different id even
// though base_class_id (below, via pageState.classFamilyRows) links them as
// the same family. A character whose own class is the OLDER version must
// still see that ability priced at the own rate in the ability island, not
// the cross rate its differing class_id would suggest without classFamilyOf.
const TRAILBLAZER_V1 = {
  id: 'class-tb-v1',
  name: 'Trailblazer',
  is_public: true,
  is_player_created: false,
  rules_edition: 'aspirant',
  rules_version: 'v1',
  content_format: 'aspirant',
  gear: [],
  abilities: [{ name: 'Trailmark' }],
  advanced_abilities: [],
  created_at: '2020-01-01T00:00:00Z',
};
const TRAILBLAZER_V2 = {
  id: 'class-tb-v2',
  base_class_id: 'class-tb-v1',
  name: 'Trailblazer',
  is_public: true,
  is_player_created: false,
  rules_edition: 'aspirant',
  rules_version: 'v1',
  content_format: 'aspirant',
  gear: [],
  abilities: [{ name: 'Trailmark' }, { name: 'Long Stride' }],
  advanced_abilities: [],
  created_at: '2024-01-01T00:00:00Z',
};
// The one class on the v2 rules in this file, so GET /characters/version-fields
// has something that resolves to the v2 field block rather than the empty
// container the v1 branch sends.
const V2_RULES_CLASS = {
  id: 'class-v2-rules',
  name: 'Wayfinder',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v2',
  content_format: 'advent',
  gear: [],
  abilities: [],
  advanced_abilities: [],
  created_at: '2024-01-01T00:00:00Z',
};
// An Advent class on the v1 rules, for characters whose mode, not their
// class, decides their rules.
const ADVENT_V1_CLASS = {
  id: 'class-advent-v1',
  name: 'Vanguard',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v1',
  content_format: 'advent',
  gear: [],
  abilities: [],
  advanced_abilities: [],
  created_at: '2024-01-01T00:00:00Z',
};
// An Advent class and its Aspirant version. A character on the fork owns
// items from the Advent class as its own class.
const GS_ADVENT = {
  id: 'class-gs-advent',
  name: 'Gunslinger',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v2',
  content_format: 'advent',
  gear: [{ name: 'Duster', description: '' }, { name: 'Sling', description: '' }],
  abilities: [{ name: 'Quickdraw', description: '' }],
  advanced_abilities: [],
  created_at: '2023-01-01T00:00:00Z',
};
const GS_FORK = {
  ...GS_ADVENT,
  id: 'class-gs-fork',
  base_class_id: GS_ADVENT.id,
  rules_edition: 'aspirant',
  content_format: 'aspirant',
  gear: [{ name: 'Revolver', description: '' }],
  abilities: [{ name: 'Trickshot', description: '' }],
  created_at: '2024-01-01T00:00:00Z',
};
// An Advent class and its Aspirant version that print the same Signature and
// Ability under different case.
const LN_ADVENT = {
  id: 'class-ln-advent',
  name: 'Duelist',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v2',
  content_format: 'advent',
  gear: [{ name: 'Rapier', description: '' }, { name: 'Cloak', description: '' }],
  abilities: [{ name: 'Riposte', description: '' }, { name: 'Feint', description: '' }],
  advanced_abilities: [],
  created_at: '2023-01-01T00:00:00Z',
};
const LN_FORK = {
  ...LN_ADVENT,
  id: 'class-ln-fork',
  base_class_id: LN_ADVENT.id,
  rules_edition: 'aspirant',
  content_format: 'aspirant',
  gear: [{ name: 'RAPIER', description: '' }],
  abilities: [{ name: 'RIPOSTE', description: '' }],
  created_at: '2024-01-01T00:00:00Z',
};
const LN_FAMILY_ROWS = [
  { id: LN_ADVENT.id, base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
  { id: LN_FORK.id, base_class_id: LN_ADVENT.id, rules_edition: 'aspirant', content_format: 'aspirant' },
];
const CLASS_BY_ID = {
  [LN_FORK.id]: LN_FORK,
  [LN_ADVENT.id]: LN_ADVENT,
  [GS_FORK.id]: GS_FORK,
  [TRAILBLAZER_V1.id]: TRAILBLAZER_V1,
  [V2_RULES_CLASS.id]: V2_RULES_CLASS,
  [ADVENT_V1_CLASS.id]: ADVENT_V1_CLASS
};

mock.module('../models/class', () => ({
  getClass: async (id) => ({ data: CLASS_BY_ID[id] || { id: 'class-a', rules_edition: 'advent', rules_version: 'v1', content_format: 'advent' }, error: null }),
  getUnlockedClassIdsForUser: async () => ({ data: pageState.unlockedClassIds || new Set(), error: null }),
  // filterClassDataForUser fans out to advent, aspirant and player-created
  // pools; the aspirant pool carries ABILITY_CLASS and whatever a test adds
  // via pageState.extraAspirantClasses, the advent pool only what a test adds
  // via pageState.extraAdventClasses.
  getClasses: async (filters) => {
    const official = filters && !filters.is_player_created;
    if (official && filters.rules_edition === 'aspirant') {
      return { data: [ABILITY_CLASS, ...(pageState.extraAspirantClasses || [])], error: null };
    }
    if (official && filters.rules_edition === 'advent') {
      return { data: pageState.extraAdventClasses || [], error: null };
    }
    return { data: [], error: null };
  },
}));

const express = require('express');
const exphbs = require('express-handlebars');
const hbsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const range = require('handlebars-helper-range');
const path = require('path');
const { renderMarkdown, renderPowerRatings } = require('../util/markdown');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./characters')];

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Full Handlebars engine — same helpers as app.js's engineHelpers (spread
  // wholesale, the same reason app.js gives: a helper added to
  // util/handlebars.js must not go silently unregistered here either). The
  // edit-form template (character-form.handlebars) reaches helpers the
  // character-perk-group partial never needed -- customTrait among them --
  // so a hand-picked subset drifts out of date the moment the form grows.
  app.engine('handlebars', exphbs.engine({
    layoutsDir: path.join(__dirname, '..', 'views', 'layouts'),
    partialsDir: path.join(__dirname, '..', 'views', 'partials'),
    defaultLayout: 'main',
    helpers: {
      ...hbsHelpers,
      ...customHelpers,
      range,
      markdown: renderMarkdown,
      powerRatings: renderPowerRatings,
    },
  }));
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, '..', 'views'));

  // The full character page builds its Open Graph card via res.locals.openGraph
  // (util/open-graph.js), which app.js normally installs app-wide.
  app.use(require('../util/open-graph').openGraphDefaults);

  // Minimal res.locals the route middleware and sendError expect.
  app.use((req, res, next) => {
    res.locals.supabaseUrl = process.env.SUPABASE_URL;
    res.locals.supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    next();
  });

  app.use('/characters', require('./characters'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../services/access/service', () => realBookAccess);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/character', () => realCharacter);
  mock.module('../models/class', () => realClass);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/offscreen-mission', () => realOffscreen);
  delete require.cache[require.resolve('./characters')];
});

beforeEach(() => {
  pageState.character = null;
  pageState.unlockedClassIds = null;
  pageState.extraAspirantClasses = null;
  pageState.extraAdventClasses = null;
  pageState.classFamilyRows = null;
  pageState.lastUpdateBody = null;
  pageState.updateResult = null;
  pageState.createResult = null;
  pageState.conversionPlan = null;
  pageState.upgradeTargets = null;
  pageState.conversionResult = null;
  pageState.lastConvert = null;
  pageState.lastPlanArgs = null;
  pageState.planThrows = false;
});

test('GET /characters/ability-perk-group renders scaffold with ability name and dom key', async () => {
  const res = await fetch(
    `${baseUrl}/characters/ability-perk-group?ability=Quick%20Strike&key=g0`,
    { headers: { Accept: 'text/html' } }
  );

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('data-ability-id="Quick Strike"');
  expect(body).toContain('id="perks-list-g0"');
  expect(body).toContain('Quick Strike</h4>');
});

test('GET /characters/ability-perk-group without ability param returns 400', async () => {
  const res = await fetch(
    `${baseUrl}/characters/ability-perk-group?key=g0`,
    { headers: { Accept: 'application/json' } }
  );

  expect(res.status).toBe(400);
});

test('GET /characters/ability-perk-group without key param falls back domKey to ability name', async () => {
  const res = await fetch(
    `${baseUrl}/characters/ability-perk-group?ability=Strike`,
    { headers: { Accept: 'text/html' } }
  );

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('id="perks-list-Strike"');
  expect(body).toContain('data-ability-id="Strike"');
});

// GET /characters/:id/:name? — the Perk breakdown and build-breach notices
// (Task 11). An advent character's Ability cap is 3 (util/perk-economy.js);
// four Abilities is over it, so buildBreaches carries a 'hard' breach and
// the page must read "Illegal Build". A clean, three-ability character has
// no breach and must not.
test('character page renders Illegal Build for an advent character over the Ability cap', async () => {
  pageState.character = makePageCharacter(4);
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/Ash`, {
    headers: { Accept: 'text/html' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('Illegal Build');
});

test('character page does not render Illegal Build for a clean character', async () => {
  pageState.character = makePageCharacter(3);
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/Ash`, {
    headers: { Accept: 'text/html' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).not.toContain('Illegal Build');
});

// POST /characters (classic/expert create) — closing the bypass (Task 12).
// The wizard's create path runs validateAspiringBuild via
// normalizeWizardPayload; this route called createCharacter directly, so a
// hand-crafted aspiring payload posted here skipped it. A payload with a
// valid three-Signature pool but only one Ability pick clears the Signature
// check and must be refused by the Ability-pick rule specifically.
test('POST /characters refuses an aspiring build missing its three Ability picks', async () => {
  const res = await fetch(`${baseUrl}/characters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify({
      creator_mode: 'aspiring',
      name: 'Ash',
      pseudo_class: { name: 'Homebrew' },
      aspiring_signatures: [
        { class_id: 'class-a', name: 'Sig A' },
        { class_id: 'class-b', name: 'Sig B' },
        { class_id: 'class-c', name: 'Sig C' },
      ],
      aspiring_abilities: [
        { class_id: 'class-a', name: 'Ability A', type: 'core' },
      ],
    }),
  });

  expect(res.status).toBe(400);
  const body = await res.text();
  expect(body).toContain('An Aspiring character needs exactly three Ability picks.');
});

// GET /characters/class-abilities -- the htmx "Add Class Abilities" endpoint
// (Task 3). A V1 class carries three Core Abilities and three Advanced ones,
// and both must be offerable from the classic picker: it is the one form
// that can otherwise add any ability in the game.
test('the classic ability picker offers a class Advanced Abilities', async () => {
  const res = await fetch(`${baseUrl}/characters/class-abilities`, {
    headers: { Accept: 'text/html' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('Quickdraw');
  expect(body).toContain('Trick Shot');
});

// The option value posts as a single string, so the type has to travel with
// it -- without it an Advanced pick is stored as core and priced at the
// wrong rate by the Perk engine (services/character/service.js's
// submittedAbilityType falls back to 'core'). The value attribute alone is
// invisible to the player, though, so the label text must carry the same
// distinction (views/class-view.handlebars:320 gives Advanced Abilities
// their own heading; this picker marks each option instead, since options
// can't be headed).
test('an Advanced option carries its type, so it is not stored as core', async () => {
  const res = await fetch(`${baseUrl}/characters/class-abilities`, {
    headers: { Accept: 'text/html' },
  });

  const body = await res.text();
  expect(body).toContain('value="class-adv::Trick Shot::advanced"');
  expect(body).toContain('value="class-adv::Quickdraw::core"');
  // Visible label text, not just the value attribute: a player choosing an
  // option must be able to see it costs Perks before selecting it.
  expect(body).toContain('Trick Shot (Gunslinger — Advanced)');
  expect(body).toContain('Quickdraw (Gunslinger)');
  expect(body).not.toContain('Quickdraw (Gunslinger — Advanced)');
});

// Two versions of one class share a name and item names, so a name prefix
// cannot tell the server which class a pick came from; the option value must
// carry the class id (services/character/service.js's classItemResolver
// trusts an id prefix only when that class carries the item).
const PATHFINDER_V1 = {
  id: 'class-pf-v1',
  name: 'Pathfinder',
  is_public: true,
  is_player_created: false,
  rules_edition: 'aspirant',
  rules_version: 'v1',
  content_format: 'aspirant',
  gear: [{ name: 'Compass', description: '' }],
  abilities: [{ name: 'Trailsense', description: '' }],
  advanced_abilities: [],
};
const PATHFINDER_V2 = { ...PATHFINDER_V1, id: 'class-pf-v2', base_class_id: 'class-pf-v1', rules_version: 'v2' };

test('the classic gear picker prefixes each option with its class id, not the shared class name', async () => {
  pageState.extraAspirantClasses = [PATHFINDER_V1, PATHFINDER_V2];

  const res = await fetch(`${baseUrl}/characters/class-gear`, {
    headers: { Accept: 'text/html' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('value="class-pf-v1::Compass"');
  expect(body).toContain('value="class-pf-v2::Compass"');
  expect(body).not.toContain('value="Pathfinder::Compass"');
  expect(body).toContain('Compass (Pathfinder — ');
});

test('the classic ability picker prefixes each option with its class id, not the shared class name', async () => {
  pageState.extraAspirantClasses = [PATHFINDER_V1, PATHFINDER_V2];

  const res = await fetch(`${baseUrl}/characters/class-abilities`, {
    headers: { Accept: 'text/html' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('value="class-pf-v1::Trailsense::core"');
  expect(body).toContain('value="class-pf-v2::Trailsense::core"');
  expect(body).not.toContain('value="Pathfinder::Trailsense::core"');
  expect(body).toContain('Trailsense (Pathfinder)');
});

// The classic pickers list each lineage's item once when the form's class puts
// the character on the Aspirant economy.
test('the classic pickers of an Aspirant form list each lineage\'s item once', async () => {
  pageState.extraAdventClasses = [LN_ADVENT];
  pageState.extraAspirantClasses = [LN_FORK];

  const gearRes = await fetch(`${baseUrl}/characters/class-gear?class_id=${LN_FORK.id}`, {
    headers: { Accept: 'text/html' },
  });
  expect(gearRes.status).toBe(200);
  const gear = await gearRes.text();
  expect(gear).toContain(`value="${LN_FORK.id}::RAPIER"`);
  expect(gear).not.toContain(`value="${LN_ADVENT.id}::Rapier"`);
  expect(gear).toContain(`value="${LN_ADVENT.id}::Cloak"`);

  const abilityRes = await fetch(`${baseUrl}/characters/class-abilities?class_id=${LN_FORK.id}`, {
    headers: { Accept: 'text/html' },
  });
  const abilities = await abilityRes.text();
  expect(abilities).toContain(`value="${LN_FORK.id}::RIPOSTE::core"`);
  expect(abilities).not.toContain(`value="${LN_ADVENT.id}::Riposte::core"`);
  expect(abilities).toContain(`value="${LN_ADVENT.id}::Feint::core"`);
});

test('the classic pickers of an Advent form list every class\'s items', async () => {
  pageState.extraAdventClasses = [LN_ADVENT];
  pageState.extraAspirantClasses = [LN_FORK];

  const res = await fetch(`${baseUrl}/characters/class-gear?class_id=${LN_ADVENT.id}&creator_mode=advent`, {
    headers: { Accept: 'text/html' },
  });
  const body = await res.text();
  expect(body).toContain(`value="${LN_FORK.id}::RAPIER"`);
  expect(body).toContain(`value="${LN_ADVENT.id}::Rapier"`);
});

test('the Add buttons send the form\'s class and the stored mode', async () => {
  pageState.character = {
    ...makePageCharacter(0),
    creator_id: 'profile-1',
    class_id: ADVENT_V1_CLASS.id,
    creator_mode: 'advent',
  };

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/hx-get="\/characters\/class-gear"[^>]*hx-include="#char-class-id"[^>]*hx-vals='\{"creator_mode": "advent"\}'/);
  expect(body).toMatch(/hx-get="\/characters\/class-abilities"[^>]*hx-include="#char-class-id"[^>]*hx-vals='\{"creator_mode": "advent"\}'/);
});

// Both versions render an option for the same item name, so a stored pick
// must select only the option of the class it was taken from.
test('the classic edit pickers select only the option of the stored item\'s class', async () => {
  pageState.character = {
    ...makePageCharacter(0),
    creator_id: 'profile-1',
    gear: [{ name: 'Compass', class_id: PATHFINDER_V2.id }],
    abilities: [{ name: 'Trailsense', class_id: PATHFINDER_V2.id, type: 'core' }],
  };
  pageState.unlockedClassIds = new Set([PATHFINDER_V1.id, PATHFINDER_V2.id]);
  pageState.extraAspirantClasses = [PATHFINDER_V1, PATHFINDER_V2];

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toMatch(/value="class-pf-v2::Compass"\s+selected/);
  expect(body).not.toMatch(/value="class-pf-v1::Compass"\s+selected/);
  expect(body).toMatch(/value="class-pf-v2::Trailsense::core"\s+selected/);
  expect(body).not.toMatch(/value="class-pf-v1::Trailsense::core"\s+selected/);
});

// An Advent class and its aspirant-format fork share a name, but
// util/class-family.js keeps a format fork in its own version family, so
// latestClassVersions alone leaves both cards in the aspiring wizard. The
// fork represents the class there; an Advent class nobody forked stays.
const BERSERKER_ADVENT = {
  id: 'class-berserker-advent',
  name: 'Berserker',
  is_public: true,
  is_player_created: false,
  rules_edition: 'advent',
  rules_version: 'v1',
  content_format: 'advent',
  gear: [],
  abilities: [],
  advanced_abilities: [],
  created_at: '2023-01-01T00:00:00Z',
};
const BERSERKER_ASPIRANT = {
  ...BERSERKER_ADVENT,
  id: 'class-berserker-aspirant',
  base_class_id: BERSERKER_ADVENT.id,
  content_format: 'aspirant',
  created_at: '2024-01-01T00:00:00Z',
};
const WARDEN_ADVENT = {
  ...BERSERKER_ADVENT,
  id: 'class-warden-advent',
  name: 'Warden',
};

test('the aspiring wizard lists an aspirant-format fork in place of the Advent class it forks', async () => {
  pageState.extraAdventClasses = [BERSERKER_ADVENT, BERSERKER_ASPIRANT, WARDEN_ADVENT];
  pageState.unlockedClassIds = new Set([BERSERKER_ADVENT.id, BERSERKER_ASPIRANT.id, WARDEN_ADVENT.id]);

  const res = await fetch(`${baseUrl}/characters/wizard?mode=aspiring`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const island = JSON.parse(body.match(/id="wizard-data">([\s\S]*?)<\/script>/)[1]);
  const ids = island.classes.map((c) => c.id);
  expect(ids).toContain(BERSERKER_ASPIRANT.id);
  expect(ids).not.toContain(BERSERKER_ADVENT.id);
  expect(ids).toContain(WARDEN_ADVENT.id);
});

// GET /characters/:id/edit — the ability island (Task 4 fix round 2).
// routes/characters.js resolves classFamilyOf once and feeds it to both
// deriveCharacterTotals and buildAbilityPurchaseData; this guards that
// wiring at the tier a future edit that drops the argument, feeds only one
// of the two call sites, or resolves it twice would actually break -- the
// module-level test in util/ability-purchase-data.test.js exercises the same
// pricing rule directly, but passes with or without the route doing its part
// and so does not guard the wiring itself.
//
// allClasses has already been collapsed to TRAILBLAZER_V2 by
// latestClassVersions (TRAILBLAZER_V1, the character's own class, is the
// older half of the same family and drops out of the catalogue walk).
// Without a resolved classFamilyOf, TRAILBLAZER_V2's Long Stride prices as
// cross-class purely because its class_id differs from the character's own.
test('the ability island prices a newer-version own-class ability at the own rate', async () => {
  pageState.character = {
    id: CHAR_ID,
    name: 'Rue',
    class: 'Trailblazer',
    class_id: TRAILBLAZER_V1.id,
    creator_id: 'profile-1',
    creator_mode: null,
    is_public: true,
    level: 3,
    completed_missions: 0,
    ...Object.fromEntries(statList.map(stat => [stat, 2])),
    traits: [],
    abilities: [],
    gear: [],
    ability_perks: [],
    quirks: [],
    accessories: [],
    common_items: [],
    perks: '',
    additional_gear: '',
  };
  pageState.unlockedClassIds = new Set([TRAILBLAZER_V2.id]);
  pageState.extraAspirantClasses = [TRAILBLAZER_V2];
  pageState.classFamilyRows = [
    { id: TRAILBLAZER_V1.id, base_class_id: null, rules_edition: 'aspirant', content_format: 'aspirant' },
    { id: TRAILBLAZER_V2.id, base_class_id: TRAILBLAZER_V1.id, rules_edition: 'aspirant', content_format: 'aspirant' },
  ];

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const match = body.match(/<script type="application\/json" id="ability-purchase-data">([^<]*)<\/script>/);
  expect(match).not.toBeNull();
  const island = JSON.parse(match[1]);
  const entry = island.entries.find((e) => e.name === 'Long Stride');
  expect(entry).toBeTruthy();
  expect(entry.crossClass).toBe(false);
  expect(entry.price).toBe(1);
});

test('the edit page prices a fork character\'s Advent-origin items at the own rate', async () => {
  pageState.character = {
    id: CHAR_ID,
    name: 'Cora',
    class: 'Gunslinger',
    class_id: GS_FORK.id,
    creator_id: 'profile-1',
    creator_mode: 'aspirant',
    is_public: true,
    level: 3,
    completed_missions: 0,
    ...Object.fromEntries(statList.map(stat => [stat, 2])),
    traits: [],
    abilities: [{ id: 'ab-q', name: 'Quickdraw', class_id: GS_ADVENT.id, type: 'core' }],
    gear: [{ name: 'Duster', class_id: GS_ADVENT.id, enchantment: null, mods: [] }],
    ability_perks: [],
    quirks: [],
    accessories: [],
    common_items: [],
    perks: '',
    additional_gear: '',
  };
  pageState.unlockedClassIds = new Set([GS_ADVENT.id, GS_FORK.id]);
  pageState.extraAdventClasses = [GS_ADVENT];
  pageState.extraAspirantClasses = [GS_FORK];
  pageState.classFamilyRows = [
    { id: GS_ADVENT.id, base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
    { id: GS_FORK.id, base_class_id: GS_ADVENT.id, rules_edition: 'aspirant', content_format: 'aspirant' },
  ];

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const island = (id) => JSON.parse(body.match(new RegExp(`id="${id}">([^<]*)</script>`))[1]);
  const quickdraw = island('ability-purchase-data').entries
    .find((e) => e.name === 'Quickdraw' && e.class_id === GS_ADVENT.id);
  expect(quickdraw.crossClass).toBe(false);
  const gear = island('gear-purchase-data');
  expect(gear.ownClassIds.sort()).toEqual([GS_ADVENT.id, GS_FORK.id].sort());
  const entriesNamed = (name) => gear.entries.filter((e) => e.name === name);
  expect(entriesNamed('Sling')).toHaveLength(1);
  expect(entriesNamed('Sling')[0].class_id).toBe(GS_ADVENT.id);
  expect(entriesNamed('Duster')).toHaveLength(1);
  expect(entriesNamed('Revolver')).toHaveLength(1);
});

test('the edit page offers an Aspirant character each lineage\'s item once, from its Aspirant version', async () => {
  pageState.character = {
    id: CHAR_ID,
    name: 'Dara',
    class: 'Duelist',
    class_id: LN_FORK.id,
    creator_id: 'profile-1',
    creator_mode: 'aspirant',
    is_public: true,
    level: 3,
    completed_missions: 0,
    ...Object.fromEntries(statList.map(stat => [stat, 2])),
    traits: [],
    abilities: [],
    gear: [],
    ability_perks: [],
    quirks: [],
    accessories: [],
    common_items: [],
    perks: '',
    additional_gear: '',
  };
  pageState.unlockedClassIds = new Set([LN_ADVENT.id, LN_FORK.id]);
  pageState.extraAdventClasses = [LN_ADVENT];
  pageState.extraAspirantClasses = [LN_FORK];
  pageState.classFamilyRows = LN_FAMILY_ROWS;

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const island = (id) => JSON.parse(body.match(new RegExp(`id="${id}">([^<]*)</script>`))[1]);
  const named = (entries, name) => entries.filter((e) => e.name.trim().toLowerCase() === name);
  const gear = island('gear-purchase-data').entries;
  expect(named(gear, 'rapier').map((e) => e.class_id)).toEqual([LN_FORK.id]);
  expect(named(gear, 'cloak').map((e) => e.class_id)).toEqual([LN_ADVENT.id]);
  const abilities = island('ability-purchase-data').entries;
  expect(named(abilities, 'riposte').map((e) => e.class_id)).toEqual([LN_FORK.id]);
  expect(named(abilities, 'feint').map((e) => [e.class_id, e.crossClass])).toEqual([[LN_ADVENT.id, false]]);
});

test('the edit page lists an owned Advent copy as owned although the Aspirant version is the catalogue entry', async () => {
  pageState.character = {
    id: CHAR_ID,
    name: 'Dara',
    class: 'Duelist',
    class_id: LN_FORK.id,
    creator_id: 'profile-1',
    creator_mode: 'aspirant',
    is_public: true,
    level: 3,
    completed_missions: 0,
    ...Object.fromEntries(statList.map(stat => [stat, 2])),
    traits: [],
    abilities: [{ id: 'ab-r', name: 'Riposte', class_id: LN_ADVENT.id, type: 'core' }],
    gear: [{ name: 'Rapier', class_id: LN_ADVENT.id, enchantment: null, mods: [] }],
    ability_perks: [],
    quirks: [],
    accessories: [],
    common_items: [],
    perks: '',
    additional_gear: '',
  };
  pageState.unlockedClassIds = new Set([LN_ADVENT.id, LN_FORK.id]);
  pageState.extraAdventClasses = [LN_ADVENT];
  pageState.extraAspirantClasses = [LN_FORK];
  pageState.classFamilyRows = LN_FAMILY_ROWS;

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  const island = (id) => JSON.parse(body.match(new RegExp(`id="${id}">([^<]*)</script>`))[1]);
  const gear = island('gear-purchase-data');
  expect(gear.purchases.map((p) => [p.name, p.class_id])).toEqual([['Rapier', LN_ADVENT.id]]);
  expect(gear.entries.some((e) => e.name === 'Rapier' && e.class_id === LN_ADVENT.id)).toBe(true);
  const abilities = island('ability-purchase-data');
  expect(abilities.owned.map((a) => [a.name, a.class_id])).toEqual([['Riposte', LN_ADVENT.id]]);
  expect(abilities.entries.some((e) => e.name === 'Riposte' && e.class_id === LN_ADVENT.id)).toBe(true);
});

// PUT /:id turns a submitted abilities_json into body.abilities via
// util/ability-purchase-data.js's applyAbilityPurchases, mirroring
// applyGearPurchases for gear_json.
test('PUT /characters/:id turns a submitted abilities_json into body.abilities', async () => {
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Bearer test-token',
    },
    body: new URLSearchParams({
      name: 'Ash',
      abilities_json: JSON.stringify([{ name: 'Trick Shot', class_id: 'class-adv', type: 'advanced' }]),
    }).toString(),
  });

  expect(res.status).toBe(200);
  expect(pageState.lastUpdateBody.abilities).toEqual([
    { name: 'Trick Shot', class_id: 'class-adv', type: 'advanced' },
  ]);
  expect('abilities_json' in pageState.lastUpdateBody).toBe(false);
});

test('PUT /characters/:id with malformed abilities_json is rejected before it reaches updateCharacter', async () => {
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Bearer test-token',
    },
    body: new URLSearchParams({ name: 'Ash', abilities_json: '{oops' }).toString(),
  });

  expect(res.status).toBe(400);
  expect(pageState.lastUpdateBody).toBeNull();
});

// The Ability-Perk limits are util/perk-economy.js's PERK_WORD_LIMIT and
// PERKS_PER_ABILITY. Every route that renders a Perk editor serves them, so
// the views that name them hold no figure of their own.
test('GET /characters/ability-perk serves the Perk word limit to the row it renders', async () => {
  const { perkFigures } = require('../util/perk-economy');
  const figures = perkFigures();
  const res = await fetch(
    `${baseUrl}/characters/ability-perk?ability_id=ability-1&position=0`,
    { headers: { Accept: 'text/html' } }
  );

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('placeholder="Perk text (\u2264' + figures.perkWordLimit + ' words)"');
  expect(body).toContain('/ ' + figures.perkWordLimit + ' words');
});

test('GET /characters/version-fields serves both Ability-Perk limits to the v2 block', async () => {
  const { perkFigures } = require('../util/perk-economy');
  const figures = perkFigures();
  const res = await fetch(
    `${baseUrl}/characters/version-fields?class_id=${V2_RULES_CLASS.id}`,
    { headers: { Accept: 'text/html' } }
  );

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain(
    'Each perk is at most ' + figures.perkWordLimit
    + ' words; max ' + figures.perksPerAbility + ' per ability.'
  );
});

// GET /characters/:id/edit resolves effectiveVersion from the character's
// stored class; a v2 class must reach the form's Deprecated fields section.
test('the edit form shows a v2 character its stored v1-only text as Deprecated fields', async () => {
  pageState.character = {
    ...makePageCharacter(0),
    class: V2_RULES_CLASS.name,
    class_id: V2_RULES_CLASS.id,
    creator_id: 'profile-1',
    perks: 'Old perk prose',
    additional_gear: 'Old gear prose',
  };

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('Deprecated fields');
  expect(body).toContain('Old perk prose');
  expect(body).toContain('name="clear_perks"');
  expect(body).toContain('name="clear_additional_gear"');
  expect(body).not.toMatch(/<textarea[^>]*name="perks"/);
  expect(body).not.toMatch(/<textarea[^>]*name="additional_gear"/);
});

// A v2 character carries at most one Defining Quirk, posted as the scalar
// fields quirk_name / quirk_downside / quirk_upside.
const countMatches = (html, re) => (html.match(re) || []).length;

test('GET /characters/version-fields renders a single blank Defining Quirk block', async () => {
  const res = await fetch(
    `${baseUrl}/characters/version-fields?class_id=${V2_RULES_CLASS.id}`,
    { headers: { Accept: 'text/html' } }
  );

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(countMatches(body, /Defining Quirk<\/label>/g)).toBe(1);
  expect(countMatches(body, /name="quirk_name"/g)).toBe(1);
  expect(countMatches(body, /name="quirk_downside"/g)).toBe(1);
  expect(countMatches(body, /name="quirk_upside"/g)).toBe(1);
  expect(body).not.toContain('name="quirk_name[]"');
  expect(body).not.toContain('Add Quirk');
  expect(body).not.toContain('hx-get="/characters/quirk"');
});

test('the edit form prefills the Defining Quirk from the stored quirk', async () => {
  pageState.character = {
    ...makePageCharacter(0),
    class: V2_RULES_CLASS.name,
    class_id: V2_RULES_CLASS.id,
    creator_id: 'profile-1',
    quirks: [{ name: 'Monochromia', downside: 'Sees only red', upside: 'Spots blood instantly' }],
  };

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });

  expect(res.status).toBe(200);
  const body = await res.text();
  expect(countMatches(body, /Defining Quirk<\/label>/g)).toBe(1);
  expect(body).toMatch(/name="quirk_name"[^>]*value="Monochromia"/);
  expect(body).toMatch(/name="quirk_downside"[^>]*value="Sees only red"/);
  expect(body).toMatch(/name="quirk_upside"[^>]*value="Spots blood instantly"/);
  expect(body).not.toContain('Add Quirk');
});

test('GET /characters/quirk no longer serves a quirk row', async () => {
  const res = await fetch(`${baseUrl}/characters/quirk`, { headers: { Accept: 'text/html' } });

  expect(res.status).not.toBe(200);
  expect(await res.text()).not.toContain('quirk_name');
});

// --- Convert to Aspirant ------------------------------------------------------

const NO_UPGRADE = { target: null, gear: null, abilities: null, abilityPerks: null, moved: [], kept: [] };
const conversionPlan = (blockers = [], upgrade = NO_UPGRADE) => ({
  upgrade,
  blockers,
  breaches: [{ severity: 'hard', rule: 'perk-deficit', detail: '6 Perks spent of 4 earned.' }],
  perkBreakdown: { earned: 4, spend: 6, remaining: 0, deficit: 2 },
  merxBreakdown: { earned: 12, spend: 20, reward: 0, deficit: 8 }
});

const editPage = async () => {
  pageState.character = { ...makePageCharacter(3), creator_id: 'profile-1' };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  expect(res.status).toBe(200);
  return res.text();
};

test('the edit form offers conversion: same class and build, Aspirant totals, a live Convert button', async () => {
  pageState.conversionPlan = conversionPlan();
  const body = await editPage();
  expect(pageState.lastPlanArgs).toEqual({ actor: expect.objectContaining({ profileId: 'profile-1' }), id: CHAR_ID });
  expect(body).toContain('id="aspirant-conversion"');
  expect(body).toContain('Ash can switch to the Aspirant rules. It keeps its class and its whole build.</p>');
  expect(body).not.toContain('Moves to its Aspirant version:');
  expect(body).not.toContain('Stays as it is:');
  expect(body).toContain('<strong>Perks spent:</strong> 6');
  expect(body).toContain('<strong>Deficit:</strong> 8');
  expect(body).toContain('<strong>Illegal Build:</strong> 6 Perks spent of 4 earned.');
  expect(body).toContain(`hx-post="/characters/${CHAR_ID}/convert-aspirant"`);
  expect(body).toContain('hx-confirm="Convert Ash to Aspirant? This cannot be undone."');
});

test('the edit form names the Aspirant version and lists what moves and what stays', async () => {
  pageState.conversionPlan = conversionPlan([], {
    ...NO_UPGRADE,
    target: { id: 'class-gs-fork', name: 'Gunslinger' },
    moved: [{ kind: 'Signature', name: 'Revolver', className: 'Gunslinger' }],
    kept: [{ kind: 'Ability', name: 'Old Trick', className: null }, { kind: 'Signature', name: 'Duster', className: 'Gunslinger' }]
  });
  const body = await editPage();
  expect(body).toContain('Ash can switch to the Aspirant rules and move to <strong>the Aspirant version of Gunslinger</strong>.');
  expect(body).toContain('Moves to its Aspirant version:');
  expect(body).toContain('<li>Signature: Revolver (Gunslinger)</li>');
  expect(body).toContain('Stays as it is:');
  expect(body).toContain('<li>Ability: Old Trick</li>');
  expect(body).toContain('<li>Signature: Duster (Gunslinger)</li>');
  expect(body).not.toContain('It keeps its class');
});

test('without an Aspirant version the form lists a cross-class item that moves, and nothing that stays', async () => {
  pageState.conversionPlan = conversionPlan([], {
    ...NO_UPGRADE,
    moved: [{ kind: 'Ability', name: 'Familiar Face', className: 'Wanderer' }],
    kept: [{ kind: 'Signature', name: 'Bedroll', className: 'Drifter' }]
  });
  const body = await editPage();
  expect(body).toContain('Ash can switch to the Aspirant rules. It keeps its class.</p>');
  expect(body).not.toContain('its whole build');
  expect(body).toContain('<li>Ability: Familiar Face (Wanderer)</li>');
  expect(body).not.toContain('Stays as it is:');
});

test('the conversion footer about Illegal Build lines appears only when there is a hard breach', async () => {
  pageState.conversionPlan = conversionPlan();
  expect(await editPage()).toContain('Illegal Build lines above carry over to the sheet');

  pageState.conversionPlan = { ...conversionPlan(), breaches: [] };
  const clean = await editPage();
  expect(clean).toContain('id="aspirant-conversion"');
  expect(clean).not.toContain('Illegal Build lines above carry over');
});

const LEGACY_BLOCK_COPY = 'preserved as a read-only legacy block';

const upgradePage = async (creatorMode) => {
  pageState.upgradeTargets = [{ id: 'class-a-v2', name: 'Gunslinger', rules_edition: 'aspirant', rules_version: 'v2' }];
  pageState.character = { ...makePageCharacter(3), creator_id: 'profile-1', creator_mode: creatorMode };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  expect(res.status).toBe(200);
  return res.text();
};

test('the Upgrade block warns of the read-only legacy block for an Advent character on a v1 class', async () => {
  const body = await upgradePage(null);
  expect(body).toContain('Upgrade to Aspirant v2');
  expect(body).toContain(LEGACY_BLOCK_COPY);
});

test('the Upgrade block omits the legacy-block warning for an Aspirant character already on the v2 rules', async () => {
  const body = await upgradePage('aspirant');
  expect(body).toContain('Upgrade to Aspirant v2');
  expect(body).not.toContain(LEGACY_BLOCK_COPY);
});

test('the edit form lists blockers and disables the Convert button', async () => {
  pageState.conversionPlan = conversionPlan([
    { rule: 'traits', detail: 'Two Traits may not share a Stat (might).' }
  ]);
  const body = await editPage();
  expect(body).toContain('<li>Two Traits may not share a Stat (might).</li>');
  expect(body).toMatch(/<button type="button" class="button is-link" disabled>Convert to Aspirant<\/button>/);
  expect(body).not.toContain('/convert-aspirant"');
});

test('the edit form offers no conversion to an ineligible character', async () => {
  const body = await editPage();
  expect(body).not.toContain('aspirant-conversion');
  expect(body).not.toContain('Convert to Aspirant');
});

test('POST /characters/:id/convert-aspirant sends the player to the converted sheet', async () => {
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/convert-aspirant`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'HX-Request': 'true' },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('HX-Location')).toBe(`/characters/${CHAR_ID}/Ash`);
  expect(pageState.lastConvert).toEqual({ actor: expect.objectContaining({ profileId: 'profile-1' }), id: CHAR_ID });
});

test('POST /characters/:id/convert-aspirant renders a refusal with its reason', async () => {
  pageState.conversionResult = {
    data: null,
    error: { status: 400, message: 'Ash cannot convert to Aspirant yet. Two Traits may not share a Stat (might).' }
  };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/convert-aspirant`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'HX-Request': 'true' },
  });
  expect(res.status).toBe(400);
  expect(res.headers.get('HX-Location')).toBeNull();
  expect(await res.text()).toContain('Two Traits may not share a Stat (might).');
});

test('the edit page answers with an error, not a hang, when the conversion preview throws', async () => {
  pageState.planThrows = true;
  pageState.character = { ...makePageCharacter(3), creator_id: 'profile-1' };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
    signal: AbortSignal.timeout(3000),
  });
  expect(res.status).toBe(500);
}, 5000);

// An Aspirant character is on the v2 character rules whatever its class's
// rules_version (util/character-rules.js).
const aspirantOnAdventV1 = (extra = {}) => ({
  ...makePageCharacter(0),
  class: ADVENT_V1_CLASS.name,
  class_id: ADVENT_V1_CLASS.id,
  creator_mode: 'aspirant',
  quirks: [{ name: 'Monochromia', downside: 'Sees only red', upside: 'Spots blood instantly' }],
  ...extra,
});

test('the edit form gives an Aspirant character on a v1 class the v2 fields', async () => {
  pageState.character = aspirantOnAdventV1({ creator_id: 'profile-1' });
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(countMatches(body, /Defining Quirk<\/label>/g)).toBe(1);
  expect(body).toMatch(/name="quirk_name"[^>]*value="Monochromia"/);
});

test('the edit form\'s Class select tells /version-fields the character\'s mode', async () => {
  pageState.character = aspirantOnAdventV1({ creator_id: 'profile-1' });
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/edit`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  const body = await res.text();
  expect(body).toContain('hx-vals=\'{"creator_mode": "aspirant"}\'');
});

test('GET /characters/version-fields serves the v2 block to an Aspirant character on a v1 class', async () => {
  const aspirant = await fetch(
    `${baseUrl}/characters/version-fields?class_id=${ADVENT_V1_CLASS.id}&creator_mode=aspirant`,
    { headers: { Accept: 'text/html' } }
  );
  expect(countMatches(await aspirant.text(), /Defining Quirk<\/label>/g)).toBe(1);

  const advent = await fetch(
    `${baseUrl}/characters/version-fields?class_id=${ADVENT_V1_CLASS.id}`,
    { headers: { Accept: 'text/html' } }
  );
  expect(await advent.text()).toBe('<div id="v2-fields-container"></div>');
});

test('the auto-calc fields count an Aspirant character\'s missions on the v2 curve', async () => {
  pageState.character = aspirantOnAdventV1({ creator_id: 'profile-1' });
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/auto-calc-fields`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('more completed missions');
});

test('the auto-calc fields price a fork character\'s Advent-origin Signature at the own rate', async () => {
  const { CREATION_GRANT, priceOfSignature } = require('../util/merx-economy');
  pageState.character = {
    ...makePageCharacter(0),
    creator_id: 'profile-1',
    class: 'Gunslinger',
    class_id: GS_FORK.id,
    creator_mode: 'aspirant',
    completed_missions: 0,
    gear: [{ name: 'Duster', class_id: GS_ADVENT.id, enchantment: null, mods: [] }],
    common_items: [],
  };
  pageState.classFamilyRows = [
    { id: GS_ADVENT.id, base_class_id: null, rules_edition: 'advent', content_format: 'advent' },
    { id: GS_FORK.id, base_class_id: GS_ADVENT.id, rules_edition: 'aspirant', content_format: 'aspirant' },
  ];
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/auto-calc-fields?on=1`, {
    headers: { Accept: 'text/html', Authorization: 'Bearer test-token' },
  });
  expect(res.status).toBe(200);
  const ownRate = CREATION_GRANT.aspirant - priceOfSignature({ crossClass: false });
  expect(await res.text()).toMatch(new RegExp(`name="commissary_reward"[^>]*value="${ownRate}"`));
});

test('the sheet shows an Aspirant character on a v1 class its v2 fields and curve', async () => {
  pageState.character = aspirantOnAdventV1();
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/Ash`, { headers: { Accept: 'text/html' } });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('<h3 class="title is-4">Defining Quirk</h3>');
  expect(body).toContain('more completed missions');
});

test('a business error the update service returns reaches the player as its own status and message', async () => {
  pageState.updateResult = { data: null, error: { status: 400, message: 'Raven already has Veneer.' } };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Bearer test-token',
    },
    body: new URLSearchParams({ name: 'Raven' }).toString(),
  });

  expect(res.status).toBe(400);
  expect(await res.text()).toContain('Raven already has Veneer.');
});

test('a business error the create service returns reaches the player as its own status and message', async () => {
  pageState.createResult = { data: null, error: { status: 400, message: 'Raven already has Veneer.' } };
  const res = await fetch(`${baseUrl}/characters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify({ name: 'Raven' }),
  });

  expect(res.status).toBe(400);
  expect(await res.text()).toContain('Raven already has Veneer.');
});

test('locked creation options and the conversion offer remain visible with purchase links', async () => {
  aspirantBookState = 'none';
  try {
    const selector = await fetch(`${baseUrl}/characters/new`, { headers: { Accept: 'text/html', Authorization: 'Bearer test-token' } });
    const selectorHtml = await selector.text();
    expect(selectorHtml).toContain('/characters/wizard?mode=aspiring&fresh=1');
    expect(selectorHtml).toContain('/characters/wizard?mode=aspirant&fresh=1');
    expect(selectorHtml).toContain('Buy Aspirant');
    const editHtml = await editPage();
    expect(editHtml).toContain('convert an Advent character');
    expect(editHtml).toContain('Buy Aspirant');
    expect(editHtml).not.toContain(`hx-post="/characters/${CHAR_ID}/convert-aspirant"`);
    for (const mode of ['aspiring', 'aspirant']) {
      const locked = await fetch(`${baseUrl}/characters/wizard?mode=${mode}`, { headers: { Accept: 'text/html', Authorization: 'Bearer test-token' } });
      expect(locked.status).toBe(403);
      const html = await locked.text();
      expect(html).toContain('Buy Aspirant');
      expect(html).toContain('/classes/redeem/bulk');
      expect(html).not.toContain('id="wizard-data"');
    }
  } finally {
    aspirantBookState = 'owned';
  }
});

test('a book-locked conversion returns a purchase prompt in the htmx alerts area', async () => {
  pageState.conversionResult = { data: null, error: realBookAccess.ASPIRANT_ACCESS_ERROR };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/convert-aspirant`, {
    method: 'POST', headers: { Authorization: 'Bearer test-token', 'HX-Request': 'true' },
  });
  expect(res.status).toBe(403);
  expect(res.headers.get('HX-Retarget')).toBe('#alerts');
  expect(res.headers.get('HX-Location')).toBeNull();
  const html = await res.text();
  expect(html).toContain('Buy Aspirant');
  expect(html).not.toContain('<!DOCTYPE');
});


test('sheet promotion uses Advent v1 history thresholds instead of manual counters', async () => {
  pageState.character = { ...makePageCharacter(0), creator_id: 'profile-1', level: 4, completed_missions: 999 };
  pageState.history = Array.from({length: 11}, () => ({ outcome: 'success' }));
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}`, { headers: { Accept: 'text/html', Authorization: 'Bearer test-token' } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('data-required-missions="14"');
  expect(html).toContain('data-completed-missions="11"');
  expect(html).toContain('more completed missions');
  pageState.history = [];
});

test('corrected Aspirant v1 sheet uses v2 curve with absent creator mode', async () => {
  const saved = CLASS_BY_ID[GS_FORK.id].rules_version;
  CLASS_BY_ID[GS_FORK.id].rules_version = 'v1';
  pageState.character = { ...makePageCharacter(0), class_id: GS_FORK.id, creator_id: 'profile-1', creator_mode: null, level: 4 };
  pageState.history = Array.from({length: 7}, () => ({ outcome: 'failure' }));
  try {
    const res = await fetch(`${baseUrl}/characters/${CHAR_ID}`, { headers: { Accept: 'text/html', Authorization: 'Bearer test-token' } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-required-missions="10"');
    expect(html).toContain('data-completed-missions="7"');
  } finally { CLASS_BY_ID[GS_FORK.id].rules_version = saved; pageState.history = []; }
});

test('level ten sheet disables promotion and has no level-eleven target', async () => {
  pageState.character = { ...makePageCharacter(0), creator_id: 'profile-1', level: 10 };
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}`, { headers: { Accept: 'text/html', Authorization: 'Bearer test-token' } });
  const html = await res.text();
  expect(html).toMatch(/id="levelUpBtn"[^>]*disabled/);
  expect(html).toContain('data-next-level=""');
  expect(html).toContain('Maximum level reached.');
});
