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
    getEffectiveClassUnlock,
    unlockClass,
    getVersionHistory,
    createUnlockCodes,
    listUnlockCodes,
    redeemUnlockCode,
    deleteClass,
    saveClassPdfMetadata,
    canViewClassPdf
} = require('../models/class');
const { getRulesPdf } = require('../models/rules');
const { storeClassPdf, getSignedPdfUrl, deletePdfObject, CLASS_PDF_BUCKET } = require('../models/pdf');
const { getProfileById, patchOnboarding } = require('../models/profile');
const { isAuthenticated, requireAdmin, authOptional } = require('../util/auth');
const { sendError, FRIENDLY_NOT_FOUND } = require('../util/http-error');
const { actorFromLocals } = require('../util/actor');
const { asyncHandler } = require('../util/async-handler');
const { processClassImport } = require('../util/class-import');
const { exportClass, getSupportedFormats, EXPORT_FORMATS } = require('../util/class-export');
const { parseImageCrop } = require('../util/crop');
const { redeemAnyCode } = require('../util/redeem-code');
const { groupClassVersions } = require('../util/class-list-grouping');
const { partitionClassGroups } = require('../util/class-filter');
const { statList } = require('../util/enclave-consts');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
    // First gate: reject obviously non-PDF uploads by declared type. The
    // authoritative content check (%PDF- magic bytes) lives in pdf.js, since
    // this mimetype is client-supplied and spoofable.
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(null, false);
        }
        cb(null, true);
    }
});

const ensureArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
};

const parseStatSpread = (body) => {
    const nested = (body.stat_spread && typeof body.stat_spread === 'object' && !Array.isArray(body.stat_spread))
        ? body.stat_spread
        : null;
    const spread = {};
    for (const stat of statList) {
        const raw = nested ? nested[stat] : body[`stat_spread[${stat}]`];
        delete body[`stat_spread[${stat}]`];
        const points = parseInt(raw, 10);
        if (Number.isInteger(points) && points > 0) {
            spread[stat] = Math.min(points, 3);
        }
    }
    return spread;
};

// One example per line. Ends-only trimming: interior runs of whitespace, en
// dashes and curly quotes are verbatim content copied from the source document.
const parseExamples = (body) => String(body.examples ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

// Mirrors the CHECK constraints these two columns carry. Both accept NULL and
// reject '', so an unselected option must land as NULL rather than as the empty
// string the select submits, and anything outside the allowlist -- a typo from a
// non-browser client -- must not reach Postgres as a raw constraint violation.
const CONSTRAINED_SELECTS = {
    challenge_level: ['Low', 'Mid', 'High'],
    prerelease_section: ['pcc', 'exclusive', 'aspirant']
};

const applyConstrainedSelects = (body) => {
    for (const [field, allowed] of Object.entries(CONSTRAINED_SELECTS)) {
        if (body[field] !== undefined) {
            body[field] = allowed.includes(body[field]) ? body[field] : null;
        }
    }
};

// Curation and provenance, not player-editable metadata: prerelease_section
// records which section of the source document a class was printed under, and
// designer credits its author. The form hides all three from non-admins, so the
// handlers drop them rather than trust them. Deleting rather than nulling gives
// the same asymmetry is_player_created already has -- create takes the column
// default, update leaves whatever an admin set.
const ADMIN_ONLY_FIELDS = ['challenge_level', 'prerelease_section', 'designer'];

const dropAdminOnlyFields = (body) => {
    for (const field of ADMIN_ONLY_FIELDS) {
        delete body[field];
    }
};

// NULL means "this class has no such field"; '' asserts that someone set it to
// nothing. Every one of these columns is nullable by design and holds a
// verbatim copy of the source document, so a form that renders a NULL column as
// an empty textarea must not write '' back over it on a routine save.
//
// `examples` is excluded: it is jsonb NOT NULL DEFAULT '[]', so blank means an
// empty array. `teaser` and `tips` are excluded because their blank-handling
// predates this branch.
const NULLABLE_TEXT_FIELDS = [
    'stat_line', 'stat_note', 'quote', 'quote_source', 'overview',
    'conduit_notes', 'grounding', 'examples_heading', 'tips_heading', 'designer'
];

const blankTextToNull = (body) => {
    for (const field of NULLABLE_TEXT_FIELDS) {
        if (typeof body[field] === 'string' && body[field].trim() === '') {
            body[field] = null;
        }
    }
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

    // Collapse version families to their latest (leaf) version, UNLESS the user
    // explicitly filtered by a specific rules_version — then show each match flat.
    const versionFiltered = !!filters.rules_version;
    const classGroups = versionFiltered
        ? (classes || []).map((c) => ({ primary: c, previous: [] }))
        : groupClassVersions(classes || []);
    // Released classes (officials + graduated PCCs) lead the page; unreleased
    // PCCs get their own art-free section below.
    const { released: releasedGroups, pcc: pccGroups } = partitionClassGroups(classGroups);

    res.render('classes', {
        profile,
        title: 'Classes',
        releasedGroups,
        pccGroups,
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
        statList,
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
    const { inputText } = req.body;
    try {
        const importedClass = await processClassImport(inputText, actorFromLocals(res.locals));
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
            const { type, id, error } = await redeemAnyCode(code, userId);
            if (error) {
                results.push({ code, success: false, error: error.message });
                continue;
            }
            if (type === 'pdf') {
                let pdfTitle = null;
                try {
                    const { data: pdfData } = await getRulesPdf(id);
                    pdfTitle = pdfData?.title || null;
                } catch (_) {
                    // ignore
                }
                results.push({ code, success: true, type, pdf_id: id, pdf_title: pdfTitle });
                continue;
            }
            let className = null;
            try {
                const { data: classData } = await getClass(id, res.locals.supabase);
                className = classData?.name || null;
            } catch (_) {
                // ignore
            }
            results.push({ code, success: true, type, class_id: id, class_name: className });
        } catch (e) {
            results.push({ code, success: false, error: e?.message || 'Unknown error' });
        }
    }

    if (results.some(r => r.success)) {
        // Onboarding step: fire-and-forget, redemption results render regardless.
        patchOnboarding(userId, { redeemed: true }).catch(() => {});
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
        statList,
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

    const capitalize = (word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word);

    const classCard = () => res.locals.openGraph({
        type: 'article',
        title: classData.name,
        description: [
            // Matches how the page itself labels the edition: "Advent v2".
            [capitalize(classData.rules_edition), classData.rules_version].filter(Boolean).join(' '),
            classData.teaser
        ].filter(Boolean).join(' · '),
        image: classData.image_url,
        suppress: classData.is_public === false
    });

    let unlocked = false;
    let unlockExpiresAt = null;
    if (profile) {
        const { data: access } = await getEffectiveClassUnlock(profile.user_id, id);
        unlocked = access?.unlocked || false;
        unlockExpiresAt = access?.expiresAt || null;
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
                og: classCard(),
                title: `${classData.name} - View Class`,
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
        const viewerUserId = res.locals.user?.id || null;
        const { data: canAccess, error: accessError } = await canViewClassPdf(
            {
                userId: viewerUserId,
                profileId: profile?.id || null,
                role: profile?.role || null
            },
            classData,
            // Reuse the unlock check already made above rather than resolving
            // the user's effective unlocks a second time — only when it was
            // resolved for this same viewer.
            profile && profile.user_id === viewerUserId ? { unlocked } : {}
        );
        classPdfAccessible = !!canAccess;
        if (accessError) {
            classPdfError = accessError.message || 'Unable to determine PDF access';
        }
    }

    res.render('class-view', {
        profile,
        og: classCard(),
        title: `${classData.name} - View Class`,
        class: classData,
        unlocked,
        unlockExpiresAt,
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
router.post('/:id/codes', isAuthenticated, requireAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { expires_at, max_uses, amount } = req.body;
    const createdByProfileId = res.locals.profile.id;
    const count = parseInt(amount, 10) || 1;
    const actor = actorFromLocals(res.locals);
    const { data, error } = await createUnlockCodes(actor, { classId: id, createdByProfileId, expiresAt: expires_at || null, maxUses: max_uses || 1, amount: count });
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
}));

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

router.post('/', isAuthenticated, upload.single('class_pdf'), asyncHandler(async (req, res) => {
    const { profile } = res.locals;
    const profileId = profile?.id;
    if (!profileId) {
        return sendError(req, res, null, { status: 500, message: 'Missing profile id' });
    }
    const actor = actorFromLocals(res.locals);

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

    const image_crop = parseImageCrop(req.body.image_crop);
    if (image_crop !== undefined) {
        req.body.image_crop = image_crop;
    }

    req.body.stat_spread = parseStatSpread(req.body);
    req.body.examples = parseExamples(req.body);
    if (!isAdmin) {
        dropAdminOnlyFields(req.body);
    }
    applyConstrainedSelects(req.body);
    blankTextToNull(req.body);

    const { data: classData, error } = await createClass(actor, req.body);
    if (error) {
        return sendError(req, res, error);
    }

    if (req.file) {
        const { data: storageInfo, error: storageError } = await storeClassPdf(classData.id, req.file);
        if (storageError) {
            return sendError(req, res, storageError, { status: 500, message: 'Failed to store class PDF' });
        }
        const { error: metaError } = await saveClassPdfMetadata(actor, classData.id, storageInfo.path);
        if (metaError) {
            return sendError(req, res, metaError, { status: 500, message: 'Failed to update class PDF metadata' });
        }
    }

    return res.header('HX-Location', `/classes/${classData.id}/${encodeURIComponent(classData.name)}`).send();
}));

router.put('/:id', isAuthenticated, upload.single('class_pdf'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const actor = actorFromLocals(res.locals);

    const { data: existingClass, error: fetchError } = await getClass(id, res.locals.supabase);
    if (fetchError || !existingClass) {
        return sendError(req, res, fetchError, { status: 404, title: 'Not found', message: 'Class not found' });
    }

    // Authz (owner-or-admin) is enforced by the service via classService.updateClass.

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

    req.body.stat_spread = parseStatSpread(req.body);
    req.body.examples = parseExamples(req.body);
    if (!isAdmin) {
        dropAdminOnlyFields(req.body);
    }
    applyConstrainedSelects(req.body);
    blankTextToNull(req.body);

    const { data: classData, error } = await updateClass(actor, id, req.body);
    if (error) {
        return sendError(req, res, error);
    }

    if (req.file) {
        const { data: storageInfo, error: storageError } = await storeClassPdf(id, req.file, { previousPath: existingClass.pdf_storage_path });
        if (storageError) {
            return sendError(req, res, storageError, { status: 500, message: 'Failed to store class PDF' });
        }
        const { error: metaError } = await saveClassPdfMetadata(actor, id, storageInfo.path);
        if (metaError) {
            return sendError(req, res, metaError, { status: 500, message: 'Failed to update class PDF metadata' });
        }
    } else if (removePdf && existingClass.pdf_storage_path) {
        await deletePdfObject({ bucket: CLASS_PDF_BUCKET, path: existingClass.pdf_storage_path });
        await saveClassPdfMetadata(actor, id, null);
    }

    return res.header('HX-Location', `/classes/${id}/${encodeURIComponent(classData.name)}`).send();
}));

// Delete a class (owner or admin; enforced by the service via classService.deleteClass)
router.delete('/:id', isAuthenticated, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const actor = actorFromLocals(res.locals);

    const { data: existingClass, error: fetchError } = await getClass(id, res.locals.supabase);
    if (fetchError || !existingClass) {
        return sendError(req, res, fetchError, { status: 404, message: 'Class not found' });
    }

    const { error } = await deleteClass(actor, id);
    if (error) {
        return sendError(req, res, error);
    }
    // HX-Location, not 204: htmx does not swap on 204, so the my-classes
    // delete button (my-classes.handlebars:115) left the row on screen even on
    // success. Matches how the character, mission, and LFG delete routes
    // already answer.
    //
    // The class-view delete button was inert for a SECOND, unrelated reason:
    // it carried hx-target="closest tr" on a page with no <tr>, so htmx
    // aborted with htmx:targetError before ever issuing a request. That is
    // fixed in the template, not here -- HX-Location cannot help a request
    // that is never sent.
    //
    // Delete returns you to the list you came from. The My PCCs list is served
    // at /classes/my (this router is mounted at /classes, see app.js) -- NOT
    // /my-classes, which is only the activeNav key and matches no route.
    let dest = '/classes';
    try {
        if (new URL(req.get('HX-Current-URL')).pathname === '/classes/my') {
            dest = '/classes/my';
        }
    } catch {
        // Missing/unparseable HX-Current-URL — fall back to /classes.
    }
    return res.header('HX-Location', dest).send();
}));

module.exports = router;
