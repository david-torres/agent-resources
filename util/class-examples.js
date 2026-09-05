// Reads the admin class form's examples textarea back into the array
// `classes.examples` holds. One example per line -- the textarea in
// views/class-form.handlebars prints the stored array one entry per line, and
// this is its round-trip partner.
//
// It lives here rather than in routes/classes.js for the same reason
// util/class-abilities.js and util/class-gear.js do: the round-trip guard in
// util/class-form-round-trip.integration.test.js has to run the parser the
// handlers actually run, and a function private to a router module cannot be
// required.
//
// Ends-only trimming: interior runs of whitespace, en dashes and curly quotes
// are a verbatim copy of the source document, not formatting to tidy up. A
// blank line is a separator rather than an example, so it is dropped instead of
// being stored as ''.
const parseExamples = (body) => String(body.examples ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

module.exports = { parseExamples };
