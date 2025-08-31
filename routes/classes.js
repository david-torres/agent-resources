const express = require('express');
const router = express.Router();
const { 
    getClasses, 
    getClass, 
    createClass, 
    updateClass, 
    duplicateClass, 
    getUnlockedClasses, 
    unlockClass,
    isClassUnlocked, 
    getVersionHistory,
    createUnlockCode,
    listUnlockCodes,
    redeemUnlockCode
} = require('../util/supabase');
const { isAuthenticated, requireAdmin, authOptional } = require('../util/auth');

// View Routes
router.get('/', authOptional, async (req, res) => {
    const { profile } = res.locals;

    // get class filters
    const filters = {
        is_public: true,
        rules_edition: req.query.rules_edition,
        rules_version: req.query.rules_version,
        status: req.query.status,
    }
    if (req.query.is_player_created) {
        filters.is_player_created = req.query.is_player_created === 'true';
    }

    const { data: classes, error } = await getClasses(filters);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.render('classes', {
        profile,
        title: 'Classes',
        classes: classes,
        filters: filters
    });
});

router.get('/new', isAuthenticated, (req, res) => {
    const { profile } = res.locals;
    res.render('class-form', {
        profile,
        title: 'New Class',
        isNew: true,
        class: null
    });
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
    const { profile } = res.locals;
    const { id } = req.params;
    const { data: classData, error } = await getClass(id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.render('class-form', { profile, title: 'Edit Class', class: classData });
});

router.get('/:id/:name?', authOptional, async (req, res) => {
    const { profile } = res.locals;
    const { id } = req.params;
    const { data: classData, error } = await getClass(id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    // Show teaser if Release and not unlocked for non-admins/non-creators
    if (
        classData &&
        classData.status === 'release' &&
        (!profile || (profile.role !== 'admin' && profile.id !== classData.creator_id))
    ) {
        const userId = res.locals.user?.id;
        const { data: unlocked } = await isClassUnlocked(userId, id);
        if (!unlocked) {
            return res.render('class-view-teaser', {
                profile,
                title: 'View Class',
                class: classData
            });
        }
    }

    res.render('class-view', { profile, title: 'View Class', class: classData });
});

// Self-unlock eligible PCCs (alpha/beta, public)
router.post('/:id/unlock/self', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const userId = res.locals.user.id;
    const { data: cls, error } = await getClass(id);
    if (error || !cls) return res.status(400).send(error?.message || 'Class not found');
    if (!((cls.is_public === true) && cls.is_player_created === true && ['alpha','beta'].includes(cls.status))) {
        return res.status(403).send('Not eligible for self-unlock');
    }
    const { error: unlockError } = await unlockClass(userId, id);
    if (unlockError) return res.status(400).send(unlockError.message);
    return res.status(204).send();
});

// Admin: generate unlock code for a class
router.post('/:id/codes', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { expires_at, max_uses } = req.body;
    const createdByProfileId = res.locals.profile.id;
    const { data, error } = await createUnlockCode({ classId: id, createdByProfileId, expiresAt: expires_at || null, maxUses: max_uses || 1 });
    if (error) return res.status(400).send(error.message);

    return res.render('partials/unlock-code-result', {
        layout: false,
        code: data.code,
        max_uses: data.max_uses,
        expires_at: data.expires_at
    });
});

// Admin: list unlock codes for a class
router.get('/:id/codes', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { data, error } = await listUnlockCodes(id);
    if (error) return res.status(400).send(error.message);
    return res.json(data);
});

// User: redeem code
router.post('/redeem', isAuthenticated, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).send('Code is required');
    const userId = res.locals.user.id;
    const { data: classId, error } = await redeemUnlockCode(code, userId);
    if (error) return res.status(400).send(error.message);

    // Navigate to the unlocked class view using HX-Location for htmx
    try {
        const { data: classData } = await getClass(classId);
        const slug = classData?.name ? `/${classData.name}` : '';
        return res.header('HX-Location', `/classes/${classId}${slug}`).status(204).send();
    } catch (_) {
        return res.header('HX-Location', `/classes/${classId}`).status(204).send();
    }
});

router.post('/', isAuthenticated, async (req, res) => {
    const { profile } = res.locals;
    
    // Process abilities and gear arrays
    const abilities = req.body.ability_name ? req.body.ability_name.map((name, index) => ({
        name: name,
        description: req.body['ability_description'][index]
    })) : [];
    req.body.abilities = abilities;
    delete req.body.ability_name;
    delete req.body.ability_description;

    const gear = req.body.gear_name ? req.body.gear_name.map((name, index) => ({
        name: name,
        description: req.body['gear_description'][index]
    })) : [];
    req.body.gear = gear;
    delete req.body.gear_name;
    delete req.body.gear_description;

    // Add created_by field and normalize is_public checkbox
    req.body.created_by = res.locals.profile.id;
    if (req.body.is_public === 'on') {
        req.body.is_public = true;
    } else {
        req.body.is_public = false;
    }

    const { data: classData, error } = await createClass(req.body);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    return res.header('HX-Location', `/classes/${classData.id}/${classData.name}`).send();
});

router.put('/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;

    const abilities = req.body.ability_name ? req.body.ability_name.map((name, index) => ({
        name: name,
        description: req.body['ability_description'][index]
    })) : [];
    req.body.abilities = abilities;
    delete req.body.ability_name;
    delete req.body.ability_description;

    const gear = req.body.gear_name ? req.body.gear_name.map((name, index) => ({
        name: name,
        description: req.body['gear_description'][index]
    })) : [];
    req.body.gear = gear;
    delete req.body.gear_name;
    delete req.body.gear_description;

    console.log('req.body is', req.body);
    if (req.body.is_public === 'on') {
        req.body.is_public = true;
    } else if (req.body.is_public === undefined) {
        // unchecked in forms does not send field; default to false unless explicitly set elsewhere
        req.body.is_public = false;
    }
    const { data: classData, error } = await updateClass(id, req.body);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    return res.header('HX-Location', `/classes/${id}/${classData.name}`).send();
});

module.exports = router;
