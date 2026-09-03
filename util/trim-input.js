// Whitespace on user-entered text silently breaks every name-keyed lookup in
// the app. This walks the whole payload rather than a list of known fields: a
// field list is what let classes.name slip through, and it rots every time a
// column is added.
const isPlainObject = (value) => {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

const trimStrings = (value, options = {}, path = '') => {
    const { exempt = [] } = options;
    if (typeof value === 'string') return exempt.includes(path) ? value : value.trim();
    // Array elements inherit their array's path, so `gear.description` exempts
    // that field on every element rather than needing an index.
    if (Array.isArray(value)) return value.map((item) => trimStrings(item, options, path));
    if (!isPlainObject(value)) return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        result[key] = trimStrings(item, options, path ? `${path}.${key}` : key);
    }
    return result;
};

module.exports = { trimStrings };
