const moment = require('moment-timezone');
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

  // created_at is editable because the backfill that seeded it was a guess and
  // characters carry no other date a player could correct it with. Only this
  // column is editable -- updated_at stays trigger-owned, or a row could be
  // pinned to the top of the homepage feeds indefinitely.
  if ('created_at' in data) {
    const raw = typeof data.created_at === 'string' ? data.created_at.trim() : data.created_at;
    if (!raw) {
      delete data.created_at;
    } else {
      const parsed = moment.utc(raw, ['YYYY-MM-DD', moment.ISO_8601], true);
      if (!parsed.isValid()) {
        return { data: null, childData: null, error: 'Invalid created date.' };
      }
      if (parsed.isAfter(moment.utc())) {
        return { data: null, childData: null, error: 'Created date cannot be in the future.' };
      }
      data.created_at = parsed.toISOString();
    }
  }

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

const normalizeWizardPayload = (rawBody) => {
  const body = cloneInput(rawBody);

  const trimmedName = (body.name || '').toString().trim();
  if (!trimmedName) return { data: null, error: 'Character name is required.' };
  if (trimmedName.length > 120) {
    return { data: null, error: 'Character name is too long (max 120 characters).' };
  }

  if (body.creator_mode != null && body.creator_mode !== '' && !CREATOR_MODES.includes(body.creator_mode)) {
    return { data: null, error: `Invalid mode: ${body.creator_mode}` };
  }

  const knownStats = new Set(statList);
  for (const k of Object.keys(body)) {
    if (knownStats.has(k)) body[k] = parseInteger(body[k], 0);
  }

  if (body.level != null) body.level = Math.max(1, Math.min(20, parseInteger(body.level, 1)));
  if (body.completed_missions != null) body.completed_missions = Math.max(0, parseInteger(body.completed_missions, 0));
  body.commissary_reward = Math.max(0, parseInteger(body.commissary_reward, 0));
  body.name = trimmedName;
  body.is_public = body.is_public === false ? false : true;
  body.hide_from_search = !!body.hide_from_search;

  return { data: body, error: null };
};

const asArray = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

const collectAbilityPerksFromForm = (body) => {
  const ids = asArray(body.ability_perk_class_ability_id);
  const texts = asArray(body.ability_perk_text);
  const pos = asArray(body.ability_perk_position);
  const cw = asArray(body.ability_perk_compounds_with);
  const n = Math.max(ids.length, texts.length, pos.length, cw.length);
  const perks = [];
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    const text = texts[i];
    if (!id || !text) continue;
    perks.push({
      class_ability_id: id,
      text: String(text),
      position: Number(pos[i]) || i,
      compounds_with: cw[i] || null
    });
  }
  return perks;
};

const collectNamedFromForm = (body, nameKey, descKey) => {
  const names = asArray(body[nameKey]);
  const descs = asArray(body[descKey]);
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const name = (names[i] || '').toString().trim();
    if (!name) continue;
    const desc = (descs[i] || '').toString().trim();
    out.push(desc ? { name, description: desc } : { name });
  }
  return out;
};

const FORM_ARRAY_KEYS = [
  'ability_perk_class_ability_id', 'ability_perk_text', 'ability_perk_position',
  'ability_perk_compounds_with', 'quirk_name', 'quirk_description',
  'accessory_name', 'accessory_description'
];

const collectCharacterFormArrays = (body) => {
  const out = { ...body };
  out.ability_perks = collectAbilityPerksFromForm(body);
  out.quirks = collectNamedFromForm(body, 'quirk_name', 'quirk_description');
  out.accessories = collectNamedFromForm(body, 'accessory_name', 'accessory_description');
  for (const key of FORM_ARRAY_KEYS) delete out[key];
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
  normalizeStatsPayload,
  normalizeWizardPayload,
  collectCharacterFormArrays
};
