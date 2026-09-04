#!/usr/bin/env bun
// Loads the verbatim pre-release extraction into `classes`.
//
// Idempotent: re-running resolves the same rows and writes the same values, and
// a run with nothing to change issues no request at all. Dry-run by default --
// --apply is the only thing that writes.
//
// The artifact is the audit trail, gated token-for-token by
// scripts/verify-prerelease-extract.mjs, so it holds the document exactly as
// printed: all-caps class titles, the page's own section headings, tips as
// bullets, and values with their original whitespace. The catalogue holds
// normalized data. Every difference between the two is reconciled here.
//
// Only the CLI entry point touches the network; everything above it is pure and
// exported so test/load-prerelease-classes.test.js can exercise it directly.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'data',
    'prerelease-classes-2026-08.json');

// The document renames this class; the catalogue still holds the old spelling
// until a load lands, and holds the new one afterwards. Resolution accepts
// both, so a second run finds the row it renamed rather than creating another.
const ALIASES = { Witchfinder: 'Witchhunter' };

// `classes.prerelease_section` carries the normalized enum; the artifact
// carries the headings the page prints above each block.
const SECTIONS = { PCCs: 'pcc', EXCLUSIVES: 'exclusive', 'ASPIRANT CLASSES': 'aspirant' };

export const FIELDS = ['name', 'challenge_level', 'stat_line', 'stat_note', 'quote', 'quote_source',
    'overview', 'conduit_notes', 'grounding', 'examples_heading', 'examples', 'tips_heading',
    'tips', 'designer', 'prerelease_section', 'stat_spread', 'abilities', 'gear'];

// `rules_version` is NOT NULL with no column default, so a new row cannot be
// inserted without it. It is never part of an update payload -- an existing row
// keeps whatever the owner set. All 16 classes in this document that the
// catalogue already holds are 'v1'.
const NEW_ROW_RULES_VERSION = 'v1';

// Rich-text trees whose `text` leaves are runs within a line rather than whole
// values: trimming each leaf independently would delete the space between two
// adjacent runs, which is interior whitespace and must survive.
const RICH_TEXT_KEYS = new Set(['notes']);

const LOCAL_TARGET = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;
const PREVIEW_WIDTH = 140;

export const isLocalTarget = (url) => LOCAL_TARGET.test(url);

export const fold = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// The document prints every class title in full caps as a typographic
// convention; the catalogue stores the cased name.
export const displayName = (heading) =>
    heading.replace(/\S+/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());

export const sectionEnum = (heading) => {
  const mapped = SECTIONS[heading.trim()];
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
export const trimEnds = (value) => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(trimEnds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
        .map(([key, val]) => [key, RICH_TEXT_KEYS.has(key) ? val : trimEnds(val)]));
  }
  return value;
};

export const buildPayload = (record) => trimEnds(Object.fromEntries(
    FIELDS.map((field) => [field, DERIVED[field] ? DERIVED[field](record) : record[field]])));

// jsonb comes back with its keys in storage order, so equality has to be
// structural rather than textual.
export const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
};

const preview = (value) => {
  const text = typeof value === 'string' ? JSON.stringify(value) : stable(value);
  return text.length > PREVIEW_WIDTH ? `${text.slice(0, PREVIEW_WIDTH)}… (${text.length} chars)` : text;
};

export const diffFields = (payload, row) => FIELDS
    .filter((field) => stable(payload[field]) !== stable(row?.[field]))
    .map((field) => ({ field, before: row?.[field] ?? null, after: payload[field] }));

export const resolveTarget = (payload, rows) => {
  const wanted = new Set([fold(payload.name)]);
  if (ALIASES[payload.name]) wanted.add(fold(ALIASES[payload.name]));
  return rows.filter((row) => wanted.has(fold(row.name.trim())));
};

export const planLoad = (records, rows) => records.map((record) => {
  const payload = buildPayload(record);
  const matches = resolveTarget(payload, rows);
  return { payload, matches, row: matches.length === 1 ? matches[0] : null };
});

const reportPlan = (plans) => {
  for (const plan of plans) {
    const { payload, row } = plan;
    if (!row) {
      console.log(`\nCREATE ${payload.name}`);
      for (const { field, after } of plan.changes) console.log(`  + ${field}: ${preview(after)}`);
      console.log(`  + rules_version: ${JSON.stringify(NEW_ROW_RULES_VERSION)}`);
      continue;
    }
    console.log(`\nUPDATE ${row.name} (${row.id})`);
    if (!plan.changes.length) console.log('  no changes');
    for (const { field, before, after } of plan.changes) {
      console.log(`  ~ ${field}`);
      console.log(`      - ${preview(before)}`);
      console.log(`      + ${preview(after)}`);
    }
  }
};

const main = async (argv) => {
  const apply = argv.includes('--apply');
  const force = argv.includes('--force');

  const url = process.env.SUPABASE_URL || process.env.API_URL || '';
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SECRET_KEY || '';
  const source = process.env.SUPABASE_URL ? 'SUPABASE_URL' : process.env.API_URL ? 'API_URL' : 'no env var';

  console.log(`target: ${url || '(unset)'} (from ${source})`);
  console.log(apply ? 'mode: APPLY - this run writes' : 'mode: dry run');

  // `dotenv` never overrides an already-exported variable, so a shell that ran
  // `eval "$(supabase status -o env)"` can still be pointed elsewhere by .env.
  // Writing is irreversible and this database holds real characters.
  if (apply && !isLocalTarget(url) && !force) {
    console.error(`\nrefusing to --apply against a non-local target (${url || 'unset'}).\n` +
        '  Point SUPABASE_URL at the local stack, or pass --force to override.');
    return 1;
  }
  if (!url || !key) {
    console.error('\nmissing credentials: set SUPABASE_URL and SUPABASE_SECRET_KEY.');
    return 1;
  }

  const supabase = createClient(url, key,
      { auth: { autoRefreshToken: false, persistSession: false } });

  const records = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  const { data: rows, error } = await supabase.from('classes').select('*');
  if (error) {
    console.error(`\nfailed to read classes: ${error.message}`);
    return 1;
  }

  const plans = planLoad(records, rows);

  // A partial load leaves the database in a state the next dry-run's diff can
  // no longer describe, so one ambiguous name stops everything before output.
  const ambiguous = plans.filter((plan) => plan.matches.length > 1);
  if (ambiguous.length) {
    for (const { payload, matches } of ambiguous) {
      console.error(`ambiguous: "${payload.name}" matches ${matches.length} rows -> ` +
          matches.map((row) => `${row.name} (${row.id})`).join(', '));
    }
    console.error(`\nABORTED - ${ambiguous.length} ambiguous name(s), nothing written`);
    return 1;
  }

  for (const plan of plans) plan.changes = diffFields(plan.payload, plan.row);
  reportPlan(plans);

  const updates = plans.filter((plan) => plan.row);
  const creates = plans.filter((plan) => !plan.row);
  const renames = updates
      .filter((plan) => plan.row.name !== plan.payload.name)
      .map((plan) => ({ from: plan.row.name, to: plan.payload.name, id: plan.row.id }));

  console.log(`\n${plans.length} classes resolved (${updates.length} update, ${creates.length} create), 0 ambiguous`);
  for (const { from, to, id } of renames) console.log(`name correction: "${from}" -> "${to}" (${id})`);

  // Unchanged rows are skipped so a re-run does not bump `updated_at` on all 19
  // and reshuffle the recency ordering the class listings read.
  const pendingUpdates = updates.filter((plan) => plan.changes.length);
  console.log(`${pendingUpdates.length} of ${updates.length} existing rows differ`);

  if (!apply) {
    console.log('DRY RUN - nothing written');
    return 0;
  }

  // The three new rows go in one statement. The 16 updates cannot join them:
  // PostgREST's upsert is INSERT ... ON CONFLICT, and Postgres rejects the
  // proposed tuple on `rules_version` NOT NULL before the conflict resolves, so
  // batching them would mean putting `rules_version` -- an owner-controlled
  // field the allowlist excludes -- into all 16 update payloads. So each update
  // is its own statement; a failure stops the run and names the rows already
  // written, and re-running converges because resolution accepts both spellings
  // of every renamed class.
  if (creates.length) {
    const { error: insertError } = await supabase.from('classes')
        .insert(creates.map((plan) => ({ ...plan.payload, rules_version: NEW_ROW_RULES_VERSION })));
    if (insertError) {
      console.error(`\nfailed to create ${creates.length} classes: ${insertError.message}`);
      console.error('nothing written');
      return 1;
    }
    console.log(`${creates.length} classes created`);
  }

  const written = [];
  for (const plan of pendingUpdates) {
    const { error: updateError } = await supabase.from('classes')
        .update(plan.payload).eq('id', plan.row.id);
    if (updateError) {
      console.error(`\nfailed to update "${plan.payload.name}": ${updateError.message}`);
      console.error(`partial load - created: ${creates.length}, updated: ${written.join(', ') || 'none'}`);
      console.error('re-run to converge; resolution is idempotent');
      return 1;
    }
    written.push(plan.payload.name);
  }

  console.log(`${written.length} classes updated`);
  console.log(`${creates.length + written.length} classes written`);
  return 0;
};

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
