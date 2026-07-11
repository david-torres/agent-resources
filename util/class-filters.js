// Pure query-shaping helper shared by the public (anon/user) class read in
// models/class.js and the admin-client read in services/class/repository.js.
// Operates on any Postgrest-shaped query builder (chainable .eq/.order).
const applyClassFilters = (query, filters = {}) => {
    if (filters.name) {
        query = query.eq('name', filters.name);
    }
    if (filters.is_public !== undefined) {
        query = query.eq('is_public', filters.is_public);
    }
    if (filters.created_by) {
        query = query.eq('created_by', filters.created_by);
    }
    if (filters.rules_edition) {
        query = query.eq('rules_edition', filters.rules_edition);
    }
    if (filters.rules_version) {
        query = query.eq('rules_version', filters.rules_version);
    }
    if (filters.status) {
        query = query.eq('status', filters.status);
    }
    if (filters.is_player_created !== undefined) {
        query = query.eq('is_player_created', filters.is_player_created);
    }

    return query.order('name', { ascending: true });
};

module.exports = { applyClassFilters };
