const { createHash } = require('node:crypto');

const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
};
const requestHash = body => {
  const { request_id, ...payload } = body;
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
};
const byId = (a, b) => String(a.id).localeCompare(String(b.id));
const historySnapshot = (realMissions = [], offscreenMissions = []) => ({
  missions: realMissions.map(mission => ({ id: mission.id, outcome: mission.outcome,
    difficulty: mission.difficulty ?? null, danger: mission.danger ?? null })).sort(byId),
  offscreen: offscreenMissions.map(mission => ({ id: mission.id, merx_gained: mission.merx_gained,
    source_mission_id: mission.source_mission_id ?? null })).sort(byId)
});

const buildSnapshot = character => ({
  gear: (character.gear || []).map(row => ({ id: row.id, class_id: row.class_id,
    name: row.name, enchantment: row.enchantment ?? null, mods: row.mods || [] })).sort(byId),
  abilities: (character.abilities || []).map(row => ({ id: row.id, class_id: row.class_id,
    name: row.name, type: row.type })).sort(byId),
  perks: (character.ability_perks || []).map(row => ({ id: row.id,
    class_ability_id: row.class_ability_id, text: row.text, position: row.position })).sort(byId),
  traits: (character.traits || []).map(row => ({ name: row.name, stat: row.stat ?? null }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1
      : String(a.stat || '') < String(b.stat || '') ? -1 : String(a.stat || '') > String(b.stat || '') ? 1 : 0)
});

module.exports = { requestHash, historySnapshot, buildSnapshot };
