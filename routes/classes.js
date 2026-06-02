const express = require('express');
const multer = require('multer');
const router = express.Router();
const { registerUuidParams } = require('../util/validate');
registerUuidParams(router, ['id']);
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
    createUnlockCodes,
    listUnlockCodes,
    redeemUnlockCode,
    deleteClass,
    getProfileById,
    saveClassPdfMetadata,
    storeClassPdf,
    getSignedPdfUrl,
    canViewClassPdf,
    deletePdfObject,
    CLASS_PDF_BUCKET
} = require('../util/supabase');
const { isAuthenticated, requireAdmin, authOptional } = require('../util/auth');
const { sendError, FRIENDLY_NOT_FOUND } = require('../util/http-error');
const { processClassImport } = require('../util/class-import');
const { exportClass, getSupportedFormats, EXPORT_FORMATS } = require('../util/class-export');
const { parseImageCrop } = require('../util/crop');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

const ensureArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
};

// View Routes
router.get('/', authOptional, async (req, res) => {
    const { profile } = res.locals;

    // get class filters
    const isAdmin = profile?.role === 'admin';
    const filters = {
        rules_edition: req.query.rules_edition,
        rules_version: req.query.rules_version,
        status: req.query.status,
    };
    // Non-admins see only public classes. Admins see all (RLS-permitted) entries.
    if (!isAdmin) {
        filters.is_public = true;
    }
    if (req.query.is_player_created) {
        filters.is_player_created = req.query.is_player_created === 'true';
    }

    const { data: classes, error } = await getClasses(filters, res.locals.supabase);
    if (error) {
        return sendError(req, res, error);
    }
    res.render('classes', {
        profile,
        title: 'Classes',
        classes: classes,
        filters: filters,
        isAdmin,
        activeNav: 'classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' }
        ]
    });
});

// My Classes (owned by current profile)
router.get('/my', isAuthenticated, async (req, res) => {
    const { profile } = res.locals;
    const filters = {
        created_by: profile?.id,
        rules_edition: req.query.rules_edition,
        rules_version: req.query.rules_version,
        status: req.query.status,
    };

    const { data: classes, error } = await getClasses(filters, res.locals.supabase);
    if (error) {
        return sendError(req, res, error);
    }
    res.render('my-classes', {
        profile,
        title: 'My Classes',
        classes: classes,
        filters: filters,
        activeNav: 'my-classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' },
            { label: 'My PCCs', href: '/classes/my' }
        ]
    });
});

router.get('/new', isAuthenticated, (req, res) => {
    const { profile } = res.locals;
    res.render('class-form', {
        profile,
        title: 'New Class',
        isNew: true,
        class: null,
        activeNav: 'classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' },
            { label: 'New Class', href: '/classes/new' }
        ]
    });
});

router.get('/import', isAuthenticated, (req, res) => {
    const { profile } = res.locals;
    res.render('class-import', {
        profile,
        title: 'Import Class',
        activeNav: 'classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' },
            { label: 'Import Class', href: '/classes/import' }
        ]
    });
});

router.post('/import', isAuthenticated, async (req, res) => {
    const { profile } = res.locals;
    const { inputText } = req.body;
    try {
        const importedClass = await processClassImport(inputText, profile);
        const classData = Array.isArray(importedClass) ? importedClass[0] : importedClass;
        return res.header('HX-Location', `/classes/${classData.id}/${encodeURIComponent(classData.name)}`).send();
    } catch (error) {
        return sendError(req, res, error);
    }
});

// Bulk Redeem: show form
router.get('/redeem/bulk', isAuthenticated, async (req, res) => {
    const { profile } = res.locals;
    return res.render('redeem-codes', {
        profile,
        title: 'Redeem Unlock Codes',
        results: null,
        input_codes: '',
        activeNav: 'redeem',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' },
            { label: 'Redeem Codes', href: '/classes/redeem/bulk' }
        ]
    });
});

// Bulk Redeem: process textarea input
router.post('/redeem/bulk', isAuthenticated, async (req, res) => {
    const { profile } = res.locals;
    const userId = res.locals.user.id;
    const codesRaw = (req.body.codes || '').trim();

    if (!codesRaw) {
        return res.render('redeem-codes', {
            profile,
            title: 'Redeem Unlock Codes',
            results: [],
            input_codes: '',
            activeNav: 'redeem',
            breadcrumbs: [
                { label: 'Classes', href: '/classes' },
                { label: 'Redeem Codes', href: '/classes/redeem/bulk' }
            ]
        });
    }

    // Split by newlines or commas; trim and de-duplicate
    const codes = Array.from(new Set(
        codesRaw
            .split(/\r?\n|,/)
            .map(c => c.trim())
            .filter(c => c.length > 0)
    ));

    const results = [];
    for (const code of codes) {
        try {
            const { data: classId, error } = await redeemUnlockCode(code, userId);
            if (error) {
                results.push({ code, success: false, error: error.message });
                continue;
            }
            let className = null;
            try {
                const { data: classData } = await getClass(classId, res.locals.supabase);
                className = classData?.name || null;
            } catch (_) {
                // ignore
            }
            results.push({ code, success: true, class_id: classId, class_name: className });
        } catch (e) {
            results.push({ code, success: false, error: e?.message || 'Unknown error' });
        }
    }

    return res.render('redeem-codes', {
        profile,
        title: 'Redeem Unlock Codes',
        results,
        input_codes: codesRaw,
        activeNav: 'redeem',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' },
            { label: 'Redeem Codes', href: '/classes/redeem/bulk' }
        ]
    });
});

router.get('/:id/edit', isAuthenticated, async (req, res) => {
    const { profile } = res.locals;
    const { id } = req.params;
    const { data: classData, error } = await getClass(id, res.locals.supabase);
    if (error) {
        return sendError(req, res, error);
    }
    res.render('class-form', {
        profile,
        title: 'Edit Class',
        class: classData,
        activeNav: 'classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' },
            { label: classData.name, href: `/classes/${id}/${encodeURIComponent(classData.name)}` },
            { label: 'Edit', href: '#' }
        ]
    });
});

router.get('/:id/pdf', authOptional, async (req, res) => {
    const { profile, user } = res.locals;
    const { id } = req.params;

    const { data: classData, error } = await getClass(id, res.locals.supabase);
    if (error || !classData) {
        return sendError(req, res, null, { status: 404, message: 'Class not found' });
    }

    if (!classData.pdf_storage_path) {
        return sendError(req, res, null, { status: 404, message: 'Class PDF not available' });
    }

    const { data: canView, error: canViewError } = await canViewClassPdf(
        {
            userId: user?.id || null,
            profileId: profile?.id || null,
            role: profile?.role || null
        },
        classData
    );

    if (canViewError) {
        return sendError(req, res, canViewError, { message: 'Unable to verify access' });
    }

    if (!canView) {
        return sendError(req, res, null, { status: 403, title: 'No access', message: 'You do not have access to this class PDF' });
    }

    const { data: signedUrl, error: signedError } = await getSignedPdfUrl({
        bucket: CLASS_PDF_BUCKET,
        path: classData.pdf_storage_path,
        expiresIn: 600
    });

    if (signedError || !signedUrl) {
        console.error('Failed to create signed URL for class PDF', {
            classId: id,
            bucket: CLASS_PDF_BUCKET,
            storagePath: classData.pdf_storage_path,
            error: signedError?.message || signedError
        });
        return sendError(req, res, null, { status: 500, message: 'Failed to prepare class PDF' });
    }

    return res.render('pdf-viewer', {
        profile,
        title: `${classData.name} PDF`,
        viewerTitle: `${classData.name} Class PDF`,
        pdfUrl: signedUrl,
        backUrl: `/classes/${classData.id}/${classData.name || ''}`,
        breadcrumbs: [
            { label: 'Classes', href: '/classes' },
            { label: classData.name, href: `/classes/${classData.id}/${encodeURIComponent(classData.name || '')}` },
            { label: 'PDF', href: `/classes/${classData.id}/pdf` }
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

    const { data: classData, error } = await getClass(id, res.locals.supabase);
    if (error) {
        return sendError(req, res, error);
    }

    // Only the creator or admin can export
    if (classData.created_by !== profile.id && profile.role !== 'admin') {
        return sendError(req, res, null, { status: 403, title: 'No access', message: 'You can only export your own classes' });
    }
    
    const { content, mimeType, filename } = exportClass(classData, format);
    
    res.setHeader('Content-Type', `${mimeType}; charset=utf-8`);
    const safeFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '\\"');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', Buffer.byteLength(content, 'utf-8'));
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(content);
});

router.get('/:id/:name?', authOptional, async (req, res) => {
    const { profile } = res.locals;
    const { id } = req.params;
    const { data: classData, error } = await getClass(id, res.locals.supabase);
    if (error) {
        return sendError(req, res, error);
    }

    let unlocked = false;
    if (profile) {
        const result = await isClassUnlocked(profile.user_id, id);
        unlocked = result?.data || false;
    }

    // Show teaser if Release and not unlocked for non-admins/non-creators
    if (
        classData &&
        classData.status === 'release' &&
        (!profile || (profile.role !== 'admin' && profile.id !== classData.created_by))
    ) {
        if (!unlocked) {
            return res.render('class-view-teaser', {
                profile,
                title: 'View Class',
                class: classData,
                activeNav: 'classes',
                breadcrumbs: [
                    { label: 'Classes', href: '/classes' },
                    { label: classData.name, href: `/classes/${id}/${encodeURIComponent(classData.name)}` }
                ]
            });
        }
    }

    // Load owner profile for linking (if public)
    let ownerProfile = null;
    try {
        const { data: creator } = await getProfileById(classData.created_by, res.locals.supabase);
        if (creator && creator.is_public !== false) {
            ownerProfile = creator;
        }
    } catch (_) {
        // optional
    }

    let classPdfAccessible = false;
    let classPdfError = null;
    if (classData?.pdf_storage_path) {
        const { data: canAccess, error: accessError } = await canViewClassPdf(
            {
                userId: res.locals.user?.id || null,
                profileId: profile?.id || null,
                role: profile?.role || null
            },
            classData
        );
        classPdfAccessible = !!canAccess;
        if (accessError) {
            classPdfError = accessError.message || 'Unable to determine PDF access';
        }
    }

    res.render('class-view', {
        profile,
        title: 'View Class',
        class: classData,
        unlocked,
        ownerProfile,
        classPdfAccessible,
        classPdfError,
        activeNav: 'classes',
        breadcrumbs: [
            { label: 'Classes', href: '/classes' },
            { label: classData.name, href: `/classes/${id}/${encodeURIComponent(classData.name)}` }
        ]
    });
});

// Duplicate a class to a new version
router.post('/:id/duplicate', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { profile } = res.locals;
    const { new_version, new_edition } = req.body;
    if (!new_version) return sendError(req, res, null, { status: 400, message: 'new_version is required' });
    if (new_edition && !['advent', 'aspirant'].includes(new_edition)) {
      return sendError(req, res, null, { status: 400, message: 'Invalid new_edition' });
    }

    const { data: sourceClass, error: fetchError } = await getClass(id, res.locals.supabase);
    if (fetchError || !sourceClass) {
        return sendError(req, res, fetchError, { status: 404, message: 'Class not found' });
    }
    const isAdminCaller = profile?.role === 'admin';
    const isOwner = !!profile?.id && profile.id === sourceClass.created_by;
    if (!isAdminCaller && !isOwner) {
        return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
    }

    const { data: newClassId, error } = await duplicateClass(id, new_version, new_edition || null);
    if (error) return sendError(req, res, error);
    try {
        const { data: newClass } = await getClass(newClassId, res.locals.supabase);
        const slug = newClass?.name ? `/${encodeURIComponent(newClass.name)}` : '';
        return res.header('HX-Location', `/classes/${newClassId}${slug}`).status(204).send();
    } catch (_) {
        return res.header('HX-Location', `/classes/${newClassId}`).status(204).send();
    }
});

// Version history (base and derived)
router.get('/:id/history', isAuthenticated, async (req, res) => {
    const { profile } = res.locals;
    const { id } = req.params;
    const { data: history, error } = await getVersionHistory(id);
    if (error) return sendError(req, res, error);
    return res.render('partials/class-history', { layout: false, profile, history });
});

// Self-unlock eligible PCCs (alpha/beta, public)
router.post('/:id/unlock/self', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const userId = res.locals.user.id;
    const { data: cls, error } = await getClass(id, res.locals.supabase);
    if (error || !cls) return sendError(req, res, error, { message: 'Class not found' });
    if (!((cls.is_public === true) && cls.is_player_created === true && ['alpha','beta'].includes(cls.status))) {
        return sendError(req, res, null, { status: 403, title: 'No access', message: 'Not eligible for self-unlock' });
    }
    const { error: unlockError } = await unlockClass(userId, id);
    if (unlockError) return sendError(req, res, unlockError);
    return res.status(204).send();
});

// Admin: generate unlock code for a class
router.post('/:id/codes', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { expires_at, max_uses, amount } = req.body;
    const createdByProfileId = res.locals.profile.id;
    const count = parseInt(amount, 10) || 1;
    const { data, error } = await createUnlockCodes({ classId: id, createdByProfileId, expiresAt: expires_at || null, maxUses: max_uses || 1, amount: count });
    if (error) return sendError(req, res, error);

    if (count > 1) {
        return res.render('partials/unlock-code-result', {
            layout: false,
            codes: data
        });
    }

    if (!data || data.length === 0) {
        return sendError(req, res, null, { status: 400, message: 'Unlock code creation returned no rows' });
    }
    const code = data[0];
    return res.render('partials/unlock-code-result', {
        layout: false,
        code: code.code,
        max_uses: code.max_uses,
        expires_at: code.expires_at
    });
});

// Admin: list unlock codes for a class
router.get('/:id/codes', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { data, error } = await listUnlockCodes(id, res.locals.supabase);
    if (error) return sendError(req, res, error);
    return res.json(data);
});

// User: redeem code
router.post('/redeem', isAuthenticated, async (req, res) => {
    const { code } = req.body;
    if (!code) return sendError(req, res, null, { status: 400, message: 'Code is required' });
    const userId = res.locals.user.id;
    const { data: classId, error } = await redeemUnlockCode(code, userId);
    if (error) return sendError(req, res, error);

    // Navigate to the unlocked class view using HX-Location for htmx
    try {
        const { data: classData } = await getClass(classId, res.locals.supabase);
        const slug = classData?.name ? `/${encodeURIComponent(classData.name)}` : '';
        return res.header('HX-Location', `/classes/${classId}${slug}`).status(204).send();
    } catch (_) {
        return res.header('HX-Location', `/classes/${classId}`).status(204).send();
    }
});

router.post('/', isAuthenticated, upload.single('class_pdf'), async (req, res) => {
    const { profile } = res.locals;
    const profileId = profile?.id;
    if (!profileId) {
        return sendError(req, res, null, { status: 500, message: 'Missing profile id' });
    }
    
    // Process abilities and gear arrays
    const abilityNames = ensureArray(req.body['ability_name[]'] || req.body.ability_name);
    const abilityDescriptions = ensureArray(req.body['ability_description[]'] || req.body.ability_description);
    const abilities = abilityNames
        .map((name, index) => ({
            name: name,
            description: abilityDescriptions[index] || ''
        }))
        .filter((ability) => ability.name);
    req.body.abilities = abilities;
    delete req.body['ability_name[]'];
    delete req.body['ability_description[]'];
    delete req.body.ability_name;
    delete req.body.ability_description;

    const gearNames = ensureArray(req.body['gear_name[]'] || req.body.gear_name);
    const gearDescriptions = ensureArray(req.body['gear_description[]'] || req.body.gear_description);
    const gear = gearNames
        .map((name, index) => ({
            name: name,
            description: gearDescriptions[index] || ''
        }))
        .filter((item) => item.name);
    req.body.gear = gear;
    delete req.body['gear_name[]'];
    delete req.body['gear_description[]'];
    delete req.body.gear_name;
    delete req.body.gear_description;

    // Normalize is_public checkbox
    if (req.body.is_public === 'on') {
        req.body.is_public = true;
    } else {
        req.body.is_public = false;
    }

    // Enforce class type: only admins may set/override is_player_created
    const isAdmin = profile?.role === 'admin';
    if (isAdmin) {
        if (req.body.is_player_created !== undefined) {
            req.body.is_player_created = req.body.is_player_created === 'true';
        }
    } else {
        req.body.is_player_created = true;
        // Non-admins can only create alpha/beta
        req.body.status = ['alpha', 'beta'].includes(req.body.status) ? req.body.status : 'alpha';
    }

    // Always set created_by to the current profile
    req.body.created_by = profileId;

    const image_crop = parseImageCrop(req.body.image_crop);
    if (image_crop !== undefined) {
        req.body.image_crop = image_crop;
    }

    const { data: classData, error } = await createClass(req.body);
    if (error) {
        return sendError(req, res, error);
    }

    if (req.file) {
        const { data: storageInfo, error: storageError } = await storeClassPdf(classData.id, req.file);
        if (storageError) {
            return sendError(req, res, storageError, { status: 500, message: 'Failed to store class PDF' });
        }
        const { error: metaError } = await saveClassPdfMetadata(classData.id, storageInfo.path);
        if (metaError) {
            return sendError(req, res, metaError, { status: 500, message: 'Failed to update class PDF metadata' });
        }
    }

    return res.header('HX-Location', `/classes/${classData.id}/${encodeURIComponent(classData.name)}`).send();
});

router.put('/:id', isAuthenticated, upload.single('class_pdf'), async (req, res) => {
    const { id } = req.params;
    const { profile } = res.locals;

    const { data: existingClass, error: fetchError } = await getClass(id, res.locals.supabase);
    if (fetchError || !existingClass) {
        return sendError(req, res, fetchError, { status: 404, title: 'Not found', message: 'Class not found' });
    }

    // Authz: only the class creator or an admin may update
    const isAdminCaller = profile?.role === 'admin';
    const isOwner = !!profile?.id && profile.id === existingClass.created_by;
    if (!isAdminCaller && !isOwner) {
        return sendError(req, res, null, { status: 403, title: 'No access', message: 'Not authorized' });
    }

    const image_crop = parseImageCrop(req.body.image_crop);
    if (image_crop !== undefined) {
        req.body.image_crop = image_crop;
    }

    const abilityNames = ensureArray(req.body['ability_name[]'] || req.body.ability_name);
    const abilityDescriptions = ensureArray(req.body['ability_description[]'] || req.body.ability_description);
    const abilities = abilityNames
        .map((name, index) => ({
            name: name,
            description: abilityDescriptions[index] || ''
        }))
        .filter((ability) => ability.name);
    req.body.abilities = abilities;
    delete req.body['ability_name[]'];
    delete req.body['ability_description[]'];
    delete req.body.ability_name;
    delete req.body.ability_description;

    const gearNames = ensureArray(req.body['gear_name[]'] || req.body.gear_name);
    const gearDescriptions = ensureArray(req.body['gear_description[]'] || req.body.gear_description);
    const gear = gearNames
        .map((name, index) => ({
            name: name,
            description: gearDescriptions[index] || ''
        }))
        .filter((item) => item.name);
    req.body.gear = gear;
    delete req.body['gear_name[]'];
    delete req.body['gear_description[]'];
    delete req.body.gear_name;
    delete req.body.gear_description;

    if (req.body.is_public === 'on') {
        req.body.is_public = true;
    } else if (req.body.is_public === undefined) {
        // unchecked in forms does not send field; default to false unless explicitly set elsewhere
        req.body.is_public = false;
    }
    // Enforce class type: only admins may change is_player_created
    const isAdmin = res.locals.profile?.role === 'admin';
    if (isAdmin) {
        if (req.body.is_player_created !== undefined) {
            req.body.is_player_created = req.body.is_player_created === 'true';
        }
        // Do not accept creator overrides via request body anymore
    } else {
        delete req.body.is_player_created;
        // Non-admins cannot set release; ignore disallowed values
        if (req.body.status && !['alpha', 'beta'].includes(req.body.status)) {
            delete req.body.status;
        }
    }
    const removePdf = req.body.remove_pdf === 'on';
    delete req.body.remove_pdf;

    const { data: classData, error } = await updateClass(id, req.body);
    if (error) {
        return sendError(req, res, error);
    }

    if (req.file) {
        const { data: storageInfo, error: storageError } = await storeClassPdf(id, req.file, { previousPath: existingClass.pdf_storage_path });
        if (storageError) {
            return sendError(req, res, storageError, { status: 500, message: 'Failed to store class PDF' });
        }
        const { error: metaError } = await saveClassPdfMetadata(id, storageInfo.path);
        if (metaError) {
            return sendError(req, res, metaError, { status: 500, message: 'Failed to update class PDF metadata' });
        }
    } else if (removePdf && existingClass.pdf_storage_path) {
        await deletePdfObject({ bucket: CLASS_PDF_BUCKET, path: existingClass.pdf_storage_path });
        await saveClassPdfMetadata(id, null);
    }

    return res.header('HX-Location', `/classes/${id}/${encodeURIComponent(classData.name)}`).send();
});

// Delete a class (owner or admin)
router.delete('/:id', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { profile } = res.locals;

    const { data: existingClass, error: fetchError } = await getClass(id, res.locals.supabase);
    if (fetchError || !existingClass) {
        return sendError(req, res, fetchError, { status: 404, message: 'Class not found' });
    }

    const isAdminCaller = profile?.role === 'admin';
    const isOwner = !!profile?.id && profile.id === existingClass.created_by;
    if (!isAdminCaller && !isOwner) {
        return sendError(req, res, null, { status: 403, title: 'No access', message: FRIENDLY_NOT_FOUND });
    }

    const { error } = await deleteClass(id);
    if (error) {
        return sendError(req, res, error);
    }
    return res.status(204).send();
});

module.exports = router;
