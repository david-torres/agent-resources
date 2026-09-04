// routes/classes-structured-fields.test.js
//
// The admin class form submits the thirteen class-level structured columns the
// pre-release import populates. Both write handlers must pass every scalar
// through untouched, split the `examples` textarea into a JSON array, and send
// a blank constrained select to the database as NULL -- classes_challenge_level_check
// and classes_prerelease_section_check both reject the empty string.
//
// Mocking recipe mirrors routes/classes-stat-spread.test.js: real
// isAuthenticated middleware + real route handler against a mocked data layer.
const { test, expect, mock, beforeAll, beforeEach, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules up front so afterAll can restore them -- bun's
// mock.module is process-global and would otherwise leak into other files.
const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realClass = require('../models/class');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');

// Payloads the mocked data layer received. Reset before every test.
let capturedCreate = null;
let capturedUpdate = null;

const EXISTING_CLASS_ID = '11111111-2222-4333-8444-555555555555';

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
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
let profileRole = 'admin';
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p1', user_id: 'u1', role: profileRole }),
}));

mock.module('../models/class', () => ({
  createClass: async (actor, payload) => {
    capturedCreate = payload;
    return { data: { id: 'new-class-id', name: payload.name }, error: null };
  },
  updateClass: async (actor, id, payload) => {
    capturedUpdate = payload;
    return { data: { id, name: payload.name }, error: null };
  },
  getClass: async (id) => ({ data: { id, name: 'Vanguard', created_by: 'p1' }, error: null }),
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

// Shared request helpers. Tasks 15-17 append tests to this file and call these:
// form-urlencode a flat object (bracket-notation keys such as
// `abilities[0][name]` are passed through verbatim as keys) and submit it as an
// authenticated admin.
const encodeBody = (bodyObject) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(bodyObject || {})) {
    params.append(key, value === undefined || value === null ? '' : String(value));
  }
  return params;
};

const send = (method, path, bodyObject) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    'Authorization': 'Bearer valid-jwt',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  },
  body: encodeBody(bodyObject),
});

const post = (path, bodyObject) => send('POST', path, bodyObject);
const put = (path, bodyObject) => send('PUT', path, bodyObject);

beforeAll(async () => {
  delete require.cache[require.resolve('./classes')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/classes', require('./classes'));
  ({ server, baseUrl } = await startHttpServer(app));
});

beforeEach(() => {
  capturedCreate = null;
  capturedUpdate = null;
  profileRole = 'admin';
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/class', () => realClass);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  delete require.cache[require.resolve('./classes')];
});

// Interior double spaces, an en dash and curly quotes are content, not
// formatting: the assertions below compare against these exact strings so any
// normalization on the write path fails the test.
const structuredFields = {
  challenge_level: 'Mid',
  stat_line: 'Might 2  ·  Resilience 1',
  stat_note: 'Spend the third point where the table needs it.',
  quote: '“Hold the line — and mean it.”',
  quote_source: 'Sgt. Aldo Vance',
  overview: 'A frontline anchor who trades reach for footing.\n\nThey break a charge  so the rest of the squad never has to.',
  conduit_notes: 'Conduits should telegraph the shield wall a round early.',
  grounding: 'Grounded in the long siege of the Ninth Gate — mud, not glory.',
  examples_heading: 'Example Vanguards',
  tips_heading: 'Playing a Vanguard',
  designer: 'D. Torres',
  prerelease_section: 'pcc',
};

// Browsers submit textarea newlines as CRLF, and admins leave stray indentation
// and blank lines behind. Ends-only trimming per line, blank lines dropped.
//
// The first line carries an interior double space, an en dash (U+2013) and a
// curly apostrophe (U+2019) on purpose: parseExamples must change nothing about
// a line but its ends, so a collapse or a punctuation rewrite has to fail here.
const examplesTextarea = '  Watch-captain  of a wall town \u2013 she\u2019s held it twice  \r\n\r\nBodyguard turned drill sergeant\r\n   \r\nRetired duelist  ';
const expectedExamples = [
  'Watch-captain  of a wall town \u2013 she\u2019s held it twice',
  'Bodyguard turned drill sergeant',
  'Retired duelist',
];

const baseBody = {
  name: 'Vanguard',
  status: 'alpha',
  is_public: 'on',
  is_player_created: 'false',
};

test('POST /classes forwards every structured scalar and parses examples into an array', async () => {
  const res = await post('/classes', {
    ...baseBody,
    ...structuredFields,
    examples: examplesTextarea,
  });

  expect(res.status).toBe(200);
  expect(capturedCreate).not.toBeNull();
  for (const [field, value] of Object.entries(structuredFields)) {
    expect(capturedCreate[field]).toBe(value);
  }
  expect(capturedCreate.examples).toEqual(expectedExamples);
});

test('POST /classes sends blank challenge_level and prerelease_section as NULL', async () => {
  const res = await post('/classes', {
    ...baseBody,
    challenge_level: '',
    prerelease_section: '',
    overview: 'No challenge level assigned yet.',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.challenge_level).toBeNull();
  expect(capturedCreate.prerelease_section).toBeNull();
  expect(capturedCreate.examples).toEqual([]);
});

test('PUT /classes/:id forwards every structured scalar and parses examples into an array', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    ...structuredFields,
    examples: examplesTextarea,
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate).not.toBeNull();
  for (const [field, value] of Object.entries(structuredFields)) {
    expect(capturedUpdate[field]).toBe(value);
  }
  expect(capturedUpdate.examples).toEqual(expectedExamples);
});

test('PUT /classes/:id sends blank challenge_level and prerelease_section as NULL', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    challenge_level: '',
    prerelease_section: '',
    overview: 'No challenge level assigned yet.',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate.challenge_level).toBeNull();
  expect(capturedUpdate.prerelease_section).toBeNull();
  expect(capturedUpdate.examples).toEqual([]);
});

// A non-browser client can post anything. Both columns carry a CHECK
// constraint, so an unrecognised value has to be neutralised here or Postgres
// answers with a raw constraint-violation 500.
test('POST /classes rejects out-of-allowlist select values without a 500', async () => {
  const res = await post('/classes', {
    ...baseBody,
    challenge_level: 'bogus',
    prerelease_section: 'ASPIRANT CLASSES',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.challenge_level).toBeNull();
  expect(capturedCreate.prerelease_section).toBeNull();
});

test('PUT /classes/:id rejects out-of-allowlist select values without a 500', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    challenge_level: 'mid',
    prerelease_section: 'PCCs',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate.challenge_level).toBeNull();
  expect(capturedUpdate.prerelease_section).toBeNull();
});

// prerelease_section is provenance: which section of the source document a
// class was printed under. Both inputs are admin-only in the form, so the
// server must not take them from a non-admin who posts them anyway.
const adminOnlyFields = {
  challenge_level: 'High',
  prerelease_section: 'exclusive',
  designer: 'Sneaky Player',
};

test('POST /classes ignores the admin-only class metadata from a non-admin', async () => {
  profileRole = 'player';
  const res = await post('/classes', { ...baseBody, ...adminOnlyFields, examples: '' });

  expect(res.status).toBe(200);
  for (const field of Object.keys(adminOnlyFields)) {
    expect(capturedCreate).not.toHaveProperty(field);
  }
});

test('PUT /classes/:id ignores the admin-only class metadata from a non-admin', async () => {
  profileRole = 'player';
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, { ...baseBody, ...adminOnlyFields, examples: '' });

  expect(res.status).toBe(200);
  for (const field of Object.keys(adminOnlyFields)) {
    expect(capturedUpdate).not.toHaveProperty(field);
  }
});

// 31 of the 50 live classes have a NULL overview. The form renders a NULL
// column as an empty textarea, so an admin toggling is_public and saving posts
// every prose field blank -- which must leave the columns NULL rather than
// rewrite ten of them to ''. NULL means "no such field"; '' asserts someone set
// it to nothing.
const nullableTextFields = [
  'stat_line', 'stat_note', 'quote', 'quote_source', 'overview',
  'conduit_notes', 'grounding', 'examples_heading', 'tips_heading', 'designer',
];

const blankProseBody = Object.fromEntries(
  [...nullableTextFields, 'examples', 'teaser', 'tips'].map((field) => [field, ''])
);

test('POST /classes writes blank prose as NULL, leaving examples, teaser and tips alone', async () => {
  const res = await post('/classes', { ...baseBody, ...blankProseBody });

  expect(res.status).toBe(200);
  for (const field of nullableTextFields) {
    expect(capturedCreate[field]).toBeNull();
  }
  // jsonb NOT NULL DEFAULT '[]' -- blank is an empty array, not NULL.
  expect(capturedCreate.examples).toEqual([]);
  // Long-standing behaviour from outside this branch; untouched on purpose.
  expect(capturedCreate.teaser).toBe('');
  expect(capturedCreate.tips).toBe('');
});

test('PUT /classes/:id writes blank prose as NULL, leaving examples, teaser and tips alone', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, { ...baseBody, ...blankProseBody });

  expect(res.status).toBe(200);
  for (const field of nullableTextFields) {
    expect(capturedUpdate[field]).toBeNull();
  }
  expect(capturedUpdate.examples).toEqual([]);
  expect(capturedUpdate.teaser).toBe('');
  expect(capturedUpdate.tips).toBe('');
});

// Whitespace-only is blank too: trimStrings would reduce it to '' downstream,
// so catching it here is what keeps a stray space out of the column.
test('PUT /classes/:id treats a whitespace-only prose field as blank', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    overview: '   \n  ',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate.overview).toBeNull();
});

// ---------------------------------------------------------------------------
// Task 15: the repeatable ability editor.
//
// Express runs express.urlencoded({ extended: true }), whose body-parser passes
// qs depth: 32, so `abilities[0][notes][0][children][0][text]` -- six levels --
// arrives already nested. Bare qs.parse defaults to depth: 5 and would hand
// back a literal "[text]" property, so every test below goes through post()/
// put() and the real middleware rather than parsing a query string itself.
//
// The fixtures carry an interior double space, an en dash (U+2013) and a curly
// apostrophe (U+2019) in the description and in a note: normalizeAbilities
// trims the ends of a submitted string and changes nothing else, so a collapse
// or a punctuation rewrite has to fail here.
const ABILITY_DESCRIPTION = 'Conjure a magical  ring – it’s the collar’s twin.';
const NOTE_TEXT = 'Duration scales  on intimidation – the target’s, not yours.';

const nestedAbilityBody = {
  name: 'Test',
  'abilities[0][name]': 'Collar',
  'abilities[0][description]': ABILITY_DESCRIPTION,
  'abilities[0][paired_action]': 'Call a cowed animal to heel.',
  'abilities[0][meters][0][label]': 'Essence Cost',
  'abilities[0][meters][0][value]': 'Low',
  'abilities[0][notes][0][text]': NOTE_TEXT,
  'abilities[0][notes][0][children][0][text]': 'Ends early if the collar is destroyed.',
};

const expectedNestedAbility = {
  name: 'Collar',
  description: ABILITY_DESCRIPTION,
  paired_action: 'Call a cowed animal to heel.',
  meters: [{ label: 'Essence Cost', value: 'Low' }],
  notes: [{
    text: NOTE_TEXT,
    children: [{ text: 'Ends early if the collar is destroyed.', children: [] }],
  }],
};

test('POST /classes accepts nested ability metadata from the form', async () => {
  const res = await post('/classes', nestedAbilityBody);

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities).toEqual([expectedNestedAbility]);
});

test('PUT /classes/:id accepts nested ability metadata from the form', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, nestedAbilityBody);

  expect(res.status).toBe(200);
  expect(capturedUpdate.abilities).toEqual([expectedNestedAbility]);
});

// Ends-only trimming. The browser and the admin both leave whitespace at the
// edges; everything between the edges is a verbatim copy of the source
// document and must survive byte for byte.
test('POST /classes trims the ends of every ability string and nothing else', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': '  Collar  ',
    'abilities[0][description]': `\r\n  ${ABILITY_DESCRIPTION}  \r\n`,
    'abilities[0][paired_action]': '  Call a cowed  animal to heel.  ',
    'abilities[0][meters][0][label]': '  Essence Cost  ',
    'abilities[0][meters][0][value]': '  Low  ',
    'abilities[0][notes][0][text]': `  ${NOTE_TEXT}  `,
    'abilities[0][notes][0][children][0][text]': '  Ends early  if the collar is destroyed.  ',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities).toEqual([{
    name: 'Collar',
    description: ABILITY_DESCRIPTION,
    paired_action: 'Call a cowed  animal to heel.',
    meters: [{ label: 'Essence Cost', value: 'Low' }],
    notes: [{
      text: NOTE_TEXT,
      children: [{ text: 'Ends early  if the collar is destroyed.', children: [] }],
    }],
  }]);
});

// A repeater's blank row is a normal intermediate state -- the inputs carry no
// `required`, so the server is the only thing that drops them.
test('POST /classes drops an ability whose name is blank after trimming', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': '   ',
    'abilities[0][description]': 'Orphaned description.',
    'abilities[1][name]': 'Kept',
    'abilities[1][description]': 'Kept description.',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities.map((a) => a.name)).toEqual(['Kept']);
});

// A meter is a label/value pair by definition: partials/class-meters.handlebars
// renders a <dt>/<dd> row, so neither half alone shows anything meaningful.
test('POST /classes drops a meter row whose label is blank', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Collar',
    'abilities[0][meters][0][label]': '  ',
    'abilities[0][meters][0][value]': 'Low',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities[0].meters).toEqual([]);
});

test('POST /classes drops a meter row whose value is blank', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Collar',
    'abilities[0][meters][0][label]': 'Essence Cost',
    'abilities[0][meters][0][value]': '  ',
    'abilities[0][meters][1][label]': 'Range',
    'abilities[0][meters][1][value]': 'Close',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities[0].meters).toEqual([{ label: 'Range', value: 'Close' }]);
});

// A child reattached to the wrong parent is the corruption class the extraction
// work fought. A blank parent takes its children down with it rather than
// promoting them a level.
test('POST /classes drops a blank note together with its children', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Collar',
    'abilities[0][notes][0][text]': '   ',
    'abilities[0][notes][0][children][0][text]': 'Orphan that must not be promoted.',
    'abilities[0][notes][1][text]': 'Kept parent.',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities[0].notes).toEqual([{ text: 'Kept parent.', children: [] }]);
});

test('POST /classes drops a blank child note but keeps its parent', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Collar',
    'abilities[0][notes][0][text]': 'Kept parent.',
    'abilities[0][notes][0][children][0][text]': '  ',
    'abilities[0][notes][0][children][1][text]': 'Kept child.',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities[0].notes).toEqual([
    { text: 'Kept parent.', children: [{ text: 'Kept child.', children: [] }] },
  ]);
});

// `children` is an array even when it is empty -- never undefined, never null.
// partials/class-notes.handlebars does guard on `.length`, so this is not
// crash-avoidance: it is one shape for every note, so that a consumer reading
// `notes[i].children` does not have to test for three of them.
test('POST /classes gives every ability, meter list and note an array', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Collar',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities).toEqual([{
    name: 'Collar', description: '', paired_action: '', meters: [], notes: [],
  }]);
});

test('POST /classes sends no abilities as an empty array', async () => {
  const res = await post('/classes', { name: 'Test' });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities).toEqual([]);
});

// Notes nest exactly two levels. A third level is not a shape the renderer or
// the source document has, so it is dropped rather than carried into jsonb.
test('POST /classes keeps notes two levels deep, dropping any grandchild', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Collar',
    'abilities[0][notes][0][text]': 'Parent.',
    'abilities[0][notes][0][children][0][text]': 'Child.',
    'abilities[0][notes][0][children][0][children][0][text]': 'Grandchild.',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities[0].notes).toEqual([
    { text: 'Parent.', children: [{ text: 'Child.', children: [] }] },
  ]);
});

// Array order IS the semantic -- it is the order abilities, meters and notes
// print in -- and a form whose rows have been added and removed submits gappy
// indices. body-parser sets qs's arrayLimit to `Math.max(100, paramCount)`
// (body-parser/lib/types/urlencoded.js:168), so index 9 next to index 21
// arrives as a two-element array, NOT the object shape qs produces at its
// default limit of 20. That object shape is unreachable from any request
// through this app -- append-field never builds one at all -- and is pinned
// directly in util/class-abilities.test.js instead.
test('POST /classes keeps gappy ability indices in ascending order', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[9][name]': 'Nine',
    'abilities[21][name]': 'TwentyOne',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities.map((a) => a.name)).toEqual(['Nine', 'TwentyOne']);
});

test('POST /classes keeps gappy meter and note indices in ascending order', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Collar',
    'abilities[0][meters][9][label]': 'Nine',
    'abilities[0][meters][9][value]': 'v',
    'abilities[0][meters][21][label]': 'TwentyOne',
    'abilities[0][meters][21][value]': 'v',
    'abilities[0][notes][9][text]': 'Nine',
    'abilities[0][notes][21][text]': 'TwentyOne',
    'abilities[0][notes][9][children][9][text]': 'ChildNine',
    'abilities[0][notes][9][children][21][text]': 'ChildTwentyOne',
  });

  expect(res.status).toBe(200);
  const ability = capturedCreate.abilities[0];
  expect(ability.meters.map((m) => m.label)).toEqual(['Nine', 'TwentyOne']);
  expect(ability.notes.map((n) => n.text)).toEqual(['Nine', 'TwentyOne']);
  expect(ability.notes[0].children.map((c) => c.text)).toEqual(['ChildNine', 'ChildTwentyOne']);
});

// The flat ability_name[] / ability_description[] path is gone, not kept
// alongside, so those names build nothing -- and they are stripped rather than
// forwarded: req.body reaches the repository wholesale with no column
// allowlist, so a browser holding the previous version of the form would
// otherwise turn its next save into a Postgres error on columns that do not
// exist.
test('POST /classes ignores and strips the retired flat ability field names', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'ability_name[]': 'Stale',
    'ability_description[]': 'Stale description.',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities).toEqual([]);
  expect(capturedCreate).not.toHaveProperty('ability_name[]');
  expect(capturedCreate).not.toHaveProperty('ability_description[]');
});

test('PUT /classes/:id ignores and strips the retired flat ability field names', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    'ability_name[]': 'Stale',
    'ability_description[]': 'Stale description.',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate.abilities).toEqual([]);
  expect(capturedUpdate).not.toHaveProperty('ability_name[]');
  expect(capturedUpdate).not.toHaveProperty('ability_description[]');
});

// The form renders a hidden pronunciation field only for an ability that
// already has one. Two live abilities do; 55 more carry the key as an explicit
// null, and 93 legacy abilities have never had it at all. The rule is echo, not
// invent: without this the editor's round-trip field would be pointless, and
// with it applied unconditionally every legacy ability would gain a key it
// never had.
test('POST /classes round-trips an ability pronunciation it was given', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Ko\u014dan',
    'abilities[0][pronunciation]': '  KOH-ahn  ',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities[0].pronunciation).toBe('KOH-ahn');
});

test('PUT /classes/:id round-trips an ability pronunciation it was given', async () => {
  const res = await put(`/classes/${EXISTING_CLASS_ID}`, {
    ...baseBody,
    'abilities[0][name]': 'Ko\u014dan',
    'abilities[0][pronunciation]': 'KOH-ahn',
    examples: '',
  });

  expect(res.status).toBe(200);
  expect(capturedUpdate.abilities[0].pronunciation).toBe('KOH-ahn');
});

test('POST /classes invents no pronunciation for an ability that posts none', async () => {
  const res = await post('/classes', { name: 'Test', 'abilities[0][name]': 'Collar' });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities[0]).not.toHaveProperty('pronunciation');
});

// A blank hidden field is an ability whose pronunciation was cleared, not one
// that never had the key.
test('POST /classes sends a blanked pronunciation as NULL, keeping the key', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Collar',
    'abilities[0][pronunciation]': '   ',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities[0].pronunciation).toBeNull();
});

// The other half of that rule, and a deliberate difference from it. `name`,
// `description`, `paired_action`, `meters` and `notes` are this task's declared
// ability contract, so a legacy ability that only ever had a name and a
// description picks up the other three on save -- the uniform shape the editor
// renders and round-trips, and one both class-view partials already guard on.
// That is normalization. Writing `pronunciation` onto those same rows would be
// invention, which is why it is echoed rather than defaulted.
test('POST /classes gives a legacy two-field ability the full contract shape', async () => {
  const res = await post('/classes', {
    name: 'Test',
    'abilities[0][name]': 'Bulwark',
    'abilities[0][description]': 'Plant the shield.',
  });

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities).toEqual([{
    name: 'Bulwark',
    description: 'Plant the shield.',
    paired_action: '',
    meters: [],
    notes: [],
  }]);
});

// views/class-form.handlebars submits multipart/form-data (it carries the class
// PDF), so the real request never touches express.urlencoded at all -- multer
// parses it, and multer nests bracket names through `append-field` rather than
// qs. Every test above proves the urlencoded path; this one proves the path an
// actual browser takes, including the six-level note key.
const postMultipart = (path, bodyObject) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(bodyObject)) form.append(key, value);
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer valid-jwt', 'Accept': 'application/json' },
    body: form,
  });
};

test('POST /classes accepts nested ability metadata over multipart/form-data', async () => {
  const res = await postMultipart('/classes', nestedAbilityBody);

  expect(res.status).toBe(200);
  expect(capturedCreate.abilities).toEqual([expectedNestedAbility]);
});
