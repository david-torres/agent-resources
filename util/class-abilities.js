// Normalizes the nested ability rows the admin class form submits into the
// shape `classes.abilities` holds.
//
// This is a different function with a different contract from the module-local
// `normalizeAbilities` in util/class-import.js. Since `f4c5ffc` both emit the
// same five-key contract -- `name`, `description`, `paired_action`, `meters`,
// `notes` -- which is what makes an AI-imported class's first admin save a
// no-op. They differ either side of that: the import one reads already-parsed
// model output rather than a request body, caps the list at three abilities,
// and adds `pronunciation` only when the writeup gave a value, where this one
// echoes `pronunciation` back whenever the request carried the key at all.
// Neither wraps the other.
//
// It lives here rather than in routes/classes.js so that it can be tested
// directly, the way util/crop.js's parseImageCrop is -- the object-shaped input
// below is unreachable through either real parser, so an HTTP test cannot pin
// it at all.

// Both write handlers receive `abilities` already nested: express.urlencoded
// runs qs, and the multipart path the form actually takes runs multer's
// append-field. Neither is a parser this function has to think about, with one
// exception -- the container type of an indexed group:
//
//   - append-field ALWAYS builds an array, even for `abilities[500]` (a
//     length-501 sparse array), never an object.
//   - qs builds an array up to `arrayLimit` and an object with numeric string
//     keys past it. body-parser sets that limit to `Math.max(100, paramCount)`
//     (body-parser/lib/types/urlencoded.js:168), so through this app it is an
//     array in practice too.
//
// The object branch therefore guards a shape only a bare `qs.parse` at a lower
// arrayLimit produces. It is kept because it is two lines and qs genuinely
// produces it, and it is pinned by util/class-abilities.test.js rather than by
// an HTTP test that cannot reach it.
//
// Array order IS the semantic -- it is the order abilities, meters and notes
// print in. Integer-like object keys only happen to iterate in ascending
// numeric order, so the object shape is sorted explicitly rather than trusted
// to do that. Sparse array holes are dropped, which is what makes a
// high-indexed row (`abilities[500]`) collapse back to a dense list.
const indexedRows = (value) => {
    const rows = Array.isArray(value)
        ? value
        : (value && typeof value === 'object'
            ? Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((key) => value[key])
            : []);
    return rows.filter((row) => row && typeof row === 'object');
};

// Ends only. Interior runs of whitespace, en dashes and curly quotes are a
// verbatim copy of the source document, not formatting to tidy up.
//
// A non-string reaches this only from a hand-built request: a repeated field
// name arrives as an array, and answering '' for it drops the row rather than
// writing `["a","b"]` into a text field.
const trimField = (value) => (typeof value === 'string' ? value.trim() : '');

// A meter is a label/value pair by definition -- partials/class-meters.handlebars
// renders it as a <dt>/<dd> row -- so half a pair shows nothing meaningful and
// is dropped whichever half is missing.
const normalizeMeter = (row) => {
    const label = trimField(row.label);
    const value = trimField(row.value);
    return (label && value) ? { label, value } : null;
};

// Notes nest exactly two levels: a note and its sub-bullets, no grandchildren.
// A blank note is dropped WITH its children rather than promoting them --
// a child reattached to the wrong parent is exactly the corruption the
// extraction work fought, and must not be reintroduced at the form layer.
// `children` is always an array so that every note has the same shape; both
// partials/class-notes.handlebars and the editor guard on `.length` anyway.
const normalizeNote = (row) => {
    const text = trimField(row.text);
    if (!text) return null;
    return {
        text,
        children: indexedRows(row.children)
            .map((child) => {
                const childText = trimField(child.text);
                return childText ? { text: childText, children: [] } : null;
            })
            .filter(Boolean)
    };
};

// The repeatable ability editor's counterpart. A blank row is a normal
// intermediate state in a repeater -- the inputs carry no `required` -- so this
// is the only thing that drops one.
//
// `name`, `description`, `paired_action`, `meters` and `notes` are this
// branch's declared ability contract, so every ability gets all five: a legacy
// row that only ever had a name and a description picks up `paired_action: ''`,
// `meters: []` and `notes: []` on save. That is normalization, and it is the
// uniform shape the editor round-trips.
//
// `pronunciation` is deliberately NOT in that set. It has no input, no view
// renders it, and of the 150 live abilities 57 carry the KEY while only 2 carry
// a real value -- the other 55 hold an explicit null, and 93 have no key at all.
// Writing it onto those 93 would fabricate shape rather than normalize it. It is
// echoed back only when the request carried it, which is what stops the form's
// hidden round-trip field from deleting the two abilities that have a real one
// while keeping the key off every ability that never had one.
const normalizeAbilities = (value) => indexedRows(value)
    .map((row) => {
        const ability = {
            name: trimField(row.name),
            description: trimField(row.description),
            paired_action: trimField(row.paired_action),
            meters: indexedRows(row.meters).map(normalizeMeter).filter(Boolean),
            notes: indexedRows(row.notes).map(normalizeNote).filter(Boolean)
        };
        if (row.pronunciation !== undefined) {
            ability.pronunciation = trimField(row.pronunciation) || null;
        }
        return ability;
    })
    .filter((ability) => ability.name);

module.exports = { normalizeAbilities };
