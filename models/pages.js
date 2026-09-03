const { supabase } = require('./_base');
const { trimStrings } = require('../util/trim-input');

// Every query here takes the caller's client. `pages` has RLS on both halves:
// the write policies require is_admin(), and the SELECT policies gate drafts and
// access_level='admin'/'authenticated' rows the same way. The anon singleton
// carries no user JWT, so bound to it an admin's UPDATE/DELETE match zero rows
// and their drafts are simply invisible. `res.locals.supabase` (util/auth.js)
// carries the caller's token — anon for signed-out visitors, so the default
// keeps public reads working for callers with no request context.

/**
 * Generate a URL-friendly slug from a title
 */
const generateSlug = (title) => {
    if (!title) return '';
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
};

/**
 * Check if a slug is unique (excluding a specific page ID if provided)
 */
const isSlugUnique = async (slug, excludeId = null, client = supabase) => {
    let query = client
        .from('pages')
        .select('id')
        .eq('slug', slug)
        .limit(1);

    if (excludeId) {
        query = query.neq('id', excludeId);
    }

    const { data, error } = await query;
    if (error) {
        console.error(error);
        return { isUnique: false, error };
    }
    return { isUnique: !data || data.length === 0, error: null };
};

/**
 * Get all pages with optional filters
 */
const getPages = async (filters = {}, client = supabase) => {
    let query = client
        .from('pages')
        .select('*')
        .order('created_at', { ascending: false });

    if (filters.is_published !== undefined) {
        query = query.eq('is_published', filters.is_published);
    }

    if (filters.access_level) {
        query = query.eq('access_level', filters.access_level);
    }

    const { data, error } = await query;
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

/**
 * Get a single page by slug
 */
const getPageBySlug = async (slug, client = supabase) => {
    const { data, error } = await client
        .from('pages')
        .select('*')
        .eq('slug', slug)
        .single();
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

/**
 * Get a single page by ID
 */
const getPage = async (id, client = supabase) => {
    const { data, error } = await client
        .from('pages')
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

/**
 * Create a new page
 */
const createPage = async (payload, client = supabase) => {
    payload = trimStrings(payload);
    // Generate slug if not provided
    if (!payload.slug && payload.title) {
        payload.slug = generateSlug(payload.title);
    }

    // Check slug uniqueness
    if (payload.slug) {
        const { isUnique, error: slugError } = await isSlugUnique(payload.slug, null, client);
        if (slugError) {
            return { data: null, error: slugError };
        }
        if (!isUnique) {
            return { 
                data: null, 
                error: { message: 'A page with this slug already exists' } 
            };
        }
    }

    const { data, error } = await client
        .from('pages')
        .insert(payload)
        .select()
        .single();
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

/**
 * Update an existing page
 */
const updatePage = async (id, updates, client = supabase) => {
    updates = trimStrings(updates);
    // Generate slug if title changed and slug not provided
    if (updates.title && !updates.slug) {
        updates.slug = generateSlug(updates.title);
    }

    // Check slug uniqueness if slug is being changed
    if (updates.slug) {
        const { isUnique, error: slugError } = await isSlugUnique(updates.slug, id, client);
        if (slugError) {
            return { data: null, error: slugError };
        }
        if (!isUnique) {
            return { 
                data: null, 
                error: { message: 'A page with this slug already exists' } 
            };
        }
    }

    const { data, error } = await client
        .from('pages')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

/**
 * Delete a page
 */
const deletePage = async (id, client = supabase) => {
    const { error } = await client
        .from('pages')
        .delete()
        .eq('id', id);
    if (error) {
        console.error(error);
        return { error };
    }
    return { error: null };
};

/**
 * Check if a user can view a page based on access level and published status
 */
const canViewPage = async (userContext = {}, page) => {
    const { userId = null, role = null } = userContext;

    if (!page) {
        return { data: false, error: null };
    }

    // Admins can always view pages (including unpublished)
    if (role === 'admin') {
        return { data: true, error: null };
    }

    // Unpublished pages are only viewable by admins
    if (!page.is_published) {
        return { data: false, error: null };
    }

    // Public pages are viewable by everyone
    if (page.access_level === 'public') {
        return { data: true, error: null };
    }

    // Authenticated pages require a logged-in user
    if (page.access_level === 'authenticated') {
        return { data: !!userId, error: null };
    }

    // Admin-only pages require admin role
    if (page.access_level === 'admin') {
        return { data: role === 'admin', error: null };
    }

    return { data: false, error: null };
};

/**
 * Latest published news posts for the homepage.
 *
 * Ordered by created_at, so a post drafted early and published later carries
 * the draft date. Acceptable while posts are written and published in one
 * sitting; a published_at column is the fix if that stops being true.
 *
 * The caller's client applies the pages RLS SELECT policies, so access_level
 * gating comes for free — an anon caller sees only access_level='public'.
 */
const getRecentNews = async ({ limit = 2 } = {}, client = supabase) => {
    const { data, error } = await client
        .from('pages')
        .select('id, title, slug, content, created_at')
        .eq('is_news', true)
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

/**
 * Every published news post, newest first. Same filters as getRecentNews,
 * with no limit -- this backs the /news index, where "all of it" is the point.
 *
 * The caller's client applies the pages RLS SELECT policies, same as
 * getRecentNews.
 */
const getAllNews = async (client = supabase) => {
    const { data, error } = await client
        .from('pages')
        .select('id, title, slug, content, created_at')
        .eq('is_news', true)
        .eq('is_published', true)
        .order('created_at', { ascending: false });
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error };
};

module.exports = {
    getPages,
    getPageBySlug,
    getPage,
    createPage,
    updatePage,
    deletePage,
    canViewPage,
    generateSlug,
    isSlugUnique,
    getRecentNews,
    getAllNews
};
