// Annotates rule rows with per-user access flags derived from the unlocks map.
const withRuleAccess = (rules, unlocksMap, isAdmin, now) => rules.map((rule) => {
    const unlock = unlocksMap.get(rule.id);
    const expiresAt = unlock?.expires_at ? new Date(unlock.expires_at) : null;
    const isExpired = expiresAt ? expiresAt <= now : false;
    // Access the viewer would have without the admin role; anything beyond
    // this is an admin override.
    const hasOwnAccess = !!rule.free_access || (!!unlock && !isExpired);
    return {
        ...rule,
        isUnlocked: !!unlock,
        isExpired,
        canView: isAdmin || hasOwnAccess,
        isAdminOverride: isAdmin && !hasOwnAccess,
        expires_at: unlock?.expires_at || null
    };
});

module.exports = { withRuleAccess };
