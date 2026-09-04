// util/class-import.test.js
//
// The AI class importer's Zod schema had a REQUIRED `description` field whose
// value was written straight into the `classes` insert. With the column gone
// (Task 13) every AI import would fail at the database, so the schema field is
// `overview` and the insert carries `overview`. Nothing covered this path.
//
// `llm-api` and `zod-gpt` are mocked: the point is the shape handed to
// createClass, not a live model call.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

const realLlmApi = require('llm-api');
const realZodGpt = require('zod-gpt');
const realClassModel = require('../models/class');

let lastSchema = null;
let created = null;

// What the mocked model "returns". Each test sets the parts it cares about; the
// point is the shape handed to createClass, not a live model call.
const BASE_RESPONSE = {
  name: 'Beastmaster',
  teaser: 'A domineering animal tamer.',
  overview: 'You are a domineering animal tamer.',
  abilities: [{ name: 'Tame', description: 'Bonds a beast.' }],
  gear: [{ name: 'Whip', description: 'Cracks.' }],
};
let modelResponse = BASE_RESPONSE;
const respondWith = (extra) => { modelResponse = { ...BASE_RESPONSE, ...extra }; };

mock.module('llm-api', () => ({ OpenAIChatApi: class { constructor() {} } }));
mock.module('zod-gpt', () => ({
  completion: async (_api, _prompt, { schema }) => {
    lastSchema = schema;
    return { data: modelResponse };
  },
}));
mock.module('../models/class', () => ({
  ...realClassModel,
  createClass: async (_actor, classData) => {
    created = classData;
    return { data: { id: 'new-class' }, error: null };
  },
}));

let processClassImport;

beforeAll(() => {
  delete require.cache[require.resolve('./class-import')];
  ({ processClassImport } = require('./class-import'));
});

afterAll(() => {
  mock.module('llm-api', () => realLlmApi);
  mock.module('zod-gpt', () => realZodGpt);
  mock.module('../models/class', () => realClassModel);
  delete require.cache[require.resolve('./class-import')];
});

test('an imported class is created with overview, never description', async () => {
  const result = await processClassImport('Beastmaster writeup', { profileId: 'p1' });
  expect(result).toEqual({ id: 'new-class' });
  expect(created).not.toHaveProperty('description');
  expect(created.overview).toBe('You are a domineering animal tamer.');
});

test('the import schema asks the model for an overview, not a description', async () => {
  await processClassImport('Beastmaster writeup', { profileId: 'p1' });
  const shape = lastSchema.shape;
  expect(Object.keys(shape)).toContain('overview');
  expect(Object.keys(shape)).not.toContain('description');
  expect(shape.overview.description).toBe('Full class description and pitch');
});

// Task 13 renamed `description` to `overview` and added nothing else, so the AI
// path kept emitting the two-field ability and gear items that predate the
// structured columns. Tasks 14-16 gave both a five-key contract, and an
// importer that cannot express it produces a class whose first admin save
// changes it.
test('the import schema asks for the structured class columns', () => {
  const shape = Object.keys(lastSchema.shape);
  for (const column of [
    'stat_line', 'stat_note', 'quote', 'quote_source', 'conduit_notes',
    'grounding', 'examples_heading', 'examples', 'tips_heading',
  ]) {
    expect(shape).toContain(column);
  }
});

// challenge_level, designer and prerelease_section are curation and
// provenance: routes/classes.js drops all three from a non-admin's save
// (ADMIN_ONLY_FIELDS), and /classes/import is open to any signed-in user, so a
// writeup must not be able to assert them.
test('the import schema does not accept the admin-only provenance fields', () => {
  const shape = Object.keys(lastSchema.shape);
  expect(shape).not.toContain('challenge_level');
  expect(shape).not.toContain('designer');
  expect(shape).not.toContain('prerelease_section');
});

test('an imported ability carries its paired action, meters and notes', async () => {
  respondWith({
    abilities: [{
      name: 'Sic \u2018Em!',
      description: 'Prompt a beast to attack.',
      paired_action: 'Indicate your target.',
      pronunciation: 'seek em',
      meters: [{ label: 'Essence Cost', value: 'Low' }],
      notes: [{ text: 'Cooldown is prolonged on a miss.', children: [{ text: 'Only once per target.' }] }],
    }],
  });
  await processClassImport('Beastmaster writeup', { profileId: 'p1' });
  expect(created.abilities).toEqual([{
    name: 'Sic \u2018Em!',
    description: 'Prompt a beast to attack.',
    paired_action: 'Indicate your target.',
    pronunciation: 'seek em',
    meters: [{ label: 'Essence Cost', value: 'Low' }],
    notes: [{ text: 'Cooldown is prolonged on a miss.', children: [{ text: 'Only once per target.', children: [] }] }],
  }]);
});

// The five-key contract, not the model's output: an ability the model returns
// bare still reaches the database in the shape a form save would write, so the
// first save changes nothing.
test('an imported ability without extras still gets the full contract shape', async () => {
  respondWith({ abilities: [{ name: 'Tame', description: 'Bonds a beast.' }] });
  await processClassImport('Beastmaster writeup', { profileId: 'p1' });
  expect(created.abilities).toEqual([
    { name: 'Tame', description: 'Bonds a beast.', paired_action: '', meters: [], notes: [] },
  ]);
});

// R79: `filterBy` in views/class-view.handlebars puts a blank category in the
// Base column whatever the item's position, while gearCategory assigns Elective
// from index 3. An importer that emits no category renders all six items under
// Base and the first admin save silently moves items 4-6 to Elective.
test('imported gear is categorised by position, three Base then three Elective', async () => {
  respondWith({
    gear: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((name) => ({ name, description: `${name}.` })),
  });
  await processClassImport('Beastmaster writeup', { profileId: 'p1' });
  expect(created.gear.map((item) => item.category)).toEqual([
    'default', 'default', 'default', 'elective', 'elective', 'elective',
  ]);
});

test('an imported gear item keeps a category the model chose', async () => {
  respondWith({
    gear: [{ name: 'Whip', description: 'Cracks.', category: 'elective' }],
  });
  await processClassImport('Beastmaster writeup', { profileId: 'p1' });
  expect(created.gear[0].category).toBe('elective');
});

test('an imported gear item carries its meters and notes', async () => {
  respondWith({
    gear: [{
      name: 'Whip',
      description: 'Cracks.',
      meters: [{ label: 'Accuracy Boost', value: 'Mid' }],
      notes: [{ text: 'Reach is Low.', children: [] }],
    }],
  });
  await processClassImport('Beastmaster writeup', { profileId: 'p1' });
  expect(created.gear).toEqual([{
    name: 'Whip',
    description: 'Cracks.',
    category: 'default',
    meters: [{ label: 'Accuracy Boost', value: 'Mid' }],
    notes: [{ text: 'Reach is Low.', children: [] }],
  }]);
});

test('imported examples arrive as an array of lines', async () => {
  respondWith({ examples: ['Siegfried & Roy', 'Rexxar (Warcraft)'] });
  await processClassImport('Beastmaster writeup', { profileId: 'p1' });
  expect(created.examples).toEqual(['Siegfried & Roy', 'Rexxar (Warcraft)']);
});
