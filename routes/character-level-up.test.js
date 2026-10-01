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
const realAccess = require('../services/access/service');
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

const CHAR_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = 'p1';

mock.module('../services/access/service', () => ({ ...realAccess, getEditionAccess: async () => ({ aspirant: { state: 'owned' } }) }));

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

mock.module('../models/mission', () => ({
  createMission: async () => { throw new Error('Independent mission writes forbidden'); },
  addCharacterToMission: async () => { throw new Error('Independent mission links forbidden'); }
}));

mock.module('../models/class', () => ({
  getClass: async () => ({ data: { id: 'c1', rules_edition: 'advent', rules_version: 'v1', content_format: 'advent' }, error: null }),
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
let atomicError;
let atomicCalls;
let committedRequests;
let rulesMetadata;

mock.module('../services/character/repository', () => ({
  getEditionAccess: async () => ({ aspirant: { state: 'owned' } }),
  // ability_perks ride along the way getCharacterAdmin returns them, so the
  // ratchet levelUp runs sees the Perks the character already carries rather
  // than an empty list that makes every level-up look affordable.
  getCharacter: async () => ({
    data: { ...characterRow, ability_perks: characterPerks.map(p => ({ ...p })) },
    error: null
  }),
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
  getClassRulesVersion: async () => ({ data: rulesMetadata.rules_version, classRules: rulesMetadata, contentFormat: rulesMetadata.content_format, error: null }),
  // updateCharacter's classFamilyOf lookup -- unreached by level-up, but the
  // constructor checks the whole adapter surface.
  getClassFamilyRows: async () => ({ data: [], error: null }),
  getConversionClasses: async () => ({ data: [], error: null }),
  getAccessibleClassIds: async () => ({ data: new Set(), error: null }),
  fetchAllowedAbilityIds: async () => ({ data: classAbilities.map(a => ({ id: a.id })), error: null }),
  fetchExistingPerks: async () => ({ data: characterPerks.map(p => ({ ...p })), error: null }),
  // In-memory stand-in for the atomic level-up RPC: applies the
  // owned-field update, inserts the new perk rows, then resolves each perk's
  // compound link exactly as the SQL does — a 'position-<n>' link targets a
  // same-ability perk by position; a bare UUID targets a same-ability existing
  // perk by id; anything else stays null.
  getLevelUpResult: async (_id, _creator, requestId, hash) => {
    const saved = committedRequests.get(requestId);
    return saved && saved.hash !== hash ? { data: null, error: { status: 409, message: 'Request ID reused with another payload' } }
      : { data: saved?.data || null, error: null };
  },
  levelUpAtomic: async ({ fields, perks, missionNames, creditSourceIds, requestId, requestHash }) => {
    atomicCalls++;
    if (atomicError) return { data: null, error: atomicError };
    if (creditSourceIds.length) throw new Error('Fixture does not provide credit sources');
    backfilledMissions.push(...missionNames.map((name, i) => ({ id: `mission-${backfilledMissions.length + i}`, name, outcome: 'success' })));
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
    committedRequests.set(requestId, { hash: requestHash, data: { ...characterRow } });
    return { data: { ...characterRow }, error: null };
  },
  createBackfillMission: async () => { throw new Error('Backfill must use the atomic RPC'); },
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
  mock.module('../services/access/service', () => realAccess);
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
  perkIdSeq = 0;
  atomicError = null;
  atomicCalls = 0;
  committedRequests = new Map();
  rulesMetadata = { rules_edition: 'advent', rules_version: 'v1', content_format: 'advent' };
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

  // 2 (advent grant) + two success missions at MERX_PER_MISSION_SUCCESS (1) each, no spend → 4.
  expect(characterRow.commissary_reward).toBe(4);
  expect(characterRow.completed_missions).toBe(2);
});

test('atomic database failure returns HTTP error without mission or character side effects', async () => {
  atomicError = { status: 503, message: 'Injected transaction failure' };
  const before = structuredClone(characterRow);
  const res = await postLevelUp({ level: 2, mission_names: ['Op Charlie', 'Op Delta'], stats: {} });
  expect(res.status).toBe(503);
  expect((await res.json()).error).toBeTruthy();
  expect(characterRow).toEqual(before);
  expect(backfilledMissions).toEqual([]);
  expect(characterPerks).toEqual([]);
  expect(atomicCalls).toBe(1);
});

test('level-up resolves compounds_with links for newly-added perks', async () => {
  // An existing perk the new perks can compound with.
  characterPerks = [
    { id: 'perk-existing', character_id: CHAR_ID, class_ability_id: 'ab1', text: 'Base perk', position: 0, compounds_with: null },
  ];
  // Nine successful missions carry a v1 character to level 4
  // (v1LevelingSequence, util/enclave-consts.js) and so to three earned Perks
  // -- what the existing perk plus the two added below cost. levelUp runs the
  // same ratchet updateCharacter does, so without them the save is refused as
  // a Perk deficit and this test never reaches the links it asserts on.
  characterRow.level = 3;
  backfilledMissions = Array.from({ length: 9 }, (_, i) => ({ id: `mission-${i}`, outcome: 'success' }));

  const res = await fetch(`${baseUrl}/characters/${CHAR_ID}/level-up`, {
    method: 'POST',
    headers: {
      'authorization': 'Bearer valid-jwt',
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      level: 4,
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

const postLevelUp = body => fetch(`${baseUrl}/characters/${CHAR_ID}/level-up`, {
  method: 'POST', headers: { authorization: 'Bearer valid-jwt', 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body)
});
test('HTTP retry returns the committed promotion without duplicating named missions', async () => {
  const body = { level: 2, request_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', mission_names: ['Alpha', 'Bravo'], stats: {} };
  const first = await postLevelUp(body);
  expect(first.status).toBe(200);
  const firstData = await first.json();
  const retry = await postLevelUp(body);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual(firstData);
  expect(backfilledMissions).toHaveLength(2);
  expect(atomicCalls).toBe(1);
  expect(characterRow.level).toBe(2);
});
test('insufficient history rejects HTTP promotion without named mission or perk side effects', async () => {
  const before = structuredClone(characterRow);
  const res = await postLevelUp({ level: 2, completed_missions: 999, mission_names: ['Only One'], stats: {} });
  expect(res.status).toBe(409);
  expect(characterRow).toEqual(before);
  expect(backfilledMissions).toEqual([]);
  expect(characterPerks).toEqual([]);
  expect(atomicCalls).toBe(0);
});
test('corrected Aspirant v1 without mode promotes using Advent v2 mission curve', async () => {
  rulesMetadata = { rules_edition: 'aspirant', rules_version: 'v1', content_format: 'advent' };
  characterRow.level = 4;
  backfilledMissions = Array.from({ length: 11 }, (_, i) => ({ id: `mission-${i}`, outcome: 'failure' }));
  const res = await postLevelUp({ level: 5, stats: {} });
  expect(res.status).toBe(200);
  expect(characterRow.level).toBe(5);
  expect(characterRow.completed_missions).toBe(11);
  expect(characterRow.commissary_reward).toBe(2);
});
