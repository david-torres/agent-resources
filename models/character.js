const { supabase, supabaseAdmin } = require('./_base');
const { getClasses, getClass, buildClassContentLookupMaps } = require('./class');
const { escapeLikePattern } = require('../util/validate');
const { statList } = require('../util/enclave-consts');
const { listOffscreenMissions } = require('./offscreen-mission');
const { cloneInput } = require('../services/character/input');
const { CharacterService } = require('../services/character/service');

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

const getCharacter = async (id, client = supabase) => {
  const { data, error } = await client.from('characters').select('*').eq('id', id).single();
  if (error) {
    console.error(error);
    return { data: null, error };
  }

  const { data: traits, error: traitsError } = await getCharacterTraits(id);
  if (traitsError) {
    console.error(traitsError);
    return { data: null, error: traitsError };
  }
  data.traits = traits.map(trait => trait.name);

  const { data: gear, error: gearError } = await getCharacterGear(id, client);
  if (gearError) {
    console.error(gearError);
    return { data: null, error: gearError };
  }
  data.gear = gear;

  const { data: abilities, error: abilitiesError } = await getCharacterAbilities(id, client);
  if (abilitiesError) {
    console.error(abilitiesError);
    return { data: null, error: abilitiesError };
  }
  data.abilities = abilities;

  const { data: abilityPerks, error: perksError } = await getCharacterAbilityPerks(id);
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

const deleteCharacter = async (id, profile) => {
  // Admin read for the ownership probe — see updateCharacter for the same
  // reasoning. The creator_id JS check + .eq() filter still enforce authz.
  const { data: characterData, error: characterError } = await getCharacter(id, supabaseAdmin);
  if (characterError) return { data: null, error: characterError };
  if (characterData.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  // authz: creator_id check above + filter below
  const { data, error } = await supabaseAdmin.from('characters').delete().eq('id', id).eq('creator_id', profile.id);
  return { data, error };
}

// helpers

const getCharacterTraits = async (id) => {
  const { data, error } = await supabaseAdmin.from('traits').select('*').eq('character_id', id);
  return { data, error };
}

const getCharacterGear = async (id, client = supabase) => {
  // Fetch character gear rows
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

  // Fetch related class definitions (non-fatal)
  const classIds = [...new Set(gear.map(g => g.class_id).filter(Boolean))];
  if (classIds.length === 0) {
    return { data: gear, error: null };
  }
  const { data: classes, error: classesError } = await client
    .from('classes')
    .select('id, name, gear')
    .in('id', classIds);
  if (classesError) {
    // Fallback: return raw gear rows as-is
    return { data: gear, error: null };
  }

  // Merge class gear definition values directly onto each character gear row
  const mergedGear = gear.map(item => {
    const cls = classes?.find(c => c.id === item.class_id);
    const classGear = Array.isArray(cls?.gear)
      ? cls.gear.find(g => g && g.name === item.name)
      : null;

    if (classGear) {
      // Prefer existing row values when overlapping keys exist
      return { ...classGear, ...item };
    }
    return item;
  });

  return { data: mergedGear, error: null };
}

const getCharacterAbilities = async (id, client = supabase) => {
  // First get the character abilities
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

  // Get unique class IDs
  const classIds = [...new Set(abilities.map(ability => ability.class_id).filter(Boolean))];
  if (classIds.length === 0) {
    return { data: abilities, error: null };
  }
  
  // Get classes with their abilities JSONB (non-fatal)
  const { data: classes, error: classesError } = await client
    .from('classes')
    .select('id, name, abilities')
    .in('id', classIds);

  if (classesError) {
    // Fallback: return raw ability rows as-is
    return { data: abilities, error: null };
  }

  // Merge class ability definition values directly onto each character ability
  const mergedAbilities = abilities.map(ability => {
    const cls = classes.find(c => c.id === ability.class_id);
    const classAbility = Array.isArray(cls?.abilities)
      ? cls.abilities.find(a => a && a.name === ability.name)
      : null;

    if (classAbility) {
      // Prefer existing ability row values when overlapping keys exist
      return { ...classAbility, ...ability };
    }

    return ability;
  });

  return { data: mergedAbilities, error: null };
}

const getCharacterAbilityPerks = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('character_perks')
    .select('*')
    .eq('character_id', id)
    .order('position', { ascending: true });
  if (error) return { data: null, error };
  return { data: Array.isArray(data) ? data : [], error: null };
};

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

const markCharacterDeceased = async (id, profile) => {
  // Admin read for the ownership probe — see updateCharacter for the same
  // reasoning. The creator_id JS check + .eq() filter still enforce authz.
  const { data: characterData, error: characterError } = await getCharacter(id, supabaseAdmin);
  if (characterError) return { data: null, error: characterError };
  if (characterData.creator_id != profile.id) return { data: null, error: 'Unauthorized' };
  if (characterData.is_deceased) return { data: null, error: 'Character is already deceased' };

  // authz: creator_id check above + filter below
  const { data, error } = await supabaseAdmin
    .from('characters')
    .update({ is_deceased: true })
    .eq('id', id)
    .eq('creator_id', profile.id)
    .select();

  if (error) {
    console.error(error);
    return { data: null, error };
  }
  if (!data || data.length === 0) {
    return { data: null, error: 'Character update returned no rows' };
  }

  return { data: data[0], error: null };
};

const upgradeCharacterClass = async (id, targetClassId, profile, client = supabase) => {
  // Lean admin-client read of just what we need from the character. The default
  // anon `supabase` would RLS-strip private characters, so we use admin here;
  // ownership is enforced by the creator_id check below + the UPDATE's
  // .eq('creator_id', profile.id) filter.
  const { data: characterData, error: characterError } = await supabaseAdmin
    .from('characters')
    .select('id, creator_id, class_id')
    .eq('id', id)
    .maybeSingle();
  if (characterError) return { data: null, error: characterError };
  if (!characterData) return { data: null, error: 'Character not found' };
  if (characterData.creator_id != profile.id) return { data: null, error: 'Unauthorized' };
  if (!targetClassId) return { data: null, error: 'Missing target class id' };

  // Target-class lookup uses the per-request client so RLS gates which
  // candidates the caller can pick: admins see private forks, non-admins
  // see only public ones. This prevents non-admins from upgrading into an
  // unreleased private v2 by guessing its id.
  const candidates = await findUpgradeTargetsFor(characterData.class_id, client);
  const target = candidates.find(c => c.id === targetClassId);
  if (!target) return { data: null, error: 'Target class is not a valid upgrade for this character' };

  const { data, error } = await supabaseAdmin
    .from('characters')
    .update({ class_id: target.id, class: target.name })
    .eq('id', id)
    .eq('creator_id', profile.id)
    .select();
  if (error) {
    console.error(error);
    return { data: null, error };
  }
  if (!data || data.length === 0) {
    return { data: null, error: 'Character upgrade returned no rows' };
  }
  return { data: data[0], error: null };
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

  const { data, error } = await builder;
  if (error) return { data: null, error };

  const mapped = (data || []).map((row) =>
    serializeCharacterSummaryForAgent({ ...row, owner_name: row.profile?.name || null })
  );
  return { data: mapped, error: null };
};

const getCharacterForAgent = async (id, actor = {}) => {
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
  if (!data) return { data: null, error: null };

  const rulesVersion = await effectiveRulesVersion(data.class_id);
  if (rulesVersion === 'v2') {
    const { data: perks } = await getCharacterAbilityPerks(data.id);
    data.ability_perks = perks || [];
  }

  const serialized = serializeCharacterForAgent(
    { ...data, owner_name: data.profile?.name || null, rules_version: rulesVersion },
    actor
  );
  return { data: serialized, error: null };
};

// Compatibility adapter: routes and importers continue using this model's
// public functions while the service owns write orchestration. The adapter can
// be replaced by an RPC-backed implementation without changing those callers.
const characterService = new CharacterService({
  getRulesVersion: classId => effectiveRulesVersion(classId),
  resolveClassReference: resolveCharacterClassReference,
  getCharacter: id => getCharacter(id, supabaseAdmin),
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
  getClassContentLookupMaps: buildClassContentLookupMaps,
  getRealMissions: id => getCharacterRealMissionsForDerivation(id, supabaseAdmin),
  listOffscreenMissions: id => listOffscreenMissions({ characterId: id, supabase: supabaseAdmin })
});

const createCharacter = (input, actor) => characterService.createCharacter(input, actor);
const updateCharacter = (id, input, actor) => characterService.updateCharacter(id, input, actor);

module.exports = {
  getOwnCharacters,
  getCharacter,
  createCharacter,
  updateCharacter,
  incrementMissionCount,
  deleteCharacter,
  markCharacterDeceased,
  upgradeCharacterClass,
  findUpgradeTargetsFor,
  getCharacterRecentMissions,
  getCharacterAllMissions,
  getCharacterRealMissionsForDerivation,
  searchPublicCharacters,
  getRandomPublicCharacters,
  getPublicCharactersByCreator,
  serializeCharacterSummaryForAgent,
  serializeCharacterForAgent,
  searchCharactersForAgent,
  getCharacterForAgent,
  effectiveRulesVersion
};
