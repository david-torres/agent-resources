const z = require("zod");
const { OpenAIChatApi } = require("llm-api");
const { completion } = require("zod-gpt");
const { createCharacter } = require('../models/character');
const { getClasses } = require('../models/class');
const { adventClassList, aspirantPreviewClassList, playerCreatedClassList, classGearList, classAbilityList, personalityMap } = require('../util/enclave-consts');
const { processMissionImport } = require('./mission-import');
const { addCharacterToMission } = require('../models/mission');

const openai = new OpenAIChatApi(
  { apiKey: process.env.OPENAI_API_KEY },
  { model: "gpt-5.1-mini" }
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
  mission_logs: z.array(z.string()).nullable().optional().describe("Array of mission log texts if any are attached to this character sheet. Each string should be a complete mission log entry that can be parsed separately.")
});

const resolveClassIdByName = async (className) => {
  if (!className) {
    return null;
  }

  const attempt = async (filters = {}) => {
    const { data } = await getClasses({ name: className, ...filters });
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  };

  return (await attempt()) || (await attempt({ is_public: true })) || null;
};

const formatClassContent = (items, classId) => {
  if (!Array.isArray(items) || !classId) {
    return [];
  }

  return items
    .map(item => {
      if (!item) return null;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) return null;
        return { name: trimmed, class_id: classId };
      }
      if (typeof item === 'object' && typeof item.name === 'string') {
        const trimmed = item.name.trim();
        if (!trimmed) return null;
        return {
          ...item,
          name: trimmed,
          class_id: item.class_id ?? classId,
        };
      }
      return null;
    })
    .filter(Boolean);
};

async function processCharacterImport(inputText, profile) {
  const prompt = `Parse the following character sheet and try to structure the data following the provided JSON schema info.

If the character sheet includes mission logs or mission recaps (often found in sections labeled "Missions", "Mission Log", "Mission History", "Adventures", etc.), extract each mission log as a separate string in the mission_logs array. Each mission log should be a complete, standalone entry that can be parsed independently.

Character sheet:
${inputText}

JSON output:`;

  const result = await completion(openai, prompt, { schema });
  try {
    const validatedCharacter = schema.parse(result.data);
    const missionLogs = Array.isArray(validatedCharacter.mission_logs) 
      ? validatedCharacter.mission_logs.filter(log => log && typeof log === 'string' && log.trim().length > 0)
      : [];
    
    const characterData = {
      ...validatedCharacter,
      creator_id: profile.id,
      is_public: false,
    };
    // Remove mission_logs from characterData as it's not a character field
    delete characterData.mission_logs;
    
    const classDefinition = await resolveClassIdByName(characterData.class);
    if (!classDefinition?.id) {
      throw new Error(`Unknown class "${characterData.class}"`);
    }
    characterData.class_id = classDefinition.id;
    const abilityNames = classAbilityList[characterData.class] || [];
    characterData.abilities = formatClassContent(abilityNames, classDefinition.id);
    characterData.gear = formatClassContent(characterData.gear, classDefinition.id);
    const { data: character, error } = await createCharacter(characterData, profile);
    if (error) throw new Error(error.message);
    
    const importedCharacter = Array.isArray(character) ? character[0] : character;
    const importedMissions = [];
    
    // Process mission logs if any were found
    if (missionLogs.length > 0) {
      for (const missionLogText of missionLogs) {
        try {
          // Process the mission import, which will try to match characters
          // We need to ensure the newly imported character is included
          const { mission, matchedCharacterIds } = await processMissionImport(missionLogText, profile);
          
          // Check if the newly imported character was already added
          // If not, add them to the mission
          if (importedCharacter && importedCharacter.id) {
            const characterAlreadyAdded = matchedCharacterIds.includes(importedCharacter.id);
            if (!characterAlreadyAdded) {
              // Try to add the character to the mission
              // The mission import might not have matched the character name correctly
              // since it was just created, so we'll add it explicitly
              await addCharacterToMission(mission.id, importedCharacter.id);
            }
          }
          
          importedMissions.push(mission);
        } catch (missionError) {
          // Log but don't fail the character import if mission import fails
          console.error(`Failed to import mission log: ${missionError.message}`);
        }
      }
    }
    
    return { character: importedCharacter, missions: importedMissions };
  } catch (error) {
    throw new Error(`Invalid character data: ${error.message}`);
  }
}

module.exports = { processCharacterImport };

