const moment = require('moment-timezone');
const { sanitizeHttpUrl } = require('../../util/url');
const { validateAbilityPerks } = require('../../util/validate');
const { statList } = require('../../util/enclave-consts');
const { trimStrings } = require('../../util/trim-input');
const {
  countWordsExcludingRatings,
  ENCHANTMENT_WORD_LIMIT,
  MOD_WORD_LIMIT,
  MODS_PER_SIGNATURE,
  economyFor,
  equipmentSpend,
  signatureSlotsUsed,
  withPreservedEnchantments,
  CREATION_GRANT,
  SIGNATURE_CAP,
  COMMON_ITEM_PRICE
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

// Shapes and judges a submitted Enchantment in one pass, returning both what
// to store and, on a rejection, the player-readable message for it -- never
// throwing, so a caller decides for itself whether the message needs to
// surface. A throw here would reach `POST /characters/wizard` and
// `POST /characters` as an unhandled promise rejection (neither route has an
// `asyncHandler` wrapper) and `PUT /characters/:id` as a generic "unexpected
// error" (a bare Error has no `.code`, so util/http-error.js classifyError
// takes its default branch and drops the message in production).
//
// A Default Enchantment stores only its source: its text belongs to the class
// (classes.gear[].default_enchantment) and services/character/repository.js
// mergeClassItems already merges it onto the character row at read time, so a
// copy stored here could drift from the class page and would hide an errata
// from a character who unlocked it.
//
// A Custom Enchantment is Self-Made Content, so it is bounded but not judged
// on power: the book's "a Custom Enchantment may never be stronger than the
// Default" (pg. 86) is the playgroup's call, and nothing here can measure it.
//
// `source` must be a string to be treated as "no source submitted" (missing,
// or blank/whitespace) versus "a source was submitted and it's wrong": a
// present non-string/non-null value (e.g. `5`, `true`) is a malformed
// payload, not a cleared field, so it is rejected rather than silently
// treated as absent.
const shapeEnchantment = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value: null, error: null };
  const rawSource = value.source;
  if (rawSource != null && typeof rawSource !== 'string') {
    return { value: undefined, error: `Enchantment source must be default or custom, not "${rawSource}".` };
  }
  const source = typeof rawSource === 'string' ? rawSource.trim() : '';
  if (!source) return { value: null, error: null };
  if (!ENCHANTMENT_SOURCES.includes(source)) {
    return { value: undefined, error: `Enchantment source must be default or custom, not "${source}".` };
  }
  if (source === 'default') return { value: { source }, error: null };
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return { value: undefined, error: 'A Custom Enchantment needs a name.' };
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (countWordsExcludingRatings(description) > ENCHANTMENT_WORD_LIMIT) {
    return { value: undefined, error: `A Custom Enchantment may be no more than ${ENCHANTMENT_WORD_LIMIT} words.` };
  }
  return { value: { source, name, description }, error: null };
};

// pg. 87: a Mod "should be named for easy reference during play". A blank
// name is a UI artifact rather than a purchase, so it is dropped rather than
// reported -- the same treatment util/class-gear.js gives a blank note. The
// 10-word limit and two-Mod cap are judged, though, and reported like
// shapeEnchantment's rejections: returned, never thrown.
const shapeMods = (value) => {
  const rows = Array.isArray(value) ? value : [];
  const mods = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    if (countWordsExcludingRatings(description) > MOD_WORD_LIMIT) {
      return { value: undefined, error: `A Mod may be no more than ${MOD_WORD_LIMIT} words.` };
    }
    mods.push({ name, description });
  }
  if (mods.length > MODS_PER_SIGNATURE) {
    return { value: undefined, error: 'A Signature may hold no more than two Mods.' };
  }
  return { value: mods, error: null };
};

// Permissive shaping only: an invalid submission shapes to "no equipment"
// (null / []) rather than being rejected here. Rejecting it is
// validateGearEquipment's job, and normalizeCharacterInput calls that before
// this ever runs, so by the time reconcileGear/reconcileAbilities and the
// atomic save path reach this, the submission has already been judged.
const normalizeEnchantment = (value) => shapeEnchantment(value).value ?? null;
const normalizeMods = (value) => shapeMods(value).value ?? [];

// Judges a character's Merx spend and/or Signature Cap against
// util/merx-economy.js -- the single definition of every figure -- and
// reports both the same way validateGearEquipment does: `{ ok: true }` or
// `{ ok: false, errors }`, never a throw. A throw here would reach
// `POST /characters/wizard` and `POST /characters` as an unhandled promise
// rejection (neither route has an asyncHandler wrapper, so the request just
// hangs) and `PUT /characters/:id` as a generic "unexpected error" (a bare
// Error has no `.code`, so util/http-error.js classifyError drops the message
// in production).
//
// The Advent economy is deliberately unenforced: every character that exists
// today predates any budget, and no measurement says it would pass one, so
// enforcing it now would retroactively invalidate real data. Aspirant and
// Aspiring are both empty populations, which is what makes hard rejection
// safe for them.
//
// `enforceMerxBudget` (default true) exists because the Signature Cap and the
// Merx budget need different information: the cap is a fixed number that any
// caller can check, but the budget is CREATION_GRANT plus whatever Merx a
// character has earned from missions, and updateCharacter has no mission data
// in hand outside its auto_calculate branch. Passing `earnedMerx: 0` there
// instead of `enforceMerxBudget: false` would not "skip" the budget -- it
// would enforce it against a budget of 0-plus-grant, refusing a purchase a
// character's real (unfetched) earnings could afford. That false rejection
// is worse than not checking at all, so the two rules are split explicitly
// rather than left to whatever earnedMerx a caller happens to pass.
//
// `storedGear` is the character's current class_gear rows, passed by
// updateCharacter from the getCharacter call it already makes. The cap is
// counted from the Enchantments the save will LEAVE, not only the ones it
// mentions: an item that omits `enchantment` keeps its stored one, so the
// submitted list alone is breachable across two saves (see
// withPreservedEnchantments). The spend below stays on the submitted list --
// storedGear only ever arrives from updateCharacter, which passes
// enforceMerxBudget: false, so no caller prices a list with stored rows
// behind it.
const validateEconomyLimits = ({
  economy, gear, storedGear, commonItems, characterClassId, earnedMerx = 0, enforceMerxBudget = true
}) => {
  if (economy === 'advent') return { ok: true };

  const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
  const errors = [];

  // pg. 8: an Enchantment counts as a second slot toward the Signature Cap.
  // This is checked independently of Merx -- a character who can afford a
  // seventh enchanted Signature may still not carry it if the slots are full.
  const cap = SIGNATURE_CAP[economy];
  const slots = signatureSlotsUsed(withPreservedEnchantments(items, storedGear));
  if (cap !== null && slots > cap) {
    errors.push(
      `Signature Cap is ${cap}; this character carries ${slots} `
      + '(an Enchantment counts as a Signature).'
    );
  }

  if (enforceMerxBudget) {
    const budget = CREATION_GRANT[economy] + Math.max(0, Number(earnedMerx) || 0);
    const itemCount = Array.isArray(commonItems) ? commonItems.length : 0;
    const spend = equipmentSpend(items, { economy, characterClassId })
      + itemCount * COMMON_ITEM_PRICE;
    if (spend > budget) {
      errors.push(`This character spends ${spend} Merx of ${budget}.`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};

// Validates the Enchantment/Mods a submitted gear or ability list carries,
// mirroring util/validate.js validateAbilityPerks's `{ ok }` / `{ ok: false,
// errors }` contract so normalizeCharacterInput's existing "return an error
// string" convention (see its validateAbilityPerks call) can surface a
// rejection the same way everywhere it's called, rather than throwing.
// String items ("Class::Item") never carry equipment, so only object items
// are checked.
const validateGearEquipment = (items) => {
  const errors = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const enchantmentResult = shapeEnchantment(item.enchantment);
    if (enchantmentResult.error) errors.push(enchantmentResult.error);
    const modsResult = shapeMods(item.mods);
    if (modsResult.error) errors.push(modsResult.error);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};

// Shapes a Signature's player-authored equipment for storage. A key the
// submitted item never mentioned stays absent here -- checked with `in`,
// since `??` cannot tell "missing" from "explicitly null" -- so a save that
// says nothing about equipment leaves a stored Enchantment or Mods alone
// downstream. A key the item did submit, including an explicit `null`, is
// normalized and kept present, which downstream reads as "remove the
// Enchantment". Abilities never carry equipment, so normalizeClassItems runs
// this for ability items too; reconcileAbilities and the atomic path's
// ability mapping name their columns explicitly, so any keys this produces
// for an ability are dropped before a write.
const normalizeGearEquipment = (item) => {
  const result = {};
  if (item && typeof item === 'object' && 'enchantment' in item) {
    result.enchantment = normalizeEnchantment(item.enchantment);
  }
  if (item && typeof item === 'object' && 'mods' in item) {
    result.mods = normalizeMods(item.mods);
  }
  return result;
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

  // Applies to every rules version -- Enchantments/Mods are a class_gear
  // concept, not an ability-perks (v1/v2) one -- and runs before the
  // pseudo_class/rulesVersion handling below since it only concerns
  // childData.classGear/classAbilities. Both createCharacter and
  // updateCharacter call normalizeCharacterInput before ever touching
  // reconcileGear/reconcileAbilities or the atomic save's p_gear payload, so
  // this is the one place a bad submission needs to be caught.
  const gearValidation = validateGearEquipment(childData.classGear);
  if (!gearValidation.ok) return { data: null, childData: null, error: gearValidation.errors.join(' ') };
  const abilityValidation = validateGearEquipment(childData.classAbilities);
  if (!abilityValidation.ok) return { data: null, childData: null, error: abilityValidation.errors.join(' ') };

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

  // Resolved the same way every other consumer resolves it (economyFor, fed
  // by context.contentFormat -- the class row the caller already looked up --
  // and this character's own creator_mode), rather than re-deriving it here.
  //
  // Priced on context.economyGear, not the raw childData.classGear, when the
  // caller supplies it: the classic/expert create form submits gear as bare
  // "ClassName::ItemName" strings with no class_id at all, and isCrossClass
  // (util/merx-economy.js) reads a missing class_id as "not cross-class" --
  // so pricing the unresolved list would price every cross-class Signature
  // as if it were own-class. The caller (CharacterService) already has
  // gearNameToClassId from the same catalogue lookup it uses for content_format,
  // so it resolves this once with resolveSubmittedGear and hands the result
  // in, rather than this module re-implementing that resolution.
  //
  // Normalized before it is priced, through the same normalizeClassItems the
  // write paths run: a submission may carry equipment that shapes to nothing
  // storable (`enchantment: {}` has no source and stores null; a blank-named
  // Mod is dropped), and charging Merx or a Signature Cap slot for equipment
  // the save will not store refuses builds the rules permit. Normalizing here
  // rather than re-deriving "what counts as stored equipment" keeps that
  // definition in one place.
  // context.enforceMerxBudget defaults to true (creation: a brand-new
  // character has no missions, so CREATION_GRANT alone IS its budget) and is
  // passed false by updateCharacter (an edit may have mission-earned Merx
  // this call has no way to know, and checking the bare grant would refuse a
  // purchase the character can actually afford). The Signature Cap needs no
  // such data and always runs for a non-advent economy either way.
  const economy = economyFor({ contentFormat: context.contentFormat, creatorMode: data.creator_mode });
  const economyValidation = validateEconomyLimits({
    economy,
    gear: normalizeClassItems(context.economyGear ?? childData.classGear),
    storedGear: context.storedGear,
    commonItems: data.common_items,
    characterClassId: data.class_id ?? null,
    enforceMerxBudget: context.enforceMerxBudget ?? true
  });
  if (!economyValidation.ok) return { data: null, childData: null, error: economyValidation.errors.join(' ') };

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

// Structural invariants only -- picks/counts, not price. The Perk budget this
// function does not check stays client-side only
// (public/js/character-wizard.js:1525 hardcodes its own ASPIRING_PERKS_BUDGET;
// this task does not give it a server-side counterpart). The Merx budget and
// Signature Cap are a different matter: normalizeCharacterInput runs
// validateEconomyLimits on every submission after this structural check
// passes, enforcing util/merx-economy.js's figures directly, so a build that
// clears this structural check still answers to that one.
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
  validateGearEquipment,
  validateEconomyLimits,
  normalizeAbilityPerks,
  parseInteger,
  normalizeStatsPayload,
  normalizeWizardPayload,
  collectCharacterFormArrays
};
