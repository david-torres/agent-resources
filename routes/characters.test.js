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
        const data = table === 'classes' ? (pageState.classFamilyRows || []) : [];
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
  getCharacter: async () => (pageState.character
    ? { data: pageState.character, error: null }
    : { data: null, error: { code: 'PGRST116', message: 'not found' } }),
  getCharacterRecentMissions: async () => ({ data: [], error: null }),
  // The classic-POST-bypass test (Task 12) must never reach this: a rejected
  // build is refused by validateAspiringBuild before createCharacter is
  // called. A distinct error here makes a guard that silently lets the
  // request through fail loudly instead of passing for the wrong reason.
  createCharacter: async () => ({ data: null, error: 'createCharacter should not have been called' }),
  // Reached by GET /:id/edit whenever characterClass resolves (every test
  // below that authenticates does). Unused by upgradeTargets assertions here,
  // so an empty list is enough to keep the handler from throwing on a
  // destructured function it never got.
  findUpgradeTargetsFor: async () => [],
  // PUT /:id never reaches a real save layer here -- captures the body
  // applyAbilityPurchases and applyGearPurchases produced, the way pageState
  // feeds every other mock, so the abilities_json test below can assert on
  // what the route handed downstream without a real database.
  updateCharacter: async (id, body) => {
    pageState.lastUpdateBody = body;
    return { data: { id, name: body.name || 'Ash' }, error: null };
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
const CLASS_BY_ID = {
  [TRAILBLAZER_V1.id]: TRAILBLAZER_V1,
  [V2_RULES_CLASS.id]: V2_RULES_CLASS
};

mock.module('../models/class', () => ({
  getClass: async (id) => ({ data: CLASS_BY_ID[id] || { id: 'class-a', rules_version: 'v1' }, error: null }),
  getUnlockedClassIdsForUser: async () => ({ data: pageState.unlockedClassIds || new Set(), error: null }),
  // filterClassDataForUser fans out to advent, aspirant and player-created
  // pools; only the aspirant pool carries ABILITY_CLASS and whatever a test
  // adds via pageState.extraAspirantClasses.
  getClasses: async (filters) => ({
    data: filters && filters.rules_edition === 'aspirant' && !filters.is_player_created
      ? [ABILITY_CLASS, ...(pageState.extraAspirantClasses || [])]
      : [],
    error: null,
  }),
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
  pageState.classFamilyRows = null;
  pageState.lastUpdateBody = null;
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
  expect(body).toContain('value="Gunslinger::Trick Shot::advanced"');
  expect(body).toContain('value="Gunslinger::Quickdraw::core"');
  // Visible label text, not just the value attribute: a player choosing an
  // option must be able to see it costs Perks before selecting it.
  expect(body).toContain('Trick Shot (Gunslinger — Advanced)');
  expect(body).toContain('Quickdraw (Gunslinger)');
  expect(body).not.toContain('Quickdraw (Gunslinger — Advanced)');
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
