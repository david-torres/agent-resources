// Render-time gating for class ability/gear descriptions and the class-authored
// Default Enchantment on purchased gear. Extracted from the
// inline block that lived at routes/characters.js:863-939 so /characters/:id,
// the /characters/:id/details fragment, and (through it) /party and /lfg all
// enforce the same rule: names are always visible, descriptions require the
// item's class family to be unlocked for the viewer.
const { getLfgPost } = require('../../models/lfg');
const { getUnlockedClassIdsForUser } = require('../../models/class');

const blankDefaultEnchantment = (gear) => {
  if (gear.default_enchantment) {
    gear.default_enchantment = { ...gear.default_enchantment, description: '' };
  }
};

const blankAll = (character) => {
  try {
    if (Array.isArray(character.abilities)) {
      for (const ability of character.abilities) {
        if (ability) ability.description = '';
      }
    }
    if (Array.isArray(character.gear)) {
      for (const gear of character.gear) {
        if (gear) {
          gear.description = '';
          blankDefaultEnchantment(gear);
        }
      }
    }
  } catch (_) { /* ignore */ }
};

// Mutates class-authored descriptions on the character and returns it. Fails
// closed: any unexpected error blanks them rather than throwing.
const applyDescriptionGate = async ({ character, profile, userId = null, lfgPostId = null, client }) => {
  try {
    let hostingViaLfg = false;

    // If an LFG context is provided and the viewer hosts that post with this
    // character approved on it, allow full descriptions regardless of unlocks.
    if (profile && lfgPostId) {
      try {
        const { data: lfgPost } = await getLfgPost(lfgPostId, client);
        if (lfgPost && lfgPost.host_id === profile.id) {
          hostingViaLfg = Array.isArray(lfgPost.join_requests) && lfgPost.join_requests.some(r =>
            r && r.status === 'approved' && r.character && r.character.id === character.id
          );
        }
      } catch (_) { /* ignore; hostingViaLfg remains false */ }
    }

    if (!hostingViaLfg) {
      let unlockedClassIds = new Set();
      try {
        // Admin-backed lookup on purpose: the shared anon client no longer
        // carries the user's JWT, so RLS on class_unlocks would return zero
        // rows and wipe every description.
        const { data: ids, error } = await getUnlockedClassIdsForUser(userId || (profile && profile.user_id) || null);
        if (!error && ids instanceof Set) unlockedClassIds = ids;
      } catch (_) {
        unlockedClassIds = new Set();
      }

      if (Array.isArray(character.abilities)) {
        for (const ability of character.abilities) {
          if (ability && (
            (ability.class_id && !unlockedClassIds.has(ability.class_id)) ||
            (!ability.class_id && !profile)
          )) {
            ability.description = '';
          }
        }
      }
      if (Array.isArray(character.gear)) {
        for (const gear of character.gear) {
          if (!gear) continue;
          if (
            (gear.class_id && !unlockedClassIds.has(gear.class_id)) ||
            (!gear.class_id && !profile)
          ) {
            gear.description = '';
          }
          // A Default Enchantment comes from the class book, even if the
          // purchase row has no class_id. Without one, access cannot be proven.
          if (!gear.class_id || !unlockedClassIds.has(gear.class_id)) {
            blankDefaultEnchantment(gear);
          }
        }
      }
    }
  } catch (_) {
    blankAll(character);
  }
  return character;
};

module.exports = { applyDescriptionGate };
