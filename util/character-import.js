const z = require("zod");
const { OpenAIChatApi } = require("llm-api");
const { completion } = require("zod-gpt");
const { createCharacter } = require('../models/character');
const { adventClassList, aspirantPreviewClassList, playerCreatedClassList, classGearList, classAbilityList, personalityMap } = require('../util/enclave-consts');

const openai = new OpenAIChatApi(
  { apiKey: process.env.OPENAI_API_KEY },
  { model: "gpt-4o-mini" }
);

const traits = Object.values(personalityMap).join(', ');
const classes = adventClassList.concat(aspirantPreviewClassList, playerCreatedClassList).join(', ');
const gear = Object.values(classGearList).map(gear => gear.join(', ')).join(', ');

const schema = z.object({
  name: z.string().describe("The character's name"),
  class: z.string().describe(`The character's class, must be in the following list: ${classes}`),
  trait0: z.string().nullable().describe(`The character's first personality trait, must be in the following list: ${traits}`),
  trait1: z.string().nullable().describe(`The character's second personality trait, must be in the following list: ${traits}`),
  trait2: z.string().nullable().describe(`The character's third personality trait, must be in the following list: ${traits}`),
  vitality: z.number().int().describe("The character's vitality, may be represented as a number or a series of plus signs (+)"),
  might: z.number().int().describe("The character's might, may be represented as a number or a series of plus signs (+)"),
  resilience: z.number().int().describe("The character's resilience, may be represented as a number or a series of plus signs (+)"),
  spirit: z.number().int().describe("The character's spirit, may be represented as a number or a series of plus signs (+)"),
  arcane: z.number().int().describe("The character's arcane, may be represented as a number or a series of plus signs (+)"),
  will: z.number().int().describe("The character's will, may be represented as a number or a series of plus signs (+)"),
  sensory: z.number().int().describe("The character's sensory, may be represented as a number or a series of plus signs (+)"),
  reflex: z.number().int().describe("The character's reflex, may be represented as a number or a series of plus signs (+)"),
  vigor: z.number().int().describe("The character's vigor, may be represented as a number or a series of plus signs (+)"),
  skill: z.number().int().describe("The character's skill, may be represented as a number or a series of plus signs (+)"),
  intelligence: z.number().int().describe("The character's intelligence, may be represented as a number or a series of plus signs (+)"),
  luck: z.number().int().describe("The character's luck, may be represented as a number or a series of plus signs (+)"),
  level: z.number().int().describe("The character's level, must be a number"),
  completed_missions: z.number().int().describe("The number of missions the character has completed, must be a number"),
  commissary_reward: z.number().int().describe("The character's commissary reward, must be a number"),
  appearance: z.string().describe("The character's appearance"),
  gear: z.array(z.string()).nullable().describe(`The character's gear, must be in the following list: ${gear}`),
  additional_gear: z.string().describe("The character's common items"),
  image_url: z.string().url().nullable().describe("The character's image URL"),
  flavor: z.string().describe("The character's flavor text, stories about the character besides missions"),
  ideas: z.string().describe("The player's ideas for the character"),
  background: z.string().describe("The character's background"),
  perks: z.string().describe("The character's ability perks"),
});

async function processCharacterImport(inputText, profile) {
  const prompt = `Parse the following character sheet and try to structure the data following the provided JSON schema info.

Character sheet:
${inputText}

JSON output:`;

  const result = await completion(openai, prompt, { schema });
  try {
    const validatedCharacter = schema.parse(result.data);
    const characterData = {
      ...validatedCharacter,
      creator_id: profile.id,
      is_public: false,
    };
    characterData.abilities = classAbilityList[characterData.class];
    const { data: character, error } = await createCharacter(characterData, profile);
    if (error) throw new Error(error.message);
    return character;
  } catch (error) {
    throw new Error(`Invalid character data: ${error.message}`);
  }
}

module.exports = { processCharacterImport };

