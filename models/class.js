const { supabase } = require('./_base');
const crypto = require('crypto');

const getClasses = async (filters = {}) => {
    let query = supabase
        .from('classes')
        .select('*');

    // Apply filters
    if (filters.is_public !== undefined) {
        query = query.eq('is_public', filters.is_public);
    }
    if (filters.created_by) {
        query = query.eq('created_by', filters.created_by);
    }
    if (filters.rules_edition) {
        query = query.eq('rules_edition', filters.rules_edition);
    }
    if (filters.rules_version) {
        query = query.eq('rules_version', filters.rules_version);
    }
    if (filters.status) {
        query = query.eq('status', filters.status);
    }
    if (filters.is_player_created !== undefined) {
        query = query.eq('is_player_created', filters.is_player_created);
    }

    // sort
    query = query.order('name', { ascending: true });

    const { data, error } = await query;
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

const createUnlockCode = async ({ classId, createdByProfileId, expiresAt = null, maxUses = 1 }) => {
    const code = crypto.randomBytes(12).toString('base64url');
    const insert = {
        code,
        class_id: classId,
        created_by: createdByProfileId,
        expires_at: expiresAt,
        max_uses: maxUses
    };

    const { data, error } = await supabase
        .from('class_unlock_codes')
        .insert([insert])
        .select()
        .single();

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data: { ...data, code }, error: null };
};

const listUnlockCodes = async (classId) => {
    const { data, error } = await supabase
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

const isClassUnlocked = async (userId, classId) => {
    if (!userId || !classId) {
        return { data: false, error: null };
    }

    const { data, error } = await supabase
        .from('class_unlocks')
        .select('class_id')
        .eq('user_id', userId)
        .eq('class_id', classId)
        .limit(1);

    if (error) {
        console.error(error);
        return { data: false, error };
    }
    return { data: Array.isArray(data) && data.length > 0, error: null };
};

const getClass = async (id) => {
    const { data, error } = await supabase
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

const createClass = async (classData) => {
    // // pack jsonb fields: abilities and gear
    // classData.abilities = JSON.stringify(classData.abilities);
    // classData.gear = JSON.stringify(classData.gear);

    const { data, error } = await supabase
        .from('classes')
        .insert([classData])
        .select()
        .single();

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

const updateClass = async (id, updates) => {
    // pack jsonb fields: abilities and gear
    // console.log('updateClass before', updates);
    // updates.abilities = JSON.stringify(updates.abilities);
    // updates.gear = JSON.stringify(updates.gear);
    // console.log('updateClass after', updates);

    const { data, error } = await supabase
        .from('classes')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

const duplicateClass = async (baseId, newVersion) => {
    const { data, error } = await supabase
        .rpc('dup_class', {
            new_id: crypto.randomUUID(),
            base_id: baseId,
            new_version: newVersion
        });

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

const getUnlockedClasses = async (userId) => {
    const { data, error } = await supabase
        .from('class_unlocks')
        .select('class:classes(*)')
        .eq('user_id', userId);

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { 
        data: data.map(entry => entry.class),
        error 
    };
};

const unlockClass = async (userId, classId) => {
    const { data, error } = await supabase
        .from('class_unlocks')
        .insert([{
            user_id: userId,
            class_id: classId
        }])
        .select()
        .single();

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
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

const getUserProfile = async (userId) => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

module.exports = {
    getClasses,
    getClass,
    createClass,
    updateClass,
    duplicateClass,
    getUnlockedClasses,
    unlockClass,
    isClassUnlocked,
    getVersionHistory,
    getUserProfile,
    createUnlockCode,
    listUnlockCodes,
    redeemUnlockCode
};
