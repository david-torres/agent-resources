// Normalizes the nested gear rows the admin class form submits into the shape
// `classes.gear` holds.
//
// This is a different function with a different contract from the module-local
// `normalizeGear` in util/class-import.js. Both apply the same positional
// `category` default (R79) over the saved index, so an AI-imported class's
// `category` values never change on the first admin save -- but the import
// path emits six keys per item and this one emits eight, so that save adds
// `column` and `position` to every item. The import one reads already-parsed
// model output rather than a request body and caps the list per rules
// edition. Neither wraps the other.
//
// So the AI path is no longer why the positional default below has to keep
// working: it now supplies its own. What keeps the default here is everything
// that still arrives without a usable `category` -- a legacy row stored before
// the key existed, whose <select> needs an answer to render at all, and a
// hand-built request that omits or misspells it. Both must land in one of the
// two real columns rather than in neither.
//
// It mirrors util/class-abilities.js field for field, with `category` and
// `default_enchantment` in place of `paired_action` and `sample_perks`. The
// two are deliberately separate modules rather than one parameterised
// normalizer: the ability contract was reviewed and settled in Task 15 and is
// out of scope to touch here.
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
// What "ends" costs, stated because verbatim preservation is this branch's
// binding constraint: .trim() strips U+00A0 along with ASCII whitespace, so a
// description deliberately ended with a non-breaking space would lose it. No
// live gear item does -- the corpus carries 7 of them, all interior, and a
// round trip of all 50 classes changes only 4 descriptions, each of which ends
// in ASCII whitespace (Guardian's first item a space and an LF, Vizier's fifth
// a CRLF, two Squatter v0 items an LF). Widen this to a trailing-ASCII-only
// trim if that ever stops being true.
//
// A non-string reaches this only from a hand-built request: a repeated field
// name arrives as an array, and answering '' for it drops the row rather than
// writing `["a","b"]` into a text field.
const trimField = (value) => (typeof value === 'string' ? value.trim() : '');

// The only two values views/class-view.handlebars knows: it splits Signature
// Gear into its Base and Elective columns by an exact string match, so an item
// carrying anything else renders in neither.
const GEAR_CATEGORIES = ['default', 'elective'];

// The book prints a class's Signatures in four columns of three across a
// two-page spread and gives the column meaning: "Each of a Class's four columns
// of Signature Items are ordered by complexity and alignment with that Class's
// general game plan" (ENCLAVE: Aspirant, pg. 11). Neither index is printed, so
// both are derived from the item's position in the saved list.
const ITEMS_PER_COLUMN = 3;
const gearColumn = (index) => Math.floor(index / ITEMS_PER_COLUMN) + 1;
const gearPosition = (index) => (index % ITEMS_PER_COLUMN) + 1;

// Under V1 Signatures are no longer split into Default and Elective rosters.
// The book's backwards-compatibility rule (ENCLAVE: Aspirant, pg. 2) reads the
// first column as the Default Roster and the second as the Elective, so
// `category` survives as the compatibility view of a four-column roster rather
// than as a fact about it: column 1 is Default, every other column Elective.
//
// With three items to a column that is arithmetically identical to the old
// `index < 3` test, so all fifty live six-item classes keep the category they
// have, and twelve items need no second branch.
const DEFAULT_ROSTER_COLUMN = 1;

// That column split is the one
// supabase/migrations/20260904000001_backfill_gear_category.sql wrote onto the
// 31 pre-existing classes, and it is reproduced here so a legacy row, a
// backfilled row and a freshly saved one all agree.
//
// `index` is the item's position in the SAVED list -- the array the class page
// will actually render -- not its position among the items that happen to lack
// the key.
//
// R76 ruled the other way, and the reversal is deliberate. It held that a
// dropped blank row KEEPS its position for defaulting, matching the backfill
// migration's `WITH ORDINALITY` over the stored array. That reasoning was about
// which index a SURVIVING item gets, and it did not consider what a blank row
// above real items does: it pushes one of them across the Base/Elective
// boundary, printing it under the wrong heading. Mislabelling a column is worse
// than renumbering one, so `normalizeGear` now drops blank rows before it
// numbers them and this reads the index the item ends up at.
//
// An unrecognised value takes the same fallback rather than being written
// through, because writing it through would drop the item off the class page
// entirely: present in the column, rendered in neither.
//
// Exported because views/class-form.handlebars needs the identical answer when
// it decides which <option> is `selected` on an uncategorised item; a second
// copy of the rule in the template is a copy that can drift.
const gearCategory = (category, index) => {
    const value = trimField(category);
    return GEAR_CATEGORIES.includes(value)
        ? value
        : (gearColumn(index) === DEFAULT_ROSTER_COLUMN ? 'default' : 'elective');
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

// A Signature may hold no more than one Enchantment (ENCLAVE: Aspirant,
// pg. 86), so this is one object rather than a list. The dedication is the
// "In Honor of ..." line the book prints under some enchantment names.
//
// The name decides survival, the same rule the item itself follows: an
// enchantment with no name cannot be referred to during play, and a
// description with nothing to call it is not worth keeping the item's key for.
const normalizeEnchantment = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const name = trimField(value.name);
    if (!name) return null;
    return {
        name,
        description: trimField(value.description),
        dedication: trimField(value.dedication) || null
    };
};

// The repeatable gear editor's counterpart. A blank row is a normal
// intermediate state in a repeater -- the inputs carry no `required` -- so this
// is the only thing that drops one.
//
// `name`, `description`, `category`, `meters`, `notes`, `default_enchantment`,
// `column` and `position` are this branch's declared gear contract, so every
// item gets all eight: a legacy item that only ever had a name and a
// description picks up the rest on save. A census of jsonb_object_keys over the
// 300 live gear items answers {category, description, name} and
// {category, description, meters, name, notes}: a stored item picks up
// `default_enchantment`, `column` and `position` on its next save.
//
// Blank rows are dropped BEFORE the items are numbered, so `index` is the
// position in the saved array rather than in the submitted one -- see
// `gearCategory` above for why that reverses R76.
const normalizeGear = (value) => indexedRows(value)
    .filter((row) => trimField(row.name))
    .map((row, index) => ({
        name: trimField(row.name),
        description: trimField(row.description),
        category: gearCategory(row.category, index),
        meters: indexedRows(row.meters).map(normalizeMeter).filter(Boolean),
        notes: indexedRows(row.notes).map(normalizeNote).filter(Boolean),
        default_enchantment: normalizeEnchantment(row.default_enchantment),
        column: gearColumn(index),
        position: gearPosition(index)
    }));

module.exports = {
    normalizeGear, gearCategory, gearColumn, gearPosition, indexedRows, normalizeNote
};
