// routes/character-level-up.test.js
//
// Regression test for the level-up commissary_reward bug: POST
// /characters/:id/level-up backfills real success missions (each worth
// MERX_PER_MISSION_SUCCESS), but the route wrote level/completed_missions as
// raw columns and never updated commissary_reward. Because the character detail
// page renders the *stored* commissary_reward, the reward was understated until
// some other auto_calculate save re-derived it. The route must re-derive all of
// level/completed_missions/commissary_reward from the resulting rows.
//
// We run the REAL isAuthenticated middleware and the REAL route handler, the
// REAL models/character.js, and the REAL CharacterService (services/character/
// service.js) — the only fake at this level is services/character/repository,
// which this file replaces with a small in-memory fake standing in for
// supabaseAdmin. This keeps the level-up orchestration (backfill missions,
// credit spend, re-derivation, perk-append) under real regression coverage
// while avoiding a join-capable Postgres fake.
const { test, expect, mock, beforeAll, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them — bun's
// mock.module is process-global and would otherwise leak into other files.
const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');
const realMission = require('../models/mission');
const realClass = require('../models/class');
const realCharacterRepository = require('../services/character/repository');
const { AuthorizationError } = require('../util/errors');
const { SYSTEM_ACTOR } = require('../util/actor');

const CHAR_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 'p1';

mock.module('../models/_base', () => ({
  supabase: { from: () => { throw new Error('unexpected supabase call in level-up test'); } },
  supabaseAdmin: { from: () => { throw new Error('unexpected supabaseAdmin call in level-up test'); } },
  createUserClient: () => ({}),
  anonKey: 'test-anon-key',
}));

mock.module('../models/auth', () => ({
  // Consumed by the real isAuthenticated middleware:
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: PROFILE_ID, user_id: 'u1' }),
}));

// Mutable so a single test can force addCharacterToMission to THROW (as the
// real MissionService.addCharacter now does on a denied/not-found mission via
// requireEditable) without affecting the other tests in this file, which all
// share this one mock.module registration.
let addCharacterToMissionImpl = async () => ({ data: [{}], error: null });
mock.module('../models/mission', () => ({
  createMission: async () => ({ data: [{ id: 'mission-1' }], error: null }),
  addCharacterToMission: async (...args) => addCharacterToMissionImpl(...args),
}));
// Re-require AFTER the mock.module registration above so this file's own
// direct calls (inside the repository fake below) resolve to the fakes too.
const { createMission: fakeCreateMission, addCharacterToMission: fakeAddCharacterToMission } = require('../models/mission');

mock.module('../models/class', () => ({
  getClass: async () => ({ data: { id: 'c1', rules_version: 'v1' }, error: null }),
  getClasses: async () => ({ data: [], error: null }),
  // Not exercised by the level-up flow, but models/character.js composes it
  // into the CharacterService adapter unconditionally at module load time.
  buildClassContentLookupMaps: async () => ({
    gearNameToClassId: new Map(),
    gearNameToDescription: new Map(),
    abilityNameToClassId: new Map(),
    abilityNameToDescription: new Map()
  }),
}));

// In-memory state the repository fake below operates on directly (plain JS,
// no Postgres/PostgREST chain needed at this boundary) — reset in beforeEach.
let characterRow;
let classAbilities;
let characterPerks;
let backfilledMissions;
let perkIdSeq;

mock.module('../services/character/repository', () => ({
  getCharacter: async () => ({ data: { ...characterRow }, error: null }),
  fetchCharacterOwnership: async () => ({ data: { ...characterRow }, error: null }),
  updateOwnedFields: async ({ fields }) => {
    Object.assign(characterRow, fields);
    return { data: { ...characterRow }, error: null };
  },
  deleteCharacter: async () => ({ data: null, error: null }),
  setDeceased: async () => ({ data: [{ ...characterRow, is_deceased: true }], error: null }),
  updateClass: async () => ({ data: [{ ...characterRow }], error: null }),
  getRealMissions: async () => ({ data: [...backfilledMissions], error: null }),
  listOffscreenMissions: async () => ({ data: [], error: null }),
  getClassRulesVersion: async () => ({ data: 'v1', error: null }),
  fetchAllowedAbilityIds: async () => ({ data: classAbilities.map(a => ({ id: a.id })), error: null }),
  fetchExistingPerks: async () => ({ data: characterPerks.map(p => ({ ...p })), error: null }),
  // In-memory stand-in for the level_up_character_atomic RPC: applies the
  // owned-field update, inserts the new perk rows, then resolves each perk's
  // compound link exactly as the SQL does — a 'position-<n>' link targets a
  // same-ability perk by position; a bare UUID targets a same-ability existing
  // perk by id; anything else stays null.
  levelUpAtomic: async ({ fields, perks }) => {
    Object.assign(characterRow, fields);
    if (Array.isArray(perks)) {
      for (const row of perks) {
        characterPerks.push({
          id: `perk-${++perkIdSeq}`,
          character_id: CHAR_ID,
          class_ability_id: row.class_ability_id,
          text: row.text,
          position: row.position,
          compounds_with: null
        });
      }
      for (const row of perks) {
        if (row.compounds_with == null) continue;
        const source = characterPerks.find(p => p.class_ability_id === row.class_ability_id && p.position === row.position);
        if (!source) continue;
        const link = String(row.compounds_with);
        let target = null;
        if (link.startsWith('position-')) {
          const pos = Number(link.slice('position-'.length));
          target = characterPerks.find(p => p.class_ability_id === row.class_ability_id && p.position === pos);
        } else {
          target = characterPerks.find(p => p.id === link && p.class_ability_id === row.class_ability_id);
        }
        if (target && target.id !== source.id) source.compounds_with = target.id;
      }
    }
    return { data: { ...characterRow }, error: null };
  },
  // Mirrors services/character/repository.js#createBackfillMission, using
  // this file's (possibly test-overridden) mission mocks — preserves the
  // throw-regression coverage below.
  createBackfillMission: async ({ characterId, name, profileId }) => {
    const { data: missionRows, error: missionError } = await fakeCreateMission(SYSTEM_ACTOR, {
      name,
      date: new Date().toISOString(),
      outcome: 'success',
      is_public: false,
      creator_id: profileId
    });
    if (missionError) return { error: missionError };
    const mission = Array.isArray(missionRows) ? missionRows[0] : missionRows;
    if (!mission) return { error: { status: 400, message: 'Mission creation returned no rows' } };
    try {
      const { error: linkError } = await fakeAddCharacterToMission(SYSTEM_ACTOR, mission.id, characterId);
      if (linkError) return { error: linkError };
      backfilledMissions.push({ outcome: 'success' });
      return { error: null };
    } catch (error) {
      return { error };
    }
  },
  getAvailableHostedMissions: async () => ({ data: [], error: null }),
  createOffscreenMissionRow: async () => ({ data: {}, error: null }),
  // Unused by the level-up flow but required by CharacterService's adapter
  // validation / other CharacterService capabilities.
  createCharacterRow: async () => ({ data: [{}], error: null }),
  updateCharacterRow: async () => ({ data: [{}], error: null }),
  getChildRows: async () => ({ data: [], error: null }),
  insertChildRows: async () => ({ data: true, error: null }),
  updateChildRow: async () => ({ data: true, error: null }),
  deleteChildRows: async () => ({ data: true, error: null }),
  // Unused by the level-up flow but required by CharacterService's adapter
  // validation (createOffscreenMission/updateOffscreenMission/
  // deleteOffscreenMission capabilities).
  getOffscreenMissionRow: async () => ({ data: null, error: null }),
  getSourceMissionForCredit: async () => ({ data: null, error: null }),
  getConduitCredits: async () => ({ data: null, error: null }),
  insertOffscreenMission: async () => ({ data: null, error: null }),
  updateOffscreenMissionRow: async () => ({ data: null, error: null }),
  deleteOffscreenMissionRow: async () => ({ data: null, error: null })
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
mock.module('../models/lfg', () => ({ getPendingJoinRequestCount: async () => ({ count: 0 }) }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./characters')];
  delete require.cache[require.resolve('../models/character')];
  const app = express();
  app.use(express.json());
  app.use('/characters', require('./characters'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/offscreen-mission', () => realOffscreen);
  mock.module('../models/mission', () => realMission);
  mock.module('../models/class', () => realClass);
  mock.module('../services/character/repository', () => realCharacterRepository);
  delete require.cache[require.resolve('./characters')];
  delete require.cache[require.resolve('../models/character')];
});

beforeEach(() => {
  addCharacterToMissionImpl = async () => ({ data: [{}], error: null });
  perkIdSeq = 0;
  characterRow = {
    id: CHAR_ID,
    creator_id: PROFILE_ID,
    name: 'Tango',
    level: 1,
    completed_missions: 0,
    commissary_reward: 0,
    class_id: 'c1',
  };
  classAbilities = [{ id: 'ab1', character_id: CHAR_ID, class_id: 'c1', name: 'Blink' }];
  characterPerks = [];
  backfilledMissions = [];
});

test('level-up backfilling real missions updates stored commissary_reward', async () => {
  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/level-up`, {
    method: 'POST',
    headers: {
      'authorization': 'Bearer valid-jwt',
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      level: 2,
      completed_missions: 2,
      mission_names: ['Op Alpha', 'Op Bravo'],
      use_conduit_credit: false,
      stats: {},
    }),
  });

  expect(res.status).toBe(200);

  // Two success missions at MERX_PER_MISSION_SUCCESS (1) each, no spend → 2.
  expect(characterRow.commissary_reward).toBe(2);
  expect(characterRow.completed_missions).toBe(2);
});

test('level-up backfill returns a graceful error (not a hang) when addCharacterToMission throws', async () => {
  // As of the mission service seam, MissionService.addCharacter throws
  // (AuthorizationError or a raw repo error) instead of returning
  // { error }. The level-up route/service isn't shielded from that any other
  // way than the repository's own try/catch, so this proves it resolves
  // gracefully instead of hanging on an unhandled rejection.
  addCharacterToMissionImpl = async () => {
    throw new AuthorizationError('Mission not found', { reason: 'not_found' });
  };

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('request hung')), 2000));

  const res = await Promise.race([
    fetch(`${baseUrl}/characters/${CHAR_ID}/level-up`, {
      method: 'POST',
      headers: {
        'authorization': 'Bearer valid-jwt',
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        level: 2,
        completed_missions: 1,
        mission_names: ['Op Charlie'],
        use_conduit_credit: false,
        stats: {},
      }),
    }),
    timeout,
  ]);

  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error).toBeTruthy();

  // The character row must be untouched — the backfill failed before the
  // route/service ever reached the update at the end of the handler.
  expect(characterRow.completed_missions).toBe(0);
});

test('level-up resolves compounds_with links for newly-added perks', async () => {
  // An existing perk the new perks can compound with.
  characterPerks = [
    { id: 'perk-existing', character_id: CHAR_ID, class_ability_id: 'ab1', text: 'Base perk', position: 0, compounds_with: null },
  ];

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/level-up`, {
    method: 'POST',
    headers: {
      'authorization': 'Bearer valid-jwt',
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      level: 2,
      use_conduit_credit: false,
      stats: {},
      ability_perks: [
        // Compounds with an existing perk (by UUID).
        { class_ability_id: 'ab1', text: 'Compounds with base', ref: 'pA', compounds_with: 'perk-existing' },
        // Compounds with another perk added in the same batch (by ref).
        { class_ability_id: 'ab1', text: 'Chains off A', ref: 'pB', compounds_with: 'new:pA' },
      ],
    }),
  });

  expect(res.status).toBe(200);

  const base = characterPerks.find(p => p.text === 'Base perk');
  const a = characterPerks.find(p => p.text === 'Compounds with base');
  const b = characterPerks.find(p => p.text === 'Chains off A');

  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  // New perks are appended after the existing one.
  expect(a.position).toBe(1);
  expect(b.position).toBe(2);
  // A compounds with the existing perk; B compounds with the just-inserted A.
  expect(a.compounds_with).toBe('perk-existing');
  expect(b.compounds_with).toBe(a.id);
  // The existing perk is left untouched.
  expect(base.compounds_with).toBeNull();
});
