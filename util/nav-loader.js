const { getNavItems } = require('./supabase');

/**
 * Middleware to load navigation items and attach them to res.locals
 * This should be called after auth middleware so we have user context
 */
async function loadNavItems(req, res, next) {
    try {
        const { user, profile } = res.locals;
        
        const userContext = {
            userId: user?.id || null,
            role: profile?.role || null
        };

        const { data: navItems, error } = await getNavItems(userContext);
        
        if (error) {
            console.error('Error loading nav items:', error);
            // Don't fail the request, just use empty nav
            res.locals.navItems = [];
        } else {
            res.locals.navItems = navItems || [];
        }
    } catch (err) {
        console.error('Error in loadNavItems middleware:', err);
        res.locals.navItems = [];
    }
    
    next();
}

module.exports = { loadNavItems };
