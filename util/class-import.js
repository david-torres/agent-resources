const z = require("zod");
const { OpenAIChatApi } = require("llm-api");
const { completion } = require("zod-gpt");
const { createClass } = require("../models/class");
const { blankTextToNull } = require("./class-fields");
const { assertNonEmptyImportText } = require("./validate");

const openai = new OpenAIChatApi(
  { apiKey: process.env.OPENAI_API_KEY },
  { model: "gpt-5-mini" }
);

const meterSchema = z.object({
  label: z.string().describe("Meter label, e.g. Essence Cost, Duration, Cooldown"),
  value: z.string().describe("Meter value, e.g. Low, Mid, High"),
});

// Notes nest exactly two levels -- a note and its sub-bullets, no
// grandchildren -- which is the shape util/class-abilities.js and
// util/class-gear.js normalize the admin form into.
const noteSchema = z.object({
  text: z.string().describe("Note text"),
  children: z.array(z.object({ text: z.string().describe("Sub-note text") }))
    .nullable().optional().describe("Sub-bullets under this note"),
});

const abilitySchema = z.object({
  name: z.string().describe("Ability name"),
  description: z.string().nullable().optional().describe("Ability description"),
  paired_action: z.string().nullable().optional().describe("The action this ability pairs with"),
  pronunciation: z.string().nullable().optional().describe("How the ability name is pronounced, only if the writeup gives one"),
  meters: z.array(meterSchema).nullable().optional().describe("Label/value pairs printed beside the ability"),
  notes: z.array(noteSchema).nullable().optional().describe("Bulleted notes under the ability"),
});

const gearSchema = z.object({
  name: z.string().describe("Gear name"),
  description: z.string().nullable().optional().describe("Gear description"),
  category: z.enum(["default", "elective"]).nullable().optional()
    .describe("Base gear ('default') or Elective gear ('elective'); the first three items are Base"),
  meters: z.array(meterSchema).nullable().optional().describe("Label/value pairs printed beside the item"),
  notes: z.array(noteSchema).nullable().optional().describe("Bulleted notes under the item"),
});

// The prose columns migration 20260904000000_class_structured_content split
// `description` into, in the source document's printed order.
//
// challenge_level, designer and prerelease_section are deliberately absent.
// They are curation and provenance, routes/classes.js strips all three from a
// non-admin's save (ADMIN_ONLY_FIELDS), and POST /classes/import is open to any
// signed-in user -- so a writeup must not be able to assert them.
const schema = z.object({
  name: z.string().describe("Class name"),
  teaser: z.string().nullable().optional().describe("Short teaser or hook for list display"),
  stat_line: z.string().nullable().optional().describe("The stat allocation exactly as the writeup prints it"),
  stat_note: z.string().nullable().optional().describe("Note explaining the stat line"),
  quote: z.string().nullable().optional().describe("Epigraph quote for the class"),
  quote_source: z.string().nullable().optional().describe("Who the quote is attributed to"),
  overview: z.string().describe("Full class description and pitch"),
  conduit_notes: z.string().nullable().optional().describe("Guidance for the Conduit running this class"),
  grounding: z.string().nullable().optional().describe("Where the class sits in the setting"),
  examples_heading: z.string().nullable().optional().describe("Heading above the examples list, e.g. Examples from history and pop culture include:"),
  examples: z.array(z.string()).nullable().optional().describe("Example characters, one per entry"),
  tips_heading: z.string().nullable().optional().describe("Heading above the tips, e.g. Playing a Vanguard"),
  image_url: z.string().url().nullable().optional().describe("Optional image URL for the class"),
  tips: z.string().nullable().optional().describe("Optional short gameplay tips shown under the description in the character creator"),
  abilities: z.array(abilitySchema).describe("List of class abilities (ideally three)"),
  gear: z.array(gearSchema).describe("List of class gear items (ideally six)"),
  status: z.enum(["alpha", "beta", "release"]).optional().describe("Class status; PCCs default to alpha"),
  is_public: z.boolean().optional().describe("Whether the PCC should be public"),
  rules_edition: z.enum(["advent", "aspirant"]).optional().describe("Rules edition; defaults to advent"),
  rules_version: z.enum(["v1", "v2"]).optional().describe("Rules version; defaults to v1"),
});

// Everything below emits the contract Tasks 15 and 16 settled for the admin
// form -- five keys per ability, five per gear item -- rather than whatever
// subset the model happened to return. A class imported in the canonical shape
// is a class whose first admin save changes nothing, which is the whole point
// of util/class-form-round-trip.integration.test.js.
//
// `schema.parse` has already run by the time these are called, so every row is
// an object and every name is a string; only emptiness is still possible.
const text = (value) => (typeof value === "string" ? value.trim() : "");

const optionalText = (value) => text(value) || null;

// A meter is a label/value pair by definition, so half a pair is dropped --
// the same rule util/class-abilities.js applies to the form.
const normalizeMeters = (meters) => (Array.isArray(meters) ? meters : [])
  .filter((meter) => meter && text(meter.label) && text(meter.value))
  .map((meter) => ({ label: text(meter.label), value: text(meter.value) }));

// A blank note is dropped WITH its children rather than promoting them: a child
// reattached to the wrong parent is the corruption the extraction work fought.
const normalizeNotes = (notes) => (Array.isArray(notes) ? notes : [])
  .filter((note) => note && text(note.text))
  .map((note) => ({
    text: text(note.text),
    children: (Array.isArray(note.children) ? note.children : [])
      .filter((child) => child && text(child.text))
      .map((child) => ({ text: text(child.text), children: [] })),
  }));

const normalizeAbilities = (abilities, limit = 3) => (Array.isArray(abilities) ? abilities : [])
  .filter((ability) => ability && text(ability.name))
  .map((ability) => {
    const normalized = {
      name: text(ability.name),
      description: text(ability.description),
      paired_action: text(ability.paired_action),
      meters: normalizeMeters(ability.meters),
      notes: normalizeNotes(ability.notes),
    };
    // Outside the contract, and only 2 of 150 live abilities carry one:
    // written through when the writeup gave it, never fabricated.
    if (text(ability.pronunciation)) {
      normalized.pronunciation = text(ability.pronunciation);
    }
    return normalized;
  })
  .slice(0, limit);

// The first three items are Base gear and the rest Elective -- the split
// supabase/migrations/20260904000001_backfill_gear_category.sql wrote and
// util/class-gear.js `gearCategory` reproduces.
//
// Emitting it here is what closes R79: views/class-view.handlebars renders a
// blank category in the Base column whatever the item's position, so an import
// with no category showed all six items under Base and the first admin save
// silently moved items 4-6 to Elective.
const BASE_GEAR_COUNT = 3;

const normalizeGear = (gear, limit = 6) => (Array.isArray(gear) ? gear : [])
  .filter((item) => item && text(item.name))
  .map((item, index) => ({
    name: text(item.name),
    description: text(item.description),
    category: item.category === "elective" || item.category === "default"
      ? item.category
      : (index < BASE_GEAR_COUNT ? "default" : "elective"),
    meters: normalizeMeters(item.meters),
    notes: normalizeNotes(item.notes),
  }))
  .slice(0, limit);

const normalizeExamples = (examples) => (Array.isArray(examples) ? examples : [])
  .map((example) => text(example))
  .filter((example) => example.length > 0);

async function processClassImport(inputText, actor) {
  const writeup = assertNonEmptyImportText(inputText, 'class writeup');
  const prompt = `Parse the following class writeup into the JSON schema described below. Focus on creating a PCC (player-created class) entry.

Class writeup:
${writeup}

JSON output:`;

  const result = await completion(openai, prompt, { schema });

  try {
    const parsed = schema.parse(result.data);
    const classData = {
      ...parsed,
      teaser: text(parsed.teaser),
      overview: text(parsed.overview),
      stat_line: optionalText(parsed.stat_line),
      stat_note: optionalText(parsed.stat_note),
      quote: optionalText(parsed.quote),
      quote_source: optionalText(parsed.quote_source),
      conduit_notes: optionalText(parsed.conduit_notes),
      grounding: optionalText(parsed.grounding),
      examples_heading: optionalText(parsed.examples_heading),
      examples: normalizeExamples(parsed.examples),
      tips_heading: optionalText(parsed.tips_heading),
      image_url: parsed.image_url || null,
      tips: text(parsed.tips),
      abilities: normalizeAbilities(parsed.abilities),
      gear: normalizeGear(parsed.gear),
      status: parsed.status || "alpha",
      is_public: parsed.is_public ?? false,
      rules_edition: parsed.rules_edition || "advent",
      rules_version: parsed.rules_version || "v1",
      is_player_created: true,
    };

    // The admin form's own rule, run rather than restated: a blank nullable
    // text column is written as NULL (R86, util/class-fields.js). Without this
    // an imported class lands '' on `teaser`, `tips` or `overview` and the
    // admin's first save flips it to NULL and bumps `updated_at` -- exactly the
    // no-op-save mutation Tasks 14-17 closed on every other write path.
    blankTextToNull(classData);

    if (!actor?.profileId) {
      throw new Error("Missing profile id for PCC creation");
    }

    if (classData.abilities.length === 0) {
      throw new Error("At least one ability is required to import a PCC");
    }

    if (classData.gear.length === 0) {
      throw new Error("At least one gear item is required to import a PCC");
    }

    const { data: createdClass, error } = await createClass(actor, classData);
    if (error) throw new Error(error.message);
    return createdClass;
  } catch (error) {
    throw new Error(`Invalid class data: ${error.message}`);
  }
}

// Exported for util/class-export.test.js, which compares the keys this schema
// can set against the keys the exporter emits: an export -> import cycle that
// silently drops a field is a schema drift bug, and a hand-maintained list of
// key names in the test would drift with it.
module.exports = { processClassImport, classImportSchema: schema };
