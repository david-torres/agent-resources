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

mock.module('llm-api', () => ({ OpenAIChatApi: class { constructor() {} } }));
mock.module('zod-gpt', () => ({
  completion: async (_api, _prompt, { schema }) => {
    lastSchema = schema;
    return {
      data: {
        name: 'Beastmaster',
        teaser: 'A domineering animal tamer.',
        overview: 'You are a domineering animal tamer.',
        abilities: [{ name: 'Tame', description: 'Bonds a beast.' }],
        gear: [{ name: 'Whip', description: 'Cracks.' }],
      },
    };
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
