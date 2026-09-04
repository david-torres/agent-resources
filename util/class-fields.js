// The two body steps both class write handlers run just before the payload
// reaches the repository. They live here rather than in routes/classes.js so
// that util/class-form-round-trip.integration.test.js can run the real ones:
// a guard that reimplements a step of the path it claims to exercise is a guard
// that cannot see that step drift.

// Mirrors the CHECK constraints these two columns carry. Both accept NULL and
// reject '', so an unselected option must land as NULL rather than as the empty
// string the select submits, and anything outside the allowlist -- a typo from a
// non-browser client -- must not reach Postgres as a raw constraint violation.
const CONSTRAINED_SELECTS = {
    challenge_level: ['Low', 'Mid', 'High'],
    prerelease_section: ['pcc', 'exclusive', 'aspirant']
};

const applyConstrainedSelects = (body) => {
    for (const [field, allowed] of Object.entries(CONSTRAINED_SELECTS)) {
        if (body[field] !== undefined) {
            body[field] = allowed.includes(body[field]) ? body[field] : null;
        }
    }
};

// NULL means "this class has no such field"; '' asserts that someone set it to
// nothing. Every one of these columns is nullable by design and holds a
// verbatim copy of the source document, so a form that renders a NULL column as
// an empty textarea must not write '' back over it on a routine save.
//
// `examples` is excluded: it is jsonb NOT NULL DEFAULT '[]', so blank means an
// empty array.
// `teaser` and `tips` were carved out of this list at first, to leave
// pre-branch behaviour alone. R84 reversed that: three imported classes store a
// NULL teaser and a no-op admin save was writing '' over it. Nothing in the
// codebase distinguishes NULL from '' on these two columns -- `renderMarkdown(c.teaser || '')`,
// the OpenGraph `filter(Boolean)` and every `{{#if}}` treat both as falsy -- so
// the NULL-versus-'' argument applies to them exactly as it does to the rest.
const NULLABLE_TEXT_FIELDS = [
    'stat_line', 'stat_note', 'quote', 'quote_source', 'overview',
    'conduit_notes', 'grounding', 'examples_heading', 'tips_heading', 'designer',
    'teaser', 'tips'
];

const blankTextToNull = (body) => {
    for (const field of NULLABLE_TEXT_FIELDS) {
        if (typeof body[field] === 'string' && body[field].trim() === '') {
            body[field] = null;
        }
    }
};

module.exports = {
    CONSTRAINED_SELECTS,
    applyConstrainedSelects,
    NULLABLE_TEXT_FIELDS,
    blankTextToNull
};
