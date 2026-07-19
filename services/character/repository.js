const { supabase, supabaseAdmin } = require('../../models/_base');
const {
  listOffscreenMissions: listOffscreenMissionsForCharacter,
  createOffscreenMission,
  getAvailableHostedMissionsForPicker
} = require('../../models/offscreen-mission');
const { createMission, addCharacterToMission } = require('../../models/mission');
const { SYSTEM_ACTOR } = require('../../util/actor');
const { escapeLikePattern } = require('../../util/validate');
const { statList } = require('../../util/enclave-consts');

// The only consumer of supabaseAdmin for the character domain. Holds every
// privileged (service-role) query verbatim; models/character.js keeps
// `getCharacter` (used by both admin AND RLS callers) and the surrounding
// derivation/serialization logic. Repository methods never throw — they
// resolve to { data, error } (or { error } for write-only calls).

// --- trait/gear/ability/perk read helpers -----------------------------
// These always read through supabaseAdmin regardless of the `client` param
// (mirrors the pre-refactor behavior in models/character.js): only the
// secondary, non-fatal "classes" catalog lookup honors the caller's client.

const getCharacterTraits = async (id) => {
  const { data, error } = await supabaseAdmin.from('traits').select('*').eq('character_id', id);
  return { data, error };
};

const getCharacterGear = async (id, client = supabase) => {
  const { data: gear, error: gearError } = await supabaseAdmin
    .from('class_gear')
    .select('*')
    .eq('character_id', id);
  if (gearError) {
    return { data: null, error: gearError };
  }

  if (!Array.isArray(gear) || gear.length === 0) {
    return { data: [], error: null };
  }

  const classIds = [...new Set(gear.map(g => g.class_id).filter(Boolean))];
  if (classIds.length === 0) {
    return { data: gear, error: null };
  }
  const { data: classes, error: classesError } = await client
    .from('classes')
    .select('id, name, gear')
    .in('id', classIds);
  if (classesError) {
    return { data: gear, error: null };
  }

  const mergedGear = gear.map(item => {
    const cls = classes?.find(c => c.id === item.class_id);
    const classGear = Array.isArray(cls?.gear)
      ? cls.gear.find(g => g && g.name === item.name)
      : null;

    if (classGear) {
      return { ...classGear, ...item };
    }
    return item;
  });

  return { data: mergedGear, error: null };
};

const getCharacterAbilities = async (id, client = supabase) => {
  const { data: abilities, error: abilitiesError } = await supabaseAdmin
    .from('class_abilities')
    .select('*')
    .eq('character_id', id);

  if (abilitiesError) {
    return { data: null, error: abilitiesError };
  }

  if (!abilities || abilities.length === 0) {
    return { data: [], error: null };
  }

  const classIds = [...new Set(abilities.map(ability => ability.class_id).filter(Boolean))];
  if (classIds.length === 0) {
    return { data: abilities, error: null };
  }

  const { data: classes, error: classesError } = await client
    .from('classes')
    .select('id, name, abilities')
    .in('id', classIds);

  if (classesError) {
    return { data: abilities, error: null };
  }

  const mergedAbilities = abilities.map(ability => {
    const cls = classes.find(c => c.id === ability.class_id);
    const classAbility = Array.isArray(cls?.abilities)
      ? cls.abilities.find(a => a && a.name === ability.name)
      : null;

    if (classAbility) {
      return { ...classAbility, ...ability };
    }

    return ability;
  });

  return { data: mergedAbilities, error: null };
};

const getCharacterAbilityPerks = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('character_perks')
    .select('*')
    .eq('character_id', id)
    .order('position', { ascending: true });
  if (error) return { data: null, error };
  return { data: Array.isArray(data) ? data : [], error: null };
};

// Self-contained, admin-only equivalent of models/character.js#getCharacter.
// Can't call that model function directly (circular require: models/character
// requires this repository), so it duplicates the same read-and-attach
// sequence, always via supabaseAdmin. Used as the CharacterService adapter's
// `getCharacter` — the privileged ownership+data probe shared by every
// mutation capability (delete/markDeceased/updateStats/levelUp/updateCharacter).
const getCharacterAdmin = async (id) => {
  const { data, error } = await supabaseAdmin.from('characters').select('*').eq('id', id).single();
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  const { data: traits, error: traitsError } = await getCharacterTraits(id);
  if (traitsError) return { data: null, error: traitsError };
  data.traits = traits.map(trait => trait.name);

  const { data: gear, error: gearError } = await getCharacterGear(id, supabaseAdmin);
  if (gearError) return { data: null, error: gearError };
  data.gear = gear;

  const { data: abilities, error: abilitiesError } = await getCharacterAbilities(id, supabaseAdmin);
  if (abilitiesError) return { data: null, error: abilitiesError };
  data.abilities = abilities;

  const { data: abilityPerks, error: perksError } = await getCharacterAbilityPerks(id);
  if (perksError) return { data: null, error: perksError };
  data.ability_perks = abilityPerks;

  if (Array.isArray(data.ability_perks) && data.ability_perks.length > 0) {
    const byId = new Map(data.ability_perks.map(p => [p.id, p]));
    for (const p of data.ability_perks) {
      if (!p.compounds_with) continue;
      const target = byId.get(p.compounds_with);
      if (target && target.class_ability_id === p.class_ability_id) {
        p.compounds_with = `position-${target.position}`;
      } else {
        p.compounds_with = null;
      }
    }
  }

  return { data, error: null };
};

// Duplicate (admin-hardcoded) of models/character.js#getCharacterRealMissionsForDerivation —
// same circular-require reasoning as getCharacterAdmin above.
const getRealMissions = async (characterId) => {
  const { data, error } = await supabaseAdmin
    .from('mission_characters')
    .select(`mission_id, missions ( id, outcome )`)
    .eq('character_id', characterId);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data: (data || []).map(mc => mc.missions).filter(Boolean), error: null };
};

const getClassRulesVersion = async (classId) => {
  if (!classId) return { data: 'v1', error: null };
  try {
    const { data, error } = await supabaseAdmin.from('classes').select('rules_version').eq('id', classId).maybeSingle();
    if (error || !data) return { data: 'v1', error: null };
    return { data: data.rules_version === 'v2' ? 'v2' : 'v1', error: null };
  } catch (_) {
    return { data: 'v1', error: null };
  }
};

const searchCharactersForAgent = async (query, actor = {}) => {
  const q = typeof query === 'string' ? query.trim() : '';
  let builder = supabaseAdmin
    .from('characters')
    .select('id, name, class, level, is_public, is_deceased, creator_id, profile:creator_id(name)')
    .order('name', { ascending: true })
    .limit(10);

  if (actor.role !== 'admin') {
    if (actor.profileId) {
      builder = builder.or(`is_public.eq.true,creator_id.eq.${actor.profileId}`);
    } else {
      builder = builder.eq('is_public', true);
    }
  }

  if (q.length > 0) {
    const escaped = escapeLikePattern(q);
    builder = builder.ilike('name', `%${escaped}%`);
  } else if (actor.profileId) {
    builder = builder.eq('creator_id', actor.profileId).order('updated_at', { ascending: false });
  } else {
    return { data: [], error: null };
  }

  return builder;
};

const getCharacterForAgentRow = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('characters')
    .select(`
      id, name, class, class_id, level, is_public, is_deceased, creator_id,
      ${statList.join(',')},
      profile:creator_id(name),
      personality:traits(name),
      abilities:class_abilities(name,description),
      gear:class_gear(name,description)
    `)
    .eq('id', id)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') return { data: null, error };
  return { data: data || null, error: null };
};

module.exports = {
  // Verbatim from the former inline adapter in models/character.js. (Two
  // adapter entries — getRulesVersion, resolveClassReference, and
  // getClassContentLookupMaps — don't touch supabaseAdmin and stay composed
  // directly in models/character.js to avoid a circular require back into
  // this file.)
  getCharacter: id => getCharacterAdmin(id),
  createCharacterRow: input => supabaseAdmin.from('characters').insert(input).select(),
  updateCharacterRow: (id, input, actor) => supabaseAdmin
    .from('characters')
    .update(input)
    .eq('id', id)
    .eq('creator_id', actor.id)
    .select(),
  ...(typeof supabaseAdmin.rpc === 'function' ? {
    saveCharacterAtomic: async ({ characterId, creatorId, character, traits, gear, abilities, perks }) => {
      const { data, error } = await supabaseAdmin.rpc('save_character_atomic', {
        p_character_id: characterId,
        p_creator_id: creatorId,
        p_character: character,
        p_traits: traits,
        p_gear: gear,
        p_abilities: abilities,
        p_perks: perks
      });
      return { data, error };
    }
  } : {}),
  getChildRows: (table, characterId) => supabaseAdmin
    .from(table)
    .select('*')
    .eq('character_id', characterId),
  insertChildRows: (table, characterId, rows) => supabaseAdmin
    .from(table)
    .insert(rows.map(row => ({ character_id: characterId, ...row }))),
  updateChildRow: (table, rowId, changes) => supabaseAdmin
    .from(table)
    .update(changes)
    .eq('id', rowId),
  deleteChildRows: (table, characterId, rowIds) => supabaseAdmin
    .from(table)
    .delete()
    .in('id', rowIds)
    .eq('character_id', characterId),
  getRealMissions,
  listOffscreenMissions: id => listOffscreenMissionsForCharacter({ characterId: id, supabase: supabaseAdmin }),

  // Trait/gear/ability/perk read helpers (used by models/character.js#getCharacter
  // and #getCharacterForAgent, both of which stay in the model as RLS-capable
  // multi-purpose readers).
  getCharacterTraits,
  getCharacterGear,
  getCharacterAbilities,
  getCharacterAbilityPerks,

  // Agent-search reads.
  searchCharactersForAgent,
  getCharacterForAgentRow,

  // Ownership probe (lean projection) — used by upgradeClass, matching the
  // pre-refactor inline admin select in models/character.js#upgradeCharacterClass.
  fetchCharacterOwnership: (id) => supabaseAdmin
    .from('characters')
    .select('id, creator_id, class_id')
    .eq('id', id)
    .maybeSingle(),

  // Mutation primitives for the policy-gated service capabilities. Each keeps
  // the `.eq('creator_id', creatorId)` SQL filter as defense in depth — the
  // caller passes the *loaded row's* creator_id (not necessarily the acting
  // actor's profileId) so admin/system mutations of another user's character
  // still match a row.
  deleteCharacter: ({ id, creatorId }) => supabaseAdmin
    .from('characters')
    .delete()
    .eq('id', id)
    .eq('creator_id', creatorId),
  setDeceased: async ({ id, creatorId }) => {
    const { data, error } = await supabaseAdmin
      .from('characters')
      .update({ is_deceased: true })
      .eq('id', id)
      .eq('creator_id', creatorId)
      .select();
    if (error) console.error(error);
    return { data, error };
  },
  updateClass: async ({ id, creatorId, classId, className }) => {
    const { data, error } = await supabaseAdmin
      .from('characters')
      .update({ class_id: classId, class: className })
      .eq('id', id)
      .eq('creator_id', creatorId)
      .select();
    if (error) console.error(error);
    return { data, error };
  },
  updateOwnedFields: async ({ id, creatorId, fields }) => {
    const { data, error } = await supabaseAdmin
      .from('characters')
      .update(fields)
      .eq('id', id)
      .eq('creator_id', creatorId)
      .select()
      .single();
    return { data, error };
  },
  getClassRulesVersion,

  // Perk-append primitives (level-up flow).
  fetchAllowedAbilityIds: async (characterId) => {
    const { data, error } = await supabaseAdmin.from('class_abilities').select('id').eq('character_id', characterId);
    return { data, error };
  },
  fetchExistingPerks: async (characterId) => {
    const { data, error } = await supabaseAdmin
      .from('character_perks')
      .select('id, class_ability_id, text, position')
      .eq('character_id', characterId);
    return { data, error };
  },
  insertPerks: async (rows) => {
    const { error } = await supabaseAdmin.from('character_perks').insert(rows);
    return { error };
  },
  updatePerkLinks: async (updates) => {
    for (const u of updates) {
      const { error } = await supabaseAdmin.from('character_perks').update({ compounds_with: u.compounds_with }).eq('id', u.id);
      if (error) return { error };
    }
    return { error: null };
  },

  // Level-up backfill/credit-spend writes — internal, non-user-triggered
  // mission creation via SYSTEM_ACTOR (see util/actor.js), so the mission
  // service's addCharacter authorization gate can't reject this internal
  // link. creator_id is still set explicitly so the mission shows up under
  // the user's own missions.
  createBackfillMission: async ({ characterId, name, profileId }) => {
    const { data: missionRows, error: missionError } = await createMission(SYSTEM_ACTOR, {
      name,
      date: new Date().toISOString(),
      outcome: 'success',
      is_public: false,
      creator_id: profileId
    });
    if (missionError) return { error: missionError };
    const mission = Array.isArray(missionRows) ? missionRows[0] : missionRows;
    if (!mission) return { error: { status: 400, message: 'Mission creation returned no rows' } };
    // addCharacterToMission can THROW (MissionService.addCharacter calls
    // requireEditable, which throws on a repo error re-reading the mission's
    // permission row, or on a not-found). SYSTEM_ACTOR always passes the
    // authorization check itself, so those are the only two throw paths left
    // reachable here. Catch and return as a normal { error } so a denied/
    // not-found mission surfaces as a graceful response instead of an
    // unhandled rejection.
    try {
      const { error: linkError } = await addCharacterToMission(SYSTEM_ACTOR, mission.id, characterId);
      return { error: linkError || null };
    } catch (error) {
      return { error };
    }
  },
  getAvailableHostedMissions: (profileId) => getAvailableHostedMissionsForPicker({ profileId, supabase: supabaseAdmin }),
  createOffscreenMissionRow: ({ characterId, profileId, payload }) => createOffscreenMission({
    characterId, profileId, payload, supabase: supabaseAdmin
  })
};
