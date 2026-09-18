const moment = require('moment-timezone');
const { sanitizeHttpUrl } = require('../../util/url');
const { validateAbilityPerks } = require('../../util/validate');
const { statList } = require('../../util/enclave-consts');
const { trimStrings } = require('../../util/trim-input');
const {
  countWordsExcludingRatings,
  ENCHANTMENT_WORD_LIMIT,
  MOD_WORD_LIMIT,
  MODS_PER_SIGNATURE
} = require('../../util/merx-economy');

const V2_ONLY_FIELDS = ['quirks', 'accessories', 'ability_perks'];
const V1_ONLY_FIELDS = ['perks', 'additional_gear'];
const CREATOR_MODES = ['advent', 'aspiring', 'aspirant'];
const ENCHANTMENT_SOURCES = ['default', 'custom'];

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

// A Default Enchantment stores only its source: its text belongs to the class
// (classes.gear[].default_enchantment) and services/character/repository.js
// mergeClassItems already merges it onto the character row at read time, so a
// copy stored here could drift from the class page and would hide an errata
// from a character who unlocked it.
//
// A Custom Enchantment is Self-Made Content, so it is bounded but not judged:
// the book's "a Custom Enchantment may never be stronger than the Default"
// (pg. 86) is the playgroup's call, and nothing here can measure it.
const normalizeEnchantment = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = typeof value.source === 'string' ? value.source.trim() : '';
  if (!source) return null;
  if (!ENCHANTMENT_SOURCES.includes(source)) {
    throw new Error(`Enchantment source must be default or custom, not "${source}".`);
  }
  if (source === 'default') return { source };
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) throw new Error('A Custom Enchantment needs a name.');
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (countWordsExcludingRatings(description) > ENCHANTMENT_WORD_LIMIT) {
    throw new Error(`A Custom Enchantment may be no more than ${ENCHANTMENT_WORD_LIMIT} words.`);
  }
  return { source, name, description };
};

// pg. 87: a Mod "should be named for easy reference during play". A blank
// name is a UI artifact rather than a purchase, so it is dropped -- the same
// treatment util/class-gear.js gives a blank note.
const normalizeMods = (value) => {
  const rows = Array.isArray(value) ? value : [];
  const mods = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    if (countWordsExcludingRatings(description) > MOD_WORD_LIMIT) {
      throw new Error(`A Mod may be no more than ${MOD_WORD_LIMIT} words.`);
    }
    mods.push({ name, description });
  }
  if (mods.length > MODS_PER_SIGNATURE) {
    throw new Error('A Signature may hold no more than two Mods.');
  }
  return mods;
};

// Bounds a Signature's player-authored equipment before it reaches
// reconcileGear. Abilities never carry equipment, so both fields normalize to
// the empty case for them; reconcileAbilities names its columns explicitly,
// so the extra keys are dropped before any write.
const normalizeGearEquipment = (item) => ({
  enchantment: normalizeEnchantment(item && item.enchantment),
  mods: normalizeMods(item && item.mods)
});

const normalizeClassItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (!item) return null;
    if (typeof item === 'string') {
      const value = item.trim();
      if (!value) return null;
      const separator = value.indexOf('::');
      const name = separator === -1 ? value : value.slice(separator + 2).trim();
      if (!name) return null;
      const className = separator === -1 ? '' : value.slice(0, separator).trim();
      return className ? { name, class_name: className } : { name };
    }
    if (typeof item === 'object' && typeof item.name === 'string') {
      const name = item.name.trim();
      if (!name) return null;
      return { ...item, name, ...normalizeGearEquipment(item) };
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

const blankToNull = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};

/**
 * Prepare an input payload for the character persistence flow without doing
 * database access. Class id/name resolution belongs to the caller; pass its
 * resolved rules version here so this stays deterministic and unit-testable.
 */
const normalizeCharacterInput = (input, context = {}) => {
  const data = trimStrings(cloneInput(input));
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

  // Aspiring is class-less. The invented class name goes in `class` -- already
  // NOT NULL and already the display name every render path reads -- rather
  // than a pseudo_class_name column that would be a second copy of it. Left
  // nested, the object reaches jsonb_populate_record, which drops keys that are
  // not columns without erroring, so the delete stays unconditional: no payload
  // shape may leak the nested key downstream. The mapping itself is gated on the
  // mode, or a crafted advent/aspirant body could rename `class` out of sync
  // with the catalog row its class_id still points at.
  if (data.creator_mode === 'aspiring' && data.pseudo_class && typeof data.pseudo_class === 'object') {
    const pseudo = data.pseudo_class;
    const name = blankToNull(pseudo.name);
    if (name) data.class = name;
    data.pseudo_class_tagline = blankToNull(pseudo.tagline);
    data.pseudo_class_description = blankToNull(pseudo.description);
  }
  delete data.pseudo_class;

  if (rulesVersion === 'v2') {
    const validation = validateAbilityPerks(normalizeAbilityPerks(childData.abilityPerks));
    if (!validation.ok) return { data: null, childData: null, error: validation.errors.join(' ') };
    data.quirks = normalizeNamedJsonbList(data.quirks);
    data.accessories = normalizeNamedJsonbList(data.accessories);
  }

  const items = Array.isArray(data.common_items) ? data.common_items : (data.common_items ? [data.common_items] : []);
  data.common_items = items.map(item => typeof item === 'string' ? item : '').filter(Boolean);
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
    const raw = data.created_at;
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

// Structural invariants only. The 10-Merx and 4-Perk budgets stay client-side
// (public/js/character-wizard.js:1504-1510) -- mirroring the rules engine here
// would give the economy two sources of truth that can drift.
const validateAspiringBuild = (body) => {
  const name = typeof body.pseudo_class?.name === 'string' ? body.pseudo_class.name.trim() : '';
  if (!name) return 'An Aspiring character needs a class name.';

  const gear = Array.isArray(body.gear) ? body.gear : [];
  if (gear.length !== 3) return 'An Aspiring character needs exactly three gear picks.';

  const abilities = Array.isArray(body.abilities) ? body.abilities : [];
  const core = abilities.filter(a => a && a.type === 'core').length;
  const advanced = abilities.filter(a => a && a.type === 'advanced').length;
  if (abilities.length !== 3 || core !== 2 || advanced !== 1) {
    return 'An Aspiring character needs two core abilities and one advanced ability.';
  }
  return null;
};

const normalizeWizardPayload = (rawBody) => {
  const body = trimStrings(cloneInput(rawBody));

  const trimmedName = (body.name || '').toString().trim();
  if (!trimmedName) return { data: null, error: 'Character name is required.' };
  if (trimmedName.length > 120) {
    return { data: null, error: 'Character name is too long (max 120 characters).' };
  }

  if (body.creator_mode != null && body.creator_mode !== '' && !CREATOR_MODES.includes(body.creator_mode)) {
    return { data: null, error: `Invalid mode: ${body.creator_mode}` };
  }

  if (body.creator_mode === 'aspiring') {
    const invalid = validateAspiringBuild(body);
    if (invalid) return { data: null, error: invalid };
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
  normalizeGearEquipment,
  normalizeAbilityPerks,
  parseInteger,
  normalizeStatsPayload,
  normalizeWizardPayload,
  collectCharacterFormArrays
};
