// Normalizes the nested gear rows the admin class form submits into the shape
// `classes.gear` holds.
//
// This is a different function with a different contract from the module-local
// `normalizeGear` in util/class-import.js, which caps AI output at six items
// and emits `{name, description}` only. Neither wraps the other -- and the AI
// path emitting no `category` is exactly why the positional default below has
// to keep working.
//
// It mirrors util/class-abilities.js field for field, with `category` in place
// of `paired_action`. The two are deliberately separate modules rather than one
// parameterised normalizer: the ability contract was reviewed and settled in
// Task 15 and is out of scope to touch here.
//
// It lives here rather than in routes/classes.js so that it can be tested
// directly, the way util/crop.js's parseImageCrop is -- the object-shaped input
// below is unreachable through either real parser, so an HTTP test cannot pin
// it at all.

// Both write handlers receive `gear` already nested: express.urlencoded runs
// qs, and the multipart path the form actually takes runs multer's
// append-field. Neither is a parser this function has to think about, with one
// exception -- the container type of an indexed group:
//
//   - append-field ALWAYS builds an array, even for `gear[500]` (a length-501
//     sparse array), never an object.
//   - qs builds an array up to `arrayLimit` and an object with numeric string
//     keys past it. body-parser sets that limit to `Math.max(100, paramCount)`
//     (body-parser/lib/types/urlencoded.js:168), so through this app it is an
//     array in practice too.
//
// The object branch therefore guards a shape only a bare `qs.parse` at a lower
// arrayLimit produces. It is kept because it is two lines and qs genuinely
// produces it, and it is pinned by util/class-gear.test.js rather than by an
// HTTP test that cannot reach it.
//
// Array order IS the semantic -- it is the order the Base and Elective columns
// print in, and the order the positional category default is read from.
// Integer-like object keys only happen to iterate in ascending numeric order,
// so the object shape is sorted explicitly rather than trusted to do that.
// Sparse array holes are dropped, which is what makes a high-indexed row
// (`gear[500]`) collapse back to a dense list.
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

// The only two values views/class-view.handlebars knows: it splits Signature
// Gear into its Base and Elective columns by an exact string match, so an item
// carrying anything else renders in neither.
const GEAR_CATEGORIES = ['default', 'elective'];

// Every one of the 50 live classes has exactly six gear items, three to a
// column, and the class page split them by that position before `category`
// existed.
const BASE_GEAR_COUNT = 3;

// The first three items of a six-item list are the Base gear and the last three
// the Elective. That is the split
// supabase/migrations/20260904000001_backfill_gear_category.sql wrote onto the
// 31 pre-existing classes, and it is reproduced here so a legacy row, a
// backfilled row and a freshly saved one all agree.
//
// `index` is the item's position in the SUBMITTED list -- not its position
// among the items that happen to lack the key. An unrecognised value takes the
// same fallback rather than being written through, because writing it through
// would drop the item off the class page entirely: present in the column,
// rendered in neither.
//
// Exported because views/class-form.handlebars needs the identical answer when
// it decides which <option> is `selected` on an uncategorised item; a second
// copy of the rule in the template is a copy that can drift.
const gearCategory = (category, index) => {
    const value = trimField(category);
    return GEAR_CATEGORIES.includes(value)
        ? value
        : (index < BASE_GEAR_COUNT ? 'default' : 'elective');
};

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

// The repeatable gear editor's counterpart. A blank row is a normal
// intermediate state in a repeater -- the inputs carry no `required` -- so this
// is the only thing that drops one.
//
// `name`, `description`, `category`, `meters` and `notes` are this branch's
// declared gear contract, so every item gets all five: a legacy item that only
// ever had a name and a description picks up `category`, `meters: []` and
// `notes: []` on save. That is normalization, and unlike the abilities'
// `pronunciation` there is no gear key outside the contract to preserve -- a
// census of jsonb_object_keys over all 300 live gear items answers exactly
// {category, description, name} and {category, description, meters, name, notes}.
const normalizeGear = (value) => indexedRows(value)
    .map((row, index) => ({
        name: trimField(row.name),
        description: trimField(row.description),
        category: gearCategory(row.category, index),
        meters: indexedRows(row.meters).map(normalizeMeter).filter(Boolean),
        notes: indexedRows(row.notes).map(normalizeNote).filter(Boolean)
    }))
    .filter((item) => item.name);

module.exports = { normalizeGear, gearCategory };
