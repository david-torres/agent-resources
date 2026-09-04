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

// `examples` is a jsonb array; every other part is text.
const pickClassProse = (classData = {}) =>
  Object.fromEntries(CLASS_PROSE_FIELDS.map((field) => [
    field,
    field === 'examples'
      ? (Array.isArray(classData.examples) ? classData.examples : [])
      : (classData[field] ?? null),
  ]));

module.exports = { CLASS_PROSE_FIELDS, pickClassProse };
