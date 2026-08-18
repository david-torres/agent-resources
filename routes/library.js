const express = require('express');
const multer = require('multer');
const crypto = require('crypto');

const router = express.Router();
const { registerUuidParams, isValidUuid } = require('../util/validate');
registerUuidParams(router, ['id', 'userId']);

const {
    getRulesPdfs,
    getRulesPdf,
    createRulesPdf,
    updateRulesPdf,
    listRulesPdfUnlocksForUser,
    upsertRulesPdfUnlock,
    deleteRulesPdfUnlock,
    createRulesPdfUnlockCodes,
    canViewRulesPdf,
    listAllUnlockGrantsAdmin,
    listAllUnlockCodesAdmin
} = require('../models/rules');
const { storeRulesPdf, deletePdfObject, getSignedPdfUrl, RULES_PDF_BUCKET } = require('../models/pdf');
const { getProfileByNameAdmin, getProfileByIdAdmin, patchOnboarding } = require('../models/profile');
const { STARTER_RULES_PDF_ID, CORE_CLASS_UNLOCKS } = require('../util/starter-content');
const { isAuthenticated, requireAdmin, authOptional } = require('../util/auth');
const { sendError } = require('../util/http-error');
const { expandRulesUnlocksByTitle } = require('../util/rules-family');
const { groupRulesVersions } = require('../util/library-list-grouping');
const { withRuleAccess } = require('../util/library-access');
const { actorFromLocals } = require('../util/actor');
const { asyncHandler } = require('../util/async-handler');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
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

// The rulesets that exist are exactly the ones with a core roster.
const RULESETS = new Set(Object.keys(CORE_CLASS_UNLOCKS));
const normalizeRuleset = (value) => (RULESETS.has(value) ? value : null);

// rules_edition names the ruleset a book belongs to; book_type says whether
// it is that ruleset's core rulebook. Only 'core' confers the roster
// (services/rules/repository.js), so this is never inferred — an unset or
// unrecognised value is rejected rather than defaulted.
const BOOK_TYPES = new Set(['core', 'supplement']);
const normalizeBookType = (value) => (BOOK_TYPES.has(value) ? value : null);

// Create and update post the same ruleset/type pair with the same rejection
// rules; `error` carries the 400 message when either field is unusable.
const parseBookFields = (body) => {
    const rulesEdition = normalizeRuleset(body.rules_edition);
    if (!rulesEdition) {
        return { error: `Ruleset must be ${[...RULESETS].join(' or ')}` };
    }
    const bookType = normalizeBookType(body.book_type);
    if (!bookType) {
        return { error: 'Type must be core or supplement' };
    }
    return { rulesEdition, bookType, error: null };
};

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
        return sendError(req, res, error, { message: 'Failed to load rules PDFs' });
    }

    let unlocksMap = new Map();
    if (user) {
        const { data: unlocks } = await listRulesPdfUnlocksForUser(user.id);
        if (Array.isArray(unlocks)) {
            // Family expansion: an unlock for any version of a title badges
            // every version in the rendered list.
            unlocksMap = expandRulesUnlocksByTitle(rules || [], unlocks);
        }
    }

    const rulesWithAccess = withRuleAccess(rules || [], unlocksMap, isAdmin, new Date());

    return res.render('library', {
        profile,
        title: 'Library',
        ruleGroups: groupRulesVersions(rulesWithAccess),
        isAdmin,
        activeNav: 'library',
        breadcrumbs: [
            { label: 'Library', href: '/library' }
        ]
    });
});

router.get('/manage', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    const { data: rules, error } = await getRulesPdfs({ includeInactive: true });
    if (error) {
        return sendError(req, res, error, { message: 'Failed to load rules PDFs' });
    }

    return res.render('library-manage', {
        profile,
        title: 'Manage Rules PDFs',
        rules: rules || [],
        activeNav: 'library',
        breadcrumbs: [
            { label: 'Library', href: '/library' },
            { label: 'Manage', href: '/library/manage' }
        ]
    });
});

// Admin: unlock dashboard — every grant and code across every PDF.
router.get('/unlocks', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    const [rulesResult, grantsResult, codesResult] = await Promise.all([
        getRulesPdfs({ includeInactive: true }),
        listAllUnlockGrantsAdmin(),
        listAllUnlockCodesAdmin()
    ]);

    const error = rulesResult.error || grantsResult.error || codesResult.error;
    if (error) {
        return sendError(req, res, error, { message: 'Failed to load unlock dashboard' });
    }

    // Display state is computed here, not in the template: the client-side
    // filter script reads it off data attributes.
    const now = new Date();
    const grants = (grantsResult.data || []).map((grant) => ({
        ...grant,
        isExpired: grant.expires_at ? new Date(grant.expires_at) <= now : false
    }));
    const codes = (codesResult.data || []).map((code) => ({
        ...code,
        isUsable: (!code.expires_at || new Date(code.expires_at) > now)
            && code.used_count < code.max_uses
    }));

    return res.render('library-unlocks', {
        profile,
        title: 'Unlock Dashboard',
        rules: rulesResult.data || [],
        grants,
        codes,
        activeNav: 'library',
        breadcrumbs: [
            { label: 'Library', href: '/library' },
            { label: 'Manage', href: '/library/manage' },
            { label: 'Unlocks', href: '/library/unlocks' }
        ]
    });
});

// Admin: grant a user access to a rules PDF (document chosen in the form).
router.post('/unlocks', isAuthenticated, requireAdmin, async (req, res) => {
    const { rules_pdf_id, profile_name, profile_id, expires_at } = req.body;
    const { profile } = res.locals;

    if (!isValidUuid(rules_pdf_id)) {
        return sendError(req, res, null, { status: 400, message: 'Invalid rules PDF id' });
    }

    const { data: rulesPdf, error: loadError } = await getRulesPdf(rules_pdf_id);
    if (loadError || !rulesPdf) {
        return sendError(req, res, loadError, { status: 404, message: 'Rules PDF not found' });
    }

    let profileRecord = null;
    if (profile_id && profile_id.trim()) {
        const result = await getProfileByIdAdmin(profile_id.trim());
        if (result?.data) {
            profileRecord = result.data;
        }
    } else if (profile_name && profile_name.trim()) {
        const result = await getProfileByNameAdmin(profile_name.trim());
        if (result?.data) {
            profileRecord = result.data;
        }
    }

    if (!profileRecord) {
        return sendError(req, res, null, { status: 400, message: 'Profile not found' });
    }

    if (!profileRecord.user_id) {
        return sendError(req, res, null, { status: 400, message: 'Profile is missing a linked user' });
    }

    const { error } = await upsertRulesPdfUnlock({
        userId: profileRecord.user_id,
        profileId: profileRecord.id,
        rulesPdfId: rules_pdf_id,
        expiresAt: parseExpiresAt(expires_at),
        grantedBy: profile?.id || null
    });

    if (error) {
        return sendError(req, res, error, { message: 'Failed to grant access' });
    }

    return res.redirect('/library/unlocks');
});

// Admin: generate unlock codes (document chosen in the form).
router.post('/codes', isAuthenticated, requireAdmin, asyncHandler(async (req, res) => {
    const { rules_pdf_id, expires_at, max_uses, amount } = req.body;

    if (!isValidUuid(rules_pdf_id)) {
        return sendError(req, res, null, { status: 400, message: 'Invalid rules PDF id' });
    }

    const createdByProfileId = res.locals.profile.id;
    const count = parseInt(amount, 10) || 1;
    const actor = actorFromLocals(res.locals);
    const { data, error } = await createRulesPdfUnlockCodes(actor, {
        rulesPdfId: rules_pdf_id,
        createdByProfileId,
        expiresAt: parseExpiresAt(expires_at),
        maxUses: parseInt(max_uses, 10) || 1,
        amount: count
    });
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
    const codeRow = data[0];
    return res.render('partials/unlock-code-result', {
        layout: false,
        code: codeRow.code,
        max_uses: codeRow.max_uses,
        expires_at: codeRow.expires_at
    });
}));

router.post('/', isAuthenticated, requireAdmin, upload.single('rules_pdf'), async (req, res) => {
    const { profile } = res.locals;
    const { title, edition } = req.body;
    const { rulesEdition, bookType, error: bookFieldError } = parseBookFields(req.body);
    const isActive = normalizeBoolean(req.body.is_active, true);

    if (!title || !edition) {
        return sendError(req, res, null, { status: 400, message: 'Title and edition are required' });
    }

    if (bookFieldError) {
        return sendError(req, res, null, { status: 400, message: bookFieldError });
    }

    if (!req.file) {
        return sendError(req, res, null, { status: 400, message: 'A PDF file is required' });
    }

    const rulesPdfId = crypto.randomUUID();
    const { data: storageInfo, error: storageError } = await storeRulesPdf(rulesPdfId, req.file);
    if (storageError) {
        return sendError(req, res, storageError, { message: 'Failed to store PDF' });
    }

    const payload = {
        id: rulesPdfId,
        title: title.trim(),
        edition: edition.trim(),
        rules_edition: rulesEdition,
        book_type: bookType,
        storage_path: storageInfo.path,
        is_active: isActive,
        free_access: normalizeBoolean(req.body.free_access, false),
        created_by: profile?.id || null
    };

    const { error } = await createRulesPdf(payload);
    if (error) {
        await deletePdfObject({ bucket: RULES_PDF_BUCKET, path: storageInfo.path });
        return sendError(req, res, error, { message: 'Failed to create rules PDF' });
    }

    return res.redirect('/library/manage');
});

router.post('/:id', isAuthenticated, requireAdmin, upload.single('rules_pdf'), async (req, res) => {
    const { id } = req.params;
    const { title, edition } = req.body;
    const { rulesEdition, bookType, error: bookFieldError } = parseBookFields(req.body);
    // The edit form always renders the is_active checkbox, so an absent field
    // means it was unchecked — falling back to true here made deactivation
    // impossible.
    const isActive = normalizeBoolean(req.body.is_active, false);
    const removePdf = normalizeBoolean(req.body.remove_pdf, false);

    if (bookFieldError) {
        return sendError(req, res, null, { status: 400, message: bookFieldError });
    }

    const { data: existingRule, error: loadError } = await getRulesPdf(id);
    if (loadError || !existingRule) {
        return sendError(req, res, loadError, { status: 404, message: 'Rules PDF not found' });
    }

    const updates = {
        title: title?.trim() || existingRule.title,
        edition: edition?.trim() || existingRule.edition,
        rules_edition: rulesEdition,
        book_type: bookType,
        is_active: isActive,
        free_access: normalizeBoolean(req.body.free_access, false)
    };

    if (req.file) {
        const { data: storageInfo, error: storageError } = await storeRulesPdf(id, req.file, {
            previousPath: existingRule.storage_path
        });
        if (storageError) {
            return sendError(req, res, storageError, { message: 'Failed to store PDF' });
        }
        updates.storage_path = storageInfo.path;
    } else if (removePdf && existingRule.storage_path) {
        await deletePdfObject({ bucket: RULES_PDF_BUCKET, path: existingRule.storage_path });
        updates.storage_path = null;
    }

    const { error } = await updateRulesPdf(id, updates);
    if (error) {
        return sendError(req, res, error, { message: 'Failed to update rules PDF' });
    }

    return res.redirect('/library/manage');
});

router.delete('/:id/unlocks/:userId', isAuthenticated, requireAdmin, async (req, res) => {
    const { id, userId } = req.params;

    const { error } = await deleteRulesPdfUnlock({ userId, rulesPdfId: id });
    if (error) {
        return sendError(req, res, error, { message: 'Failed to revoke access' });
    }

    return res.status(204).send();
});

router.get('/:id/view', authOptional, async (req, res) => {
    const { profile, user } = res.locals;
    const { id } = req.params;

    const { data: rulesPdf, error } = await getRulesPdf(id);
    if (error || !rulesPdf) {
        return sendError(req, res, error, { status: 404, message: 'Rules PDF not found' });
    }

    if (!rulesPdf.storage_path) {
        return sendError(req, res, null, { status: 404, message: 'Rules PDF not available' });
    }

    const { data: canView, error: accessError } = await canViewRulesPdf(
        {
            userId: user?.id || null,
            role: profile?.role || null
        },
        rulesPdf
    );

    if (accessError) {
        return sendError(req, res, accessError, { message: 'Unable to verify access' });
    }

    if (!canView) {
        return sendError(req, res, null, { status: 403, title: 'No access', message: 'You do not have access to this rules PDF' });
    }

    const { data: signedUrl, error: signedError } = await getSignedPdfUrl({
        bucket: RULES_PDF_BUCKET,
        path: rulesPdf.storage_path,
        expiresIn: 600
    });

    if (signedError || !signedUrl) {
        console.error('Failed to create signed URL for rules PDF', {
            rulesPdfId: id,
            bucket: RULES_PDF_BUCKET,
            storagePath: rulesPdf.storage_path,
            error: signedError?.message || signedError
        });
        return sendError(req, res, null, { status: 500, message: 'Failed to prepare rules PDF' });
    }

    if (user && (rulesPdf.free_access || rulesPdf.id === STARTER_RULES_PDF_ID)) {
        // Learn-the-game step: fire-and-forget, the viewer never waits on it.
        patchOnboarding(user.id, { read_rules: true }).catch(() => {});
    }

    return res.render('pdf-viewer', {
        profile,
        title: `${rulesPdf.title} (${rulesPdf.edition})`,
        viewerTitle: `${rulesPdf.title} — ${rulesPdf.edition}`,
        pdfUrl: signedUrl,
        backUrl: '/library',
        activeNav: 'library',
        breadcrumbs: [
            { label: 'Library', href: '/library' },
            { label: `${rulesPdf.title} (${rulesPdf.edition})`, href: `/library/${id}/view` }
        ]
    });
});

module.exports = router;

