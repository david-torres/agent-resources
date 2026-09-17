// Turns the ENCLAVE: Aspirant V1 PDF into the reviewable JSON artifact. Every
// string is lifted from the PDF's own word stream -- nothing is retyped, and
// nothing is rewritten. All the reading lives in util/aspirant-extract.js,
// which the unit suite runs; scripts/ is not a directory it scans.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { parseBboxPages, extractBook } from '../util/aspirant-extract.js';
import { bookFor } from './lib/books.mjs';

const PDF = process.argv[2];
const OUT = process.argv[3] || bookFor('aspirant-v1').artifact;

if (!PDF) throw new Error('usage: extract-aspirant-v1-classes.mjs <pdf> [out.json]');

// The book is 415 MB and its word stream runs past 10 MB, well over execFileSync's
// 1 MB default.
const xhtml = execFileSync('pdftotext', ['-bbox-layout', PDF, '-'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });

const rows = extractBook(parseBboxPages(xhtml));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`extracted ${rows.length} classes`);
