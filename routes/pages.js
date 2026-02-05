const express = require('express');
const router = express.Router();

const {
    getPages,
    getPageBySlug,
    getPage,
    createPage,
    updatePage,
    deletePage,
    canViewPage
} = require('../util/supabase');
const { isAuthenticated, requireAdmin, authOptional } = require('../util/auth');

const normalizeBoolean = (value, fallback = false) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).toLowerCase();
    return ['true', '1', 'on', 'yes'].includes(normalized);
};

// Admin routes - must come before the slug route to avoid conflicts

// Admin: List all pages for management
router.get('/manage', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    const { data: pages, error } = await getPages();
    if (error) {
        return res.status(500).send(error.message || 'Failed to load pages');
    }

    return res.render('pages-manage', {
        profile,
        title: 'Manage Pages',
        pages: pages || [],
        activeNav: null,
        breadcrumbs: [
            { label: 'Manage Pages', href: '/pages/manage' }
        ]
    });
});

// Admin: Show create form
router.get('/new', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    return res.render('page-form', {
        profile,
        title: 'Create New Page',
        page: null,
        activeNav: null,
        breadcrumbs: [
            { label: 'Manage Pages', href: '/pages/manage' },
            { label: 'Create New Page', href: '/pages/new' }
        ]
    });
});

// Admin: Create new page
router.post('/', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;
    const { title, slug, content, access_level, is_published } = req.body;

    if (!title) {
        return res.status(400).send('Title is required');
    }

    const payload = {
        title: title.trim(),
        slug: slug?.trim() || null, // Will be auto-generated if not provided
        content: content || '',
        access_level: access_level || 'public',
        is_published: normalizeBoolean(is_published, false),
        created_by: profile?.id || null
    };

    const { data: page, error } = await createPage(payload);
    if (error) {
        return res.status(500).send(error.message || 'Failed to create page');
    }

    return res.redirect('/pages/manage');
});

// Admin: Show edit form
router.get('/:id/edit', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;
    const { id } = req.params;

    const { data: page, error } = await getPage(id);
    if (error || !page) {
        return res.status(404).send(error?.message || 'Page not found');
    }

    return res.render('page-form', {
        profile,
        title: 'Edit Page',
        page,
        activeNav: null,
        breadcrumbs: [
            { label: 'Manage Pages', href: '/pages/manage' },
            { label: 'Edit Page', href: `/pages/${id}/edit` }
        ]
    });
});

// Admin: Update existing page
router.post('/:id', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { title, slug, content, access_level, is_published } = req.body;

    const { data: existingPage, error: loadError } = await getPage(id);
    if (loadError || !existingPage) {
        return res.status(404).send(loadError?.message || 'Page not found');
    }

    const updates = {
        title: title?.trim() || existingPage.title,
        slug: slug?.trim() || null, // Will be auto-generated if not provided
        content: content || existingPage.content,
        access_level: access_level || existingPage.access_level,
        is_published: normalizeBoolean(is_published, existingPage.is_published)
    };

    const { error } = await updatePage(id, updates);
    if (error) {
        return res.status(500).send(error.message || 'Failed to update page');
    }

    return res.redirect('/pages/manage');
});

// Admin: Delete page
router.delete('/:id', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;

    const { error } = await deletePage(id);
    if (error) {
        return res.status(500).send(error.message || 'Failed to delete page');
    }

    return res.status(204).send();
});

// Public route: View page by slug (must be last to avoid matching admin routes)
router.get('/:slug', authOptional, async (req, res) => {
    const { profile, user } = res.locals;
    const { slug } = req.params;

    // Exclude admin paths
    if (slug === 'manage' || slug === 'new') {
        return res.status(404).send('Page not found');
    }

    // Check if slug looks like a UUID (to avoid conflicts with edit route)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(slug)) {
        // If it's a UUID, try to find by ID first (for backwards compatibility)
        // But this shouldn't normally happen since slugs shouldn't be UUIDs
        const { data: pageById, error: idError } = await getPage(slug);
        if (!idError && pageById) {
            // Redirect to slug-based URL if page exists
            return res.redirect(`/pages/${pageById.slug}`);
        }
        // If not found by ID, continue to try as slug
    }

    const { data: page, error } = await getPageBySlug(slug);
    if (error || !page) {
        return res.status(404).send(error?.message || 'Page not found');
    }

    // Check if user can view this page
    const { data: canView, error: accessError } = await canViewPage(
        {
            userId: user?.id || null,
            role: profile?.role || null
        },
        page
    );

    if (accessError) {
        return res.status(500).send(accessError.message || 'Unable to verify access');
    }

    if (!canView) {
        return res.status(403).send('You do not have access to this page');
    }

    return res.render('page-view', {
        profile,
        title: page.title,
        page,
        activeNav: null,
        breadcrumbs: [
            { label: page.title, href: `/pages/${slug}` }
        ]
    });
});

module.exports = router;
