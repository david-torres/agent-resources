// Collapses CRLF and lone CR to LF through a whole payload.
//
// Class prose is a character-for-character copy of a source document, and
// scripts/load-prerelease-classes.mjs writes its line endings as LF. HTML form
// submission normalizes every textarea line ending to CRLF on the way out of the
// browser (the URL-encoded and multipart/form-data encoding algorithms both do
// it), so without this a no-op admin save rewrote bytes inside all 19 imported
// classes' `tips` -- the exact failure
// util/class-form-round-trip.integration.test.js exists to prevent.
//
// Normalizing at the write path rather than allowing the difference makes the
// stored value converge: LF at rest, CRLF over the wire, LF again at rest. The
// cost is that a legacy value stored with CRLF becomes LF the next time someone
// saves it, which is a one-way move toward the form the loader writes and
// renders identically through markdown and HTML.
//
// It walks the whole payload rather than a list of known fields, for the reason
// util/trim-input.js gives: a field list rots every time a column is added.
const isPlainObject = (value) => {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};

const normalizeNewlines = (value) => {
    if (typeof value === 'string') return value.replace(/\r\n|\r/g, '\n');
    if (Array.isArray(value)) return value.map(normalizeNewlines);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalizeNewlines(item)])
    );
};

module.exports = { normalizeNewlines };
