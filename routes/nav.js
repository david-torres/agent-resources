const express = require('express');
const router = express.Router();

const {
    getAllNavItems,
    getNavItem,
    createNavItem,
    updateNavItem,
    deleteNavItem,
    reorderNavItems,
    getDropdownParents
} = require('../util/supabase');
const { getPages } = require('../util/supabase');
const { isAuthenticated, requireAdmin } = require('../util/auth');

const normalizeBoolean = (value, fallback = false) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).toLowerCase();
    return ['true', '1', 'on', 'yes'].includes(normalized);
};

// Admin: List all nav items for management
router.get('/manage', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    const { data: navItems, error } = await getAllNavItems();
    if (error) {
        return res.status(500).send(error.message || 'Failed to load navigation items');
    }

    // Build hierarchical structure for display
    const itemsMap = new Map();
    const rootItems = [];

    (navItems || []).forEach(item => {
        itemsMap.set(item.id, { ...item, children: [] });
    });

    (navItems || []).forEach(item => {
        const itemWithChildren = itemsMap.get(item.id);
        if (item.parent_id) {
            const parent = itemsMap.get(item.parent_id);
            if (parent) {
                parent.children.push(itemWithChildren);
            }
        } else {
            rootItems.push(itemWithChildren);
        }
    });

    // Sort by position
    const sortByPosition = (items) => {
        items.sort((a, b) => a.position - b.position);
        items.forEach(item => {
            if (item.children.length > 0) {
                sortByPosition(item.children);
            }
        });
    };
    sortByPosition(rootItems);

    return res.render('nav-manage', {
        profile,
        title: 'Manage Navigation',
        navItems: rootItems,
        activeNav: null,
        breadcrumbs: [
            { label: 'Manage Navigation', href: '/nav/manage' }
        ]
    });
});

// Admin: Show create form
router.get('/new', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;

    // Get pages for dropdown
    const { data: pages } = await getPages();
    
    // Get dropdown parents
    const { data: dropdownParents } = await getDropdownParents();

    return res.render('nav-form', {
        profile,
        title: 'Create Navigation Item',
        navItem: null,
        pages: pages || [],
        dropdownParents: dropdownParents || [],
        activeNav: null,
        breadcrumbs: [
            { label: 'Manage Navigation', href: '/nav/manage' },
            { label: 'Create Navigation Item', href: '/nav/new' }
        ]
    });
});

// Admin: Create new nav item
router.post('/', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;
    const { 
        label, 
        type, 
        url, 
        page_id, 
        icon, 
        parent_id, 
        position,
        requires_auth,
        requires_admin,
        is_active
    } = req.body;

    if (!label || !type) {
        return res.status(400).send('Label and type are required');
    }

    const payload = {
        label: label.trim(),
        type: type,
        url: type === 'link' ? (url?.trim() || null) : null,
        page_id: type === 'page' ? (page_id || null) : null,
        icon: icon?.trim() || null,
        parent_id: parent_id || null,
        position: position ? parseInt(position, 10) : undefined,
        requires_auth: normalizeBoolean(requires_auth, false),
        requires_admin: normalizeBoolean(requires_admin, false),
        is_active: normalizeBoolean(is_active, true)
    };

    const { data: navItem, error } = await createNavItem(payload);
    if (error) {
        const status = error.message && error.message.includes('required') ? 400 : 500;
        if (status === 400) {
            const { data: pages } = await getPages();
            const { data: dropdownParents } = await getDropdownParents();
            return res.status(400).render('nav-form', {
                profile,
                title: 'Create Navigation Item',
                navItem: {
                    label: payload.label,
                    type: payload.type,
                    url: payload.url,
                    page_id: payload.page_id,
                    icon: payload.icon,
                    parent_id: payload.parent_id,
                    position: payload.position,
                    requires_auth: payload.requires_auth,
                    requires_admin: payload.requires_admin,
                    is_active: payload.is_active
                },
                pages: pages || [],
                dropdownParents: dropdownParents || [],
                error: error.message,
                activeNav: null,
                breadcrumbs: [
                    { label: 'Manage Navigation', href: '/nav/manage' },
                    { label: 'Create Navigation Item', href: '/nav/new' }
                ]
            });
        }
        return res.status(500).send(error.message || 'Failed to create navigation item');
    }

    return res.redirect('/nav/manage');
});

// Admin: Show edit form
router.get('/:id/edit', isAuthenticated, requireAdmin, async (req, res) => {
    const { profile } = res.locals;
    const { id } = req.params;

    const { data: navItem, error } = await getNavItem(id);
    if (error || !navItem) {
        return res.status(404).send(error?.message || 'Navigation item not found');
    }

    // Get pages for dropdown
    const { data: pages } = await getPages();
    
    // Get dropdown parents (exclude self to prevent circular references)
    const { data: allDropdownParents } = await getDropdownParents();
    const dropdownParents = (allDropdownParents || []).filter(p => p.id !== id);

    return res.render('nav-form', {
        profile,
        title: 'Edit Navigation Item',
        navItem,
        pages: pages || [],
        dropdownParents: dropdownParents || [],
        activeNav: null,
        breadcrumbs: [
            { label: 'Manage Navigation', href: '/nav/manage' },
            { label: 'Edit Navigation Item', href: `/nav/${id}/edit` }
        ]
    });
});

// Admin: Update existing nav item
router.post('/:id', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { 
        label, 
        type, 
        url, 
        page_id, 
        icon, 
        parent_id, 
        position,
        requires_auth,
        requires_admin,
        is_active
    } = req.body;

    const { data: existingItem, error: loadError } = await getNavItem(id);
    if (loadError || !existingItem) {
        return res.status(404).send(loadError?.message || 'Navigation item not found');
    }

    const resolvedType = type || existingItem.type;
    const updates = {
        label: label?.trim() || existingItem.label,
        type: resolvedType,
        url: resolvedType === 'link' ? (url?.trim() || null) : null,
        page_id: resolvedType === 'page' ? (page_id || null) : null,
        icon: icon?.trim() || null,
        parent_id: parent_id || null,
        position: position ? parseInt(position, 10) : existingItem.position,
        requires_auth: normalizeBoolean(requires_auth, existingItem.requires_auth),
        requires_admin: normalizeBoolean(requires_admin, existingItem.requires_admin),
        is_active: normalizeBoolean(is_active, existingItem.is_active)
    };

    if (resolvedType === 'page' && !updates.page_id) {
        const { profile } = res.locals;
        const { data: pages } = await getPages();
        const { data: allDropdownParents } = await getDropdownParents();
        const dropdownParents = (allDropdownParents || []).filter(p => p.id !== id);
        return res.status(400).render('nav-form', {
            profile,
            title: 'Edit Navigation Item',
            navItem: { ...existingItem, ...updates },
            pages: pages || [],
            dropdownParents,
            error: 'Page ID is required for page type',
            activeNav: null,
            breadcrumbs: [
                { label: 'Manage Navigation', href: '/nav/manage' },
                { label: 'Edit Navigation Item', href: `/nav/${id}/edit` }
            ]
        });
    }

    const { error } = await updateNavItem(id, updates);
    if (error) {
        const status = error.message && error.message.includes('required') ? 400 : 500;
        if (status === 400) {
            const { profile } = res.locals;
            const { data: pages } = await getPages();
            const { data: allDropdownParents } = await getDropdownParents();
            const dropdownParents = (allDropdownParents || []).filter(p => p.id !== id);
            return res.status(400).render('nav-form', {
                profile,
                title: 'Edit Navigation Item',
                navItem: { ...existingItem, ...updates },
                pages: pages || [],
                dropdownParents,
                error: error.message,
                activeNav: null,
                breadcrumbs: [
                    { label: 'Manage Navigation', href: '/nav/manage' },
                    { label: 'Edit Navigation Item', href: `/nav/${id}/edit` }
                ]
            });
        }
        return res.status(500).send(error.message || 'Failed to update navigation item');
    }

    return res.redirect('/nav/manage');
});

// Admin: Delete nav item
router.delete('/:id', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;

    const { error } = await deleteNavItem(id);
    if (error) {
        if (req.get('HX-Request')) {
            return res.status(500).send(error.message || 'Failed to delete navigation item');
        }
        return res.status(500).send(error.message || 'Failed to delete navigation item');
    }

    // For htmx requests, return empty content (will be swapped out)
    if (req.get('HX-Request')) {
        return res.status(200).send('');
    }
    return res.status(204).send();
});

// Admin: Reorder nav items
router.post('/reorder', isAuthenticated, requireAdmin, async (req, res) => {
    const { items } = req.body;

    if (!Array.isArray(items)) {
        return res.status(400).send('Items must be an array');
    }

    const { error } = await reorderNavItems(items);
    if (error) {
        return res.status(500).send(error.message || 'Failed to reorder navigation items');
    }

    return res.status(200).json({ success: true });
});

module.exports = router;
