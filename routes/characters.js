const express = require('express');
const router = express.Router();
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id']);
const { getOwnCharacters, getCharacter, createCharacter, updateCharacter, deleteCharacter, markCharacterDeceased, getCharacterRecentMissions, searchPublicCharacters, getRandomPublicCharacters, getMission, getClasses, getClass, getLfgPost, getProfileById, getCharacterRealMissionsForDerivation, createMission, addCharacterToMission } = require('../util/supabase');
const { supabaseAdmin } = require('../models/_base');
const { statList, personalityMap, commonItemList } = require('../util/enclave-consts');
const { deriveCharacterTotals } = require('../util/character-derived');
const { getUnlockedClassIdsForUser } = require('../models/class');
const { filterClassListsByIds } = require('../util/class-filter');
const { upgradeCharacterClass, findUpgradeTargetsFor } = require('../models/character');
const { createOffscreenMission, getOffscreenMissionById, updateOffscreenMission, removeOffscreenMission, listOffscreenMissions, getAvailableHostedMissionsForPicker } = require('../models/offscreen-mission');
const { getProfileConduitCredits } = require('../models/profile');
const { isAuthenticated, authOptional } = require('../util/auth');
const { sendError, FRIENDLY_NOT_FOUND } = require('../util/http-error');
const { renderMarkdown } = require('../util/markdown');
const { processCharacterImport } = require('../util/character-import');
const { exportCharacter, getSupportedFormats, EXPORT_FORMATS } = require('../util/character-export');
const { parseImageCrop } = require('../util/crop');
const { validateAbilityPerks } = require('../util/validate');

const asArray = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

const collectAbilityPerks = (body) => {
  const ids   = asArray(body.ability_perk_class_ability_id);
  const texts = asArray(body.ability_perk_text);
  const pos   = asArray(body.ability_perk_position);
  const cw    = asArray(body.ability_perk_compounds_with);
  const n = Math.max(ids.length, texts.length, pos.length, cw.length);
  const perks = [];
  for (let i = 0; i < n; i++) {
    const id = ids[i]; const text = texts[i];
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

const collectNamed = (body, nameKey, descKey) => {
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

const getOwnedCharacterForMutation = async ({ characterId, profile }) => {
  const { data: character, error } = await getCharacter(characterId, supabaseAdmin);
  if (error) return { character: null, error };
  if (!character) return { character: null, error: { status: 404, message: 'Character not found' } };
  if (character.creator_id !== profile.id) {
    return { character: null, error: { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND } };
  }
  return { character, error: null };
};

const sendRouteError = (req, res, error) => {
  if (error && (error.status != null || error.title)) {
    return sendError(req, res, null, error);
  }
  return sendError(req, res, error);
};

const updateOwnedCharacterFields = async ({ characterId, profileId, fields }) => {
  const { data, error } = await supabaseAdmin
    .from('characters')
    .update(fields)
    .eq('id', characterId)
    .eq('creator_id', profileId)
    .select()
    .single();
  if (error) return { data: null, error };
  if (!data) return { data: null, error: { status: 404, message: 'Character update returned no rows' } };
  return { data, error: null };
};

const createBackfillMissionForCharacter = async ({ characterId, name, profile }) => {
  const { data: missionRows, error: missionError } = await createMission({
    name,
    date: new Date().toISOString(),
    outcome: 'success',
    is_public: false
  }, profile);
  if (missionError) return { error: missionError };
  const mission = Array.isArray(missionRows) ? missionRows[0] : missionRows;
  if (!mission) return { error: { status: 400, message: 'Mission creation returned no rows' } };
  const { error: linkError } = await addCharacterToMission(mission.id, characterId);
  return { error: linkError || null };
};

const appendCharacterPerks = async ({ characterId, submittedPerks }) => {
  if (!Array.isArray(submittedPerks) || submittedPerks.length === 0) {
    return { error: null };
  }

  const { data: abilities, error: abilityError } = await supabaseAdmin
    .from('class_abilities')
    .select('id')
    .eq('character_id', characterId);
  if (abilityError) return { error: abilityError };
  const allowedAbilityIds = new Set((abilities || []).map(a => a.id));

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('character_perks')
    .select('id, class_ability_id, text, position')
    .eq('character_id', characterId);
  if (existingError) return { error: existingError };

  const existingCounts = new Map();
  // id -> ability, so a new perk may only compound with an existing perk on the
  // SAME ability (mirrors resolveCompoundLinks in the full edit-form path).
  const abilityByExistingPerkId = new Map();
  const existingForValidation = (existing || []).map(p => {
    const pos = parseInteger(p.position, 0);
    existingCounts.set(p.class_ability_id, Math.max(existingCounts.get(p.class_ability_id) ?? -1, pos));
    abilityByExistingPerkId.set(p.id, p.class_ability_id);
    return {
      class_ability_id: p.class_ability_id,
      text: p.text,
      position: pos
    };
  });

  // Build insert rows. `meta` runs parallel to `rows`, carrying each new perk's
  // client `ref` and its requested compound link so we can resolve links after
  // the rows (and their ids) exist.
  const rows = [];
  const meta = [];
  for (const p of submittedPerks) {
    if (!p || typeof p !== 'object') continue;
    const classAbilityId = p.class_ability_id;
    const text = typeof p.text === 'string' ? p.text.trim() : '';
    if (!classAbilityId || !allowedAbilityIds.has(classAbilityId) || !text) continue;
    const nextPosition = (existingCounts.get(classAbilityId) ?? -1) + 1;
    existingCounts.set(classAbilityId, nextPosition);
    rows.push({
      character_id: characterId,
      class_ability_id: classAbilityId,
      text,
      position: nextPosition
    });
    meta.push({
      ref: typeof p.ref === 'string' ? p.ref : null,
      compoundsWith: p.compounds_with == null ? null : String(p.compounds_with)
    });
  }

  if (rows.length === 0) return { error: null };

  const validation = validateAbilityPerks(existingForValidation.concat(rows));
  if (!validation.ok) {
    return { error: { status: 400, message: validation.errors.join(' ') } };
  }

  const { error } = await supabaseAdmin.from('character_perks').insert(rows);
  if (error) return { error };

  // Re-read the rows to recover server-assigned ids. We match by
  // (class_ability_id, position) — each new perk got a unique position above —
  // rather than relying on insert-return ordering.
  const { data: current, error: selError } = await supabaseAdmin
    .from('character_perks')
    .select('id, class_ability_id, position')
    .eq('character_id', characterId);
  if (selError) return { error: selError };
  const idByKey = new Map((current || []).map(r => [`${r.class_ability_id}:${parseInteger(r.position, 0)}`, r.id]));
  const keyOf = (row) => `${row.class_ability_id}:${row.position}`;

  // ref -> { id, class_ability_id } for perks inserted in this batch.
  const insertedByRef = new Map();
  for (let i = 0; i < rows.length; i++) {
    if (!meta[i].ref) continue;
    insertedByRef.set(meta[i].ref, { id: idByKey.get(keyOf(rows[i])), class_ability_id: rows[i].class_ability_id });
  }

  // Resolve each new perk's compound link. A link is either `new:<ref>` (another
  // perk inserted in this batch) or an existing perk UUID. The target must be on
  // the same ability and not the perk itself; anything else resolves to null.
  const linkUpdates = [];
  for (let i = 0; i < rows.length; i++) {
    const link = meta[i].compoundsWith;
    if (!link) continue;
    const rowId = idByKey.get(keyOf(rows[i]));
    if (!rowId) continue;

    let target = null;
    if (link.startsWith('new:')) {
      const ref = link.slice('new:'.length);
      const cand = insertedByRef.get(ref);
      if (cand) target = { id: cand.id, class_ability_id: cand.class_ability_id };
    } else if (abilityByExistingPerkId.has(link)) {
      target = { id: link, class_ability_id: abilityByExistingPerkId.get(link) };
    }

    if (target && target.id && target.id !== rowId && target.class_ability_id === rows[i].class_ability_id) {
      linkUpdates.push({ id: rowId, compounds_with: target.id });
    }
  }

  for (const u of linkUpdates) {
    const { error: updError } = await supabaseAdmin
      .from('character_perks')
      .update({ compounds_with: u.compounds_with })
      .eq('id', u.id);
    if (updError) return { error: updError };
  }

  return { error: null };
};

// Helper to filter class lists/lookup maps by user's unlocked classes
const filterClassDataForUser = async (user) => {
  
  // Load classes from DB by category
  const [adventRes, aspirantRes, pccRes] = await Promise.all([
    getClasses({ is_public: true, is_player_created: false, rules_edition: 'advent' }),
    getClasses({ is_public: true, is_player_created: false, rules_edition: 'aspirant' }),
    getClasses({ is_public: true, is_player_created: true })
  ]);

  const advent = Array.isArray(adventRes.data) ? adventRes.data : [];
  const aspirant = Array.isArray(aspirantRes.data) ? aspirantRes.data : [];
  const pcc = Array.isArray(pccRes.data) ? pccRes.data : [];

  // Default to full class object lists
  let filteredAdvent = advent;
  let filteredAspirant = aspirant;
  let filteredPCC = pcc;

  // Build lookup maps for gear and abilities keyed by class name
  const allClasses = [...advent, ...aspirant, ...pcc];
  let filteredGear = Object.fromEntries(allClasses.map(c => [c.name, Array.isArray(c.gear) ? c.gear.map(g => g.name) : []]));
  let filteredAbilities = Object.fromEntries(allClasses.map(c => [c.name, Array.isArray(c.abilities) ? c.abilities.map(a => a.name) : []]));

  // If user provided, reduce to unlocked set. Unlocks match by class id and
  // extend to same-edition version families (a v1 unlock covers its v2 fork)
  // but never across editions — see util/class-family.js.
  if (user) {
    const { data: allowedIds } = await getUnlockedClassIdsForUser(user.id);
    if (allowedIds && allowedIds.size > 0) {
      const filtered = filterClassListsByIds(
        { advent: filteredAdvent, aspirant: filteredAspirant, pcc: filteredPCC },
        allowedIds
      );
      filteredAdvent = filtered.advent;
      filteredAspirant = filtered.aspirant;
      filteredPCC = filtered.pcc;
      const filterMap = m => Object.fromEntries(Object.entries(m).filter(([k]) => filtered.allowedNames.has(k)));
      filteredGear = filterMap(filteredGear);
      filteredAbilities = filterMap(filteredAbilities);
    } else {
      filteredAdvent = [];
      filteredAspirant = [];
      filteredPCC = [];
      filteredGear = {};
      filteredAbilities = {};
    }
  }

  const splitByVersion = (arr) => ({
    v1: arr.filter(c => (c.rules_version || 'v1') === 'v1'),
    v2: arr.filter(c => c.rules_version === 'v2')
  });
  const splitByEdition = (arr) => ({
    advent:   arr.filter(c => (c.rules_edition || 'advent') === 'advent'),
    aspirant: arr.filter(c => c.rules_edition === 'aspirant')
  });
  const { v1: filteredAdventV1, v2: filteredAdventV2 } = splitByVersion(filteredAdvent);
  const { v1: filteredAspirantV1, v2: filteredAspirantV2 } = splitByVersion(filteredAspirant);
  const { v1: filteredPCCv1, v2: filteredPCCv2 } = splitByVersion(filteredPCC);
  const { advent: filteredPCCAdventV1, aspirant: filteredPCCAspirantV1 } = splitByEdition(filteredPCCv1);
  const { advent: filteredPCCAdventV2, aspirant: filteredPCCAspirantV2 } = splitByEdition(filteredPCCv2);

  return { filteredAdvent, filteredAdventV1, filteredAdventV2, filteredAspirant, filteredAspirantV1, filteredAspirantV2, filteredPCC, filteredPCCAdventV1, filteredPCCAdventV2, filteredPCCAspirantV1, filteredPCCAspirantV2, filteredGear, filteredAbilities };
};

const resolveOffscreenSource = async ({ body, profileId, supabaseClient }) => {
  if (body.source_mission_id && body.source_mission_id !== '__other__') {
    const { data: srcMission, error: srcErr } = await getMission(body.source_mission_id, supabaseClient);
    if (srcErr || !srcMission) return { error: 'Source mission not found.' };
    if (srcMission.host_id !== profileId) return { error: 'Only the host of a mission can use it as a credit source.' };
    return {
      source_mission_id: srcMission.id,
      source_mission_name: srcMission.name,
      source_mission_date: typeof srcMission.date === 'string'
        ? srcMission.date.slice(0, 10)
        : new Date(srcMission.date).toISOString().slice(0, 10)
    };
  }
  const name = (body.source_mission_name_other || '').trim();
  const date = (body.source_mission_date_other || '').trim();
  if (!name || !date) return { error: 'Source mission name and date are required.' };
  return {
    source_mission_id: null,
    source_mission_name: name,
    source_mission_date: date
  };
};

router.get('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { data: characters, error } = await getOwnCharacters(profile, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  } else {
    res.render('character-list', {
      characters,
      activeNav: 'characters',
      breadcrumbs: [
        { label: 'Characters', href: '/characters' }
      ]
    });
  }
});

router.get('/new', isAuthenticated, (req, res) => {
  const { profile } = res.locals;
  res.render('character-new-selector', {
    profile,
    activeNav: 'characters',
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: 'New Character', href: '/characters/new' }
    ]
  });
});

router.get('/new/expert', isAuthenticated, async (req, res) => {
  const { profile, user } = res.locals;
  const { filteredAdventV1, filteredAdventV2, filteredAspirantV1, filteredAspirantV2, filteredPCCAdventV1, filteredPCCAdventV2, filteredPCCAspirantV1, filteredPCCAspirantV2, filteredGear, filteredAbilities } = await filterClassDataForUser(user);
  res.render('character-form', {
    profile,
    isNew: true,
    effectiveVersion: 'v1',
    statList,
    adventV1Classes: filteredAdventV1,
    adventV2Classes: filteredAdventV2,
    aspirantPreviewV1Classes: filteredAspirantV1,
    aspirantPreviewV2Classes: filteredAspirantV2,
    playerCreatedAdventV1Classes: filteredPCCAdventV1,
    playerCreatedAdventV2Classes: filteredPCCAdventV2,
    playerCreatedAspirantV1Classes: filteredPCCAspirantV1,
    playerCreatedAspirantV2Classes: filteredPCCAspirantV2,
    personalityMap,
    classGearList: filteredGear,
    classAbilityList: filteredAbilities,
    activeNav: 'characters',
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: 'New Character', href: '/characters/new' }
    ]
  });
});

router.get('/wizard', isAuthenticated, async (req, res) => {
  const { profile, user } = res.locals;
  const mode = (req.query.mode || 'advent').toString();
  const allowed = ['advent', 'aspiring', 'aspirant'];
  if (!allowed.includes(mode)) {
    return sendError(req, res, null, { status: 400, message: `Invalid mode: ${mode}` });
  }
  const preselectedClassId = (req.query.class || '').toString() || null;

  // Union class list (mode does not filter the class pool per requirements).
  // Each row carries stat_spread (for step 2), gear/abilities (for steps 3-4),
  // and display fields for the slider card. Description and tips are stored
  // as markdown and rendered to safe HTML here so the client can drop them
  // into the wizard panel verbatim (no client-side markdown lib).
  const { filteredAdvent, filteredAspirant, filteredPCC } = await filterClassDataForUser(user);
  const wizardClasses = [...filteredAdvent, ...filteredAspirant, ...filteredPCC]
    .map((c) => ({
      id: c.id,
      name: c.name,
      description_html: renderMarkdown(c.description || ''),
      teaser_html: renderMarkdown(c.teaser || ''),
      tips_html: renderMarkdown(c.tips || ''),
      image_url: c.image_url || null,
      image_crop: c.image_crop || null,
      rules_edition: c.rules_edition || 'advent',
      rules_version: c.rules_version || 'v1',
      is_player_created: !!c.is_player_created,
      // Drives the wizard's step 2 (personality & stat selection). Stored on
      // the class row (migration 20260609_classes_stat_spread); the column
      // defaults to '{}' and is backfilled for official classes via
      // scripts/backfill-class-stats.js.
      stat_spread: c.stat_spread || {},
      gear: Array.isArray(c.gear) ? c.gear : [],
      abilities: Array.isArray(c.abilities) ? c.abilities : [],
      // Pre-render each ability's description to safe HTML so the step 3
      // primer can drop it in directly (consistent with class description).
      abilities_html: Array.isArray(c.abilities)
        ? c.abilities.map((a) => ({
            name: a.name || '',
            description_html: renderMarkdown(a.description || '')
          }))
        : [],
      // Step 4 gear: all 6 class items are available on the right-hand shop
      // at 2 merx each (duplicates allowed, so the user can re-pick a base
      // item from the left list). The first 3 ("base") are also auto-loaded
      // for free on the left. The JS uses `subtype` to badge each card so
      // the user can see which is which.
      class_gear: Array.isArray(c.gear)
        ? c.gear.slice(0, 6).map((g, idx) => ({
            name: g.name || '',
            description_html: renderMarkdown(g.description || ''),
            subtype: idx < 3 ? 'base' : 'elective'
          }))
        : [],
      base_gear: Array.isArray(c.gear)
        ? c.gear.slice(0, 3).map((g) => ({
            name: g.name || '',
            description_html: renderMarkdown(g.description || '')
          }))
        : []
    }));

  // Pre-render common-item descriptions for the step 4 spending list.
  const commonItemsHtml = (commonItemList || []).map((item) => ({
    name: item.name || '',
    description_html: renderMarkdown(item.description || '')
  }));

  res.render('character-wizard', {
    profile,
    mode,
    preselectedClassId,
    wizardClasses,
    statList,
    personalityMap,
    commonItemsHtml,
    wizardData: {
      mode,
      preselectedClassId,
      classes: wizardClasses,
      statList,
      personalityMap,
      commonItems: commonItemsHtml
    },
    activeNav: 'characters',
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: 'New Character', href: '/characters/new' },
      { label: 'Wizard', href: '#' }
    ]
  });
});

router.post('/wizard', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  // The wizard's client posts a single form field, `payload`, holding a JSON
  // string that mirrors the field names views/character-form.handlebars uses
  // (trait0/1/2, gear, common_items, is_public/hide_from_search, creator_mode,
  // ...). createCharacter already knows how to translate those into the
  // characters / traits / class_gear rows, so this handler is a validation
  // pass that, on success, responds with the same HX-Location contract as the
  // expert create route — letting the submit ride htmx's auth/redirect/error
  // pipeline instead of a bespoke fetch.
  let body;
  try {
    body = JSON.parse(req.body.payload || '{}');
  } catch (e) {
    return sendError(req, res, null, { status: 400, message: 'Invalid wizard payload.' });
  }

  const trimmedName = (body.name || '').toString().trim();
  if (!trimmedName) {
    return sendError(req, res, null, { status: 400, message: 'Character name is required.' });
  }
  if (trimmedName.length > 120) {
    return sendError(req, res, null, { status: 400, message: 'Character name is too long (max 120 characters).' });
  }

  // Whitelist creator_mode to the same set the wizard exposes in its mode
  // selector. createCharacter will re-validate and reject anything else.
  const allowedModes = ['advent', 'aspiring', 'aspirant'];
  if (body.creator_mode != null && body.creator_mode !== '' && !allowedModes.includes(body.creator_mode)) {
    return sendError(req, res, null, { status: 400, message: `Invalid mode: ${body.creator_mode}` });
  }

  // Coerce stat values to integers; the model passes them straight through
  // to the characters row. Unknown stat keys (shouldn't happen, but the
  // wizard is client-built) are silently dropped.
  const knownStats = new Set(statList);
  for (const k of Object.keys(body)) {
    if (knownStats.has(k)) body[k] = parseInteger(body[k], 0);
  }

  // Coerce level / completed_missions / visibility booleans to defensible
  // shapes. The form-input handlers in createCharacter also do this for
  // is_public / hide_from_search, but doing it here keeps the DB write from
  // seeing "on" as a string and stops an out-of-range number from
  // contaminating the row.
  if (body.level != null) {
    body.level = Math.max(1, Math.min(20, parseInteger(body.level, 1)));
  }
  if (body.completed_missions != null) {
    body.completed_missions = Math.max(0, parseInteger(body.completed_missions, 0));
  }
  // The wizard's UI has no commissary_reward field; the column is NOT NULL,
  // so default to 0 unless auto_calculate-derived downstream overrides it.
  body.commissary_reward = Math.max(0, parseInteger(body.commissary_reward, 0));
  body.name = trimmedName;
  body.is_public = body.is_public === false ? false : true;
  body.hide_from_search = !!body.hide_from_search;

  // The 12 stat ints stay on `body` as normal columns: createCharacter only
  // pulls out the keys it owns (trait0/1/2, gear, abilities, ability_perks,
  // common_items) before insert, so the stats pass straight through.
  const { data, error } = await createCharacter(body, profile);
  if (error) {
    // createCharacter returns string errors for some validation paths
    // (e.g. invalid creator_mode, v2 ability-perk validation). Wrap those
    // so sendError gets a recognizable shape.
    const errObj = typeof error === 'string' ? { message: error } : error;
    return sendError(req, res, errObj);
  }
  const character = Array.isArray(data) ? data[0] : data;
  if (!character) {
    return sendError(req, res, null, { status: 400, message: 'Character creation returned no rows' });
  }
  return res.header('HX-Location', `/characters/${character.id}/${encodeURIComponent(character.name)}`).send();
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  } else if (character.creator_id !== profile.id) {
    return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
  } else {
    const { filteredAdvent, filteredAdventV1, filteredAdventV2, filteredAspirant, filteredAspirantV1, filteredAspirantV2, filteredPCC, filteredPCCAdventV1, filteredPCCAdventV2, filteredPCCAspirantV1, filteredPCCAspirantV2, filteredGear, filteredAbilities } = await filterClassDataForUser(res.locals.user);

    // Inject existing character gear/abilities into dropdown options so
    // items from classes the user no longer has unlocked still appear
    const allFilteredClasses = [...filteredAdvent, ...filteredAspirant, ...filteredPCC];
    if (Array.isArray(character.gear)) {
      for (const g of character.gear) {
        if (!g?.name || !g?.class_id) continue;
        let className = allFilteredClasses.find(c => c.id === g.class_id)?.name;
        if (!className) {
          try { className = (await getClass(g.class_id, res.locals.supabase))?.data?.name; } catch (_) {}
        }
        if (!className) continue;
        if (!filteredGear[className]) filteredGear[className] = [];
        if (!filteredGear[className].includes(g.name)) filteredGear[className].push(g.name);
      }
    }
    if (Array.isArray(character.abilities)) {
      for (const a of character.abilities) {
        if (!a?.name || !a?.class_id) continue;
        let className = allFilteredClasses.find(c => c.id === a.class_id)?.name;
        if (!className) {
          try { className = (await getClass(a.class_id, res.locals.supabase))?.data?.name; } catch (_) {}
        }
        if (!className) continue;
        if (!filteredAbilities[className]) filteredAbilities[className] = [];
        if (!filteredAbilities[className].includes(a.name)) filteredAbilities[className].push(a.name);
      }
    }

    let characterClass = null;
    let effectiveVersion = 'v1';
    if (character.class_id) {
      try {
        const { data: cls } = await getClass(character.class_id, res.locals.supabase);
        if (cls) {
          characterClass = cls;
          if (cls.rules_version === 'v2') effectiveVersion = 'v2';
        }
      } catch (_) {}
    }

    const [missionsRes, offscreenRes] = await Promise.all([
      getCharacterRealMissionsForDerivation(id, supabaseAdmin),
      listOffscreenMissions({ characterId: id, supabase: supabaseAdmin })
    ]);
    const derived = deriveCharacterTotals({
      character,
      realMissions: missionsRes.data || [],
      offscreenMissions: offscreenRes.data || [],
      rulesVersion: effectiveVersion
    });

    let upgradeTargets = [];
    if (characterClass) {
      upgradeTargets = await findUpgradeTargetsFor(characterClass.id, res.locals.supabase);
    }

    res.render('character-form', {
      profile,
      isNew: false,
      character,
      effectiveVersion,
      characterClass,
      upgradeTargets,
      derived,
      autoCalculate: character.auto_calculate,
      statList,
      adventV1Classes: filteredAdventV1,
      adventV2Classes: filteredAdventV2,
      aspirantPreviewV1Classes: filteredAspirantV1,
      aspirantPreviewV2Classes: filteredAspirantV2,
      playerCreatedAdventV1Classes: filteredPCCAdventV1,
      playerCreatedAdventV2Classes: filteredPCCAdventV2,
      playerCreatedAspirantV1Classes: filteredPCCAspirantV1,
      playerCreatedAspirantV2Classes: filteredPCCAspirantV2,
      personalityMap,
      classGearList: filteredGear,
      classAbilityList: filteredAbilities,
      activeNav: 'characters',
      breadcrumbs: [
        { label: 'Characters', href: '/characters' },
        { label: character.name, href: `/characters/${id}/${encodeURIComponent(character.name)}` },
        { label: 'Edit', href: '#' }
      ]
    });
  }
});

router.get('/:id/auto-calc-fields', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const on = req.query.on === '1' || req.query.on === 1 || req.query.on === true || req.query.on === 'true';

  const { data: character, error } = await getCharacter(id, res.locals.supabase);
  if (error || !character) return sendError(req, res, error, { message: 'Character not found' });
  if (character.creator_id !== profile.id) return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });

  let effectiveVersion = 'v1';
  if (character.class_id) {
    try {
      const { data: cls } = await getClass(character.class_id, res.locals.supabase);
      if (cls && cls.rules_version === 'v2') effectiveVersion = 'v2';
    } catch (_) {}
  }

  let derived = { completed_missions: 0, commissary_reward: 0, level: 1 };
  if (on) {
    const [missionsRes, offscreenRes] = await Promise.all([
      getCharacterRealMissionsForDerivation(id, supabaseAdmin),
      listOffscreenMissions({ characterId: id, supabase: supabaseAdmin })
    ]);
    if (missionsRes.error || offscreenRes.error) {
      return sendError(req, res, null, { status: 503, message: 'Failed to load mission data' });
    }
    derived = deriveCharacterTotals({
      character,
      realMissions: missionsRes.data || [],
      offscreenMissions: offscreenRes.data || [],
      rulesVersion: effectiveVersion
    });
  }

  return res.render('partials/character-auto-calc-fields', {
    layout: false,
    character,
    derived,
    autoCalculate: on,
    effectiveVersion
  });
});

router.get('/:id/offscreen-missions/new', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id, res.locals.supabase);
  if (error) return sendError(req, res, error);
  if (character.creator_id !== profile.id) return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });

  const { data: availableHostedMissions } = await getAvailableHostedMissionsForPicker({
    profileId: profile.id,
    supabase: res.locals.supabase
  });
  const { data: profileCredits } = await getProfileConduitCredits({
    profileId: profile.id,
    supabase: res.locals.supabase
  });

  res.render('offscreen-mission-new', {
    title: `Spend a Credit — ${character.name}`,
    profile,
    character,
    availableHostedMissions: availableHostedMissions || [],
    profileCredits: profileCredits || { earned: 0, spent_linked: 0, balance: 0 },
    formAction: `/characters/${id}/offscreen-missions`,
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: character.name, href: `/characters/${id}/${encodeURIComponent(character.name)}` },
      { label: 'Spend Conduit Credit', href: '#' }
    ]
  });
});

router.post('/:id/offscreen-missions', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id: characterId } = req.params;

  const { data: character, error: charError } = await getCharacter(characterId, res.locals.supabase);
  if (charError) return sendError(req, res, charError);
  if (character.creator_id !== profile.id) return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });

  const src = await resolveOffscreenSource({
    body: req.body, profileId: profile.id, supabaseClient: res.locals.supabase
  });
  if (src.error) return sendError(req, res, null, { status: 400, message: src.error });

  if (!req.body.name || !req.body.summary) {
    return sendError(req, res, null, { status: 400, message: 'Name and summary are required.' });
  }

  // If the user picked a hosted mission as the source, gate on the profile's balance.
  // Free-text sources bypass the gate.
  if (src.source_mission_id) {
    const { data: credits } = await getProfileConduitCredits({
      profileId: profile.id,
      supabase: res.locals.supabase
    });
    if (!credits || credits.balance <= 0) {
      return sendError(req, res, null, { status: 400, message: 'No Conduit Credits available.' });
    }
  }

  const { error } = await createOffscreenMission({
    characterId,
    profileId: profile.id,
    payload: {
      name: req.body.name,
      summary: req.body.summary,
      merx_gained: req.body.merx_gained,
      source_mission_id: src.source_mission_id,
      source_mission_name: src.source_mission_name,
      source_mission_date: src.source_mission_date
    },
    supabase: res.locals.supabase
  });

  if (error) {
    if (error.code === '23505' || error.message === 'duplicate_source_mission') {
      return sendError(req, res, error, { status: 400, message: 'That mission has already funded a credit.' });
    }
    return sendError(req, res, error);
  }

  return res.redirect(`/characters/${characterId}/${encodeURIComponent(character.name)}`);
});

router.get('/:id/offscreen-missions/:omId/edit', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id: characterId, omId } = req.params;

  const { data: character, error: charError } = await getCharacter(characterId, res.locals.supabase);
  if (charError) return sendError(req, res, charError);
  if (character.creator_id !== profile.id) return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });

  const { data: offscreenMission, error: omError } = await getOffscreenMissionById({
    id: omId,
    supabase: res.locals.supabase
  });
  if (omError) return sendError(req, res, omError);
  if (!offscreenMission || offscreenMission.character_id !== characterId) {
    return sendError(req, res, null, { status: 404, message: 'Not found' });
  }

  const { data: availableHostedMissions } = await getAvailableHostedMissionsForPicker({
    profileId: profile.id,
    currentSourceId: offscreenMission.source_mission_id || null,
    supabase: res.locals.supabase
  });

  res.render('offscreen-mission-edit', {
    title: `Edit Offscreen Mission — ${character.name}`,
    profile,
    character,
    offscreenMission,
    availableHostedMissions: availableHostedMissions || [],
    formAction: `/characters/${characterId}/offscreen-missions/${omId}`,
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: character.name, href: `/characters/${characterId}/${encodeURIComponent(character.name)}` },
      { label: 'Edit Offscreen Mission', href: '#' }
    ]
  });
});

router.post('/:id/offscreen-missions/:omId', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id: characterId, omId } = req.params;

  const { data: character, error: charError } = await getCharacter(characterId, res.locals.supabase);
  if (charError) return sendError(req, res, charError);
  if (character.creator_id !== profile.id) return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });

  const { data: existing, error: omError } = await getOffscreenMissionById({
    id: omId,
    supabase: res.locals.supabase
  });
  if (omError) return sendError(req, res, omError);
  if (!existing || existing.character_id !== characterId) {
    return sendError(req, res, null, { status: 404, message: 'Not found' });
  }

  if (!req.body.name || !req.body.summary) {
    return sendError(req, res, null, { status: 400, message: 'Name and summary are required.' });
  }

  const src = await resolveOffscreenSource({
    body: req.body, profileId: profile.id, supabaseClient: res.locals.supabase
  });
  if (src.error) return sendError(req, res, null, { status: 400, message: src.error });

  const { error } = await updateOffscreenMission({
    id: omId,
    payload: {
      name: req.body.name,
      summary: req.body.summary,
      merx_gained: req.body.merx_gained,
      source_mission_id: src.source_mission_id,
      source_mission_name: src.source_mission_name,
      source_mission_date: src.source_mission_date
    },
    supabase: res.locals.supabase
  });
  if (error) {
    if (error.code === '23505' || error.message === 'duplicate_source_mission') {
      return sendError(req, res, error, { status: 400, message: 'That mission has already funded a credit.' });
    }
    return sendError(req, res, error);
  }

  return res.redirect(`/characters/${characterId}/${encodeURIComponent(character.name)}`);
});

router.post('/:id/offscreen-missions/:omId/delete', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id: characterId, omId } = req.params;

  const { data: character, error: charError } = await getCharacter(characterId, res.locals.supabase);
  if (charError) return sendError(req, res, charError);
  if (character.creator_id !== profile.id) return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });

  const { data: existing, error: omError } = await getOffscreenMissionById({
    id: omId,
    supabase: res.locals.supabase
  });
  if (omError) return sendError(req, res, omError);
  if (!existing || existing.character_id !== characterId) {
    return sendError(req, res, null, { status: 404, message: 'Not found' });
  }

  const { error } = await removeOffscreenMission({ id: omId, supabase: res.locals.supabase });
  if (error) return sendError(req, res, error);

  return res.redirect(`/characters/${characterId}/${encodeURIComponent(character.name)}`);
});

router.post('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const image_crop = parseImageCrop(req.body.image_crop);
  if (image_crop !== undefined) {
    req.body.image_crop = image_crop;
  }
  req.body.ability_perks = collectAbilityPerks(req.body);
  req.body.quirks = collectNamed(req.body, 'quirk_name', 'quirk_description');
  req.body.accessories = collectNamed(req.body, 'accessory_name', 'accessory_description');
  // Strip the parallel arrays so they don't reach Supabase as unknown columns.
  delete req.body.ability_perk_class_ability_id;
  delete req.body.ability_perk_text;
  delete req.body.ability_perk_position;
  delete req.body.ability_perk_compounds_with;
  delete req.body.quirk_name;
  delete req.body.quirk_description;
  delete req.body.accessory_name;
  delete req.body.accessory_description;
  const { data, error } = await createCharacter(req.body, profile);
  if (error) {
    return sendError(req, res, error);
  } else {
    const character = Array.isArray(data) ? data[0] : data;
    if (!character) {
      return sendError(req, res, null, { status: 400, message: 'Character creation returned no rows' });
    }
    return res.header('HX-Location', `/characters/${character.id}/${encodeURIComponent(character.name)}`).send();
  }
});

router.get('/class-gear', authOptional, async (req, res) => {
  const { filteredGear } = await filterClassDataForUser(res.locals.user);
  res.render('partials/character-class-gear', { layout: false, classGearList: filteredGear });
});

router.get('/class-abilities', authOptional, async (req, res) => {
  const { filteredAbilities } = await filterClassDataForUser(res.locals.user);
  res.render('partials/character-class-abilities', { layout: false, classAbilityList: filteredAbilities });
});

router.get('/common-item', authOptional, async (req, res) => {
  res.render('partials/character-common-item', { layout: false });
});

router.get('/quirk', authOptional, (req, res) => {
  res.render('partials/character-quirk', { layout: false, quirk: {} });
});

router.get('/accessory', authOptional, (req, res) => {
  res.render('partials/character-accessory', { layout: false, accessory: {} });
});

router.get('/ability-perk', authOptional, (req, res) => {
  const abilityId = req.query.ability_id;
  const position = Number(req.query.position) || 0;
  if (!abilityId) return sendError(req, res, null, { status: 400, message: 'ability_id required' });
  res.render('partials/character-ability-perk', {
    layout: false,
    perk: { text: '', compounds_with: null },
    abilityId,
    position,
    siblingPerks: []
  });
});

router.get('/ability-perk-group', authOptional, (req, res) => {
  const ability = (req.query.ability || '').toString().trim();
  const key = (req.query.key || '').toString().trim();
  if (!ability) return sendError(req, res, null, { status: 400, message: 'ability required' });
  res.render('partials/character-perk-group', {
    layout: false,
    linkValue: ability,
    domKey: key || ability,
    abilityName: ability,
    abilityPerks: []
  });
});

router.get('/version-fields', authOptional, async (req, res) => {
  const classId = req.query.class_id;
  let effectiveVersion = 'v1';
  if (classId) {
    try {
      const { data: cls } = await getClass(classId, res.locals.supabase);
      if (cls && cls.rules_version === 'v2') effectiveVersion = 'v2';
    } catch (_) {}
  }

  if (effectiveVersion !== 'v2') {
    // Return an empty container so the swap target stays present for future
    // version changes within the same form session.
    return res.send('<div id="v2-fields-container"></div>');
  }

  res.render('partials/character-v2-fields', {
    layout: false,
    // No existing character context yet (this is the change-on-select path);
    // render with an empty character so the v2 fields show as blank rows.
    character: { quirks: [], accessories: [], ability_perks: [], abilities: [] }
  });
});

router.get('/import', isAuthenticated, (req, res) => {
  const { profile } = res.locals;
  res.render('character-import', {
    profile,
    activeNav: 'characters',
    breadcrumbs: [
      { label: 'Characters', href: '/characters' },
      { label: 'Import Character', href: '/characters/import' }
    ]
  });
});

router.post('/import', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { inputText } = req.body;
  try {
    const result = await processCharacterImport(inputText, profile);
    const character = result.character;
    if (!character) {
      return sendError(req, res, null, { status: 400, message: 'No character found in import' });
    }
    return res.header('HX-Location', `/characters/${character.id}/${encodeURIComponent(character.name)}`).send();
  } catch (error) {
    return sendError(req, res, error);
  }
});

router.get('/add-to-mission-search', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { q, count, mission:missionId } = req.query;

  const { data: mission, errorMission } = await getMission(missionId, res.locals.supabase);
  if (errorMission) {
    return sendError(req, res, errorMission);
  }

  if (!q || q.length < 2) {
    res.render('partials/add-to-mission-search-results', { 
      layout: false, 
      characters: [],
      mission,
      q
    });
    return;
  }
  const { data: characters, error } = await searchPublicCharacters(q, count);

  if (error) {
    return sendError(req, res, error);
  } else {
    res.render('partials/add-to-mission-search-results', { 
      layout: false, 
      characters,
      mission,
      q
    });
  }
});

router.get('/s', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { q, count } = req.query;
  const classId = req.query.classId || null;
  const className = req.query.class || null;

  const hasQuery = q && q.length >= 2;
  const hasClassFilter = !!(classId || className);

  if (!hasQuery && !hasClassFilter) {
    res.render('partials/character-search-results', {
      layout: false,
      characters: [],
      q,
      classFilter: null
    });
    return;
  }

  const options = {};
  if (classId) options.classId = classId;
  if (!options.classId && className) options.className = className;

  const { data: characters, error } = await searchPublicCharacters(hasQuery ? q : null, count, options);

  if (error) {
    return sendError(req, res, error);
  } else {
    res.render('partials/character-search-results', {
      layout: false,
      characters,
      q,
      classFilter: classId || className || null
    });
  }
});

router.get('/search', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const [{ data: classes }] = await Promise.all([
    getClasses({ is_public: true })
  ]);
  const { data: initialCharacters } = await getRandomPublicCharacters(12);

  res.render('character-search', {
    profile,
    classes: Array.isArray(classes) ? classes : [],
    initialCharacters: Array.isArray(initialCharacters) ? initialCharacters : [],
    activeNav: 'search-characters',
    breadcrumbs: [
      { label: 'Search Characters', href: '/characters/search' }
    ]
  });
});

router.get('/:id/export', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const format = req.query.format || EXPORT_FORMATS.MARKDOWN;
  
  // Validate format
  const supportedFormats = getSupportedFormats();
  if (!supportedFormats.includes(format)) {
    return sendError(req, res, null, { status: 400, message: `Unsupported format. Supported formats: ${supportedFormats.join(', ')}` });
  }

  const { data: character, error } = await getCharacter(id, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  }

  // Only the owner can export their character
  if (character.creator_id !== profile.id) {
    return sendError(req, res, null, { status: 403, title: 'No access', message: 'You can only export your own characters' });
  }
  
  const { content, mimeType, filename } = exportCharacter(character, format, {
    includePrivateNotes: true,
  });
  
  res.setHeader('Content-Type', `${mimeType}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Length', Buffer.byteLength(content, 'utf-8'));
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(content);
});

router.get('/:id/:name?', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { data: character, error } = await getCharacter(id, res.locals.supabase);
  if (error) {
    return sendError(req, res, error);
  } else {
    if (character.is_public === false && (!profile || character.creator_id !== profile.id)) {
      return sendError(req, res, null, { status: 404, message: 'Not found' });
    } else {
      const { data: recentMissions } = await getCharacterRecentMissions(id);

      const { data: offscreenMissions } = await listOffscreenMissions({
        characterId: id,
        supabase: res.locals.supabase
      });

      // Merge real missions and offscreen entries into a single chronological list.
      // Each entry carries a `_kind` discriminator so the view can choose its renderer.
      const mergedRecent = [
        ...(recentMissions || []).map(m => ({ _kind: 'mission', ...m })),
        ...(offscreenMissions || []).map(om => ({ _kind: 'offscreen', ...om }))
      ];
      const dateOf = (e) => e._kind === 'offscreen' ? e.source_mission_date : e.date;
      mergedRecent.sort((a, b) => new Date(dateOf(b)) - new Date(dateOf(a)));
      const recentMerged = mergedRecent.slice(0, 5);

      // fetch class record (non-fatal on failure)
      let characterClass = null;
      try {
        if (character.class_id) {
          const { data: cls } = await getClass(character.class_id, res.locals.supabase);
          if (cls) {
            characterClass = cls;
          }
        }
      } catch (_) {
        // ignore; continue rendering without class details
      }

      // fetch creator profile
      let ownerProfile = null;
      try {
        const { data: creator } = await getProfileById(character.creator_id, res.locals.supabase);
        if (creator) ownerProfile = creator;
      } catch (_) {
        // owner link is optional
      }

      // compute tooltip availability and description maps (never block render)
      try {
        const characterId = character.id;
        let hostingViaLfg = false;

        // If an LFG context is provided and the current user is the host for this character on that post,
        // allow full descriptions regardless of unlocks
        if (profile && req.query.lfg) {
          try {
            const { data: lfgPost } = await getLfgPost(req.query.lfg, res.locals.supabase);
            if (lfgPost && lfgPost.host_id === profile.id) {
              hostingViaLfg = Array.isArray(lfgPost.join_requests) && lfgPost.join_requests.some(r =>
                r && r.status === 'approved' && r.character && r.character.id === characterId
              );
            }
          } catch (_) { /* ignore; hostingViaLfg remains false */ }
        }

        if (!profile) {
          // Not logged in: hide all descriptions
          if (Array.isArray(character.abilities)) {
            for (const ability of character.abilities) {
              ability.description = '';
            }
          }
          if (Array.isArray(character.gear)) {
            for (const gear of character.gear) {
              gear.description = '';
            }
          }
        } else if (!hostingViaLfg) {
          // Logged in but not host in this LFG context: enforce unlock gating
          const userId = profile.user_id || (res.locals.user && res.locals.user.id) || null;
          let unlockedClassIds = new Set();
          try {
            // Use admin-backed lookup: the shared anon client no longer carries the
            // user's JWT (setSession was removed), so RLS on class_unlocks would
            // return zero rows and wipe every description.
            const { data: ids } = await getUnlockedClassIdsForUser(userId);
            if (ids instanceof Set) {
              unlockedClassIds = ids;
            }
          } catch (e) {
            // On error fetching unlocks, default to hiding everything that is class-gated
            unlockedClassIds = new Set();
          }

          if (Array.isArray(character.abilities)) {
            for (const ability of character.abilities) {
              if (ability && ability.class_id && !unlockedClassIds.has(ability.class_id)) {
                ability.description = '';
              }
            }
          }
          if (Array.isArray(character.gear)) {
            for (const gear of character.gear) {
              if (gear && gear.class_id && !unlockedClassIds.has(gear.class_id)) {
                gear.description = '';
              }
            }
          }
        }
      } catch (_) {
        // Never block page render for tooltip logic; fail closed by hiding descriptions
        try {
          if (Array.isArray(character.abilities)) {
            for (const ability of character.abilities) {
              if (ability) ability.description = '';
            }
          }
          if (Array.isArray(character.gear)) {
            for (const gear of character.gear) {
              if (gear) gear.description = '';
            }
          }
        } catch (_) { /* ignore */ }
      }

      const effectiveVersion = (characterClass && characterClass.rules_version === 'v2') ? 'v2' : 'v1';

      res.render('character', {
        title: character.name,
        profile,
        character,
        characterClass,
        effectiveVersion,
        ownerProfile,
        recentMissions,
        recentMerged,
        statList,
        authOptional: true,
        activeNav: 'characters',
        breadcrumbs: [
          { label: 'Characters', href: '/characters' },
          { label: character.name, href: `/characters/${id}/${encodeURIComponent(character.name)}` }
        ]
      });
    }
  }
});

router.patch('/:id/stats', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { character, error: charError } = await getOwnedCharacterForMutation({ characterId: id, profile });
  if (charError) return sendRouteError(req, res, charError);

  const stats = normalizeStatsPayload(req.body || {});
  const { data, error } = await updateOwnedCharacterFields({
    characterId: id,
    profileId: profile.id,
    fields: stats
  });
  if (error) return sendError(req, res, error);
  return res.status(200).json({
    character: {
      id: data.id,
      name: data.name || character.name,
      stats: Object.fromEntries(statList.map(stat => [stat, data[stat] ?? stats[stat]]))
    }
  });
});

router.post('/:id/level-up', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const body = req.body || {};
  const { character, error: charError } = await getOwnedCharacterForMutation({ characterId: id, profile });
  if (charError) return sendRouteError(req, res, charError);

  const currentLevel = Math.max(1, parseInteger(character.level, 1));
  const requestedLevel = Math.max(currentLevel + 1, Math.min(20, parseInteger(body.level, currentLevel + 1)));
  const currentCompleted = Math.max(0, parseInteger(character.completed_missions, 0));
  const requestedCompleted = Math.max(currentCompleted, parseInteger(body.completed_missions, currentCompleted));
  const missionNames = Array.isArray(body.mission_names)
    ? body.mission_names.map(v => String(v || '').trim()).filter(Boolean)
    : [];
  const useConduitCredit = body.use_conduit_credit === true || body.use_conduit_credit === 'true' || body.use_conduit_credit === 'on';
  const creditCount = useConduitCredit ? Math.max(0, requestedCompleted - currentCompleted - missionNames.length) : 0;

  if (!useConduitCredit && requestedCompleted > currentCompleted + missionNames.length) {
    return sendError(req, res, null, {
      status: 400,
      message: 'Provide mission names for each missing mission, or spend Conduit Credits.'
    });
  }

  let creditSources = [];
  if (creditCount > 0) {
    const { data: availableHostedMissions, error: availableError } = await getAvailableHostedMissionsForPicker({
      profileId: profile.id,
      supabase: supabaseAdmin
    });
    if (availableError) return sendError(req, res, availableError);
    creditSources = (availableHostedMissions || []).slice(0, creditCount);
    if (creditSources.length < creditCount) {
      return sendError(req, res, null, {
        status: 400,
        message: 'Not enough Conduit Credits available.'
      });
    }
  }

  for (const name of missionNames) {
    const { error } = await createBackfillMissionForCharacter({ characterId: id, name, profile });
    if (error) return sendRouteError(req, res, error);
  }

  for (let i = 0; i < creditSources.length; i++) {
    const src = creditSources[i];
    const sourceDate = typeof src.date === 'string'
      ? src.date.slice(0, 10)
      : new Date(src.date).toISOString().slice(0, 10);
    const { error } = await createOffscreenMission({
      characterId: id,
      profileId: profile.id,
      payload: {
        name: `Conduit Credit: Level ${requestedLevel}`,
        summary: 'Spent through the level-up modal.',
        merx_gained: 0,
        source_mission_id: src.id,
        source_mission_name: src.name || `Hosted mission ${i + 1}`,
        source_mission_date: sourceDate
      },
      supabase: supabaseAdmin
    });
    if (error) return sendRouteError(req, res, error);
  }

  // Re-derive level / completed_missions / commissary_reward from the rows we
  // just created (real success missions and offscreen credits) so the stored
  // counters match what every derive-path computes. The character detail page
  // renders the stored commissary_reward directly, so writing raw requested
  // values here left it stale — each backfilled success mission is worth
  // MERX_PER_MISSION_SUCCESS that never landed in the column.
  const [missionsRes, offscreenRes] = await Promise.all([
    getCharacterRealMissionsForDerivation(id, supabaseAdmin),
    listOffscreenMissions({ characterId: id, supabase: supabaseAdmin })
  ]);
  if (missionsRes.error || offscreenRes.error) {
    return sendError(req, res, missionsRes.error || offscreenRes.error);
  }

  let rulesVersion = 'v1';
  if (character.class_id) {
    try {
      const { data: cls } = await getClass(character.class_id, supabaseAdmin);
      if (cls && cls.rules_version === 'v2') rulesVersion = 'v2';
    } catch (_) { /* default to v1 */ }
  }

  const derived = deriveCharacterTotals({
    character,
    realMissions: missionsRes.data || [],
    offscreenMissions: offscreenRes.data || [],
    rulesVersion
  });

  const stats = normalizeStatsPayload(body.stats || body);
  const fields = {
    ...stats,
    level: derived.level,
    completed_missions: derived.completed_missions,
    commissary_reward: derived.commissary_reward
  };
  const { data, error } = await updateOwnedCharacterFields({
    characterId: id,
    profileId: profile.id,
    fields
  });
  if (error) return sendError(req, res, error);

  const { error: perksError } = await appendCharacterPerks({
    characterId: id,
    submittedPerks: Array.isArray(body.ability_perks) ? body.ability_perks : []
  });
  if (perksError) return sendRouteError(req, res, perksError);

  return res.status(200).json({
    character: {
      id: data.id,
      name: data.name || character.name,
      level: data.level,
      completed_missions: data.completed_missions,
      commissary_reward: data.commissary_reward
    }
  });
});

router.put('/:id/:name?', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const image_crop = parseImageCrop(req.body.image_crop);
  if (image_crop !== undefined) {
    req.body.image_crop = image_crop;
  }
  req.body.ability_perks = collectAbilityPerks(req.body);
  req.body.quirks = collectNamed(req.body, 'quirk_name', 'quirk_description');
  req.body.accessories = collectNamed(req.body, 'accessory_name', 'accessory_description');
  // Strip the parallel arrays so they don't reach Supabase as unknown columns.
  delete req.body.ability_perk_class_ability_id;
  delete req.body.ability_perk_text;
  delete req.body.ability_perk_position;
  delete req.body.ability_perk_compounds_with;
  delete req.body.quirk_name;
  delete req.body.quirk_description;
  delete req.body.accessory_name;
  delete req.body.accessory_description;
  const { data, error } = await updateCharacter(id, req.body, profile);
  if (error) {
    return sendError(req, res, error);
  } else {
    return res.header('HX-Location', `/characters/${id}/${encodeURIComponent(data.name)}`).send();
  }
});

router.delete('/:id/:name?', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { error } = await deleteCharacter(id, profile);
  if (error) {
    return sendError(req, res, error);
  } else {
    return res.header('HX-Location', '/characters').send();
  }
});

router.post('/:id/upgrade', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { target_class_id } = req.body;
  const { data, error } = await upgradeCharacterClass(id, target_class_id, profile, res.locals.supabase);
  if (error) return sendError(req, res, error);
  return res.header('HX-Location', `/characters/${id}/edit`).send();
});

router.post('/:id/deceased', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const { confirmName } = req.body;

  // Get the character to verify ownership and name
  const { data: character, error: getError } = await getCharacter(id, res.locals.supabase);
  if (getError) {
    return sendError(req, res, getError);
  }

  // Verify the confirmation name matches
  if (!confirmName || confirmName.trim() !== character.name) {
    return sendError(req, res, null, { status: 400, message: 'Character name does not match. Please type the exact name to confirm.' });
  }

  // Mark as deceased
  const { data, error } = await markCharacterDeceased(id, profile);
  if (error) {
    return sendError(req, res, error);
  }

  return res.header('HX-Location', `/characters/${id}/${encodeURIComponent(data.name)}`).send();
});

module.exports = router;
