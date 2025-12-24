const z = require("zod");
const { OpenAIChatApi } = require("llm-api");
const { completion } = require("zod-gpt");
const { createClass } = require("../models/class");

const openai = new OpenAIChatApi(
  { apiKey: process.env.OPENAI_API_KEY },
  { model: "gpt-5-mini" }
);

const abilitySchema = z.object({
  name: z.string().describe("Ability name"),
  description: z.string().nullable().optional().describe("Ability description"),
});

const gearSchema = z.object({
  name: z.string().describe("Gear name"),
  description: z.string().nullable().optional().describe("Gear description"),
});

const schema = z.object({
  name: z.string().describe("Class name"),
  teaser: z.string().nullable().optional().describe("Short teaser or hook for list display"),
  description: z.string().describe("Full class description and pitch"),
  image_url: z.string().url().nullable().optional().describe("Optional image URL for the class"),
  abilities: z.array(abilitySchema).describe("List of class abilities (ideally three)"),
  gear: z.array(gearSchema).describe("List of class gear items (ideally six)"),
  status: z.enum(["alpha", "beta", "release"]).optional().describe("Class status; PCCs default to alpha"),
  is_public: z.boolean().optional().describe("Whether the PCC should be public"),
  rules_edition: z.enum(["advent", "aspirant"]).optional().describe("Rules edition; defaults to advent"),
  rules_version: z.enum(["v1", "v2"]).optional().describe("Rules version; defaults to v1"),
});

const normalizeAbilities = (abilities, limit = 3) => {
  if (!Array.isArray(abilities)) {
    return [];
  }

  return abilities
    .map((ability) => {
      if (!ability) return null;
      if (typeof ability === "string") {
        const name = ability.trim();
        return name ? { name } : null;
      }
      if (typeof ability === "object") {
        const name = typeof ability.name === "string" ? ability.name.trim() : "";
        if (!name) return null;
        const description = typeof ability.description === "string" ? ability.description.trim() : "";
        return description ? { name, description } : { name };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, limit);
};

const normalizeGear = (gear, limit = 6) => {
  if (!Array.isArray(gear)) {
    return [];
  }

  return gear
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") {
        const name = item.trim();
        return name ? { name } : null;
      }
      if (typeof item === "object") {
        const name = typeof item.name === "string" ? item.name.trim() : "";
        if (!name) return null;
        const description = typeof item.description === "string" ? item.description.trim() : "";
        return description ? { name, description } : { name };
      }
      return null;
    })
    .filter(Boolean)
    .slice(0, limit);
};

async function processClassImport(inputText, profile) {
  const prompt = `Parse the following class writeup into the JSON schema described below. Focus on creating a PCC (player-created class) entry.

Class writeup:
${inputText}

JSON output:`;

  const result = await completion(openai, prompt, { schema });

  try {
    const parsed = schema.parse(result.data);
    const classData = {
      ...parsed,
      teaser: parsed.teaser ?? "",
      description: parsed.description?.trim() || "",
      image_url: parsed.image_url || null,
      abilities: normalizeAbilities(parsed.abilities),
      gear: normalizeGear(parsed.gear),
      status: parsed.status || "alpha",
      is_public: parsed.is_public ?? false,
      rules_edition: parsed.rules_edition || "advent",
      rules_version: parsed.rules_version || "v1",
      is_player_created: true,
      created_by: profile?.id,
    };

    if (!classData.created_by) {
      throw new Error("Missing profile id for PCC creation");
    }

    if (classData.abilities.length === 0) {
      throw new Error("At least one ability is required to import a PCC");
    }

    if (classData.gear.length === 0) {
      throw new Error("At least one gear item is required to import a PCC");
    }

    const { data: createdClass, error } = await createClass(classData);
    if (error) throw new Error(error.message);
    return createdClass;
  } catch (error) {
    throw new Error(`Invalid class data: ${error.message}`);
  }
}

module.exports = { processClassImport };
