const { supabase } = require('./_base');
const crypto = require('crypto');
const { expandIdsToFamilies } = require('../util/class-family');
const { coreClassIdsForEditions } = require('../util/book-classes');
const { applyClassFilters } = require('../util/class-filters');
const { trimStrings } = require('../util/trim-input');
const { pickClassProse } = require('../util/class-prose');
const { ClassService } = require('../services/class/service');
const classRepository = require('../services/class/repository');
const rulesRepository = require('../services/rules/repository');

const getClasses = async (filters = {}, client = supabase) => {
    const query = applyClassFilters(
        client
        .from('classes')
        .select('*'),
        filters
    );

    const { data, error } = await query;
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

// Route-facing compatibility function. The service enforces the
// mint-unlock-codes policy (admin/system only); this model builds the
// code rows (the non-privileged logic) and delegates the privileged
// insert to the service/repository.
const createUnlockCodes = async (actor, { classId, createdByProfileId, expiresAt = null, maxUses = 1, amount = 1 }) => {
    const inserts = Array.from({ length: amount }, () => ({
        code: crypto.randomBytes(12).toString('base64url'),
        class_id: classId,
        created_by: createdByProfileId,
        expires_at: expiresAt,
        max_uses: maxUses
    }));

    return classService.mintUnlockCodes(actor, inserts);
};

const listUnlockCodes = async (classId, client = supabase) => {
    const { data, error } = await client
        .from('class_unlock_codes')
        .select('*')
        .eq('class_id', classId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const redeemUnlockCode = async (code, userId) => {
    const { data, error } = await supabase
        .rpc('redeem_class_code_for_user', { p_code: code, p_user_id: userId });
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

// Lean projection of all classes for version-family resolution. Admin
// client so private forks don't break chain links. Returns null on any
// failure so callers can degrade to exact-id behavior.
const fetchClassFamilyRows = () => classRepository.fetchClassFamilyRows();

// Access to one class can come from several grants at once -- a direct
// unlock, a book, a sibling version of either -- and the least restrictive
// one wins: a single permanent grant makes access permanent, otherwise the
// latest expiry applies. `null` means permanent OR no grants at all; callers
// pair it with an `unlocked` flag to tell those apart. Dates are compared as
// instants, not strings, because Postgres can hand back either a `Z` or a
// `+00:00` offset and those don't sort lexicographically.
const leastRestrictiveExpiry = (values) => {
    if (!Array.isArray(values) || values.length === 0) return null;
    if (values.some(value => !value)) return null;
    let latest = null;
    for (const value of values) {
        if (latest === null || Date.parse(value) > Date.parse(latest)) latest = value;
    }
    return latest;
};
// The user's effective class access: direct class_unlocks unioned with the
// core roster of every ruleset they hold a book for, then expanded across
// same-edition version families. Computed on read — a lapsed book revokes its
// classes with no cleanup step. A failed read grants nothing from that source
// (fail closed) but is surfaced via `error` so callers can tell an infra
// failure apart from an authoritative "no access".
const getEffectiveClassUnlocks = async (userId) => {
    const empty = { ids: new Set(), sourceById: new Map(), expiryById: new Map(), directIds: new Set(), error: null };
    if (!userId) return empty;

    const nowIso = new Date().toISOString();
    const [directResult, booksResult] = await Promise.all([
        classRepository.unlockedClassIdRows({ userId, nowIso }),
        rulesRepository.fetchActiveBooksForUser({ userId, nowIso })
    ]);
    const readError = directResult?.error || booksResult?.error || null;
    // Attribution below is first-book-wins, and the repository read is
    // unordered: sort least-restrictive-first (permanent, then latest
    // expiry, title as tiebreak) so the badge deterministically names a
    // book whose grant matches the effective expiry it is shown with.
    const books = [...(booksResult?.data || [])].sort((a, b) => {
        if ((a.expires_at == null) !== (b.expires_at == null)) return a.expires_at == null ? -1 : 1;
        if (a.expires_at != null && a.expires_at !== b.expires_at) {
            return Date.parse(b.expires_at) - Date.parse(a.expires_at);
        }
        return String(a.title || '').localeCompare(String(b.title || ''));
    });

    const directRows = (directResult?.error ? [] : (directResult?.data || []));
    const directIds = new Set(directRows.map(row => row.class_id));

    const rawUnion = new Set(directIds);
    for (const book of books || []) {
        for (const id of coreClassIdsForEditions([book.rules_edition])) rawUnion.add(id);
    }
    // rawUnion is a superset of directIds, so an empty union means no direct
    // ids either — `empty` is the whole answer.
    if (rawUnion.size === 0) return { ...empty, error: readError };

    const classRows = await fetchClassFamilyRows();
    const expand = (idSet) => (classRows ? expandIdsToFamilies(classRows, idSet) : new Set(idSet));

    // A fork inherits the source of whatever unlocked its seed id: expand
    // each book's roster and the direct ids separately, rather than the
    // union, so a same-edition fork of a book-granted class is tagged
    // 'book' rather than falsely 'direct'. Later books do not overwrite an
    // earlier title for the same id; any owning book is a truthful badge.
    // Direct always wins when both an unlock and a book cover the same id.
    const sourceById = new Map();
    // Every grant covering an id contributes a candidate expiry; the least
    // restrictive of them is that id's real expiry. A book-derived class is
    // only ever as durable as the book grant that confers it.
    const expiriesById = new Map();
    const contribute = (id, expiresAt) => {
        if (!expiriesById.has(id)) expiriesById.set(id, []);
        expiriesById.get(id).push(expiresAt ?? null);
    };

    for (const book of books || []) {
        for (const id of expand(coreClassIdsForEditions([book.rules_edition]))) {
            if (!sourceById.has(id)) sourceById.set(id, { source: 'book', title: book.title });
            contribute(id, book.expires_at);
        }
    }
    for (const row of directRows) {
        for (const id of expand(new Set([row.class_id]))) {
            sourceById.set(id, { source: 'direct' });
            contribute(id, row.expires_at);
        }
    }

    const expiryById = new Map(
        [...expiriesById].map(([id, values]) => [id, leastRestrictiveExpiry(values)])
    );

    // directIds rides along raw (unexpanded): the hydration read needs to know
    // which ids came from an explicit class_unlocks row, so it can exempt
    // those — and only those — from its visibility filter.
    return { ids: new Set(sourceById.keys()), sourceById, expiryById, directIds, error: readError };
};

const getEffectiveClassUnlock = async (userId, classId) => {
    const none = { unlocked: false, expiresAt: null };
    if (!userId || !classId) {
        return { data: none, error: null };
    }

    // ids already includes every same-edition version of anything granted
    // (direct or book-derived), so a plain membership check is enough --
    // expanding classId's own family here would just re-fetch the same
    // classes projection getEffectiveClassUnlocks already fetched. The
    // resolver reduced each id's grants to one effective expiry on the way.
    const { ids, expiryById, error: readError } = await getEffectiveClassUnlocks(userId);
    if (readError) {
        return { data: none, error: readError };
    }
    if (!ids.has(classId)) {
        return { data: none, error: null };
    }
    return {
        data: { unlocked: true, expiresAt: expiryById.get(classId) ?? null },
        error: null
    };
};

const isClassUnlocked = async (userId, classId) => {
    const { data, error } = await getEffectiveClassUnlock(userId, classId);
    if (error) {
        return { data: false, error };
    }
    return { data: data.unlocked, error: null };
};

const getClass = async (id, client = supabase) => {
    const { data, error } = await client
        .from('classes')
        .select('*')
        .eq('id', id)
        .single();

    // // unpack jsonb fields: abilities and gear
    // data.abilities = JSON.parse(data.abilities);
    // data.gear = JSON.parse(data.gear);

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

// Route-facing compatibility functions. The service owns input preparation,
// authorization, and write orchestration; this model remains the thin
// caller that threads the actor through.
let classService;
const createClass = async (actor, classData) => classService.createClass(actor, classData);
const updateClass = async (actor, id, updates) => classService.updateClass(actor, id, updates);

const duplicateClass = async (baseId, newVersion, newEdition = null) => {
    const params = trimStrings({
        new_id: crypto.randomUUID(),
        base_id: baseId,
        new_version: newVersion,
        ...(newEdition ? { new_edition: newEdition } : {})
    });

    const { data, error } = await supabase
        .rpc('dup_class', params);

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

const saveClassPdfMetadata = async (actor, classId, storagePath) =>
    classService.savePdfMetadata(actor, classId, storagePath);

// Profile display: every class the user can play, tagged with where the
// access came from so the view can badge book-derived rows.
const getUnlockedClasses = async (userId) => {
    const { ids, sourceById, expiryById, directIds, error: readError } = await getEffectiveClassUnlocks(userId);
    if (readError) {
        return { data: null, error: readError };
    }
    if (ids.size === 0) {
        return { data: [], error: null };
    }

    const { data, error } = await classRepository.classRowsByIds(
        [...ids],
        { alwaysVisibleIds: [...directIds] }
    );
    if (error) {
        return { data: null, error };
    }

    return {
        data: (data || []).map(cls => ({
            ...cls,
            unlock_source: sourceById.get(cls.id)?.source || 'direct',
            unlock_book_title: sourceById.get(cls.id)?.title || null,
            unlock_expires_at: expiryById.get(cls.id) ?? null
        })),
        error: null
    };
};

const getUnlockedClassIdsForUser = async (userId) => {
    const { ids, error } = await getEffectiveClassUnlocks(userId);
    return { data: ids, error: error || null };
};

const resolveClassAgentAccess = ({ classData, actor = {}, unlockedClassIds = new Set() }) => {
    if (!classData) return null;

    const isAdmin = actor.role === 'admin';
    const isOwner = !!actor.profileId && actor.profileId === classData.created_by;
    const isVisible = classData.is_public === true || isOwner || isAdmin;
    if (!isVisible) return null;

    const unlocked = !!actor.userId && unlockedClassIds.has(classData.id);
    const accessLevel = classData.status === 'release' && !isAdmin && !isOwner && !unlocked
        ? 'teaser_only'
        : 'full';

    return { isAdmin, isOwner, unlocked, accessLevel };
};

const serializeClassSummaryForAgent = ({ classData, actor = {}, unlockedClassIds = new Set() }) => {
    const access = resolveClassAgentAccess({ classData, actor, unlockedClassIds });
    if (!access) return null;

    return {
        id: classData.id,
        name: classData.name,
        teaser: classData.teaser || '',
        status: classData.status,
        rules_edition: classData.rules_edition,
        rules_version: classData.rules_version,
        is_public: classData.is_public,
        is_player_created: classData.is_player_created,
        owner_profile_id: classData.created_by || null,
        access_level: access.accessLevel,
        unlocked: access.unlocked,
        updated_at: classData.updated_at || null
    };
};

const serializeClassForAgent = ({ classData, actor = {}, unlockedClassIds = new Set() }) => {
    const access = resolveClassAgentAccess({ classData, actor, unlockedClassIds });
    if (!access) return null;

    const { isAdmin, isOwner, unlocked, accessLevel } = access;

    const serialized = {
        id: classData.id,
        name: classData.name,
        teaser: classData.teaser || '',
        status: classData.status,
        rules_edition: classData.rules_edition,
        rules_version: classData.rules_version,
        is_public: classData.is_public,
        is_player_created: classData.is_player_created,
        image_url: classData.image_url || null,
        image_crop: classData.image_crop || null,
        base_class_id: classData.base_class_id || null,
        owner_profile_id: classData.created_by || null,
        access_level: accessLevel,
        unlocked,
        pdf_available: accessLevel === 'full' && !!classData.pdf_storage_path,
        updated_at: classData.updated_at || null,
        created_at: classData.created_at || null
    };

    if (accessLevel === 'full') {
        Object.assign(serialized, pickClassProse(classData));
        serialized.signature_gear = Array.isArray(classData.gear) ? classData.gear : [];
        serialized.abilities = Array.isArray(classData.abilities) ? classData.abilities : [];
    }

    return serialized;
};

const listClassesForAgent = async (filters = {}, actor = {}) => {
    const { data, error } = await classRepository.fetchClassesForAgentAdmin(filters, actor);
    if (error) {
        return { data: null, error };
    }

    const { data: unlockedClassIds, error: unlockedError } = await getUnlockedClassIdsForUser(actor.userId);
    if (unlockedError) {
        return { data: null, error: unlockedError };
    }

    return {
        data: (data || [])
            .map((classData) => serializeClassSummaryForAgent({ classData, actor, unlockedClassIds }))
            .filter(Boolean),
        error: null
    };
};

const getClassForAgent = async (id, actor = {}) => {
    const { data: classData, error } = await classRepository.fetchClassByIdAdmin(id);

    if (error) {
        return { data: null, error };
    }

    const { data: unlockedClassIds, error: unlockedError } = await getUnlockedClassIdsForUser(actor.userId);
    if (unlockedError) {
        return { data: null, error: unlockedError };
    }

    const serialized = serializeClassForAgent({ classData, actor, unlockedClassIds });
    if (!serialized) {
        return { data: null, error: null };
    }

    return { data: serialized, error: null };
};

// `unlocked` lets a caller that has already resolved this user's unlock state
// hand it in rather than paying for a second resolve: getEffectiveClassUnlocks
// costs three queries including a full classes projection, and the class-view
// page would otherwise run it twice per request.
const canViewClassPdf = async (userContext = {}, classData = {}, { unlocked = null } = {}) => {
    const { userId = null, profileId = null, role = null } = userContext;

    if (!classData?.pdf_storage_path) {
        return { data: false, error: null };
    }

    if (role === 'admin') {
        return { data: true, error: null };
    }

    if (profileId && classData?.created_by && profileId === classData.created_by) {
        return { data: true, error: null };
    }

    if (!userId) {
        return { data: false, error: null };
    }

    if (unlocked !== null) {
        return { data: !!unlocked, error: null };
    }

    const { data, error } = await isClassUnlocked(userId, classData.id);
    return { data: !!data, error: error || null };
};

const unlockClass = async (userId, classId, expiresAt = null) => {
    const payload = {
        user_id: userId,
        class_id: classId
    };
    if (expiresAt) {
        payload.expires_at = expiresAt;
    }

    // authz: caller route verifies eligibility before calling (e.g. /unlock/self, redeem code)
    const { data, error } = await classRepository.insertUnlock(payload);

    if (error) {
        return { data: null, error };
    }
    return { data, error: null };
};

const getVersionHistory = async (classId) => {
    const { data, error } = await supabase
        .from('classes')
        .select('*')
        .or(`id.eq.${classId},base_class_id.eq.${classId}`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

const deleteClass = async (actor, id) => classService.deleteClass(actor, id);

// Build lookup maps from gear/ability name -> class_id and description
const buildClassContentLookupMaps = async () => {
    try {
      const [adventRes, aspirantRes, pccRes] = await Promise.all([
        getClasses({ is_public: true, is_player_created: false, rules_edition: 'advent' }),
        getClasses({ is_public: true, is_player_created: false, rules_edition: 'aspirant' }),
        getClasses({ is_public: true, is_player_created: true })
      ]);

      const advent = Array.isArray(adventRes?.data) ? adventRes.data : [];
      const aspirant = Array.isArray(aspirantRes?.data) ? aspirantRes.data : [];
      const pcc = Array.isArray(pccRes?.data) ? pccRes.data : [];

      const allClasses = [...advent, ...aspirant, ...pcc];
      const gearNameToClassId = new Map();
      const abilityNameToClassId = new Map();
      const gearNameToDescription = new Map();
      const abilityNameToDescription = new Map();

      for (const cls of allClasses) {
        if (Array.isArray(cls?.gear)) {
          for (const g of cls.gear) {
            if (g && g.name && cls.id) {
              const gearName = g.name.trim();
              gearNameToClassId.set(gearName, cls.id);
              if (g.description) {
                gearNameToDescription.set(gearName, g.description);
              }
            }
          }
        }
        if (Array.isArray(cls?.abilities)) {
          for (const a of cls.abilities) {
            if (a && a.name && cls.id) {
              const abilityName = a.name.trim();
              abilityNameToClassId.set(abilityName, cls.id);
              if (a.description) {
                abilityNameToDescription.set(abilityName, a.description);
              }
            }
          }
        }
      }

      return { gearNameToClassId, abilityNameToClassId, gearNameToDescription, abilityNameToDescription };
    } catch (error) {
      throw error;
    }
};

classService = new ClassService(classRepository);

const getRecentClassesByCreator = async (profileId, { limit = 6 } = {}, client = supabase) => {
    const { data, error } = await client
        .from('classes')
        .select('id, name, status, rules_edition, updated_at')
        .eq('created_by', profileId)
        .order('updated_at', { ascending: false })
        .limit(limit);
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
}

module.exports = {
    getClasses,
    getClass,
    createClass,
    updateClass,
    duplicateClass,
    getEffectiveClassUnlocks,
    getUnlockedClasses,
    getUnlockedClassIdsForUser,
    unlockClass,
    isClassUnlocked,
    getEffectiveClassUnlock,
    getVersionHistory,
    createUnlockCodes,
    listUnlockCodes,
    redeemUnlockCode,
    deleteClass,
    buildClassContentLookupMaps,
    saveClassPdfMetadata,
    canViewClassPdf,
    listClassesForAgent,
    getClassForAgent,
    serializeClassForAgent,
    serializeClassSummaryForAgent,
    getRecentClassesByCreator
};
