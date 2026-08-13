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
  // Matches the column's own DB default (baseline_schema.sql:129) so
  // existing callers that don't pass `status` see no behavior change --
  // this is just making the previously-implicit default explicit. Some
  // class-view.handlebars UI (e.g. the "Generate Unlock Code" trigger,
  // wrapped in `{{#unless (or (eq class.status 'beta') (eq class.status
  // 'alpha'))}}` at line 31) is hidden for alpha/beta classes, so a spec
  // that needs that control visible must override this to 'release'.
  status = 'alpha',
  // profiles.id of the owner. routes/classes.js's GET /my filters
  // `getClasses({ created_by: profile?.id, ... })` with a strict `.eq`
  // (util/class-filters.js), so a class seeded without this is invisible on
  // My Classes for every profile, including the seeding admin. Left
  // optional (default null, matching the column's own nullable FK) so
  // existing callers that only ever hit /classes or /classes/:id (which
  // don't filter by owner) see no behavior change.
  createdBy = null,
  // Prefixed, not the bare literal "E2E Ability" -- see fixtures/character.js's
  // seedCharacter comment: class_id resolution for a submitted ability is
  // keyed by ability name ALONE, globally across the whole catalog, so an
  // unprefixed name collides across concurrently-running specs' fixture
  // classes under fullyParallel execution.
  abilities = [
    { name: `${prefix} E2E Ability`, description: 'Fixture ability' },
    { name: `${prefix} E2E Ability Two`, description: 'Fixture ability two' }
  ],
  gear = [],
  // { stat: points }, mirrors the classes.stat_spread column (migration
  // 20260609_classes_stat_spread) that routes/classes.js's parseStatSpread
  // populates from the class-form UI. Left as the column's own default
  // ({}) so existing callers see no behavior change. The character wizard
  // (public/js/character-wizard.js:718-719, populatePersonalitySelects)
  // requires >= 2 keys here before it will unlock the trait1/trait2
  // selects -- a caller driving the wizard must override this.
  statSpread = {}
} = {}) => {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .insert({
      name, rules_version: rulesVersion, is_public: isPublic, status, gear, abilities,
      created_by: createdBy, stat_spread: statSpread
    })
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
