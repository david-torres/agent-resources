const { sanitizeHttpUrl } = require('../../util/url');
const { validateAbilityPerks } = require('../../util/validate');
const { statList } = require('../../util/enclave-consts');

const V2_ONLY_FIELDS = ['quirks', 'accessories', 'ability_perks'];
const V1_ONLY_FIELDS = ['perks', 'additional_gear'];
const CREATOR_MODES = ['advent', 'aspiring', 'aspirant'];

// Submitted character payloads are ordinary JSON-like data. Clone them before
// transforming so route callers (and import callers) retain their request body.
const cloneInput = (input) => {
  if (!input || typeof input !== 'object') return {};
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.map(item => item && typeof item === 'object' ? { ...item } : item)];
    if (value && typeof value === 'object') return [key, { ...value }];
    return [key, value];
  }));
};

const normalizeNamedJsonbList = (input) => {
  if (!Array.isArray(input)) return [];
  return input.map(item => {
    if (!item) return null;
    if (typeof item === 'string') {
      const name = item.trim();
      return name ? { name } : null;
    }
    if (typeof item === 'object' && typeof item.name === 'string') {
      const name = item.name.trim();
      if (!name) return null;
      const result = { name };
      if (typeof item.description === 'string' && item.description.trim()) result.description = item.description.trim();
      return result;
    }
    return null;
  }).filter(Boolean);
};

const normalizeClassItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (!item) return null;
    if (typeof item === 'string') {
      const value = item.trim();
      if (!value) return null;
      const separator = value.indexOf('::');
      const name = separator === -1 ? value : value.slice(separator + 2).trim();
      return name ? { name } : null;
    }
    if (typeof item === 'object' && typeof item.name === 'string') {
      const name = item.name.trim();
      return name ? { ...item, name } : null;
    }
    return null;
  }).filter(Boolean);
};

const normalizeAbilityPerks = (perks) => {
  if (!Array.isArray(perks)) return [];
  return perks.map((perk, index) => {
    if (!perk || typeof perk !== 'object') return null;
    const text = typeof perk.text === 'string' ? perk.text.trim() : '';
    const classAbilityId = perk.class_ability_id || null;
    if (!text || !classAbilityId) return null;
    return {
      class_ability_id: classAbilityId,
      text,
      position: Number.isFinite(Number(perk.position)) ? Number(perk.position) : index,
      compounds_with: perk.compounds_with_id || perk.compounds_with || null
    };
  }).filter(Boolean);
};

/**
 * Prepare an input payload for the character persistence flow without doing
 * database access. Class id/name resolution belongs to the caller; pass its
 * resolved rules version here so this stays deterministic and unit-testable.
 */
const normalizeCharacterInput = (input, context = {}) => {
  const data = cloneInput(input);
  const rulesVersion = context.rulesVersion === 'v2' ? 'v2' : 'v1';

  if (context.creatorId) data.creator_id = context.creatorId;
  for (const field of rulesVersion === 'v2' ? V1_ONLY_FIELDS : V2_ONLY_FIELDS) delete data[field];

  const childData = {
    traits: [data.trait0, data.trait1, data.trait2],
    abilityPerks: data.ability_perks,
    classGear: data.gear,
    classAbilities: data.abilities
  };
  delete data.trait0;
  delete data.trait1;
  delete data.trait2;
  delete data.ability_perks;
  delete data.gear;
  delete data.abilities;

  if (rulesVersion === 'v2') {
    const validation = validateAbilityPerks(normalizeAbilityPerks(childData.abilityPerks));
    if (!validation.ok) return { data: null, childData: null, error: validation.errors.join(' ') };
    data.quirks = normalizeNamedJsonbList(data.quirks);
    data.accessories = normalizeNamedJsonbList(data.accessories);
  }

  const items = Array.isArray(data.common_items) ? data.common_items : (data.common_items ? [data.common_items] : []);
  data.common_items = items.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  data.is_public = data.is_public === 'on';
  data.hide_from_search = data.hide_from_search === 'on';

  if (data.creator_mode == null || data.creator_mode === '') data.creator_mode = null;
  else if (!CREATOR_MODES.includes(data.creator_mode)) {
    return { data: null, childData: null, error: `Invalid creator_mode: ${data.creator_mode}` };
  }

  if (context.normalizeAutoCalculate) data.auto_calculate = data.auto_calculate === 'on' || data.auto_calculate === true;
  if ('image_url' in data) data.image_url = data.image_url ? sanitizeHttpUrl(data.image_url) : null;

  return { data, childData, error: null };
};

// Shared by the stats/level-up capabilities (PATCH /:id/stats, POST
// /:id/level-up) for parsing raw HTTP request-body values.
const parseInteger = (value, fallback = 0) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeStatsPayload = (body = {}) => {
  const out = {};
  for (const stat of statList) {
    const n = parseInteger(body[stat], 0);
    out[stat] = Math.max(0, Math.min(20, n));
  }
  return out;
};

module.exports = {
  cloneInput,
  normalizeCharacterInput,
  normalizeNamedJsonbList,
  normalizeGearItems: normalizeClassItems,
  normalizeAbilityItems: normalizeClassItems,
  normalizeAbilityPerks,
  parseInteger,
  normalizeStatsPayload
};
