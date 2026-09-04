#!/usr/bin/env bun
// Loads the verbatim pre-release extraction into `classes`.
//
// Idempotent: re-running writes the same rows. Dry-run by default -- --apply is
// the only thing that writes.
//
// The artifact is the audit trail, gated token-for-token by
// scripts/verify-prerelease-extract.mjs, so it holds the document exactly as
// printed: all-caps class titles, the page's own section headings, tips as
// bullets, and values with their original whitespace. The catalogue holds
// normalized data. Every difference between the two is reconciled here.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'data',
    'prerelease-classes-2026-08.json');

const APPLY = process.argv.includes('--apply');

const ALIASES = { Witchfinder: 'Witchhunter' };

// `classes.prerelease_section` carries the normalized enum; the artifact
// carries the headings the page prints above each block.
const SECTIONS = { PCCs: 'pcc', EXCLUSIVES: 'exclusive', 'ASPIRANT CLASSES': 'aspirant' };

const FIELDS = ['name', 'challenge_level', 'stat_line', 'stat_note', 'quote', 'quote_source',
    'overview', 'conduit_notes', 'grounding', 'examples_heading', 'examples', 'tips_heading',
    'tips', 'designer', 'prerelease_section', 'stat_spread', 'abilities', 'gear'];

// `rules_version` is NOT NULL with no column default, so a new row cannot be
// inserted without it. It is never part of the update payload -- an existing
// row keeps whatever the owner set. All 16 classes in this document that the
// catalogue already holds are 'v1'.
const NEW_ROW_RULES_VERSION = 'v1';

const PREVIEW_WIDTH = 140;

const fold = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// The document prints every class title in full caps as a typographic
// convention; the catalogue stores the cased name.
const displayName = (heading) =>
    heading.replace(/\S+/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());

const sectionEnum = (heading) => {
  const mapped = SECTIONS[heading];
  if (!mapped) throw new Error(`unrecognised section heading: ${JSON.stringify(heading)}`);
  return mapped;
};

// The existing markdown renderer reads `tips` as a bullet list.
const tipsMarkdown = (tips) => tips.map((tip) => `- ${tip}`).join('\n');

const DERIVED = {
  name: (record) => displayName(record.name),
  prerelease_section: (record) => sectionEnum(record.prerelease_section),
  tips: (record) => tipsMarkdown(record.tips)
};

// util/whitespace-integrity.integration.test.js fails the build on any stored
// value with leading or trailing whitespace. Only the ends go -- interior
// spacing, curly quotes, en dashes and every other glyph are left as extracted.
const trimEnds = (value) => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(trimEnds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, trimEnds(val)]));
  }
  return value;
};

const buildPayload = (record) => trimEnds(Object.fromEntries(
    FIELDS.map((field) => [field, DERIVED[field] ? DERIVED[field](record) : record[field]])));

// jsonb comes back with its keys in storage order, so equality has to be
// structural rather than textual.
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
};

const preview = (value) => {
  const text = typeof value === 'string' ? value : stable(value);
  return text.length > PREVIEW_WIDTH
      ? `${JSON.stringify(text.slice(0, PREVIEW_WIDTH))}… (${text.length} chars)`
      : JSON.stringify(text);
};

const diffFields = (payload, row) => FIELDS
    .filter((field) => stable(payload[field]) !== stable(row?.[field]))
    .map((field) => ({ field, before: row?.[field] ?? null, after: payload[field] }));

const resolveTarget = (payload, rows) => {
  const wanted = fold(ALIASES[payload.name] ?? payload.name);
  return rows.filter((row) => fold(row.name.trim()) === wanted);
};

const supabase = createClient(
    process.env.SUPABASE_URL || process.env.API_URL,
    process.env.SUPABASE_SECRET_KEY || process.env.SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });

const records = JSON.parse(readFileSync(ARTIFACT, 'utf8'));

const { data: rows, error } = await supabase.from('classes').select('*');
if (error) {
  console.error(`failed to read classes: ${error.message}`);
  process.exit(1);
}

const plans = records.map((record) => {
  const payload = buildPayload(record);
  return { payload, matches: resolveTarget(payload, rows) };
});

// A partial load leaves the database in a state the next dry-run's diff can no
// longer describe, so one ambiguous name stops everything.
const ambiguous = plans.filter((plan) => plan.matches.length > 1);
if (ambiguous.length) {
  for (const { payload, matches } of ambiguous) {
    console.error(`ambiguous: "${payload.name}" matches ${matches.length} rows -> ` +
        matches.map((row) => `${row.name} (${row.id})`).join(', '));
  }
  console.error(`\nABORTED - ${ambiguous.length} ambiguous name(s), nothing written`);
  process.exit(1);
}

let updates = 0;
let creates = 0;
const renames = [];

for (const { payload, matches } of plans) {
  const row = matches[0] ?? null;
  const changes = diffFields(payload, row);

  if (!row) {
    creates += 1;
    console.log(`\nCREATE ${payload.name}`);
    for (const { field, after } of changes) console.log(`  + ${field}: ${preview(after)}`);
    console.log(`  + rules_version: ${JSON.stringify(NEW_ROW_RULES_VERSION)}`);
  } else {
    updates += 1;
    if (row.name !== payload.name) renames.push({ from: row.name, to: payload.name, id: row.id });
    console.log(`\nUPDATE ${row.name} (${row.id})`);
    if (!changes.length) console.log('  no changes');
    for (const { field, before, after } of changes) {
      console.log(`  ~ ${field}`);
      console.log(`      - ${preview(before)}`);
      console.log(`      + ${preview(after)}`);
    }
  }

  if (!APPLY) continue;

  const result = row
      ? await supabase.from('classes').update(payload).eq('id', row.id)
      : await supabase.from('classes').insert({ ...payload, rules_version: NEW_ROW_RULES_VERSION });
  if (result.error) {
    console.error(`\nfailed to write "${payload.name}": ${result.error.message}`);
    process.exit(1);
  }
}

console.log(`\n${plans.length} classes resolved (${updates} update, ${creates} create), 0 ambiguous`);
for (const { from, to, id } of renames) console.log(`name correction: "${from}" -> "${to}" (${id})`);
console.log(APPLY ? `${plans.length} classes written` : 'DRY RUN - nothing written');
