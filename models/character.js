const { supabase, supabaseAdmin } = require('./_base');
const { getClasses, getClass, buildClassContentLookupMaps } = require('./class');
const { sanitizeUrlFields } = require('../util/url');
const { escapeLikePattern, validateAbilityPerks } = require('../util/validate');
const { statList } = require('../util/enclave-consts');
const { deriveCharacterTotals } = require('../util/character-derived');
const { remapPerkAbilityIds } = require('../util/ability-perks');
const { diffChildRows, resolveCompoundLinks } = require('../util/reconcile');
const { listOffscreenMissions } = require('./offscreen-mission');

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

const createCharacter = async (characterReq, profile) => {
  characterReq.creator_id = profile.id;

  const v2OnlyFields = ['quirks', 'accessories', 'ability_perks'];
  const linkedVersion = await effectiveRulesVersion(characterReq.class_id);
  if (linkedVersion !== 'v2') {
    for (const k of v2OnlyFields) delete characterReq[k];
  }

  // Ensure class_id is populated from the class name when missing
  if (!characterReq.class_id && characterReq.class) {
    try {
      let lookup = await getClasses({ name: characterReq.class });
      if ((!lookup || !Array.isArray(lookup.data) || lookup.data.length === 0)) {
        lookup = await getClasses({ name: characterReq.class, is_public: true });
      }
      if (lookup && Array.isArray(lookup.data) && lookup.data.length > 0) {
        characterReq.class_id = lookup.data[0].id;
      }
    } catch (_) {
      // Non-fatal: if lookup fails, proceed without blocking character creation
    }
  }

  // Ensure class name is populated from class_id when missing
  if (characterReq.class_id && !characterReq.class) {
    try {
      const { data: cls } = await getClass(characterReq.class_id);
      if (cls && cls.name) {
        characterReq.class = cls.name;
      }
    } catch (_) {
      // ignore
    }
  }

  // handle personality traits
  const traitFields = [characterReq.trait0, characterReq.trait1, characterReq.trait2];
  ['trait0', 'trait1', 'trait2'].forEach(trait => delete characterReq[trait]);
  
  // Extract v2 ability_perks before insert; we persist them after the row exists.
  const abilityPerks = characterReq.ability_perks;
  delete characterReq.ability_perks;

  if (linkedVersion === 'v2') {
    const v = validateAbilityPerks(normalizeAbilityPerks(abilityPerks));
    if (!v.ok) {
      return { data: null, error: v.errors.join(' ') };
    }
  }

  // handle class gear
  const classGear = characterReq.gear;
  delete characterReq.gear;

  // handle class abilities
  const classAbilities = characterReq.abilities;
  delete characterReq.abilities;

  // handle common items - normalize to array of non-empty strings
  if (characterReq.common_items) {
    const items = Array.isArray(characterReq.common_items)
      ? characterReq.common_items
      : [characterReq.common_items];
    characterReq.common_items = items
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => item.length > 0);
  } else {
    characterReq.common_items = [];
  }

  // handle is_public
  if (characterReq.is_public == 'on') {
    characterReq.is_public = true;
  } else {
    characterReq.is_public = false;
  }

  // handle hide_from_search
  if (characterReq.hide_from_search == 'on') {
    characterReq.hide_from_search = true;
  } else {
    characterReq.hide_from_search = false;
  }

  // normalize v2 JSONB fields before insert
  if (linkedVersion === 'v2') {
    characterReq.quirks = normalizeNamedJsonbList(characterReq.quirks);
    characterReq.accessories = normalizeNamedJsonbList(characterReq.accessories);
  }

  // sanitize URL fields before insert
  sanitizeUrlFields(characterReq, ['image_url']);

  // create character (authz: creator_id is set server-side to profile.id above)
  const { data, error } = await supabaseAdmin.from('characters').insert(characterReq).select();
  if (error) {
    console.error(error);
    return { data, error };
  }
  if (!data || data.length === 0) {
    return { data: null, error: 'Character creation returned no rows' };
  }
  const character = data[0];

  // set personality traits
  const { data: traitsSet, error: traitsSetError } = await setCharacterTraits(character.id, traitFields);
  if (traitsSetError) {
    console.error(traitsSetError);
    return { data: null, error: traitsSetError };
  }

  // set class gear
  if (classGear) {
    const { data: gearSet, error: gearSetError } = await setCharacterGear(
      character.id,
      classGear
    );
    if (gearSetError) {
      console.error(gearSetError);
      return { data: null, error: gearSetError };
    }
  }

  // set class abilities
  if (classAbilities) {
    const { data: abilitiesSet, error: abilitiesSetError } = await setCharacterAbilities(character.id, classAbilities);
    if (abilitiesSetError) {
      console.error(abilitiesSetError);
      return { data: null, error: abilitiesSetError };
    }
  }

  if (linkedVersion === 'v2') {
    const { error: perksError } = await setCharacterPerks(character.id, abilityPerks);
    if (perksError) {
      return { data: null, error: perksError };
    }
  }

  return { data: character, error };
}

const updateCharacter = async (id, characterReq, profile) => {
  // Use admin to read for the ownership probe: the anon client can't see
  // private rows under RLS, which would 404 a user trying to edit their own
  // private character (PGRST116). Authz is enforced by the creator_id check
  // immediately below + the .eq('creator_id', ...) filter on the UPDATE.
  const { data: characterData, error: characterError } = await getCharacter(id, supabaseAdmin);
  if (characterError) return { data: null, error: characterError };
  if (characterData.creator_id != profile.id) return { data: null, error: 'Unauthorized' };

  const v2OnlyFields = ['quirks', 'accessories', 'ability_perks'];
  // Pre-normalization strip: remove v2-only fields early if the submitted class_id
  // is already non-v2. linkedVersion is recomputed below after class_id is finalized.
  let linkedVersion = await effectiveRulesVersion(characterReq.class_id);
  if (linkedVersion !== 'v2') {
    for (const k of v2OnlyFields) delete characterReq[k];
  }

  // Ensure class_id is populated from the class name when missing or when class changed
  if (!characterReq.class_id && characterReq.class) {
    try {
      let lookup = await getClasses({ name: characterReq.class });
      if ((!lookup || !Array.isArray(lookup.data) || lookup.data.length === 0)) {
        lookup = await getClasses({ name: characterReq.class, is_public: true });
      }
      if (lookup && Array.isArray(lookup.data) && lookup.data.length > 0) {
        characterReq.class_id = lookup.data[0].id;
      }
    } catch (_) {
      // Non-fatal: if lookup fails, proceed with remaining updates
    }
  }

  // Ensure class name is populated from class_id when missing
  if (characterReq.class_id && !characterReq.class) {
    try {
      const { data: cls } = await getClass(characterReq.class_id);
      if (cls && cls.name) {
        characterReq.class = cls.name;
      }
    } catch (_) {
      // ignore
    }
  }

  // Recompute linkedVersion now that class_id is fully resolved — the name→id
  // lookup above can change class_id, which changes the effective rules version.
  linkedVersion = await effectiveRulesVersion(characterReq.class_id);

  // handle personality traits
  const traitFields = [characterReq.trait0, characterReq.trait1, characterReq.trait2];
  ['trait0', 'trait1', 'trait2'].forEach(trait => delete characterReq[trait]);
  delete characterData.traits;

  // Extract v2 ability_perks before update; we persist them after the row exists.
  const abilityPerks = characterReq.ability_perks;
  delete characterReq.ability_perks;

  if (linkedVersion === 'v2') {
    const v = validateAbilityPerks(normalizeAbilityPerks(abilityPerks));
    if (!v.ok) {
      return { data: null, error: v.errors.join(' ') };
    }
  }

  // handle class gear
  const classGear = characterReq.gear;
  delete characterReq.gear;
  delete characterData.gear;

  // handle class abilities
  const classAbilities = characterReq.abilities;
  // Snapshot existing ability rows: setCharacterAbilities replaces them with
  // fresh UUIDs, but submitted ability_perks reference the old row ids (the
  // form bakes them into hidden inputs at render time). We remap old→new by
  // name+class_id below before persisting perks.
  const previousAbilities = Array.isArray(characterData.abilities) ? characterData.abilities : [];
  delete characterReq.abilities;
  delete characterData.abilities;

  // handle common items - normalize to array of non-empty strings
  if (characterReq.common_items) {
    const items = Array.isArray(characterReq.common_items)
      ? characterReq.common_items
      : [characterReq.common_items];
    characterReq.common_items = items
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => item.length > 0);
  } else {
    characterReq.common_items = [];
  }

  // handle is_public
  if (characterReq.is_public == 'on') {
    characterReq.is_public = true;
  } else {
    characterReq.is_public = false;
  }

  // handle hide_from_search
  if (characterReq.hide_from_search == 'on') {
    characterReq.hide_from_search = true;
  } else {
    characterReq.hide_from_search = false;
  }

  // handle auto_calculate
  characterReq.auto_calculate = characterReq.auto_calculate === 'on' || characterReq.auto_calculate === true;

  // Auto-calculate: when enabled, recompute level/completed_missions/commissary_reward
  // from the submitted in-flight payload (gear, common_items, class_id) and the
  // character's mission history. Server is authoritative — submitted values for
  // these three fields are ignored when the flag is on.
  if (characterReq.auto_calculate) {
    // Resolve gear strings ("ClassName::GearName") to objects with class_id so
    // on-class/off-class classification matches the persisted shape.
    const submittedGear = Array.isArray(classGear) ? classGear : (classGear ? [classGear] : []);
    let resolvedGear = [];
    if (submittedGear.length > 0) {
      const { gearNameToClassId } = await buildClassContentLookupMaps();
      resolvedGear = submittedGear
        .map(item => {
          if (!item) return null;
          if (typeof item === 'string') {
            const trimmed = item.trim();
            if (!trimmed) return null;
            const name = trimmed.includes('::') ? trimmed.split('::')[1].trim() : trimmed;
            return name ? { name, class_id: gearNameToClassId.get(name) || null } : null;
          }
          if (typeof item === 'object' && item.name) {
            return { name: item.name, class_id: item.class_id || gearNameToClassId.get(item.name) || null };
          }
          return null;
        })
        .filter(Boolean);
    }

    const [missionsRes, offscreenRes] = await Promise.all([
      getCharacterRealMissionsForDerivation(id, supabaseAdmin),
      listOffscreenMissions({ characterId: id, supabase: supabaseAdmin })
    ]);
    if (missionsRes.error || offscreenRes.error) {
      return { data: null, error: missionsRes.error || offscreenRes.error };
    }
    const realMissions = missionsRes.data || [];
    const offscreenMissions = offscreenRes.data || [];

    const derived = deriveCharacterTotals({
      character: {
        class_id: characterReq.class_id,
        gear: resolvedGear,
        common_items: characterReq.common_items
      },
      realMissions: realMissions || [],
      offscreenMissions: offscreenMissions || [],
      rulesVersion: linkedVersion
    });

    characterReq.level = derived.level;
    characterReq.completed_missions = derived.completed_missions;
    characterReq.commissary_reward = derived.commissary_reward;
  }

  // normalize v2 JSONB fields before update
  if (linkedVersion === 'v2') {
    characterReq.quirks = normalizeNamedJsonbList(characterReq.quirks);
    characterReq.accessories = normalizeNamedJsonbList(characterReq.accessories);
  }

  // sanitize URL fields before update
  sanitizeUrlFields(characterReq, ['image_url']);

  // update character (authz: creator_id check above + filter below)
  const { data, error } = await supabaseAdmin.from('characters').update(characterReq).eq('id', id).eq('creator_id', profile.id).select();
  if (error) {
    console.error(error);
    return { data, error };
  }
  if (!data || data.length === 0) {
    return { data: null, error: 'Character update returned no rows' };
  }

  const character = data[0];

  // update traits
  const { data: traitsSet, error: traitsSetError } = await setCharacterTraits(character.id, traitFields);
  if (traitsSetError) {
    console.error(traitsSetError);
    return { data: null, error: traitsSetError };
  }

  // update gear
  if (classGear) {
    const { data: gearSet, error: gearSetError } = await setCharacterGear(
      character.id,
      classGear
    );
    if (gearSetError) {
      console.error(gearSetError);
      return { data: null, error: gearSetError };
    }
  }

  // update abilities
  let newAbilityRows = null;
  if (classAbilities) {
    const { data: abilitiesSet, error: abilitiesSetError } = await setCharacterAbilities(character.id, classAbilities);
    if (abilitiesSetError) {
      console.error(abilitiesSetError);
      return { data: null, error: abilitiesSetError };
    }
    newAbilityRows = abilitiesSet;
  }

  if (linkedVersion === 'v2') {
    // Abilities were replaced above (new row ids), so remap the submitted
    // perks' class_ability_id from the old rows to the new ones; otherwise
    // the insert hits a foreign key violation. When abilities weren't
    // submitted, the old rows (and ids) are still in place — no remap needed.
    const perksToSave = newAbilityRows
      ? remapPerkAbilityIds(abilityPerks, previousAbilities, newAbilityRows)
      : abilityPerks;
    const { error: perksError } = await setCharacterPerks(character.id, perksToSave);
    if (perksError) {
      return { data: null, error: perksError };
    }
  }

  return { data: character, error };
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

// Apply a diffChildRows result: inserts -> updates -> deletes. Deletes run
// last and target only truly-removed row ids, so a mid-flight failure leaves
// extra rows rather than missing ones (never a mass delete).
const applyChildDiff = async (table, characterId, { toInsert, toUpdate, toDelete }) => {
  if (toInsert.length > 0) {
    const rows = toInsert.map(fields => ({ character_id: characterId, ...fields }));
    const { error } = await supabaseAdmin.from(table).insert(rows);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
  }
  for (const { id: rowId, ...changes } of toUpdate) {
    const { error } = await supabaseAdmin.from(table).update(changes).eq('id', rowId);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
  }
  if (toDelete.length > 0) {
    const { error } = await supabaseAdmin.from(table).delete().in('id', toDelete).eq('character_id', characterId);
    if (error) {
      console.error(error);
      return { data: null, error };
    }
  }
  return { data: true, error: null };
};

const setCharacterTraits = async (id, traits) => {
  // Internal helper: authz is enforced by the calling function (createCharacter/updateCharacter).
  const { data: existing, error: fetchError } = await supabaseAdmin.from('traits').select('*').eq('character_id', id);
  if (fetchError) {
    console.error(fetchError);
    return { data: null, error: fetchError };
  }

  // Drop empty/missing slots so we never persist null- or ''-named traits
  // (the form always submits three non-empty traits; this guards other callers).
  const desired = (Array.isArray(traits) ? traits : [])
    .filter(name => name != null && name !== '')
    .map(name => ({ name }));
  const diff = diffChildRows(existing, desired, {
    keyOf: r => r.name,
    rowFields: item => ({ name: item.name })
  });
  return applyChildDiff('traits', id, diff);
};

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

const normalizeNamedJsonbList = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => {
      if (!item) return null;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        return trimmed ? { name: trimmed } : null;
      }
      if (typeof item === 'object' && typeof item.name === 'string') {
        const name = item.name.trim();
        if (!name) return null;
        const out = { name };
        if (typeof item.description === 'string' && item.description.trim()) {
          out.description = item.description.trim();
        }
        return out;
      }
      return null;
    })
    .filter(Boolean);
};

const normalizeGearItems = (gear) => {
  if (!Array.isArray(gear)) {
    return [];
  }
  return gear
    .map(item => {
      if (!item) return null;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) return null;
        // Handle "ClassName::GearName" format from searchable selects
        if (trimmed.includes('::')) {
          const [, gearName] = trimmed.split('::');
          return gearName ? { name: gearName.trim() } : null;
        }
        return { name: trimmed };
      }
      if (typeof item === 'object' && typeof item.name === 'string') {
        const trimmed = item.name.trim();
        if (!trimmed) return null;
        return {
          ...item,
          name: trimmed
        };
      }
      return null;
    })
    .filter(Boolean);
};

const setCharacterGear = async (id, gear) => {
  const normalizedGear = normalizeGearItems(gear);

  // Internal helper: authz is enforced by the calling function (createCharacter/updateCharacter).
  const { data: existing, error: fetchError } = await supabaseAdmin.from('class_gear').select('*').eq('character_id', id);
  if (fetchError) {
    return { data: null, error: fetchError };
  }

  const desired = [];
  if (normalizedGear.length > 0) {
    const { gearNameToClassId, gearNameToDescription } = await buildClassContentLookupMaps();
    for (const item of normalizedGear) {
      const clsId = item.class_id ?? gearNameToClassId.get(item.name);
      if (!clsId) {
        const errorMessage = `[setCharacterGear] Missing class_id for gear item "${item.name}"`;
        console.error(errorMessage, { characterId: id, item });
        return { data: null, error: errorMessage };
      }
      const desc = item.description ?? gearNameToDescription.get(item.name);
      desired.push({ name: item.name, class_id: clsId, description: desc || null });
    }
  }

  const diff = diffChildRows(existing, desired, {
    keyOf: r => `${r.class_id}:${r.name}`,
    rowFields: item => ({ name: item.name, class_id: item.class_id, description: item.description })
  });
  return applyChildDiff('class_gear', id, diff);
};

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

const normalizeAbilityItems = (abilities) => {
  if (!Array.isArray(abilities)) {
    return [];
  }
  return abilities
    .map(item => {
      if (!item) return null;
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (!trimmed) return null;
        // Handle "ClassName::AbilityName" format from searchable selects
        if (trimmed.includes('::')) {
          const [, abilityName] = trimmed.split('::');
          return abilityName ? { name: abilityName.trim() } : null;
        }
        return { name: trimmed };
      }
      if (typeof item === 'object' && typeof item.name === 'string') {
        const trimmed = item.name.trim();
        if (!trimmed) return null;
        return {
          ...item,
          name: trimmed
        };
      }
      return null;
    })
    .filter(Boolean);
};

const normalizeAbilityPerks = (perks) => {
  if (!Array.isArray(perks)) return [];
  return perks
    .map((p, i) => {
      if (!p || typeof p !== 'object') return null;
      const text = typeof p.text === 'string' ? p.text.trim() : '';
      const classAbilityId = p.class_ability_id || null;
      if (!text || !classAbilityId) return null;
      const position = Number.isFinite(Number(p.position)) ? Number(p.position) : i;
      const compoundsWith = p.compounds_with_id || p.compounds_with || null;
      return {
        class_ability_id: classAbilityId,
        text,
        position,
        compounds_with: compoundsWith
      };
    })
    .filter(Boolean);
};

const setCharacterPerks = async (characterId, perks) => {
  const normalized = normalizeAbilityPerks(perks);

  // delete-then-insert, mirroring setCharacterGear/setCharacterAbilities
  const { error: delError } = await supabaseAdmin
    .from('character_perks')
    .delete()
    .eq('character_id', characterId);
  if (delError) return { data: null, error: delError };

  if (normalized.length === 0) return { data: [], error: null };

  // Two-pass insert so we can resolve compounds_with references that point
  // to perks created in the same submission (referenced by their position).
  const rowsWithoutLinks = normalized.map(p => ({
    character_id: characterId,
    class_ability_id: p.class_ability_id,
    text: p.text,
    position: p.position
  }));
  const { data: inserted, error: insError } = await supabaseAdmin
    .from('character_perks')
    .insert(rowsWithoutLinks)
    .select();
  if (insError) return { data: null, error: insError };

  // Map by ability+position so we can resolve symbolic compounds_with
  // references the form submits ("position-N" sentinels point at peer
  // perks on the same ability — see Task 19).
  const byKey = new Map();
  for (const row of inserted) {
    byKey.set(`${row.class_ability_id}:${row.position}`, row.id);
  }

  const updates = normalized
    .map((p, i) => {
      const id = inserted[i]?.id;
      if (!id || !p.compounds_with) return null;
      // compounds_with may already be a UUID (existing row) or a
      // "position-{n}" sentinel from a fresh form submission.
      let target = null;
      if (typeof p.compounds_with === 'string' && p.compounds_with.startsWith('position-')) {
        const targetPos = Number(p.compounds_with.slice('position-'.length));
        target = byKey.get(`${p.class_ability_id}:${targetPos}`);
      } else {
        // Verify it points to a perk we just inserted on the same ability
        const candidate = inserted.find(r => r.id === p.compounds_with);
        if (candidate && candidate.class_ability_id === p.class_ability_id) {
          target = candidate.id;
        }
      }
      if (!target || target === id) return null;
      return { id, compounds_with: target };
    })
    .filter(Boolean);

  for (const u of updates) {
    const { error: updError } = await supabaseAdmin
      .from('character_perks')
      .update({ compounds_with: u.compounds_with })
      .eq('id', u.id);
    if (updError) return { data: null, error: updError };
  }

  return { data: inserted, error: null };
};

const setCharacterAbilities = async (id, abilities) => {
  const normalizedAbilities = normalizeAbilityItems(abilities);

  // Internal helper: authz is enforced by the calling function (createCharacter/updateCharacter).
  const { data: existing, error: fetchError } = await supabaseAdmin.from('class_abilities').select('*').eq('character_id', id);
  if (fetchError) {
    return { data: null, error: fetchError };
  }

  const desired = [];
  if (normalizedAbilities.length > 0) {
    const { abilityNameToClassId, abilityNameToDescription } = await buildClassContentLookupMaps();
    for (const item of normalizedAbilities) {
      const clsId = item.class_id ?? abilityNameToClassId.get(item.name);
      if (!clsId) {
        const errorMessage = `[setCharacterAbilities] Missing class_id for ability "${item.name}"`;
        console.error(errorMessage, { characterId: id, item });
        return { data: null, error: errorMessage };
      }
      const desc = item.description ?? abilityNameToDescription.get(item.name);
      desired.push({ name: item.name, class_id: clsId, description: desc || null });
    }
  }

  const diff = diffChildRows(existing, desired, {
    keyOf: r => `${r.class_id}:${r.name}`,
    rowFields: item => ({ name: item.name, class_id: item.class_id, description: item.description })
  });
  const { error: applyError } = await applyChildDiff('class_abilities', id, diff);
  if (applyError) {
    return { data: null, error: applyError };
  }

  // Return the full post-reconcile set (kept + inserted): updateCharacter
  // remaps the form's perk references against these rows.
  const { data: current, error: selError } = await supabaseAdmin.from('class_abilities').select('*').eq('character_id', id);
  if (selError) {
    return { data: null, error: selError };
  }
  return { data: current, error: null };
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
