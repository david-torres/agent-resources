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

// Capture real modules so afterAll can restore them — bun's mock.module is
// process-global and would otherwise leak into other test files.
const realBase = require('../models/_base');
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

// Mutable per-test state consulted by the models/character mock below. Reset
// before every test so no test inherits the character another one installed:
// with it left standing, a test that never sets it up still gets a character
// back and can pass on the previous test's fixture.
const pageState = {};

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

// Minimal no-op PostgREST-shaped fake — the ability-perk-group handler only
// checks query params and calls res.render, so an empty store is sufficient.
const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      update() { return chain; },
      insert() { return chain; },
      single() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(onF, onR) { return Promise.resolve({ data: [], error: null }).then(onF, onR); },
    };
    return chain;
  },
});

mock.module('../models/_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  createUserClient: () => makeClient(),
  anonKey: 'test-anon-key',
}));

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
  getCharacter: async () => (pageState.character
    ? { data: pageState.character, error: null }
    : { data: null, error: { code: 'PGRST116', message: 'not found' } }),
  getCharacterRecentMissions: async () => ({ data: [], error: null }),
  // The classic-POST-bypass test (Task 12) must never reach this: a rejected
  // build is refused by validateAspiringBuild before createCharacter is
  // called. A distinct error here makes a guard that silently lets the
  // request through fail loudly instead of passing for the wrong reason.
  createCharacter: async () => ({ data: null, error: 'createCharacter should not have been called' }),
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

mock.module('../models/class', () => ({
  getClass: async () => ({ data: { id: 'class-a', rules_version: 'v1' }, error: null }),
  getUnlockedClassIdsForUser: async () => ({ data: new Set(), error: null }),
  // filterClassDataForUser fans out to advent, aspirant and player-created
  // pools; only the aspirant pool carries ABILITY_CLASS.
  getClasses: async (filters) => ({
    data: filters && filters.rules_edition === 'aspirant' && !filters.is_player_created
      ? [ABILITY_CLASS]
      : [],
    error: null,
  }),
}));

const express = require('express');
const exphbs = require('express-handlebars');
const hbsHelpers = require('handlebars-helpers')();
const range = require('handlebars-helper-range');
const path = require('path');
const {
  times, date_tz, calendar_link, getTotalV1MissionsNeeded, getTotalV2MissionsNeeded,
  setVariable, encodeURIComponentH, dump, videoEmbed, isSupportedVideoUrl,
  substring, concat, effectiveRulesVersion, wordCount, perksForAbility, nextPerkPosition, json
} = require('../util/handlebars');
const { renderMarkdown } = require('../util/markdown');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./characters')];

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Full Handlebars engine — same config as index.js so partials and helpers
  // that the character-perk-group partial relies on are available.
  app.engine('handlebars', exphbs.engine({
    layoutsDir: path.join(__dirname, '..', 'views', 'layouts'),
    partialsDir: path.join(__dirname, '..', 'views', 'partials'),
    defaultLayout: 'main',
    helpers: {
      ...hbsHelpers,
      times,
      range,
      date_tz,
      calendar_link,
      encodeURIComponentH,
      getTotalV1MissionsNeeded,
      getTotalV2MissionsNeeded,
      setVariable,
      dump,
      videoEmbed,
      isSupportedVideoUrl,
      substring,
      concat,
      effectiveRulesVersion,
      wordCount,
      perksForAbility,
      nextPerkPosition,
      json,
      markdown: renderMarkdown,
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
// submittedAbilityType falls back to 'core').
test('an Advanced option carries its type, so it is not stored as core', async () => {
  const res = await fetch(`${baseUrl}/characters/class-abilities`, {
    headers: { Accept: 'text/html' },
  });

  const body = await res.text();
  expect(body).toContain('value="Gunslinger::Trick Shot::advanced"');
  expect(body).toContain('value="Gunslinger::Quickdraw::core"');
});
