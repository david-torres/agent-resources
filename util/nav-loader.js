const { getNavItems } = require('./supabase');

/**
 * Populate res.locals.navItems from the current user/profile context.
 * Safe to call multiple times per request — the last call wins, which lets
 * auth middleware overwrite the guest nav set by the global middleware.
 */
async function populateNavItems(req, res) {
    try {
        const { user, profile } = res.locals;

        const userContext = {
            userId: user?.id || null,
            role: profile?.role || null,
            currentPath: req.path || null
        };

        const { data: navItems, error } = await getNavItems(userContext);

        if (error) {
            console.error('Error loading nav items:', error);
            res.locals.navItems = [];
        } else {
            res.locals.navItems = navItems || [];
        }
    } catch (err) {
        console.error('Error in populateNavItems:', err);
        res.locals.navItems = [];
    }
}

/**
 * Middleware form of populateNavItems. Runs globally before auth so guest
 * routes see a nav; auth middleware re-invokes populateNavItems afterward
 * so authenticated/admin-gated items appear.
 */
async function loadNavItems(req, res, next) {
    await populateNavItems(req, res);
    next();
}

module.exports = { loadNavItems, populateNavItems };
