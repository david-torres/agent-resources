const express = require('express');
const moment = require('moment-timezone');
const router = express.Router();
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id']);
const {
  getOwnCharacters,
  getCharacter,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  markCharacterDeceased,
  getCharacterRecentMissions,
  searchPublicCharacters,
  getRandomPublicCharacters,
  upgradeCharacterClass,
  updateCharacterStats,
  levelUpCharacter,
  createCharacterOffscreenMission,
  updateCharacterOffscreenMission,
  deleteCharacterOffscreenMission,
  findUpgradeTargetsFor
} = require('../models/character');
const characterRepository = require('../services/character/repository');
const { applyDescriptionGate } = require('../services/character/description-gate');
const { normalizeWizardPayload, collectCharacterFormArrays } = require('../services/character/input');
const { getMission } = require('../models/mission');
const { actorFromLocals } = require('../util/actor');
const { asyncHandler } = require('../util/async-handler');
const { getClasses, getClass, getUnlockedClassIdsForUser } = require('../models/class');
const { getProfileById, getProfileConduitCredits } = require('../models/profile');
const { statList, personalityMap, commonItemList, MERX_PER_MISSION_SUCCESS } = require('../util/enclave-consts');
const { deriveCharacterTotals, deriveMerxBreakdown, deriveMissionMerx, ADVENT_DEFAULT_SIGNATURES } = require('../util/character-derived');
const { buildGearPurchaseData, applyGearPurchases } = require('../util/gear-purchase-data');
const { economyFor, economyFigures } = require('../util/merx-economy');
const { statCapMap, statCapFigures } = require('../util/stat-caps');
const { filterClassListsByIds } = require('../util/class-filter');
const { latestClassVersions } = require('../util/class-list-grouping');
const { getOffscreenMissionById, listOffscreenMissions, getAvailableHostedMissionsForPicker } = require('../models/offscreen-mission');
const { isAuthenticated, authOptional } = require('../util/auth');
const { sendError, FRIENDLY_NOT_FOUND } = require('../util/http-error');
const { renderMarkdown } = require('../util/markdown');
const { processCharacterImport } = require('../util/character-import');
const { exportCharacter, getSupportedFormats, EXPORT_FORMATS } = require('../util/character-export');
const { parseImageCrop } = require('../util/crop');


// Renders a service-returned { status, title, message }-shaped error (or a
// plain Error/string) with the appropriate status — the equivalent of
// passing a pre-classified shape through as sendError's `opts`. Kept at the
// route layer (not an admin site) for the stats/level-up capabilities' business-
// rule errors (insufficient credits, name mismatch, perk validation, ...);
// the ownership/authorization gate itself throws and is handled by asyncHandler.
const sendRouteError = (req, res, error) => {
  if (error && (error.status != null || error.title)) {
    return sendError(req, res, null, error);
  }
  return sendError(req, res, error);
};

// createCharacter/updateCharacter return a bare STRING for every validation
// failure normalizeCharacterInput reports (over-budget, over-cap, invalid
// creator_mode, malformed gear/mods, ...) -- by construction a message meant
// for the player, never an exception. Passed to sendError with no opts, a
// string has no `.code` for classifyError's switch to match, so it falls
// into the `default` branch and is reported as a 500 "Something went wrong",
// with the actual reason suppressed outright once NODE_ENV isn't literally
// 'development' (util/http-error.js#isProd) -- which is every real
// deployment. Refusing an over-budget or over-cap build is an expected,
// everyday outcome of the Merx economy this app enforces; the player is
// entitled to be told why, not just that something broke.
//
// This gives a string that shape explicitly, so the real message reaches the
// player. An Error/object-shaped failure (a genuine 500, a Postgres error
// carrying its own `.code`) is left untouched and keeps classifying exactly
// as it did before this existed.
const sendCharacterSaveError = (req, res, error) => {
  if (typeof error === 'string') {
    // `message` is passed in the fallback, not left for classifyError to
    // derive: its own default branch's message is isProd()-gated exactly
    // because it does not know an unclassified error is safe to show. This
    // one is -- it is the validation string this route asked
    // createCharacter/updateCharacter for -- so the fallback states all
    // three of status/title/message and none of classifyError's own
    // (null-error) base values survive to the response.
    return sendError(req, res, null, { status: 400, title: 'Invalid submission', message: error });
  }
  return sendError(req, res, error);
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
    // No character and no class yet, so every Stat is at its base Cap. Passed
    // anyway: the stat-blocks partial interpolates `max` straight into its
    // x-data expression, so an absent value is a SyntaxError, not a default.
    statCaps: statCapMap({ statList }),
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
    adventDefaultSignatures: ADVENT_DEFAULT_SIGNATURES,
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
  // and display fields for the slider card. Teaser and tips are stored as
  // markdown and rendered to safe HTML here so the client can drop them into
  // the wizard panel verbatim (no client-side markdown lib).
  // The kiosk shows one card per class, so version families collapse to their
  // latest member (same rule as the /classes list). A preselected class is
  // exempt: a link from an older version's page must still find its card.
  const { filteredAdvent, filteredAspirant, filteredPCC } = await filterClassDataForUser(user);
  const wizardClasses = latestClassVersions(
    [...filteredAdvent, ...filteredAspirant, ...filteredPCC],
    { keep: [preselectedClassId] }
  )
    .map((c) => ({
      id: c.id,
      name: c.name,
      overview_html: renderMarkdown(c.overview || ''),
      teaser_html: renderMarkdown(c.teaser || ''),
      tips_html: renderMarkdown(c.tips || ''),
      // The heading the source document prints above the tips. Sent as plain
      // text, not markdown: it is a heading, and the panel escapes it.
      tips_heading: c.tips_heading || null,
      image_url: c.image_url || null,
      image_crop: c.image_crop || null,
      rules_edition: c.rules_edition || 'advent',
      // The shape of the class's content, and therefore which economy prices
      // its gear. Served because the client must not re-derive the rule --
      // economyByClassId below is computed with the real economyFor.
      content_format: c.content_format || 'advent',
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
      // Advanced abilities: consumed only in aspiring mode, by the
      // class-builder's ability picker and its step 3 Perk-spend summary
      // (public/js/character-wizard.js). Advent and aspirant modes never
      // read this list — both render `abilities_html` above instead. Same
      // shape — {name, description_html}[].
      advanced_abilities: Array.isArray(c.advanced_abilities) ? c.advanced_abilities : [],
      advanced_abilities_html: Array.isArray(c.advanced_abilities)
        ? c.advanced_abilities.map((a) => ({
            name: a.name || '',
            description_html: renderMarkdown(a.description || '')
          }))
        : [],
      // Every Signature the class carries, in printed order. A V1 class has
      // twelve across four columns; an Advent class has six. The player chooses
      // which to buy, so the route no longer decides for them by taking the
      // first six. `column` and `position` come from the class contract
      // (util/class-gear.js) and are layout facts, not economy ones -- nothing
      // gates a purchase on a column (see the spec, "Two things the book does
      // not say").
      class_gear: Array.isArray(c.gear)
        ? c.gear.map((g, idx) => ({
            name: g.name || '',
            description_html: renderMarkdown(g.description || ''),
            meters: Array.isArray(g.meters) ? g.meters : [],
            column: g.column || null,
            position: g.position || null,
            default_enchantment: g.default_enchantment || null,
            subtype: idx < ADVENT_DEFAULT_SIGNATURES ? 'base' : 'elective'
          }))
        : [],
      // Advent's free auto-loaded allotment for the left-hand list -- see
      // util/character-derived.js's ADVENT_DEFAULT_SIGNATURES. Aspirant and
      // aspiring modes never render this list; what an item costs and whether
      // it does is decided in public/js/character-wizard.js.
      base_gear: Array.isArray(c.gear)
        ? c.gear.slice(0, ADVENT_DEFAULT_SIGNATURES).map((g) => ({
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
    // The same figures the client reads, for the copy the server renders:
    // a price named in prose is the served one, never a second copy.
    economy: economyFigures(),
    wizardData: {
      mode,
      preselectedClassId,
      classes: wizardClasses,
      statList,
      personalityMap,
      commonItems: commonItemsHtml,
      economy: economyFigures(),
      statCaps: statCapFigures(),
      // Mission income is not the economy module's to hold -- that module is
      // require-free and this figure lives in util/enclave-consts.js, where
      // the derivation reads it. Served alongside rather than copied into it.
      merxPerMissionSuccess: MERX_PER_MISSION_SUCCESS,
      // Which economy each class puts a character under, decided here by the
      // same economyFor every save path calls. The client looks the answer up
      // rather than working it out, so the two can never disagree -- they did
      // before this, for `?mode=advent` on a V1 class.
      economyByClassId: Object.fromEntries(wizardClasses.map((c) => [
        c.id,
        economyFor({ contentFormat: c.content_format, creatorMode: mode })
      ])),
      // The aspiring wizard has no class to look up until its pseudo-class is
      // built, and an advent wizard has none before step 1 is answered.
      economyWhenClassless: economyFor({ contentFormat: null, creatorMode: mode })
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

  const { data: normalized, error: wizardError } = normalizeWizardPayload(body);
  if (wizardError) {
    return sendError(req, res, null, { status: 400, message: wizardError });
  }

  const { data, error } = await createCharacter(normalized, profile);
  if (error) {
    return sendCharacterSaveError(req, res, error);
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

    // Inject the character's own class into the Class <select> options so the
    // class it actually has still appears when the user no longer has it
    // unlocked -- the same fallback the gear and ability pickers get below,
    // and for the same reason.
    //
    // Without it the <select> has no <option> for the character's class, so it
    // renders showing some OTHER class. That used to be a data-loss bug (the
    // save obeyed the auto-selected option); class_id is now immutable on
    // update (services/character/service.js#updateCharacter), so what is left
    // is a form that lies about what the character is. Injecting the class
    // makes the template's existing `selected` check match, so the real class
    // renders and is selected.
    if (characterClass && ![...filteredAdvent, ...filteredAspirant, ...filteredPCC].some(c => c.id === characterClass.id)) {
      const isV2 = characterClass.rules_version === 'v2';
      const isAspirant = characterClass.rules_edition === 'aspirant';
      if (characterClass.is_player_created) {
        filteredPCC.push(characterClass);
        (isAspirant
          ? (isV2 ? filteredPCCAspirantV2 : filteredPCCAspirantV1)
          : (isV2 ? filteredPCCAdventV2 : filteredPCCAdventV1)).push(characterClass);
      } else if (isAspirant) {
        filteredAspirant.push(characterClass);
        (isV2 ? filteredAspirantV2 : filteredAspirantV1).push(characterClass);
      } else {
        filteredAdvent.push(characterClass);
        (isV2 ? filteredAdventV2 : filteredAdventV1).push(characterClass);
      }
    }

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

    const [missionsRes, offscreenRes] = await Promise.all([
      characterRepository.getRealMissions(id),
      characterRepository.listOffscreenMissions(id)
    ]);
    const economy = economyFor({
      contentFormat: characterClass && characterClass.content_format,
      creatorMode: character.creator_mode
    });
    const derived = deriveCharacterTotals({
      character,
      realMissions: missionsRes.data || [],
      offscreenMissions: offscreenRes.data || [],
      rulesVersion: effectiveVersion,
      economy
    });

    let upgradeTargets = [];
    if (characterClass) {
      upgradeTargets = await findUpgradeTargetsFor(characterClass.id, res.locals.supabase);
    }

    res.render('character-form', {
      profile,
      isNew: false,
      character,
      // Bounds the Created date input client-side so the browser blocks a
      // future date before submit -- normalizeCharacterInput rejects it
      // server-side too (services/character/input.js), but that rejection
      // renders as a generic error page, not a field-level message. UTC to
      // match the server-side check, which uses moment.utc().
      maxCreatedAt: moment.utc().format('YYYY-MM-DD'),
      effectiveVersion,
      characterClass,
      upgradeTargets,
      derived,
      // Each Stat's real Cap, so the stat blocks can express a Trait's +1 and a
      // purchased +1. This is the only surface a character is edited on after
      // creation, so a literal here is where the mechanic went unreachable.
      statCaps: statCapMap({
        statList,
        economy,
        traits: character.traits,
        capPurchases: character.stat_cap_purchases
      }),
      autoCalculate: character.auto_calculate,
      // The V1 Merx purchase surface's data, served as a JSON island the way
      // the wizard serves its own. Null for the advent economy, which is what
      // the view gates the whole surface on -- those characters keep the
      // gear[] selects. Built from the character, its class and the missions
      // already fetched just above for `derived`; it costs no extra query.
      gearPurchaseData: buildGearPurchaseData({
        economy,
        characterClass,
        character,
        missionMerx: deriveMissionMerx({
          realMissions: missionsRes.data || [],
          offscreenMissions: offscreenRes.data || []
        })
      }),
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
      adventDefaultSignatures: ADVENT_DEFAULT_SIGNATURES,
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

  let classRow = null;
  let effectiveVersion = 'v1';
  if (character.class_id) {
    try {
      const { data: cls } = await getClass(character.class_id, res.locals.supabase);
      if (cls) {
        classRow = cls;
        if (cls.rules_version === 'v2') effectiveVersion = 'v2';
      }
    } catch (_) {}
  }

  let derived = { completed_missions: 0, commissary_reward: 0, level: 1 };
  if (on) {
    const [missionsRes, offscreenRes] = await Promise.all([
      characterRepository.getRealMissions(id),
      characterRepository.listOffscreenMissions(id)
    ]);
    if (missionsRes.error || offscreenRes.error) {
      return sendError(req, res, null, { status: 503, message: 'Failed to load mission data' });
    }
    derived = deriveCharacterTotals({
      character,
      realMissions: missionsRes.data || [],
      offscreenMissions: offscreenRes.data || [],
      rulesVersion: effectiveVersion,
      economy: economyFor({
        contentFormat: classRow && classRow.content_format,
        creatorMode: character.creator_mode
      })
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

router.post('/:id/offscreen-missions', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id: characterId } = req.params;
  const { error } = await createCharacterOffscreenMission(actor, characterId, req.body);
  if (error) return sendRouteError(req, res, error);
  return res.redirect(`/characters/${characterId}`);
}));

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

router.post('/:id/offscreen-missions/:omId', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id: characterId, omId } = req.params;
  const { error } = await updateCharacterOffscreenMission(actor, characterId, omId, req.body);
  if (error) return sendRouteError(req, res, error);
  return res.redirect(`/characters/${characterId}`);
}));

router.post('/:id/offscreen-missions/:omId/delete', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id: characterId, omId } = req.params;
  const { error } = await deleteCharacterOffscreenMission(actor, characterId, omId);
  if (error) return sendRouteError(req, res, error);
  return res.redirect(`/characters/${characterId}`);
}));

router.post('/', isAuthenticated, async (req, res) => {
  const { profile } = res.locals;
  const image_crop = parseImageCrop(req.body.image_crop);
  if (image_crop !== undefined) {
    req.body.image_crop = image_crop;
  }
  req.body = collectCharacterFormArrays(req.body);
  const { data, error } = await createCharacter(req.body, profile);
  if (error) {
    return sendCharacterSaveError(req, res, error);
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
  res.render('partials/character-class-gear', {
    layout: false,
    classGearList: filteredGear,
    adventDefaultSignatures: ADVENT_DEFAULT_SIGNATURES
  });
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

// Full-sheet details fragment, lazy-loaded by the /party roster and the LFG
// post page (which passes ?lfg=<postId> so a hosting Conduit sees approved
// applicants ungated). Visibility is RLS's: a character the viewer cannot
// see never comes back from getCharacter. Must stay mounted before
// /:id/:name? or that greedy route swallows it as name="details".
router.get('/:id/details', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { data: character, error } = await getCharacter(req.params.id, res.locals.supabase);
  if (error || !character) {
    return res.status(404).send('<p class="has-text-grey">Character not found.</p>');
  }

  // fetch class record for the effective rules version (non-fatal on failure)
  let characterClass = null;
  try {
    if (character.class_id) {
      const { data: cls } = await getClass(character.class_id, res.locals.supabase);
      if (cls) characterClass = cls;
    }
  } catch (_) {
    // ignore; render as v1 without class details
  }
  const effectiveVersion = (characterClass && characterClass.rules_version === 'v2') ? 'v2' : 'v1';
  // A Signature's Enchantments and Mods are a V1-population feature: they
  // show for a class with content_format 'aspirant' or a creator_mode of
  // 'aspiring', never for an advent character, which keeps today's plain tags.
  const showGearPurchases = economyFor({
    contentFormat: characterClass && characterClass.content_format,
    creatorMode: character.creator_mode
  }) !== 'advent';

  await applyDescriptionGate({
    character,
    profile,
    userId: (profile && profile.user_id) || (res.locals.user && res.locals.user.id) || null,
    lfgPostId: req.query.lfg,
    client: res.locals.supabase
  });

  res.render('partials/character-details', {
    layout: false,
    character,
    effectiveVersion,
    showGearPurchases,
    statList
  });
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

      await applyDescriptionGate({
        character,
        profile,
        userId: (profile && profile.user_id) || (res.locals.user && res.locals.user.id) || null,
        lfgPostId: req.query.lfg,
        client: res.locals.supabase
      });

      const effectiveVersion = (characterClass && characterClass.rules_version === 'v2') ? 'v2' : 'v1';

      // A Signature's Enchantments and Mods, and the Earned/Spent/Remaining
      // breakdown below, are a V1-population feature: content_format
      // 'aspirant' or creator_mode 'aspiring'. An advent character's page
      // keeps its single Commissary Reward line and today's plain gear tags.
      const economy = economyFor({
        contentFormat: characterClass && characterClass.content_format,
        creatorMode: character.creator_mode
      });
      const showGearPurchases = economy !== 'advent';

      // recentMissions above is capped at 5 for the Recent Missions box;
      // the breakdown needs every mission, so it reads the full list --
      // non-fatally, since the breakdown is supplementary to the page.
      let merxBreakdown = null;
      if (showGearPurchases) {
        try {
          const { data: allRealMissions } = await characterRepository.getRealMissions(id);
          merxBreakdown = deriveMerxBreakdown({
            realMissions: allRealMissions || [],
            offscreenMissions: offscreenMissions || [],
            gear: character.gear,
            commonItems: character.common_items,
            characterClassId: character.class_id,
            aspiringSignatures: character.aspiring_signatures,
            economy
          });
        } catch (_) {
          // Render without the breakdown; the bare page still works.
        }
      }

      const ownerCredit = ownerProfile && ownerProfile.is_public !== false
        ? `by ${ownerProfile.name}`
        : null;

      res.render('character', {
        title: character.name,
        og: res.locals.openGraph({
          type: 'article',
          title: character.name,
          description: [character.class, `Level ${character.level}`, ownerCredit]
            .filter(Boolean).join(' · '),
          image: character.image_url || (characterClass && characterClass.image_url),
          // A sheet the owner alone can see, or one opted out of discovery,
          // gets a bare card: the sharer already knows the title they pasted.
          suppress: character.is_public === false || character.hide_from_search === true
        }),
        profile,
        character,
        characterClass,
        effectiveVersion,
        ownerProfile,
        recentMissions,
        recentMerged,
        statList,
        showGearPurchases,
        merxBreakdown,
        // Each Stat's real Cap, for the live stat editor and the level-up modal
        // this page mounts. Both write through routes that already judge a Stat
        // against the same Cap (statCapError, services/character/service.js), so
        // a literal in either partial made the raised Cap unspendable on the two
        // surfaces a character actually grows on.
        statCaps: statCapMap({
          statList,
          economy,
          traits: character.traits,
          capPurchases: character.stat_cap_purchases
        }),
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

router.patch('/:id/stats', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id } = req.params;

  // updateStats throws AuthorizationError (caught by asyncHandler) when the
  // actor may not mutate this character; everything else it returns as
  // { data, error } for sendRouteError to render (matching the pre-service
  // behavior of getOwnedCharacterForMutation/updateOwnedCharacterFields).
  const { data, error } = await updateCharacterStats(actor, id, req.body || {});
  if (error) return sendRouteError(req, res, error);
  return res.status(200).json({ character: data });
}));

router.post('/:id/level-up', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id } = req.params;

  // levelUp throws AuthorizationError (caught by asyncHandler) for the
  // ownership gate; every other failure (missing mission names, insufficient
  // Conduit Credits, backfill-mission errors, perk validation) is returned
  // as { data, error } exactly as the pre-service route did, so
  // sendRouteError keeps rendering their specific status/message.
  const { data, error } = await levelUpCharacter(actor, id, req.body || {});
  if (error) return sendRouteError(req, res, error);
  return res.status(200).json({ character: data });
}));

router.put('/:id/:name?', isAuthenticated, asyncHandler(async (req, res) => {
  const { profile } = res.locals;
  const { id } = req.params;
  const image_crop = parseImageCrop(req.body.image_crop);
  if (image_crop !== undefined) {
    req.body.image_crop = image_crop;
  }
  if (!applyGearPurchases(req.body)) {
    // The title is passed explicitly: classifyError's no-error branch titles
    // everything 'Not found' (util/http-error.js), which would tell the player
    // their character is missing when what was wrong is their submission.
    return sendError(req, res, null, {
      status: 400,
      title: 'Invalid submission',
      message: 'This character\'s Signature Gear could not be read. Please refresh the page and try again.'
    });
  }
  req.body = collectCharacterFormArrays(req.body);
  // updateCharacter throws AuthorizationError (caught by asyncHandler) when
  // the actor doesn't own the character; other failures are still returned.
  const { data, error } = await updateCharacter(id, req.body, profile);
  if (error) {
    return sendCharacterSaveError(req, res, error);
  } else {
    return res.header('HX-Location', `/characters/${id}/${encodeURIComponent(data.name)}`).send();
  }
}));

router.delete('/:id/:name?', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id } = req.params;
  const { error } = await deleteCharacter(actor, id);
  if (error) {
    return sendError(req, res, error);
  } else {
    return res.header('HX-Location', '/characters').send();
  }
}));

router.post('/:id/upgrade', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id } = req.params;
  const { target_class_id } = req.body;
  const { data, error } = await upgradeCharacterClass(actor, id, target_class_id, res.locals.supabase);
  if (error) return sendError(req, res, error);
  return res.header('HX-Location', `/characters/${id}/edit`).send();
}));

router.post('/:id/deceased', isAuthenticated, asyncHandler(async (req, res) => {
  const actor = actorFromLocals(res.locals);
  const { id } = req.params;
  const { confirmName } = req.body;

  // markCharacterDeceased throws AuthorizationError (caught by asyncHandler)
  // when the actor doesn't own the character; the confirm-name mismatch and
  // already-deceased checks are still returned as { data, error } (the
  // service loads the character once, admin-privileged, and reuses it for
  // both the ownership gate and the name check).
  const { data, error } = await markCharacterDeceased(actor, id, confirmName);
  if (error) {
    return sendRouteError(req, res, error);
  }

  return res.header('HX-Location', `/characters/${id}/${encodeURIComponent(data.name)}`).send();
}));

module.exports = router;
