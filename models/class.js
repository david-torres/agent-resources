const { supabase } = require('./_base');
const crypto = require('crypto');
const { computeVersionFamily, expandIdsToFamilies } = require('../util/class-family');
const { applyClassFilters } = require('../util/class-filters');
const { ClassService } = require('../services/class/service');
const classRepository = require('../services/class/repository');

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

// Resolve the same-edition version family of a class (see util/class-family).
// Falls back to a singleton set on error: unlock checks degrade to exact-id.
const getVersionFamilyIds = async (classId) => {
    const rows = await fetchClassFamilyRows();
    if (!rows) return new Set([classId]);
    return computeVersionFamily(rows, classId);
};

const isClassUnlocked = async (userId, classId) => {
    if (!userId || !classId) {
        return { data: false, error: null };
    }

    // An unlock for any same-edition version of the class counts.
    const familyIds = await getVersionFamilyIds(classId);

    const now = new Date().toISOString();
    const { data, error } = await classRepository.activeUnlockRows({
        userId,
        classIds: [...familyIds],
        nowIso: now
    });

    if (error) {
        return { data: false, error };
    }
    return { data: Array.isArray(data) && data.length > 0, error: null };
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
    const params = {
        new_id: crypto.randomUUID(),
        base_id: baseId,
        new_version: newVersion
    };
    if (newEdition) params.new_edition = newEdition;

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

const getUnlockedClasses = async (userId) => {
    const now = new Date().toISOString();
    const { data, error } = await classRepository.unlockedClassRows({ userId, nowIso: now });

    if (error) {
        return { data: null, error };
    }
    return {
        data: data.map(entry => entry.class),
        error: null
    };
};

const getUnlockedClassIdsForUser = async (userId) => {
    if (!userId) {
        return { data: new Set(), error: null };
    }

    const now = new Date().toISOString();
    const { data, error } = await classRepository.unlockedClassIdRows({ userId, nowIso: now });

    if (error) {
        return { data: null, error };
    }

    const directIds = new Set((data || []).map((entry) => entry.class_id));
    if (directIds.size === 0) {
        return { data: directIds, error: null };
    }

    // An unlock applies to the whole same-edition version family. Degrade to
    // direct ids if the classes projection can't be loaded.
    const classRows = await fetchClassFamilyRows();
    if (!classRows) {
        return { data: directIds, error: null };
    }
    return { data: expandIdsToFamilies(classRows, directIds), error: null };
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
        serialized.description = classData.description || '';
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

const canViewClassPdf = async (userContext = {}, classData = {}) => {
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

    const { data, error } = await isClassUnlocked(userId, classData.id);
    if (error) {
        return { data: false, error };
    }

    return { data: !!data, error: null };
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
    getUnlockedClasses,
    getUnlockedClassIdsForUser,
    unlockClass,
    isClassUnlocked,
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
