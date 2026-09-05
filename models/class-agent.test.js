const { test, expect } = require('bun:test');
const {
  serializeClassSummaryForAgent,
  serializeClassForAgent
} = require('./class');

const baseClass = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Tinker',
  teaser: 'Builds weird gadgets.',
  overview: 'A very long overview that should NOT appear in the list payload.',
  challenge_level: 'Mid',
  stat_line: '+Might, +Skill',
  stat_note: 'Skill is starred.',
  quote: 'Measure twice.',
  quote_source: 'Anon',
  conduit_notes: 'Give them things to break.',
  grounding: 'Grounded in tinkerer tropes.',
  examples_heading: 'Examples include:',
  examples: ['MacGyver'],
  tips_heading: 'Tips for playing a Tinker:',
  tips: '- Bring spare parts.',
  designer: 'Reece C. Downie',
  prerelease_section: 'pcc',
  gear: [{ name: 'Wrench' }, { name: 'Bolt' }],
  abilities: [{ name: 'Jury Rig' }],
  status: 'release',
  rules_edition: 'advent',
  rules_version: '1.0',
  is_public: true,
  is_player_created: true,
  image_url: 'https://example/tinker.png',
  image_crop: { x: 0, y: 0 },
  base_class_id: null,
  pdf_storage_path: 'classes/tinker.pdf',
  created_by: 'profile-owner',
  updated_at: '2026-04-01T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z'
};

test('serializeClassSummaryForAgent omits heavy fields', () => {
  const out = serializeClassSummaryForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-other', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  });

  expect(out).not.toBeNull();
  expect(out).not.toHaveProperty('description');
  expect(out).not.toHaveProperty('overview');
  expect(out).not.toHaveProperty('gear');
  expect(out).not.toHaveProperty('signature_gear');
  expect(out).not.toHaveProperty('abilities');
  expect(out).not.toHaveProperty('image_url');
  expect(out).not.toHaveProperty('image_crop');
  expect(out.id).toBe(baseClass.id);
  expect(out.name).toBe('Tinker');
  expect(out.teaser).toBe('Builds weird gadgets.');
  expect(out.status).toBe('release');
  expect(out.rules_edition).toBe('advent');
  expect(out.rules_version).toBe('1.0');
  expect(out.is_public).toBe(true);
  expect(out.is_player_created).toBe(true);
  expect(out.access_level).toBe('teaser_only');
  expect(out.unlocked).toBe(false);
});

test('serializeClassSummaryForAgent returns null when actor cannot see private class', () => {
  const priv = { ...baseClass, is_public: false, created_by: 'profile-other' };
  const out = serializeClassSummaryForAgent({
    classData: priv,
    actor: { profileId: 'profile-self', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  });
  expect(out).toBeNull();
});

test('serializeClassSummaryForAgent reports full access for owner', () => {
  const out = serializeClassSummaryForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-owner', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  });
  expect(out.access_level).toBe('full');
});

test('serializeClassSummaryForAgent reports unlocked when id is in set', () => {
  const out = serializeClassSummaryForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-other', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set([baseClass.id])
  });
  expect(out.unlocked).toBe(true);
  expect(out.access_level).toBe('full');
});

test('free agent content access does not advertise the class PDF', () => {
  const out = serializeClassForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-other', role: 'player' },
    unlockedClassIds: new Set([baseClass.id])
  });

  expect(out.access_level).toBe('full');
  expect(out.pdf_available).toBe(false);
});

test('a product entitlement advertises the class PDF', () => {
  const out = serializeClassForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-other', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set([baseClass.id]),
    productUnlockedClassIds: new Set([baseClass.id])
  });

  expect(out.pdf_available).toBe(true);
});

test('serializeClassForAgent still returns full shape for detail endpoint', () => {
  const out = serializeClassForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-owner', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  });
  expect(out).not.toHaveProperty('description');
  expect(out.overview).toBe(baseClass.overview);
  expect(out.challenge_level).toBe('Mid');
  expect(out.stat_line).toBe('+Might, +Skill');
  expect(out.stat_note).toBe('Skill is starred.');
  expect(out.quote).toBe('Measure twice.');
  expect(out.quote_source).toBe('Anon');
  expect(out.conduit_notes).toBe('Give them things to break.');
  expect(out.grounding).toBe('Grounded in tinkerer tropes.');
  expect(out.examples_heading).toBe('Examples include:');
  expect(out.examples).toEqual(['MacGyver']);
  expect(out.tips_heading).toBe('Tips for playing a Tinker:');
  // A heading with no body under it is not worth sending.
  expect(out.tips).toBe('- Bring spare parts.');
  expect(out.designer).toBe('Reece C. Downie');
  // Provenance -- which section of the source PDF the class came from. No
  // consumer has a use for it and it is not class content.
  expect(out).not.toHaveProperty('prerelease_section');
  expect(out.signature_gear).toEqual(baseClass.gear);
  expect(out).not.toHaveProperty('gear');
  expect(out.abilities).toEqual(baseClass.abilities);
});

// docs/custom-gpt-openapi.json is the Custom GPT integration's only contract:
// a field the schema declares but the API never sends is a field the GPT asks
// for and never gets. Nothing tied the two together, which is how
// `ClassDetail.description` survived the column being dropped.
test('the published OpenAPI ClassDetail matches what serializeClassForAgent emits', () => {
  const schemas = require('../docs/custom-gpt-openapi.json').components.schemas;
  const declared = [
    ...Object.keys(schemas.ClassSummary.properties),
    ...Object.keys(schemas.ClassDetail.allOf[1].properties),
  ].sort();

  const emitted = Object.keys(serializeClassForAgent({
    classData: baseClass,
    actor: { profileId: 'profile-owner', role: 'player', userId: 'user-1' },
    unlockedClassIds: new Set()
  })).sort();

  expect(declared).toEqual(emitted);
});
