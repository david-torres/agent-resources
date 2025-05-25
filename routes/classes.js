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

// Middleware to check if user is authenticated
const requireAuth = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
};

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { data: profile, error } = await getUserProfile(req.user.id);
    if (error || profile?.role !== 'admin') {
        return res.status(403).json({ error: 'Not authorized' });
    }

    next();
};

// View Routes
router.get('/', (req, res) => {
    res.render('classes', {
        title: 'Enclave Classes',
        user: req.user
    });
});

// API Routes
// Get all classes with optional filters
router.get('/api', async (req, res) => {
    const filters = {
        visibility: req.query.visibility,
        rules_edition: req.query.rules_edition,
        rules_version: req.query.rules_version,
        status: req.query.status,
        is_player_created: req.query.is_player_created === 'true'
    };

    const { data: classes, error } = await getClasses(filters);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json(classes);
});

// Get a single class by ID
router.get('/api/:id', async (req, res) => {
    const { data: classData, error } = await getClass(req.params.id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    if (!classData) {
        return res.status(404).json({ error: 'Class not found' });
    }
    res.json(classData);
});

// Create a new class
router.post('/api', requireAuth, async (req, res) => {
    const classData = {
        ...req.body,
        created_by: req.user.id
    };
    const { data: newClass, error } = await createClass(classData);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.status(201).json(newClass);
});

// Update a class
router.patch('/api/:id', requireAuth, async (req, res) => {
    const { data: updatedClass, error } = await updateClass(req.params.id, req.body);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json(updatedClass);
});

// Duplicate a class for new version
router.post('/api/:id/duplicate', requireAuth, async (req, res) => {
    const { new_version } = req.body;
    if (!new_version) {
        return res.status(400).json({ error: 'New version is required' });
    }

    const { data: newClass, error } = await duplicateClass(req.params.id, new_version);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.status(201).json(newClass);
});

// Get unlocked classes for current user
router.get('/api/unlocked', requireAuth, async (req, res) => {
    const { data: unlockedClasses, error } = await getUnlockedClasses(req.user.id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json(unlockedClasses);
});

// Unlock a class for a user (admin only)
router.post('/api/:id/unlock', requireAuth, requireAdmin, async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    const { data: unlock, error } = await unlockClass(user_id, req.params.id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.status(201).json(unlock);
});

// Get version history for a class
router.get('/api/:id/history', async (req, res) => {
    const { data: history, error } = await getVersionHistory(req.params.id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    res.json(history);
});

module.exports = router; 