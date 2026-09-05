// Link previews are rendered by crawlers that never run JavaScript and never
// sign in, so these tests fetch the real pages as a signed-out client and read
// the tags straight out of the served HTML.
const { test, expect, mock, beforeAll, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realCharacter = require('../models/character');
const realClass = require('../models/class');
const realMission = require('../models/mission');
const realProfile = require('../models/profile');
const realBadge = require('../models/badge');
const realOffscreen = require('../models/offscreen-mission');
const realDescriptionGate = require('../services/character/description-gate');
const realNavLoader = require('../util/nav-loader');
const realSystemMessage = require('../util/system-message');

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const MISSION_ID = '33333333-3333-4333-8333-333333333333';

let character;
let classRecord;
let mission;
let viewProfile;

mock.module('../models/character', () => ({
  ...realCharacter,
  getCharacter: async () => ({ data: character, error: null }),
  getCharacterRecentMissions: async () => ({ data: [] }),
  getPublicCharactersByCreator: async () => ({ data: [], error: null })
}));
mock.module('../models/class', () => ({
  ...realClass,
  getClass: async () => ({ data: classRecord, error: null }),
  getClasses: async () => ({ data: [], error: null }),
  getEffectiveClassUnlock: async () => ({ data: { unlocked: true, expiresAt: null } }),
  getEffectiveClassAccess: async () => ({
    data: { unlocked: true, productUnlocked: false, accessSource: 'free_prerelease', expiresAt: null },
    error: null
  }),
  canViewClassPdf: async () => ({ data: false, error: null })
}));
mock.module('../models/mission', () => ({
  ...realMission,
  getMission: async () => ({ data: mission, error: null })
}));
mock.module('../models/profile', () => ({
  ...realProfile,
  getProfileById: async () => ({ data: { id: 'owner-1', name: 'Quill', is_public: true }, error: null }),
  getProfileByName: async () => ({ data: viewProfile, error: null })
}));
mock.module('../models/badge', () => ({ ...realBadge, getProfileBadges: async () => ({ data: [] }) }));
mock.module('../models/offscreen-mission', () => ({ ...realOffscreen, listOffscreenMissions: async () => ({ data: [] }) }));
mock.module('../services/character/description-gate', () => ({ applyDescriptionGate: async () => {} }));
mock.module('../util/nav-loader', () => ({ populateNavItems: async () => {}, loadNavItems: (req, res, next) => next() }));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));

const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;
const originalSiteUrl = process.env.SITE_URL;

beforeAll(async () => {
  const { createApp } = require('../app');
  ({ server, baseUrl } = await startHttpServer(createApp()));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/character', () => realCharacter);
  mock.module('../models/class', () => realClass);
  mock.module('../models/mission', () => realMission);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/badge', () => realBadge);
  mock.module('../models/offscreen-mission', () => realOffscreen);
  mock.module('../services/character/description-gate', () => realDescriptionGate);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../util/system-message', () => realSystemMessage);
  if (originalSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = originalSiteUrl;
});

beforeEach(() => {
  process.env.SITE_URL = 'https://agent-resources.vip';
  character = {
    id: CHARACTER_ID,
    name: 'Vex Marrow',
    class: 'Tinker',
    class_id: CLASS_ID,
    level: 4,
    completed_missions: 12,
    is_public: true,
    hide_from_search: false,
    creator_id: 'owner-1',
    image_url: 'https://cdn.test/vex.png',
    image_crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }
  };
  classRecord = {
    id: CLASS_ID,
    name: 'Tinker',
    rules_edition: 'advent',
    rules_version: 'v2',
    teaser: 'A builder who solves problems with a wrench and nerve.',
    status: 'published',
    is_public: true,
    created_by: 'owner-1',
    image_url: 'https://cdn.test/tinker.png'
  };
  mission = {
    id: MISSION_ID,
    name: 'The Hollow Signal',
    date: '2026-03-04T18:00:00.000Z',
    host_name: 'Quill',
    summary: 'The team traced a repeating broadcast to an abandoned relay station.',
    is_public: true
  };
  viewProfile = {
    id: 'owner-1',
    name: 'Quill',
    is_public: true,
    bio: 'Long-time Conduit. Runs games most Thursdays.',
    image_url: 'https://cdn.test/quill.png'
  };
});

// Reading tags out of the served markup, the way a crawler does, rather than
// trusting whatever object the route handed the view.
const ogTags = async (path) => {
  const res = await fetch(`${baseUrl}${path}`);
  const html = await res.text();
  const tags = {};
  for (const [, property, content] of html.matchAll(
    /<meta property="og:([a-z_:]+)" content="([^"]*)">/g
  )) {
    tags[property] = content;
  }
  return { status: res.status, tags, html };
};

test('a public character page carries a full Open Graph card', async () => {
  const { tags } = await ogTags(`/characters/${CHARACTER_ID}/Vex%20Marrow`);

  expect(tags.title).toBe('Vex Marrow');
  expect(tags.description).toBe('Tinker · Level 4 · by Quill');
  expect(tags.image).toBe('https://cdn.test/vex.png');
  expect(tags.url).toBe(`https://agent-resources.vip/characters/${CHARACTER_ID}/Vex%20Marrow`);
  expect(tags.type).toBe('article');
  expect(tags.site_name).toBe('Agent Resources');
});

test('a character with no image of its own falls back to its class art', async () => {
  character.image_url = null;

  const { tags } = await ogTags(`/characters/${CHARACTER_ID}`);
  expect(tags.image).toBe('https://cdn.test/tinker.png');
});

// Opting out of discovery has to mean opting out of the preview card too.
test('a character hidden from search shares no description and no image', async () => {
  character.hide_from_search = true;

  const { tags } = await ogTags(`/characters/${CHARACTER_ID}`);

  expect(tags.title).toBe('Vex Marrow');
  expect(tags.url).toBe(`https://agent-resources.vip/characters/${CHARACTER_ID}`);
  expect(tags.description).toBeUndefined();
  expect(tags.image).toBeUndefined();
});

test('a class page describes the edition, version and teaser', async () => {
  const { tags } = await ogTags(`/classes/${CLASS_ID}/Tinker`);

  expect(tags.title).toBe('Tinker');
  expect(tags.description).toBe('Advent v2 · A builder who solves problems with a wrench and nerve.');
  expect(tags.image).toBe('https://cdn.test/tinker.png');
  expect(tags.url).toBe(`https://agent-resources.vip/classes/${CLASS_ID}/Tinker`);
});

// The teaser page is what a signed-out visitor actually lands on for a
// Release class, so it is the page that has to carry the card.
test('the locked teaser page for a Release class still carries a card', async () => {
  classRecord.status = 'release';

  const { tags } = await ogTags(`/classes/${CLASS_ID}/Tinker`);

  expect(tags.title).toBe('Tinker');
  expect(tags.description).toContain('A builder who solves problems');
});

test('a mission page describes the date, Conduit and summary, with no image', async () => {
  const { tags } = await ogTags(`/missions/${MISSION_ID}`);

  expect(tags.title).toBe('The Hollow Signal');
  expect(tags.description).toContain('Quill');
  expect(tags.description).toContain('abandoned relay station');
  expect(tags.image).toBeUndefined();
  expect(tags.url).toBe(`https://agent-resources.vip/missions/${MISSION_ID}`);
});

test('a private mission shares no description', async () => {
  mission.is_public = false;

  const { tags } = await ogTags(`/missions/${MISSION_ID}`);

  expect(tags.title).toBe('The Hollow Signal');
  expect(tags.description).toBeUndefined();
});

test('a public profile page carries the agent name, bio and portrait', async () => {
  const { tags } = await ogTags('/profile/view/Quill');

  expect(tags.title).toBe('Quill');
  expect(tags.description).toBe('Long-time Conduit. Runs games most Thursdays.');
  expect(tags.image).toBe('https://cdn.test/quill.png');
  expect(tags.url).toBe('https://agent-resources.vip/profile/view/Quill');
});

test('every other page falls back to the site-wide card', async () => {
  const { tags } = await ogTags('/contact');

  expect(tags.title).toBe('Agent Resources');
  expect(tags.description).toContain('Enclave');
  expect(tags.type).toBe('website');
  expect(tags.url).toBe('https://agent-resources.vip/contact');
  expect(tags.image).toBeUndefined();
});

// Host is client controlled, so a card built from it would let anyone point
// the preview at another origin.
test('og:url follows the request origin only when SITE_URL is unset', async () => {
  delete process.env.SITE_URL;

  const { tags } = await ogTags('/contact');
  expect(tags.url).toBe(`${baseUrl}/contact`);
});

// ?lfg= and tracking parameters are not part of the page's identity.
test('og:url drops the query string', async () => {
  const { tags } = await ogTags(`/characters/${CHARACTER_ID}?lfg=abc`);
  expect(tags.url).toBe(`https://agent-resources.vip/characters/${CHARACTER_ID}`);
});
