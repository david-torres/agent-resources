require('../../util/env');
const { supabaseAdmin } = require('../../models/_base');

// Default abilities MUST have >= 2 entries. views/partials/character-class-abilities.handlebars
// pre-selects an ability's <option> by walking up two `{{#each}}` context
// frames (`../../characterAbility`), but Handlebars only pushes a real
// context frame for an inner `{{#each this}}` when the current array is
// loosely `!=` its own single element -- for a one-element array that's
// false, so no frame gets pushed and the `../../` path resolves to nothing.
// A one-ability class's picker option never carries `selected`, no matter
// which `../` depth the template uses (no fixed depth is correct for both
// the one- and two-plus-element cases; see ar-7v3k Task 4 fix round 1 for
// the full investigation). Keep >= 2 abilities here so specs don't
// accidentally re-trip that quirk.
const seedClass = async (prefix, {
  name = `${prefix}-class`,
  rulesVersion = 'v1',
  isPublic = true,
  // Prefixed, not the bare literal "E2E Ability" -- see fixtures/character.js's
  // seedCharacter comment: class_id resolution for a submitted ability is
  // keyed by ability name ALONE, globally across the whole catalog, so an
  // unprefixed name collides across concurrently-running specs' fixture
  // classes under fullyParallel execution.
  abilities = [
    { name: `${prefix} E2E Ability`, description: 'Fixture ability' },
    { name: `${prefix} E2E Ability Two`, description: 'Fixture ability two' }
  ],
  gear = []
} = {}) => {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .insert({ name, rules_version: rulesVersion, is_public: isPublic, gear, abilities })
    .select()
    .single();
  if (error) throw error;
  return data;
};

// Grants `profile` (via its underlying auth user) access to `classRow` by
// inserting the same class_unlocks row a real unlock-code redemption would
// leave behind. Needed because the edit form's Class <select> options are
// filtered to the editing user's unlocked set (routes/characters.js
// filterClassDataForUser) with no fallback injection for the character's own
// class (unlike gear/abilities, which do get injected) -- an unlocked class
// is required for the class <select> to ever mark the right option
// `selected`. expires_at stays null (never expires).
const unlockClassForProfile = async (profile, classRow) => {
  const { error } = await supabaseAdmin
    .from('class_unlocks')
    .insert({ user_id: profile.user_id, class_id: classRow.id });
  if (error) throw error;
};

module.exports = { seedClass, unlockClassForProfile };
