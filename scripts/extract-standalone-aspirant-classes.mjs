// Turns standalone Aspirant class PDFs -- one class each, printed in the book's
// page design -- into one reviewable JSON artifact, a record per PDF in the order
// given. As with the book, every string is lifted from the PDF's own word stream;
// all the reading lives in util/aspirant-extract.js, which the unit suite runs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { parseBboxPages, extractStandaloneClass } from '../util/aspirant-extract.js';

const [OUT, ...PDFS] = process.argv.slice(2);

if (!OUT || PDFS.length === 0) {
    throw new Error('usage: extract-standalone-aspirant-classes.mjs <out.json> <pdf>...');
}

const rows = PDFS.map((pdf) => extractStandaloneClass(parseBboxPages(
    execFileSync('pdftotext', ['-bbox-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }))));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`extracted ${rows.length} classes: ${rows.map((row) => row.name).join(', ')}`);
