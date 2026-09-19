// The AI character import wraps whatever createCharacter reports into
// "Invalid character data: <reason>". createCharacter returns its validation
// failures as a plain STRING (services/character/input.js returns
// `{ data: null, error: <string> }`), so reading `.message` off it yields
// undefined and the player is told nothing at all. That now matters: the
// import stamps every gear item with the class id, so a class whose
// content_format is 'aspirant' is subject to the 12-Merx budget and a
// 7-Signature sheet is refused at 14 Merx.
const { test, expect, mock, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Captured up front so afterAll can restore them -- bun's mock.module is
// process-global and would otherwise leak into every other test file.
const realLlmApi = require('llm-api');
const realZodGpt = require('zod-gpt');
const realCharacterModel = require('../models/character');
const realClassModel = require('../models/class');

const SHEET = {
  name: 'Vex',
  class: 'Gunslinger',
  trait0: null,
  trait1: null,
  trait2: null,
  vitality: 1, might: 1, resilience: 1, spirit: 1, arcane: 1, will: 1,
  sensory: 1, reflex: 1, vigor: 1, skill: 1, intelligence: 1, luck: 1,
  level: 1,
  completed_missions: 0,
  commissary_reward: 0,
  appearance: 'Tall.',
  gear: ['Revolver', 'Duster', 'Spurs', 'Hat', 'Lasso', 'Canteen', 'Boots'],
  additional_gear: '',
  image_url: null,
  flavor: '',
  ideas: '',
  background: '',
  perks: '',
  mission_logs: []
};

let createResult = { data: null, error: null };

mock.module('llm-api', () => ({ OpenAIChatApi: class OpenAIChatApi {} }));
mock.module('zod-gpt', () => ({ completion: async () => ({ data: SHEET }) }));
mock.module('../models/character', () => ({
  createCharacter: async () => createResult
}));
mock.module('../models/class', () => ({
  getClasses: async () => ({ data: [{ id: 'class-1', name: 'Gunslinger' }], error: null })
}));

const { processCharacterImport } = require('./character-import');

afterAll(() => {
  mock.module('llm-api', () => realLlmApi);
  mock.module('zod-gpt', () => realZodGpt);
  mock.module('../models/character', () => realCharacterModel);
  mock.module('../models/class', () => realClassModel);
});

test('a string error from createCharacter reaches the player', async () => {
  createResult = { data: null, error: 'This character spends 14 Merx of 12.' };
  await expect(processCharacterImport('a character sheet', { id: 'profile-1' }))
    .rejects.toThrow('This character spends 14 Merx of 12.');
});

test('an Error-shaped error from createCharacter still reaches the player', async () => {
  createResult = { data: null, error: { message: 'Character creation returned no rows' } };
  await expect(processCharacterImport('a character sheet', { id: 'profile-1' }))
    .rejects.toThrow('Character creation returned no rows');
});
