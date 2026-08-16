const { supabase } = require('./_base');
const { getClasses, getClass, buildClassContentLookupMaps } = require('./class');
const { escapeLikePattern } = require('../util/validate');
const { statList } = require('../util/enclave-consts');
const { cloneInput } = require('../services/character/input');
const { CharacterService } = require('../services/character/service');
const characterRepository = require('../services/character/repository');

// Resolve the rules version a character should be rendered/validated against.
// Inherits from the linked class; falls back to 'v1' when no class is linked
// (preserves legacy behavior for old characters that predate class_id).
const effectiveRulesVersion = async (classId, client = supabase) => {
  if (!classId) return 'v1';
  try {
    const { data: cls } = await getClass(classId, client);
    return cls?.rules_version === 'v2' ? 'v2' : 'v1';
  } catch (_) {
    return 'v1';
  }
};

// This remains the database-facing part of class preparation. The pure input
// module receives the resulting rules version and never needs Supabase.
const resolveCharacterClassReference = async (input) => {
  const data = cloneInput(input);
  if (!data.class_id && data.class) {
    try {
      let lookup = await getClasses({ name: data.class });
      if (!lookup || !Array.isArray(lookup.data) || lookup.data.length === 0) {
        lookup = await getClasses({ name: data.class, is_public: true });
      }
      if (lookup && Array.isArray(lookup.data) && lookup.data.length > 0) data.class_id = lookup.data[0].id;
    } catch (_) {
      // Class lookup is intentionally non-fatal for the existing create/edit flow.
    }
  }
  if (data.class_id && !data.class) {
    try {
      const { data: cls } = await getClass(data.class_id);
      if (cls && cls.name) data.class = cls.name;
    } catch (_) {
      // Keep the submitted reference when a catalog lookup is unavailable.
    }
  }
  return data;
};

const findUpgradeTargetsFor = async (classId, client = supabase) => {
  if (!classId) return [];
  const { data, error } = await client
    .from('classes')
    .select('id, name, rules_edition, rules_version, base_class_id')
    .eq('base_class_id', classId)
    .order('rules_edition', { ascending: true })
    .order('rules_version', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return Array.isArray(data) ? data : [];
};

const getOwnCharacters = async (profile, client = supabase) => {
  const { data, error } = await client
    .from('characters')
    .select('*, linked_class:classes(rules_edition, rules_version)')
    .eq('creator_id', profile.id);
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return { data, error };
}

// Homepage feeds. These select only the columns the feed row renders — the
// homepage has six sections competing for one request, so none of them pull
// full character records.
const getRecentCharactersByCreator = async (profileId, { limit = 6 } = {}, client = supabase) => {
  const { data, error } = await client
    .from('characters')
    .select('id, name, class, level, updated_at')
    .eq('creator_id', profileId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
}

// hide_from_search is deliberately honored here as well as in search: opting out
// of discovery means opting out of the homepage too.
const getRecentPublicCharacters = async ({ limit = 6, excludeProfileId = null } = {}, client = supabase) => {
  let query = client
    .from('characters')
    .select('id, name, class, level, updated_at')
    .eq('is_public', true)
    .eq('hide_from_search', false);
  if (excludeProfileId) query = query.neq('creator_id', excludeProfileId);

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
}

const getPublicCharactersByCreator = async (creatorId) => {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, image_url, image_crop, is_deceased')
    .eq('creator_id', creatorId)
    .eq('is_public', true)
    .order('name', { ascending: true });
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error };
}

// Reads the primary character row through `client` (RLS-scoped by default,
// or an admin client when a caller explicitly passes one) but always reads
// its traits/gear/abilities/ability_perks through the repository's privileged
// helpers — mirrors the pre-refactor behavior, where those child reads always
// bypassed RLS regardless of the caller's client.
const getCharacter = async (id, client = supabase) => {
  const { data, error } = await client.from('characters').select('*').eq('id', id).single();
  if (error) {
    // PGRST116 is an expected "0 rows" not-found (mapped to 404 by util/http-error.js),
    // so don't log it; any other error code is unexpected and still logged.
    if (error.code !== 'PGRST116') console.error(error);
    return { data: null, error };
  }

  const { data: traits, error: traitsError } = await characterRepository.getCharacterTraits(id);
  if (traitsError) {
    console.error(traitsError);
    return { data: null, error: traitsError };
  }
  data.traits = traits.map(trait => trait.name);

  const { data: gear, error: gearError } = await characterRepository.getCharacterGear(id, client);
  if (gearError) {
    console.error(gearError);
    return { data: null, error: gearError };
  }
  data.gear = gear;

  const { data: abilities, error: abilitiesError } = await characterRepository.getCharacterAbilities(id, client);
  if (abilitiesError) {
    console.error(abilitiesError);
    return { data: null, error: abilitiesError };
  }
  data.abilities = abilities;

  const { data: abilityPerks, error: perksError } = await characterRepository.getCharacterAbilityPerks(id);
  if (perksError) {
    console.error(perksError);
    return { data: null, error: perksError };
  }
  data.ability_perks = abilityPerks;

  // Translate compounds_with UUIDs into "position-N" sentinels so the edit
  // form's dropdown (which keys options by position) pre-selects correctly.
  // The agent API serializer reads compounds_with from the same field, so
  // we only do this for the getCharacter call (used by the form path).
  // getCharacterForAgent uses its own fetch of character_perks via
  // getCharacterAbilityPerks, which preserves the UUID.
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

  return { data, error };
}

const getCharacterRecentMissions = async (characterId, limit = 5) => {
  const { data, error } = await supabase
    .from('mission_characters')
    .select(`
      mission_id,
      missions (
        id,
        name,
        date,
        outcome,
        is_public,
        creator_id
      )
    `)
    .eq('character_id', characterId)
    .order('missions(date)', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(error);
    return { data: null, error };
  }

  const filteredMissions = data.filter(mc => {
    if (mc.missions !== null) {
      return true;
    }
    return false;
  }).map(m => m.missions);

  return {
    data: filteredMissions,
    error
  };
};

const incrementMissionCount = async (characterId) => {
  const { data, error } = await supabase.rpc('increment_missions_count', { x: 1, character_id: characterId });
  return { data, error };
}

const getCharacterAllMissions = async (characterId) => {
  const { data, error } = await supabase
    .from('mission_characters')
    .select(`
      mission_id,
      missions (
        id,
        name,
        date,
        outcome,
        summary,
        is_public,
        creator_id
      )
    `)
    .eq('character_id', characterId)
    .order('missions(date)', { ascending: false });

  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return {
    data: data.map(mc => mc.missions),
    error
  };
};

// Lightweight read used by auto-calculate derivation: only the fields we need.
// Separate from getCharacterAllMissions because the latter selects display
// fields (name, date, summary, is_public, creator_id) we don't need here.
const getCharacterRealMissionsForDerivation = async (characterId, client = supabase) => {
  const { data, error } = await client
    .from('mission_characters')
    .select(`mission_id, missions ( id, outcome )`)
    .eq('character_id', characterId);

  if (error) {
    console.error(error);
    return { data: null, error };
  }

  return {
    data: (data || []).map(mc => mc.missions).filter(Boolean),
    error: null
  };
};

const searchPublicCharacters = async (q, count, options = {}) => {
  try {
    let query = supabase
      .from('characters')
      .select('id, name, image_url, class_id, class, is_deceased')
      .eq('is_public', true)
      .eq('hide_from_search', false)
      .limit(count);

    if (q && q.trim().length > 0) {
      query = query.ilike('name', `%${escapeLikePattern(q)}%`);
    }

    if (options.classId) {
      query = query.eq('class_id', options.classId);
    } else if (options.className) {
      query = query.eq('class', options.className);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return { data: null, error };
    }
    return { data, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
}

// Fetches the character rows for a virtual party (routes/party.js) or an LFG
// party. Deliberately applies NO is_public filter: the caller passes its
// request-scoped client, and the characters SELECT policies
// (characters_public_select OR characters_owner_admin_select) already resolve
// exactly "public, plus the ones you own" at the database. Filtering again in
// JS would drop the caller's own private characters, which the party tool
// specifically supports. Never pass supabaseAdmin here.
const getPartyCharacters = async (ids, client = supabase) => {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { data: [], error: null };
  }

  const { data, error } = await client
    .from('characters')
    .select(`id, name, image_url, class, class_id, is_deceased, is_public, ${statList.join(', ')}`)
    .in('id', ids);

  if (error) {
    console.error(error);
    return { data: null, error };
  }
  return { data, error: null };
};

const getRandomPublicCharacters = async (count = 12, options = {}) => {
  try {
    // Fetch a reasonably sized pool, then sample client-side for randomness
    const poolSize = Math.max(Math.min(count * 5, 100), count);
    let query = supabase
      .from('characters')
      .select('id, name, image_url, class_id, class, is_deceased')
      .eq('is_public', true)
      .eq('hide_from_search', false)
      .limit(poolSize);

    if (options.classId) {
      query = query.eq('class_id', options.classId);
    } else if (options.className) {
      query = query.eq('class', options.className);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      return { data: null, error };
    }

    if (!Array.isArray(data) || data.length <= count) {
      return { data, error: null };
    }

    // Reservoir sample
    const sampled = [];
    for (let i = 0; i < data.length; i++) {
      if (i < count) {
        sampled.push(data[i]);
      } else {
        const j = Math.floor(Math.random() * (i + 1));
        if (j < count) {
          sampled[j] = data[i];
        }
      }
    }
    return { data: sampled, error: null };
  } catch (error) {
    console.error(error);
    return { data: null, error };
  }
}
const serializeCharacterSummaryForAgent = (row) => ({
  id: row.id,
  name: row.name,
  class: row.class,
  level: row.level,
  is_public: !!row.is_public,
  is_deceased: !!row.is_deceased,
  owner_profile_id: row.creator_id || null,
  owner_name: row.owner_name || row.profile?.name || null
});

const serializeCharacterForAgent = (row, actor = {}) => {
  if (!row) return null;
  const isAdmin = actor.role === 'admin';
  const isOwner = !!actor.profileId && actor.profileId === row.creator_id;
  const visible = row.is_public === true || isOwner || isAdmin;
  if (!visible) return null;

  const stats = Object.fromEntries(statList.map((k) => [k, row[k] ?? null]));

  const out = {
    ...serializeCharacterSummaryForAgent(row),
    rules_version: row.rules_version === 'v2' ? 'v2' : 'v1',
    stats,
    traits: Array.isArray(row.personality) ? row.personality.map((t) => t.name) : [],
    abilities: Array.isArray(row.abilities)
      ? row.abilities.map((a) => ({ name: a.name, description: a.description }))
      : [],
    signature_gear: Array.isArray(row.gear)
      ? row.gear.map((g) => ({ name: g.name, description: g.description }))
      : []
  };

  if (out.rules_version === 'v2') {
    out.quirks = Array.isArray(row.quirks) ? row.quirks : [];
    out.accessories = Array.isArray(row.accessories) ? row.accessories : [];
    out.ability_perks = Array.isArray(row.ability_perks)
      ? row.ability_perks.map((p) => ({
          class_ability_id: p.class_ability_id,
          text: p.text,
          position: p.position,
          compounds_with: p.compounds_with || null
        }))
      : [];
  }

  return out;
};

const searchCharactersForAgent = async (query, actor = {}) => {
  const { data, error } = await characterRepository.searchCharactersForAgent(query, actor);
  if (error) return { data: null, error };

  const mapped = (data || []).map((row) =>
    serializeCharacterSummaryForAgent({ ...row, owner_name: row.profile?.name || null })
  );
  return { data: mapped, error: null };
};

const getCharacterForAgent = async (id, actor = {}) => {
  const { data, error } = await characterRepository.getCharacterForAgentRow(id);
  if (error) return { data: null, error };
  if (!data) return { data: null, error: null };

  const rulesVersion = await effectiveRulesVersion(data.class_id);
  if (rulesVersion === 'v2') {
    const { data: perks } = await characterRepository.getCharacterAbilityPerks(data.id);
    data.ability_perks = perks || [];
  }

  const serialized = serializeCharacterForAgent(
    { ...data, owner_name: data.profile?.name || null, rules_version: rulesVersion },
    actor
  );
  return { data: serialized, error: null };
};

// Application boundary: the repository owns every privileged (service-role)
// query for the character domain (services/character/repository.js). This
// service composes that repository with the RLS-agnostic model-local helpers
// (class-reference resolution, rules-version lookup, catalog maps, upgrade
// targets) that don't need the privileged client — routes and other models
// continue using this model's exported functions while the service owns
// validation, authorization, sequencing, and reconciliation decisions.
const characterService = new CharacterService({
  ...characterRepository,
  getRulesVersion: classId => effectiveRulesVersion(classId),
  resolveClassReference: resolveCharacterClassReference,
  getClassContentLookupMaps: buildClassContentLookupMaps,
  findUpgradeTargets: (classId, client) => findUpgradeTargetsFor(classId, client)
});

const createCharacter = (input, actor) => characterService.createCharacter(input, actor);
const updateCharacter = (id, input, actor) => characterService.updateCharacter(id, input, actor);

// Mutation capabilities. Signatures take `actor` (built by the caller via
// actorFromLocals/actorFromProfile/SYSTEM_ACTOR) first, matching the mission/
// class service seams; denials throw AuthorizationError.
const deleteCharacter = (actor, id) => characterService.deleteCharacter(actor, id);
const markCharacterDeceased = (actor, id, confirmName) => characterService.markDeceased(actor, id, confirmName);
const upgradeCharacterClass = (actor, id, targetClassId, client) => characterService.upgradeClass(actor, id, targetClassId, client);
const updateCharacterStats = (actor, id, fields) => characterService.updateStats(actor, id, fields);
const levelUpCharacter = (actor, id, body) => characterService.levelUp(actor, id, body);
const createCharacterOffscreenMission = (actor, characterId, body) => characterService.createOffscreenMission(actor, characterId, body);
const updateCharacterOffscreenMission = (actor, characterId, omId, body) => characterService.updateOffscreenMission(actor, characterId, omId, body);
const deleteCharacterOffscreenMission = (actor, characterId, omId) => characterService.deleteOffscreenMission(actor, characterId, omId);

module.exports = {
  getOwnCharacters,
  getCharacter,
  createCharacter,
  updateCharacter,
  incrementMissionCount,
  deleteCharacter,
  markCharacterDeceased,
  upgradeCharacterClass,
  updateCharacterStats,
  levelUpCharacter,
  createCharacterOffscreenMission,
  updateCharacterOffscreenMission,
  deleteCharacterOffscreenMission,
  findUpgradeTargetsFor,
  getCharacterRecentMissions,
  getCharacterAllMissions,
  getCharacterRealMissionsForDerivation,
  searchPublicCharacters,
  getPartyCharacters,
  getRandomPublicCharacters,
  getPublicCharactersByCreator,
  getRecentCharactersByCreator,
  getRecentPublicCharacters,
  serializeCharacterSummaryForAgent,
  serializeCharacterForAgent,
  searchCharactersForAgent,
  getCharacterForAgent,
  effectiveRulesVersion
};
