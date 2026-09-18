#!/usr/bin/env bun
// Loads the verbatim pre-release extraction into `classes`.
//
// Idempotent: re-running resolves the same rows and writes the same values, and
// a run with nothing to change issues no request at all. Dry-run by default --
// --apply is the only thing that writes.
//
// A book whose descriptor sets `forks` never writes over the class it shares a
// name with. It inserts a row of its own instead, carrying `base_class_id`, its
// own `content_format` and `rules_edition`, and an id minted in
// util/starter-content.js; the parent is left exactly as it stands. A second run
// finds that row and updates it, which is what keeps a repeated --apply a no-op.
//
// An --apply run does three things in order: writes the class rows, renames the
// character-held item rows this document renames, and publishes the four
// classes the owner authorised. The rename comes from
// docs/data/prerelease-name-remap.json: the document renames items live
// characters hold, and a held name that no class in the runtime map carries
// fails that character's next save outright, so a name this import removes with
// no remap entry aborts the run before anything is written. --allow-unremapped
// waives that refusal against a local stack only -- the class-content integrity
// test has to be able to reach the unremapped state to go red.
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

import { createClient } from '@supabase/supabase-js';

import { ASPIRANT_V1_CLASS_IDS } from '../util/starter-content.js';
import { bookFor } from './lib/books.mjs';
import {
  ROW_TABLE, catalogueNames, fetchHeldRows, groupUnresolvable, projectImport
} from './lib/character-impact.mjs';

// `classes.prerelease_section` carries the normalized enum; the artifact
// carries the headings the page prints above each block.
const SECTIONS = { PCCs: 'pcc', EXCLUSIVES: 'exclusive', 'ASPIRANT CLASSES': 'aspirant' };

const CONTENT_FIELDS = ['name', 'challenge_level', 'stat_line', 'stat_note', 'quote', 'quote_source',
    'overview', 'conduit_notes', 'grounding', 'examples_heading', 'examples', 'tips_heading',
    'tips', 'designer', 'prerelease_section', 'free_play_access', 'stat_spread', 'abilities', 'gear',
    'advanced_abilities', 'expanded_tips'];

// `prerelease_section` is the pre-release document's own sectioning: the V1
// artifact carries no such key, and DERIVED.prerelease_section would throw on a
// record without one rather than store a null.
export const fieldsFor = (book) => CONTENT_FIELDS
    .filter((field) => field !== 'prerelease_section' || book.key === 'prerelease');

// The row a fork descends from: the same name in the Advent content format, at
// v1, and not somebody's own class. `content_format` and `is_player_created`
// guard against data a user can create at any time -- a player naming their
// own class 'Berserker' is an ordinary event, and this is what stops it being
// taken as a parent -- but neither clause is doing any work against today's
// catalogue: all 50 rows are content_format 'advent', and no player-created
// row shares one of the twelve names.
const FORK_PARENT = { content_format: 'advent', rules_version: 'v1', is_player_created: false };

// `rules_version` is NOT NULL with no column default, so a new row cannot be
// inserted without it. It is never part of an update payload -- an existing row
// keeps whatever the owner set. This constant supplies 'v1' unconditionally to
// every insert, create or fork alike, regardless of what a fork's parent row
// carries; the parent-resolution rule's own 'v1' requirement is a separate
// fact, stated where FORK_PARENT is defined.
const NEW_ROW_RULES_VERSION = 'v1';

// Rich-text trees whose `text` leaves are runs within a line rather than whole
// values: trimming each leaf independently would delete the space between two
// adjacent runs, which is interior whitespace and must survive.
const RICH_TEXT_KEYS = new Set(['notes']);

// The remap file names its kinds the way a class page does; the catalogue
// tables and the impact projection use the column names.
const REMAP_KIND = { ability: 'abilities', gear: 'gear' };

// `classes.is_public` defaults to false, so a created row would land invisible:
// absent from /classes for non-admins, from the character wizard, and from the
// name map the save path resolves through. `book.publishedByLoad` is the
// owner's named set, and it is the only thing here that may set a row's
// visibility -- is_public is deliberately absent from every field list so the
// general write path cannot.

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
  // The pre-release book was given away, so its classes are free to play. The
  // Aspirant book's grant lives in the class-unlock roster instead, so
  // free-play access on top of the roster would make the roster meaningless.
  free_play_access: (record, book) => book.key === 'prerelease',
  tips: (record) => tipsMarkdown(record.tips),
  // The August 2026 artifact predates Aspirant V1 and carries neither key, so
  // those records load the empty shape. Both are emitted unconditionally
  // because the allowlist test compares the payload's key set against the
  // book's field list exactly.
  advanced_abilities: (record) => record.advanced_abilities ?? [],
  expanded_tips: (record) => record.expanded_tips ?? { player: [], conduit: [] }
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

export const buildPayload = (record, book) => trimEnds(Object.fromEntries(fieldsFor(book)
    .map((field) => [field, DERIVED[field] ? DERIVED[field](record, book) : record[field]])));

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

// Keyed on the payload rather than on a field list, so a fork reports the four
// fields it mints alongside the book's own.
export const diffFields = (payload, row) => Object.keys(payload)
    .filter((field) => stable(payload[field]) !== stable(row?.[field]))
    .map((field) => ({ field, before: row?.[field] ?? null, after: payload[field] }));

const remapKey = (classId, kind, name) => JSON.stringify([classId, kind, name]);

// The names this import takes out of the catalogue that no remap entry accounts
// for. A name already unresolvable before the import is not this import's to
// answer for, so only the ones that resolve today are counted.
export const unremapped = (groups, remap) => {
  const covered = new Set(remap.map(
      (entry) => remapKey(entry.class_id, REMAP_KIND[entry.kind], entry.from)));
  return groups.filter((group) => group.survivesNow
      && !covered.has(remapKey(group.classId, group.kind, group.name)));
};

// The other half of the guard: every entry has to rename its rows *to* a name
// the post-import catalogue actually carries.
export const unresolvableTargets = (remap, after) =>
    remap.filter((entry) => !after[REMAP_KIND[entry.kind]].has(entry.to));

export const resolveTarget = (payload, rows, book) => {
  const wanted = new Set([fold(payload.name)]);
  if (book.aliases[payload.name]) wanted.add(fold(book.aliases[payload.name]));
  return rows.filter((row) => wanted.has(fold(row.name.trim())));
};

// An id Postgres mints instead would differ between environments, which is the
// one thing minting them by hand prevents -- and a payload with no `id` key is
// exactly what makes Postgres mint one.
const mintedId = (name) => {
  const id = ASPIRANT_V1_CLASS_IDS[name];
  if (!id) throw new Error(`no minted class id for ${JSON.stringify(name)}`);
  return id;
};

const isParent = (row) => Object.entries(FORK_PARENT)
    .every(([column, value]) => row[column] === value);

// A fork of this book already in the catalogue means the load has run before, so
// the second run updates the fork it made rather than making another. Otherwise
// the load descends from the parent, which it leaves untouched.
//
// `matches` narrows to whichever side decided that, because two candidates there
// is a name the loader cannot resolve -- while a parent and its own fork sharing
// a name is the steady state, not an ambiguity. An ambiguous plan is reported
// and aborts the run before anything reads the rest of it.
const forkPlan = (payload, matches, book) => {
  const existing = matches.filter((row) => row.content_format === book.contentFormat
      && row.rules_edition === book.rulesEdition);
  if (existing.length) {
    return {
      payload, matches: existing, row: existing.length === 1 ? existing[0] : null,
      parent: null, disposition: 'update'
    };
  }
  const parents = matches.filter(isParent);
  if (!parents.length) {
    throw new Error(`no fork parent for ${JSON.stringify(payload.name)}: the catalogue holds no ` +
        `${FORK_PARENT.content_format} ${FORK_PARENT.rules_version} row of that name`);
  }
  // A fork states its own identity, its parent and the two axes that separate
  // it from that parent, because it must not inherit any of the four. The pair
  // that separates fork from parent is `content_format` always, and
  // `rules_edition` only for the six Advent parents (Gunslinger, Illusionist,
  // Librarian, Thane, Thunderbird, Wanderer) -- the other six already carry
  // 'aspirant'. A create takes the four from the row's column defaults; an
  // update leaves the columns alone entirely.
  const parent = parents.length === 1 ? parents[0] : null;
  const forked = (row) => ({
    ...payload, id: mintedId(payload.name), base_class_id: row.id,
    rules_edition: book.rulesEdition, content_format: book.contentFormat
  });
  return {
    payload: parent ? forked(parent) : payload,
    matches: parents, row: null, parent, disposition: 'fork'
  };
};

export const planLoad = (records, rows, book) => records.map((record) => {
  const payload = buildPayload(record, book);
  const matches = resolveTarget(payload, rows, book);
  if (book.forks) return forkPlan(payload, matches, book);
  const row = matches.length === 1 ? matches[0] : null;
  return { payload, matches, row, parent: null, disposition: row ? 'update' : 'create' };
});

const reportInsert = (plan, heading) => {
  console.log(`\n${heading}`);
  for (const { field, after } of plan.changes) console.log(`  + ${field}: ${preview(after)}`);
  console.log(`  + rules_version: ${JSON.stringify(NEW_ROW_RULES_VERSION)}`);
};

const reportPlan = (plans) => {
  for (const plan of plans) {
    const { payload, row, parent, disposition } = plan;
    if (disposition === 'create') {
      reportInsert(plan, `CREATE ${payload.name}`);
      continue;
    }
    if (disposition === 'fork') {
      reportInsert(plan, `FORK ${payload.name} from ${parent.id}`);
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
  const allowUnremapped = argv.includes('--allow-unremapped');
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt === -1 ? null : argv[onlyAt + 1];
  const bookAt = argv.indexOf('--book');
  const bookKey = bookAt === -1 ? 'prerelease' : argv[bookAt + 1];

  if (onlyAt !== -1 && (!only || only.startsWith('--'))) {
    console.error('missing class name after --only');
    return 1;
  }
  if (bookAt !== -1 && (!bookKey || bookKey.startsWith('--'))) {
    console.error('missing book key after --book');
    return 1;
  }
  const book = bookFor(bookKey);

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
  // Leaving live characters unsaveable is a local rehearsal state, never a
  // deployed one, so this waiver does not travel with --force.
  if (allowUnremapped && !isLocalTarget(url)) {
    console.error(`\nrefusing --allow-unremapped against a non-local target (${url || 'unset'}).`);
    return 1;
  }
  if (!url || !key) {
    console.error('\nmissing credentials: set SUPABASE_URL and SUPABASE_SECRET_KEY.');
    return 1;
  }

  const supabase = createClient(url, key,
      { auth: { autoRefreshToken: false, persistSession: false } });

  const artifact = JSON.parse(readFileSync(book.artifact, 'utf8'));
  const records = only ? artifact.filter((record) => displayName(record.name) === only) : artifact;
  if (only && !records.length) {
    console.error(`no class named ${JSON.stringify(only)} in ${book.artifact}`);
    return 1;
  }
  const { data: rows, error } = await supabase.from('classes').select('*');
  if (error) {
    console.error(`\nfailed to read classes: ${error.message}`);
    return 1;
  }

  const plans = planLoad(records, rows, book);

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

  const updates = plans.filter((plan) => plan.disposition === 'update');
  const creates = plans.filter((plan) => plan.disposition === 'create');
  const forks = plans.filter((plan) => plan.disposition === 'fork');
  // Creates and forks are both inserts, and a book yields one kind or the other:
  // a forking book has no create to make, since a name with no parent stops the
  // run rather than starting a family of its own.
  const inserts = [...creates, ...forks];
  const renames = updates
      .filter((plan) => plan.row.name !== plan.payload.name)
      .map((plan) => ({ from: plan.row.name, to: plan.payload.name, id: plan.row.id }));

  // Only a forking book can fork, so the third count is printed only where it
  // can be anything but zero.
  const resolved = [`${updates.length} update`, `${creates.length} create`,
    ...(book.forks ? [`${forks.length} fork`] : [])].join(', ');
  console.log(`\n${plans.length} classes resolved (${resolved}), 0 ambiguous`);
  for (const { from, to, id } of renames) console.log(`name correction: "${from}" -> "${to}" (${id})`);

  // Unchanged rows are skipped so a re-run does not bump `updated_at` on all 19
  // and reshuffle the recency ordering the class listings read.
  const pendingUpdates = updates.filter((plan) => plan.changes.length);
  console.log(`${pendingUpdates.length} of ${updates.length} existing rows differ`);

  if (!apply) {
    console.log('DRY RUN - nothing written');
    return 0;
  }

  const remap = book.remap ? JSON.parse(readFileSync(book.remap, 'utf8')) : [];

  // A published class the document does not carry would be a silent no-op, so
  // the two lists are checked against each other rather than assumed to agree.
  const published = book.publishedByLoad.filter((name) => !only || name === only);
  const unknownPublish = published.filter(
      (name) => !plans.some((plan) => plan.payload.name === name));
  if (unknownPublish.length) {
    console.error(`\nABORTED - not in this document: ${unknownPublish.join(', ')}`);
    console.error('nothing written');
    return 1;
  }

  const after = catalogueNames(projectImport(rows, plans, book));

  // A `to` no class carries after the import renames live rows to a name that
  // resolves to nothing -- the very breakage the remap exists to prevent, dealt
  // out by the fix itself. A typo is all it takes, so it is checked here and
  // not only in the test that covers the committed file.
  const stranded = unresolvableTargets(remap, after);
  if (stranded.length) {
    for (const entry of stranded) {
      console.error(`  remap target no class carries: ${entry.kind} "${entry.to}" ` +
          `(class ${entry.class_id})`);
    }
    console.error(`\nrefusing to load: ${stranded.length} remap target(s) the import does not add`);
    console.error('nothing written');
    return 1;
  }

  // A dry run writes nothing, so this scan only earns its cost where it can
  // still stop something.
  const orphans = unremapped(
      groupUnresolvable(await fetchHeldRows(supabase), catalogueNames(rows), after), remap);
  for (const group of orphans) {
    console.error(`  no remap entry: ${group.kind} "${group.name}" (class ${group.classId}, ` +
        `${group.rows.length} rows, ${group.characters.size} characters)`);
  }
  if (orphans.length && !allowUnremapped) {
    console.error(`\nrefusing to load: ${orphans.length} character-visible names have no remap entry`);
    console.error('nothing written');
    return 1;
  }
  if (orphans.length) {
    console.log(`--allow-unremapped: loading anyway, ${orphans.length} names left unresolvable`);
  }

  // The new rows go in one statement. The updates cannot join them: PostgREST's
  // upsert is INSERT ... ON CONFLICT, and Postgres rejects the proposed tuple on
  // `rules_version` NOT NULL before the conflict resolves, so batching them
  // would mean putting `rules_version` -- an owner-controlled field the
  // allowlist excludes -- into every update payload. So each update is its own
  // statement; a failure stops the run and names the rows already written, and
  // re-running converges because resolution accepts both spellings of every
  // renamed class.
  if (inserts.length) {
    const { data, error: insertError } = await supabase.from('classes')
        .insert(inserts.map((plan) => ({ ...plan.payload, rules_version: NEW_ROW_RULES_VERSION })))
        .select('id, name, is_public');
    if (insertError) {
      console.error(`\nfailed to create ${inserts.length} classes: ${insertError.message}`);
      console.error('nothing written');
      return 1;
    }
    // The publish step reads `plan.row`, and one insert batch holds one row per
    // class, so the name resolves within it even where a name now names two rows
    // in the catalogue at large.
    const insertedByName = new Map(data.map((created) => [created.name, created]));
    for (const plan of inserts) plan.row = insertedByName.get(plan.payload.name);
    console.log(`${inserts.length} classes created`);
  }

  const written = [];
  for (const plan of pendingUpdates) {
    const { error: updateError } = await supabase.from('classes')
        .update(plan.payload).eq('id', plan.row.id);
    if (updateError) {
      console.error(`\nfailed to update "${plan.payload.name}": ${updateError.message}`);
      console.error(`partial load - created: ${inserts.length}, updated: ${written.join(', ') || 'none'}`);
      console.error('re-run to converge; resolution is idempotent');
      return 1;
    }
    written.push(plan.payload.name);
  }

  console.log(`${written.length} classes updated`);
  console.log(`${inserts.length + written.length} classes written`);

  // Renamed in place: character_perks.class_ability_id hangs off these row ids,
  // so a delete-and-reinsert would take the perks with it.
  let renamed = 0;
  for (const [index, entry] of remap.entries()) {
    const { data, error: remapError } = await supabase.from(ROW_TABLE[REMAP_KIND[entry.kind]])
        .update({ name: entry.to })
        .eq('class_id', entry.class_id).eq('name', entry.from)
        .select('id');
    if (remapError) {
      console.error(`\nfailed to remap ${entry.kind} "${entry.from}" -> "${entry.to}": ${remapError.message}`);
      console.error(`partial load - classes written, ${index} of ${remap.length} remaps applied`);
      console.error('re-run to converge; the load and the remaps are both idempotent');
      return 1;
    }
    console.log(`remap ${entry.kind} "${entry.from}" -> "${entry.to}": ${data.length} rows`);
    renamed += data.length;
  }
  console.log(`${remap.length} remaps applied, ${renamed} character rows renamed`);

  // Keyed on the plan: a fork and the parent it descends from carry the same
  // name for good, and only one of the two is this load's to publish.
  for (const plan of plans.filter((candidate) => published.includes(candidate.payload.name))) {
    const { name } = plan.payload;
    const target = plan.row;
    if (target.is_public) {
      console.log(`already public: ${name} (${target.id})`);
      continue;
    }
    const { error: publishError } = await supabase.from('classes')
        .update({ is_public: true }).eq('id', target.id);
    if (publishError) {
      console.error(`\nfailed to publish "${name}": ${publishError.message}`);
      console.error('partial load - classes and remaps written; re-run to converge');
      return 1;
    }
    console.log(`published: ${name} (${target.id})`);
  }
  return 0;
};

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
