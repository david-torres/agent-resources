/**
 * Remap each perk's class_ability_id from previousAbilities rows to the
 * matching newAbilities row (same name + class_id). Perks whose old ability
 * has no new counterpart are dropped. Perks already pointing at a new row id
 * are kept; anything else is dropped. Inputs are not mutated.
 */
function remapPerkAbilityIds(perks, previousAbilities, newAbilities) {
  if (!Array.isArray(perks)) return [];

  const previous = Array.isArray(previousAbilities) ? previousAbilities : [];
  const next = Array.isArray(newAbilities) ? newAbilities : [];

  const newIds = new Set(next.map(a => a.id));

  const result = [];
  for (const perk of perks) {
    const id = perk.class_ability_id;

    if (newIds.has(id)) {
      result.push({ ...perk });
      continue;
    }

    const old = previous.find(a => a.id === id);
    if (!old) continue;

    const replacement = next.find(a => a.name === old.name && a.class_id === old.class_id);
    if (!replacement) continue;

    result.push({ ...perk, class_ability_id: replacement.id });
  }

  return result;
}

/**
 * Remap each perk's class_ability_id to a newly-inserted ability row id.
 * On the CREATE path, perk references are ability NAMES (the create form has no
 * row ids yet). A reference that already equals a new row id is kept as-is.
 * Perks whose reference matches neither a new id nor a new name are dropped.
 * Inputs are not mutated.
 */
function remapPerkAbilityIdsByName(perks, newAbilities) {
  if (!Array.isArray(perks)) return [];
  const next = Array.isArray(newAbilities) ? newAbilities : [];
  const idSet = new Set(next.map(a => a.id));
  const nameToId = new Map(next.map(a => [a.name, a.id]));

  const result = [];
  for (const perk of perks) {
    const ref = perk.class_ability_id;

    if (idSet.has(ref)) {
      result.push({ ...perk });
      continue;
    }

    if (nameToId.has(ref)) {
      result.push({ ...perk, class_ability_id: nameToId.get(ref) });
      continue;
    }

    // no matching ability row — drop
  }
  return result;
}

module.exports = { remapPerkAbilityIds, remapPerkAbilityIdsByName };
