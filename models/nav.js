const { supabase } = require('./_base');

/**
 * Get all active nav items filtered by user context
 * Returns hierarchical structure with parent items containing children
 */
const getNavItems = async (userContext = {}) => {
    const { userId = null, role = null } = userContext;
    const isAuthenticated = !!userId;
    const isAdmin = role === 'admin';

    // Build query with filters
    let query = supabase
        .from('nav_items')
        .select(`
            *,
            pages:page_id (
                id,
                slug,
                title
            )
        `)
        .eq('is_active', true)
        .order('parent_id', { ascending: true, nullsFirst: true })
        .order('position', { ascending: true });

    const { data, error } = await query;
    if (error) {
        console.error('Error fetching nav items:', error);
        return { data: [], error };
    }

    if (!data || data.length === 0) {
        return { data: [], error: null };
    }

    // Filter items based on auth/admin requirements
    const filtered = data.filter(item => {
        if (item.requires_admin && !isAdmin) return false;
        if (item.requires_auth && !isAuthenticated) return false;
        return true;
    });

    // Build hierarchical structure
    const itemsMap = new Map();
    const rootItems = [];

    // First pass: create map of all items
    filtered.forEach(item => {
        itemsMap.set(item.id, { ...item, children: [] });
    });

    // Second pass: build tree structure
    filtered.forEach(item => {
        const itemWithChildren = itemsMap.get(item.id);
        
        // Build URL based on type
        if (item.type === 'page' && item.pages) {
            itemWithChildren.href = `/pages/${item.pages.slug}`;
        } else if (item.type === 'link' && item.url) {
            itemWithChildren.href = item.url;
        } else if (item.type === 'dropdown') {
            itemWithChildren.href = '#'; // Dropdowns don't have direct links
        } else {
            itemWithChildren.href = '#';
        }

        if (item.parent_id) {
            const parent = itemsMap.get(item.parent_id);
            if (parent) {
                parent.children.push(itemWithChildren);
            }
        } else {
            rootItems.push(itemWithChildren);
        }
    });

    // Sort children by position
    const sortByPosition = (items) => {
        items.sort((a, b) => a.position - b.position);
        items.forEach(item => {
            if (item.children.length > 0) {
                sortByPosition(item.children);
            }
        });
    };
    sortByPosition(rootItems);

    return { data: rootItems, error: null };
};

/**
 * Get a single nav item by ID
 */
const getNavItem = async (id) => {
    const { data, error } = await supabase
        .from('nav_items')
        .select(`
            *,
            pages:page_id (
                id,
                slug,
                title
            )
        `)
        .eq('id', id)
        .single();
    
    if (error) {
        console.error('Error fetching nav item:', error);
        return { data: null, error };
    }
    return { data, error: null };
};

/**
 * Get all nav items (for admin management, no filtering)
 */
const getAllNavItems = async () => {
    const { data, error } = await supabase
        .from('nav_items')
        .select(`
            *,
            pages:page_id (
                id,
                slug,
                title
            )
        `)
        .order('parent_id', { ascending: true, nullsFirst: true })
        .order('position', { ascending: true });
    
    if (error) {
        console.error('Error fetching all nav items:', error);
        return { data: [], error };
    }
    return { data: data || [], error: null };
};

/**
 * Create a new nav item
 */
const createNavItem = async (payload) => {
    // Validate required fields
    if (!payload.label || !payload.type) {
        return {
            data: null,
            error: { message: 'Label and type are required' }
        };
    }

    // Validate type-specific fields
    if (payload.type === 'link' && !payload.url) {
        return {
            data: null,
            error: { message: 'URL is required for link type' }
        };
    }

    if (payload.type === 'page' && !payload.page_id) {
        return {
            data: null,
            error: { message: 'Page ID is required for page type' }
        };
    }

    // If no position specified, get the next position for this parent
    if (payload.position === undefined || payload.position === null) {
        const { data: siblings } = await supabase
            .from('nav_items')
            .select('position')
            .eq('parent_id', payload.parent_id || null)
            .order('position', { ascending: false })
            .limit(1);
        
        payload.position = siblings && siblings.length > 0 
            ? siblings[0].position + 1 
            : 0;
    }

    const { data, error } = await supabase
        .from('nav_items')
        .insert(payload)
        .select(`
            *,
            pages:page_id (
                id,
                slug,
                title
            )
        `)
        .single();
    
    if (error) {
        console.error('Error creating nav item:', error);
        return { data: null, error };
    }
    return { data, error: null };
};

/**
 * Update an existing nav item
 */
const updateNavItem = async (id, updates) => {
    const { data, error } = await supabase
        .from('nav_items')
        .update(updates)
        .eq('id', id)
        .select(`
            *,
            pages:page_id (
                id,
                slug,
                title
            )
        `)
        .single();
    
    if (error) {
        console.error('Error updating nav item:', error);
        return { data: null, error };
    }
    return { data, error: null };
};

/**
 * Delete a nav item (cascades to children via foreign key)
 */
const deleteNavItem = async (id) => {
    const { error } = await supabase
        .from('nav_items')
        .delete()
        .eq('id', id);
    
    if (error) {
        console.error('Error deleting nav item:', error);
        return { error };
    }
    return { error: null };
};

/**
 * Reorder nav items
 * Accepts array of { id, position, parent_id } objects
 */
const reorderNavItems = async (items) => {
    const updates = items.map(item => ({
        id: item.id,
        position: item.position,
        parent_id: item.parent_id || null
    }));

    // Update each item
    const promises = updates.map(update => 
        supabase
            .from('nav_items')
            .update({ position: update.position, parent_id: update.parent_id })
            .eq('id', update.id)
    );

    const results = await Promise.all(promises);
    const errors = results.filter(r => r.error).map(r => r.error);
    
    if (errors.length > 0) {
        console.error('Error reordering nav items:', errors);
        return { error: errors[0] };
    }
    
    return { error: null };
};

/**
 * Get dropdown parents (items that can be parents)
 */
const getDropdownParents = async () => {
    const { data, error } = await supabase
        .from('nav_items')
        .select('id, label, type')
        .eq('type', 'dropdown')
        .eq('is_active', true)
        .order('label', { ascending: true });
    
    if (error) {
        console.error('Error fetching dropdown parents:', error);
        return { data: [], error };
    }
    return { data: data || [], error: null };
};

module.exports = {
    getNavItems,
    getNavItem,
    getAllNavItems,
    createNavItem,
    updateNavItem,
    deleteNavItem,
    reorderNavItems,
    getDropdownParents
};
