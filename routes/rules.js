const express = require('express');
const multer = require('multer');
const crypto = require('crypto');

const router = express.Router();

const {
    getRulesPdfs,
    getRulesPdf,
    createRulesPdf,
    updateRulesPdf,
    listRulesPdfUnlocks,
    listRulesPdfUnlocksForUser,
    upsertRulesPdfUnlock,
    deleteRulesPdfUnlock,
    storeRulesPdf,
    deletePdfObject,
    getSignedPdfUrl,
    canViewRulesPdf,
    RULES_PDF_BUCKET,
    getProfileByName,
    getProfileById
} = require('../util/supabase');
const { isAuthenticated, requireAdmin, authOptional } = require('../util/auth');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

const normalizeBoolean = (value, fallback = false) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).toLowerCase();
    return ['true', '1', 'on', 'yes'].includes(normalized);
};

const parseExpiresAt = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
};

router.get('/', authOptional, async (req, res) => {
    const { profile, user } = res.locals;
    const isAdmin = profile?.role === 'admin';

    const { data: rules, error } = await getRulesPdfs({ includeInactive: isAdmin });
    if (error) {
        return res.status(500).send(error.message || 'Failed to load rules PDFs');
    }

    let unlocksMap = new Map();
    if (user) {
        const { data: unlocks } = await listRulesPdfUnlocksForUser(user.id);
        if (Array.isArray(unlocks)) {
            unlocksMap = new Map(
                unlocks.map((unlock) => [unlock.rules_pdf_id, unlock])
            );
        }
    }

    const now = new Date();
    const rulesWithAccess = (rules || []).map((rule) => {
        const unlock = unlocksMap.get(rule.id);
        const expiresAt = unlock?.expires_at ? new Date(unlock.expires_at) : null;
        const isExpired = expiresAt ? expiresAt <= now : false;
        const canView = isAdmin || (!!unlock && !isExpired);
        return {
            ...rule,
            isUnlocked: !!unlock,
            isExpired,
            canView,
            expires_at: unlock?.expires_at || null
        };
    });

    return res.render('rules', {
        profile,
        title: 'Rules Library',
        rules: rulesWithAccess,
        isAdmin,
        activeNav: 'rules',
        breadcrumbs: [
            { label: 'Rules Library', href: '/rules' }
        ]
    });
});

router.get('/manage', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    const { data: rules, error } = await getRulesPdfs({ includeInactive: true });
    if (error) {
        return res.status(500).send(error.message || 'Failed to load rules PDFs');
    }

    const rulesWithUnlocks = await Promise.all(
        (rules || []).map(async (rule) => {
            const { data: unlocks } = await listRulesPdfUnlocks(rule.id);
            return {
                ...rule,
                unlocks: unlocks || []
            };
        })
    );

    return res.render('rules-manage', {
        profile,
        title: 'Manage Rules PDFs',
        rules: rulesWithUnlocks,
        activeNav: 'rules',
        breadcrumbs: [
            { label: 'Rules Library', href: '/rules' },
            { label: 'Manage', href: '/rules/manage' }
        ]
    });
});

router.post('/', isAuthenticated, requireAdmin, upload.single('rules_pdf'), async (req, res) => {
    const { profile } = res.locals;
    const { title, edition } = req.body;
    const isActive = normalizeBoolean(req.body.is_active, true);

    if (!title || !edition) {
        return res.status(400).send('Title and edition are required');
    }

    if (!req.file) {
        return res.status(400).send('A PDF file is required');
    }

    const rulesPdfId = crypto.randomUUID();
    const { data: storageInfo, error: storageError } = await storeRulesPdf(rulesPdfId, req.file);
    if (storageError) {
        return res.status(500).send(storageError.message || 'Failed to store PDF');
    }

    const payload = {
        id: rulesPdfId,
        title: title.trim(),
        edition: edition.trim(),
        storage_path: storageInfo.path,
        is_active: isActive,
        created_by: profile?.id || null
    };

    const { error } = await createRulesPdf(payload);
    if (error) {
        await deletePdfObject({ bucket: RULES_PDF_BUCKET, path: storageInfo.path });
        return res.status(500).send(error.message || 'Failed to create rules PDF');
    }

    return res.redirect('/rules/manage');
});

router.post('/:id', isAuthenticated, requireAdmin, upload.single('rules_pdf'), async (req, res) => {
    const { id } = req.params;
    const { title, edition } = req.body;
    const isActive = normalizeBoolean(req.body.is_active, true);
    const removePdf = normalizeBoolean(req.body.remove_pdf, false);

    const { data: existingRule, error: loadError } = await getRulesPdf(id);
    if (loadError || !existingRule) {
        return res.status(404).send(loadError?.message || 'Rules PDF not found');
    }

    const updates = {
        title: title?.trim() || existingRule.title,
        edition: edition?.trim() || existingRule.edition,
        is_active: isActive
    };

    if (req.file) {
        const { data: storageInfo, error: storageError } = await storeRulesPdf(id, req.file, {
            previousPath: existingRule.storage_path
        });
        if (storageError) {
            return res.status(500).send(storageError.message || 'Failed to store PDF');
        }
        updates.storage_path = storageInfo.path;
    } else if (removePdf && existingRule.storage_path) {
        await deletePdfObject({ bucket: RULES_PDF_BUCKET, path: existingRule.storage_path });
        updates.storage_path = null;
    }

    const { error } = await updateRulesPdf(id, updates);
    if (error) {
        return res.status(500).send(error.message || 'Failed to update rules PDF');
    }

    return res.redirect('/rules/manage');
});

router.post('/:id/unlocks', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { profile_name, profile_id, expires_at } = req.body;
    const { profile } = res.locals;

    const { data: rulesPdf, error: loadError } = await getRulesPdf(id);
    if (loadError || !rulesPdf) {
        return res.status(404).send(loadError?.message || 'Rules PDF not found');
    }

    let profileRecord = null;
    if (profile_id) {
        const result = await getProfileById(profile_id.trim());
        if (result?.data) {
            profileRecord = result.data;
        }
    } else if (profile_name) {
        const result = await getProfileByName(profile_name.trim());
        if (result?.data) {
            profileRecord = result.data;
        }
    }

    if (!profileRecord) {
        return res.status(400).send('Profile not found');
    }

    if (!profileRecord.user_id) {
        return res.status(400).send('Profile is missing a linked user');
    }

    const expiresAt = parseExpiresAt(expires_at);

    const { error } = await upsertRulesPdfUnlock({
        userId: profileRecord.user_id,
        profileId: profileRecord.id,
        rulesPdfId: id,
        expiresAt,
        grantedBy: profile?.id || null
    });

    if (error) {
        return res.status(500).send(error.message || 'Failed to grant access');
    }

    return res.redirect('/rules/manage');
});

router.delete('/:id/unlocks/:userId', isAuthenticated, requireAdmin, async (req, res) => {
    const { id, userId } = req.params;

    const { error } = await deleteRulesPdfUnlock({ userId, rulesPdfId: id });
    if (error) {
        return res.status(500).send(error.message || 'Failed to revoke access');
    }

    return res.status(204).send();
});

router.get('/:id/view', authOptional, async (req, res) => {
    const { profile, user } = res.locals;
    const { id } = req.params;

    const { data: rulesPdf, error } = await getRulesPdf(id);
    if (error || !rulesPdf) {
        return res.status(404).send(error?.message || 'Rules PDF not found');
    }

    if (!rulesPdf.storage_path) {
        return res.status(404).send('Rules PDF not available');
    }

    const { data: canView, error: accessError } = await canViewRulesPdf(
        {
            userId: user?.id || null,
            role: profile?.role || null
        },
        rulesPdf
    );

    if (accessError) {
        return res.status(500).send(accessError.message || 'Unable to verify access');
    }

    if (!canView) {
        return res.status(403).send('You do not have access to this rules PDF');
    }

    const { data: signedUrl, error: signedError } = await getSignedPdfUrl({
        bucket: RULES_PDF_BUCKET,
        path: rulesPdf.storage_path,
        expiresIn: 600
    });

    if (signedError || !signedUrl) {
        return res.status(500).send('Failed to prepare rules PDF');
    }

    return res.render('pdf-viewer', {
        profile,
        title: `${rulesPdf.title} (${rulesPdf.edition})`,
        viewerTitle: `${rulesPdf.title} — ${rulesPdf.edition}`,
        pdfUrl: signedUrl,
        backUrl: '/rules',
        activeNav: 'rules',
        breadcrumbs: [
            { label: 'Rules Library', href: '/rules' },
            { label: `${rulesPdf.title} (${rulesPdf.edition})`, href: `/rules/${id}/view` }
        ]
    });
});

module.exports = router;

