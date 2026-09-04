// The prose a class prints, one column per part, in the source document's
// printed order (migration 20260904000000_class_structured_content). It
// replaced a single assembled `description` blob; keeping the list in one
// place is what stops the agent payload, the exports and dup_class from
// drifting apart the next time a part is added.
const CLASS_PROSE_FIELDS = [
  'challenge_level',
  'stat_line',
  'stat_note',
  'quote',
  'quote_source',
  'overview',
  'conduit_notes',
  'grounding',
  'examples_heading',
  'examples',
  'tips_heading',
  'designer',
  'prerelease_section',
];

// The agent payload is the one consumer whose set is not the columns: it drops
// `prerelease_section`, which records which section of the source PDF a class
// came from -- provenance, not class content -- and adds `tips`, because a
// `tips_heading` with no body under it is not worth sending.
const CLASS_AGENT_PROSE_FIELDS = [
  ...CLASS_PROSE_FIELDS.filter((field) => field !== 'prerelease_section'),
  'tips',
];

// `examples` is a jsonb array; every other part is text.
const pickClassFields = (classData, fields) =>
  Object.fromEntries(fields.map((field) => [
    field,
    field === 'examples'
      ? (Array.isArray(classData.examples) ? classData.examples : [])
      : (classData[field] ?? null),
  ]));

const pickClassProse = (classData = {}) => pickClassFields(classData, CLASS_PROSE_FIELDS);

const pickClassProseForAgent = (classData = {}) =>
  pickClassFields(classData, CLASS_AGENT_PROSE_FIELDS);

module.exports = {
  CLASS_PROSE_FIELDS,
  CLASS_AGENT_PROSE_FIELDS,
  pickClassProse,
  pickClassProseForAgent,
};
