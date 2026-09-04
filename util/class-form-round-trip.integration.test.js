// util/class-form-round-trip.integration.test.js
//
// The failure this guards is the one the pre-release spec names: an admin opens
// a class, saves it unchanged, and metadata is silently gone. Class prose is a
// character-for-character copy of a source document, so a save that "tidies"
// anything is data loss, not formatting.
//
// This trip has been written four times as a throwaway (Task 15's implementer
// and its reviewer, Task 16's implementer and its reviewer) and deleted each
// time. Twice it caught real loss: the hidden `pronunciation` field deleting the
// only two abilities that carry one, and trailing whitespace disappearing from
// four legacy gear descriptions. It is permanent now.
//
// What it does, for EVERY class in the database -- not only the 19 imported
// ones, because the legacy rows are where the shape surprises live:
//
//   1. read the stored row (read-only; this test never writes),
//   2. render views/class-form.handlebars for it, through the real engine and
//      the real helper set,
//   3. serialize the rendered form the way a browser would, in jsdom, so
//      <input> value sanitization (CR/LF stripped) and the HTML parser's
//      leading-LF drop inside <textarea> happen for real rather than being
//      assumed away, then normalize line endings to CRLF as form submission
//      does,
//   4. parse that body the way the running app parses it -- the form posts
//      multipart and the handlers mount `upload.single('class_pdf')`, so
//      multer's `append-field` builds req.body, NOT qs -- and run it through
//      the real normalizeAbilities, normalizeGear and parseExamples,
//   5. compare against the stored value.
//
// The comparison is byte-exact, with an ENUMERATED allowlist. It deliberately
// does not "ignore empty values": a fuzzy comparator is exactly how this guard
// would pass while data was being lost. Every permitted difference below is
// applied to the EXPECTED value first; anything else fails.
//
//   A. Legacy abilities gain `paired_action: ''`, `meters: []`, `notes: []`
//      (the declared five-key ability contract, util/class-abilities.js).
//   B. Legacy gear items gain `meters: []`, `notes: []`, and an absent or
//      unrecognised `category` takes its positional default (util/class-gear.js
//      `gearCategory`, matching the backfill migration).
//   C. An ability carrying an explicit `pronunciation: null` loses that key. A
//      pronunciation with a real value MUST survive.
//   D. Ends-only trimming may remove leading/trailing whitespace. Interior
//      bytes may never change.
//   E. A stored CRLF (or lone CR) becomes LF. HTML form submission posts every
//      textarea line ending as CRLF and util/newlines.js converts them back on
//      the write path, so a value stored with LF -- what the loader writes --
//      survives byte-identically and a legacy value stored with CRLF converges
//      to LF the first time someone saves it. That is this code's own
//      normalization, it is line endings only, and it may never touch a
//      loader-written column of an imported class: the test asserts that
//      separately and names every value it does touch in the output.
//
//   F. A NULL text column renders as an empty field and posts ''. The handlers
//      map that back to NULL -- blankTextToNull for the prose columns,
//      applyConstrainedSelects for the two constrained selects, and the class
//      service's sanitizeUrlFields for image_url -- so a stored NULL and a
//      posted '' are the same value here. A stored value that arrives empty is
//      still a failure: only the NULL/'' distinction is waived, never content.
//   G. A column the payload omits is unchanged, which is the whole claim being
//      tested for it. Only `image_crop` is ever omitted: util/crop.js
//      applyImageCrop drops the key when the posted value is not a readable
//      crop, so the 17 rows whose column already holds a jsonb string keep it
//      rather than having it overwritten or erased. The test counts how many
//      rows are written back versus left alone, so "left alone" cannot quietly
//      become the answer for all of them.
//
// Counts (abilities, meters, notes, sub-notes, pronunciations, and the two
// permitted whitespace/line-ending adjustments) are printed rather than only
// asserted, so a future drop shows up in the output instead of hiding behind a
// green boolean.
const { test, expect } = require('bun:test');
const path = require('path');
const { JSDOM } = require('jsdom');
const exphbs = require('express-handlebars');
const { createClient } = require('@supabase/supabase-js');
const appendField = require('append-field');

// app.js is required for `engineHelpers` -- rebuilding the helper set here is a
// second copy that can drift from the one the server renders with. It pulls in
// routes/classes.js, which requires util/class-import.js, which constructs an
// OpenAIChatApi at import time and throws when the key is unset. Nothing here
// calls a model; the placeholder only has to be non-empty, the same reason
// scripts/run-tests.mjs sets one for the unit and HTTP runs.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
const { engineHelpers } = require('../app');
const { normalizeClassInput } = require('../services/class/input');
const { normalizeAbilities } = require('./class-abilities');
const { normalizeGear } = require('./class-gear');
const { parseExamples } = require('./class-examples');
const { applyImageCrop } = require('./crop');
const { normalizeNewlines } = require('./newlines');
const { statList } = require('./enclave-consts');

const VIEWS = path.join(__dirname, '..', 'views');
const FORM = path.join(VIEWS, 'class-form.handlebars');

const hbs = exphbs.create({
    partialsDir: path.join(VIEWS, 'partials'),
    helpers: engineHelpers,
    extname: '.handlebars'
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

// Every column of `classes` is either compared below or listed here with the
// reason it is not. A column added later belongs in one list or the other, and
// the test fails until it is in one of them -- which is the point: a new piece
// of class metadata with no form input is precisely the silent loss this guards.
const NOT_ROUND_TRIPPED = {
    id: 'the row key, in the form action rather than a field',
    base_class_id: 'version-family link, set by duplicate, not editable here',
    visibility: 'superseded by is_public; no input',
    created_by: 'ownership, set on insert',
    created_at: 'database timestamp',
    updated_at: 'database timestamp',
    pdf_storage_path: 'written by the upload path, not posted by the form',
    pdf_updated_at: 'written by the upload path, not posted by the form',
    stat_spread: 'the hidden inputs carry Alpine\'s :value, so a static render has no value to read; pinned by routes/classes-stat-spread.test.js and views/class-form.test.js'
};

// Plain <input type="text"> and <textarea> columns: what the form renders is
// what it posts.
const TEXT_FIELDS = [
    'name', 'quote', 'quote_source', 'stat_line', 'stat_note', 'overview',
    'conduit_notes', 'grounding', 'examples_heading', 'tips_heading',
    'designer', 'image_url'
];

// teaser and tips render into Toast UI markdown editors, which sync their value
// back into these textareas. The editor's own client-side serialization is not
// modelled here -- this pins the server-rendered value and the posted textarea,
// which is where a dropped field or a mangled column would show. They are
// listed apart from TEXT_FIELDS only because that limit is worth naming.
const MARKDOWN_EDITOR_FIELDS = ['teaser', 'tips'];

// <select>: an unset column renders the "Not set" option, posts '', and
// applyConstrainedSelects in routes/classes.js maps it back to NULL.
const SELECT_FIELDS = [
    'challenge_level', 'prerelease_section', 'status', 'rules_edition', 'rules_version'
];

const STRUCTURED_FIELDS = ['abilities', 'gear', 'examples'];

// jsonb, and the one column a save may legitimately omit (rule G).
const CROP_FIELD = 'image_crop';

const COMPARED = [
    ...TEXT_FIELDS, ...MARKDOWN_EDITOR_FIELDS, ...SELECT_FIELDS,
    ...STRUCTURED_FIELDS, CROP_FIELD, 'is_public', 'is_player_created'
];

// What the browser posts: every line ending as CRLF. Allowlist rule E is the
// write path undoing it, which is util/newlines.js normalizeNewlines -- the real
// function, not a restatement, since the claim is that the two compose to a
// no-op rather than that this test can reproduce one of them.
const submitNewlines = (value) => value.replace(/\r\n|\r|\n/g, '\r\n');

// Allowlist entry D. `String.prototype.trim` is what both normalizers apply.
const trimEnds = (value) => value.trim();

const renderForm = (classData) => hbs.render(
    FORM,
    // An admin's save is the trip being guarded: the provenance selects and the
    // Type radios only render for a role of 'admin', and a non-admin body is
    // stripped of them by dropAdminOnlyFields anyway.
    { class: classData, statList, profile: { role: 'admin' } },
    { layout: false }
);

// The browser's form submission, up to the point multer hands fields over.
// Values come out of a real DOM, so an <input> has already dropped any CR/LF
// and a <textarea>'s leading newline has already been eaten by the parser.
const serializeForm = (html) => {
    const { document } = new JSDOM(`<!doctype html><html><body><form>${html}</form></body></html>`).window;
    const body = Object.create(null);
    for (const el of document.querySelectorAll('form input, form textarea, form select')) {
        if (!el.name || el.disabled) continue;
        if (el.type === 'file') continue;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
        // multer's field handler is exactly this call
        // (node_modules/multer/lib/make-middleware.js:87), and append-field has
        // no depth limit and always builds arrays for indexed groups.
        appendField(body, el.name, submitNewlines(el.value));
    }
    return body;
};

// jsonb does not preserve object key order, so keys are sorted before
// stringifying. Array order is left alone -- it is the semantic -- and every
// string is compared byte for byte.
const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
};

const counts = {
    classes: 0, imported: 0,
    abilities: 0, ability_meters: 0, ability_notes: 0, ability_sub_notes: 0, pronunciations: 0,
    gear: 0, gear_meters: 0, gear_notes: 0, gear_sub_notes: 0,
    examples: 0,
    crops_written_back: 0, crops_left_untouched: 0,
    trimmed: [], line_endings_normalized: []
};

const imported = { abilities: 0, meters: 0, notes: 0, sub_notes: 0, pronunciations: 0 };

// Applies allowlist rules D and E to a stored value, recording every value it
// had to change -- with the class and column it belongs to, so the report is a
// list of names rather than a count nobody can check, and so the verbatim
// assertion below can filter it without parsing display strings.
const expectedText = (stored, ctx, path) => {
    const atRest = String(stored ?? '');
    const expected = trimEnds(normalizeNewlines(atRest));
    // Reported separately, and only when the change survives trimming: a
    // trailing CRLF that becomes LF and is then trimmed away is an ends-only
    // trim, not a line-ending rewrite of the stored value.
    if (expected !== trimEnds(atRest)) counts.line_endings_normalized.push({ ...ctx, path });
    if (trimEnds(atRest) !== atRest) counts.trimmed.push({ ...ctx, path });
    return expected;
};

const expectedMeter = (meter, ctx, path) => ({
    label: expectedText(meter.label, ctx, `${path}.label`),
    value: expectedText(meter.value, ctx, `${path}.value`)
});

const expectedNote = (note, ctx, path) => ({
    text: expectedText(note.text, ctx, `${path}.text`),
    children: (note.children || []).map((child, index) => ({
        text: expectedText(child.text, ctx, `${path}.children[${index}].text`),
        children: []
    }))
});

// Allowlist A and C.
const expectedAbilities = (rows, className) => {
    const ctx = { class: className, column: 'abilities' };
    return (rows || []).map((ability, index) => {
        const path = `${className}.abilities[${index}]`;
        const expected = {
            name: expectedText(ability.name, ctx, `${path}.name`),
            description: expectedText(ability.description, ctx, `${path}.description`),
            paired_action: expectedText(ability.paired_action, ctx, `${path}.paired_action`),
            meters: (ability.meters || []).map((meter, i) => expectedMeter(meter, ctx, `${path}.meters[${i}]`)),
            notes: (ability.notes || []).map((note, i) => expectedNote(note, ctx, `${path}.notes[${i}]`))
        };
        // An explicit null loses the key; a real value must survive verbatim.
        if (ability.pronunciation !== undefined && ability.pronunciation !== null) {
            expected.pronunciation = expectedText(ability.pronunciation, ctx, `${path}.pronunciation`);
        }
        return expected;
    });
};

// Allowlist B. The positional default is restated here rather than imported
// from util/class-gear.js: calling the function under test to build the
// expected value would make any change to it agree with itself. The rule is the
// one supabase/migrations/20260904000001_backfill_gear_category.sql wrote --
// the first three items are Base, the rest Elective.
const BASE_GEAR_COUNT = 3;
const expectedCategory = (category, index) =>
    (category === 'default' || category === 'elective'
        ? category
        : (index < BASE_GEAR_COUNT ? 'default' : 'elective'));

const expectedGear = (rows, className) => {
    const ctx = { class: className, column: 'gear' };
    return (rows || []).map((item, index) => {
        const path = `${className}.gear[${index}]`;
        return {
            name: expectedText(item.name, ctx, `${path}.name`),
            description: expectedText(item.description, ctx, `${path}.description`),
            category: expectedCategory(item.category, index),
            meters: (item.meters || []).map((meter, i) => expectedMeter(meter, ctx, `${path}.meters[${i}]`)),
            notes: (item.notes || []).map((note, i) => expectedNote(note, ctx, `${path}.notes[${i}]`))
        };
    });
};

const tally = (row) => {
    counts.classes += 1;
    const isImported = row.prerelease_section !== null;
    if (isImported) counts.imported += 1;
    for (const ability of row.abilities || []) {
        counts.abilities += 1;
        counts.ability_meters += (ability.meters || []).length;
        if (ability.pronunciation) counts.pronunciations += 1;
        if (isImported) {
            imported.abilities += 1;
            imported.meters += (ability.meters || []).length;
            if (ability.pronunciation) imported.pronunciations += 1;
        }
        for (const note of ability.notes || []) {
            counts.ability_notes += 1;
            counts.ability_sub_notes += (note.children || []).length;
            if (isImported) {
                imported.notes += 1;
                imported.sub_notes += (note.children || []).length;
            }
        }
    }
    for (const item of row.gear || []) {
        counts.gear += 1;
        counts.gear_meters += (item.meters || []).length;
        for (const note of item.notes || []) {
            counts.gear_notes += 1;
            counts.gear_sub_notes += (note.children || []).length;
        }
    }
    counts.examples += (row.examples || []).length;
};

// Rule F: the one distinction the comparison waives, and only for scalars.
const blankToNull = (value) => (value === '' || value === undefined ? null : value);

// The write path the PUT handler runs: the three parsers on the structured
// fields, then the class service's own normalizeClassInput -- which trims every
// string in the payload (util/trim-input.js) and sanitizes image_url -- exactly
// as classService.updateClass does before the row reaches Postgres.
const roundTrip = async (row) => {
    const body = serializeForm(await renderForm(row));
    const payload = {
        image_crop: body.image_crop,
        abilities: normalizeAbilities(body.abilities),
        gear: normalizeGear(body.gear),
        examples: parseExamples(body),
        is_public: body.is_public === 'on',
        is_player_created: body.is_player_created === 'true',
        ...Object.fromEntries([...TEXT_FIELDS, ...MARKDOWN_EDITOR_FIELDS, ...SELECT_FIELDS]
            .map((field) => [field, body[field]]))
    };
    applyImageCrop(payload);
    return normalizeClassInput(payload);
};

const expectedScalar = (row, field) =>
    expectedText(row[field], { class: row.name, column: field }, `${row.name}.${field}`);

const expectedFor = (row) => ({
    image_crop: row.image_crop,
    abilities: expectedAbilities(row.abilities, row.name),
    gear: expectedGear(row.gear, row.name),
    examples: (row.examples || []).map((example, index) => expectedText(
        example, { class: row.name, column: 'examples' }, `${row.name}.examples[${index}]`)),
    is_public: Boolean(row.is_public),
    is_player_created: Boolean(row.is_player_created),
    ...Object.fromEntries([...TEXT_FIELDS, ...SELECT_FIELDS, ...MARKDOWN_EDITOR_FIELDS]
        .map((field) => [field, expectedScalar(row, field)]))
});

let classes;

test('every class column is either round-tripped or listed as not round-tripped', async () => {
    ({ data: classes } = await supabase.from('classes').select('*').order('name'));
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.length).toBeGreaterThan(0);

    const columns = Object.keys(classes[0]).sort();
    const accounted = [...COMPARED, ...Object.keys(NOT_ROUND_TRIPPED)].sort();
    expect(columns).toEqual(accounted);
});

test('saving every class unchanged preserves every metadata field', async () => {
    const mismatches = [];

    for (const row of classes) {
        tally(row);
        const got = await roundTrip(row);
        const expected = expectedFor(row);
        // Rule G: a column the payload omits is a column the save does not
        // touch, so the stored value is what it still holds afterwards.
        if (CROP_FIELD in got) counts.crops_written_back += 1;
        else counts.crops_left_untouched += 1;
        const settled = (side, field) => (field === CROP_FIELD && !(field in got)
            ? row[CROP_FIELD]
            : side[field]);
        const scalar = (field) => !STRUCTURED_FIELDS.includes(field) && field !== CROP_FIELD;
        for (const field of COMPARED) {
            const value = (side) => (scalar(field) ? blankToNull(side[field]) : settled(side, field));
            const a = JSON.stringify(canonical(value(got)));
            const b = JSON.stringify(canonical(value(expected)));
            if (a !== b) mismatches.push({ class: row.name, field, got: a, expected: b });
        }
    }

    console.log('class form round trip:', JSON.stringify({
        ...counts,
        trimmed: counts.trimmed.length,
        line_endings_normalized: counts.line_endings_normalized.length,
        imported_classes: imported
    }));
    const paths = (entries) => entries.map((entry) => entry.path).join(', ') || 'none';
    console.log('ends-only trims:', paths(counts.trimmed));
    console.log('line endings normalized:', paths(counts.line_endings_normalized));

    // A guard that compared nothing would also report no mismatches.
    expect(counts.abilities).toBeGreaterThan(0);
    expect(counts.gear).toBeGreaterThan(0);
    expect(counts.ability_meters + counts.gear_meters).toBeGreaterThan(0);
    expect(counts.ability_notes + counts.gear_notes).toBeGreaterThan(0);
    expect(counts.pronunciations).toBeGreaterThan(0);
    // And rule G cannot quietly become the answer for every row.
    expect(counts.crops_written_back).toBeGreaterThan(0);

    expect(mismatches).toEqual([]);
});

// Rule E is a normalization, not a licence. The columns
// scripts/load-prerelease-classes.mjs writes hold a character-for-character
// copy of the source document on the 19 imported classes, and a save must not
// move a byte in any of them -- line endings included. Legacy rows are where the
// stored CRLFs live, and converging them to LF on their next save is the
// deliberate cost of making the imported corpus survive.
test('no line ending in an imported class\'s loader-written column is rewritten', async () => {
    const { FIELDS } = await import('../scripts/load-prerelease-classes.mjs');
    const importedNames = new Set(classes
        .filter((row) => row.prerelease_section !== null)
        .map((row) => row.name));

    const verbatim = counts.line_endings_normalized
        .filter((entry) => importedNames.has(entry.class) && FIELDS.includes(entry.column))
        .map((entry) => entry.path);

    // The 19 imported classes' `tips` are what this pins in practice: LF at
    // rest, CRLF over the wire, LF again at rest.
    expect(verbatim).toEqual([]);
});
