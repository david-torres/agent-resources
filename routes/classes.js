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
    getVersionHistory,
    getUserProfile 
} = require('../models/class');
const { isAuthenticated, requireAdmin, authOptional } = require('../util/auth');

// View Routes
router.get('/', authOptional, async (req, res) => {
    const { profile } = res.locals;

    // get class filters
    const filters = {
        visibility: 'public',
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
        const { isClassUnlocked } = require('../models/class');
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

    // Add created_by field
    req.body.created_by = res.locals.profile.id;

    const { data: classData, error } = await createClass(req.body);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.header('HX-Location', `/classes/${classData.id}/${classData.name}`).send();
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
    const { data: classData, error } = await updateClass(id, req.body);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.header('HX-Location', `/classes/${id}/${classData.name}`).send();
});

// // API Routes
// // Get all classes with optional filters
// router.get('/api', async (req, res) => {
//     const filters = {
//         visibility: req.query.visibility,
//         rules_edition: req.query.rules_edition,
//         rules_version: req.query.rules_version,
//         status: req.query.status,
//         is_player_created: req.query.is_player_created === 'true'
//     };

//     const { data: classes, error } = await getClasses(filters);
//     if (error) {
//         return res.status(500).json({ error: error.message });
//     }
//     res.json(classes);
// });

// // Get a single class by ID
// router.get('/api/:id', async (req, res) => {
//     const { data: classData, error } = await getClass(req.params.id);
//     if (error) {
//         return res.status(500).json({ error: error.message });
//     }
//     if (!classData) {
//         return res.status(404).json({ error: 'Class not found' });
//     }
//     res.json(classData);
// });

// // Create a new class
// router.post('/api', isAuthenticated, async (req, res) => {
//     const classData = {
//         ...req.body,
//         created_by: req.user.id
//     };
//     const { data: newClass, error } = await createClass(classData);
//     if (error) {
//         return res.status(500).json({ error: error.message });
//     }
//     res.status(201).json(newClass);
// });

// // Update a class
// router.patch('/api/:id', isAuthenticated, async (req, res) => {
//     const { data: updatedClass, error } = await updateClass(req.params.id, req.body);
//     if (error) {
//         return res.status(500).json({ error: error.message });
//     }
//     res.json(updatedClass);
// });

// // Duplicate a class for new version
// router.post('/api/:id/duplicate', isAuthenticated, async (req, res) => {
//     const { new_version } = req.body;
//     if (!new_version) {
//         return res.status(400).json({ error: 'New version is required' });
//     }

//     const { data: newClass, error } = await duplicateClass(req.params.id, new_version);
//     if (error) {
//         return res.status(500).json({ error: error.message });
//     }
//     res.status(201).json(newClass);
// });

// // Get unlocked classes for current user
// router.get('/api/unlocked', isAuthenticated, async (req, res) => {
//     const { data: unlockedClasses, error } = await getUnlockedClasses(req.user.id);
//     if (error) {
//         return res.status(500).json({ error: error.message });
//     }
//     res.json(unlockedClasses);
// });

// // Unlock a class for a user (admin only)
// router.post('/api/:id/unlock', isAuthenticated, requireAdmin, async (req, res) => {
//     const { user_id } = req.body;
//     if (!user_id) {
//         return res.status(400).json({ error: 'User ID is required' });
//     }

//     const { data: unlock, error } = await unlockClass(user_id, req.params.id);
//     if (error) {
//         return res.status(500).json({ error: error.message });
//     }
//     res.status(201).json(unlock);
// });

// // Get version history for a class
// router.get('/api/:id/history', async (req, res) => {
//     const { data: history, error } = await getVersionHistory(req.params.id);
//     if (error) {
//         return res.status(500).json({ error: error.message });
//     }
//     res.json(history);
// });

module.exports = router;
