#!/usr/bin/env bun
// Reports which live characters the pre-release class import would leave
// unsaveable, before the import is applied.
//
// Editing a class touches no character row. But the next save of an affected
// character resolves every submitted item name through the global, name-only
// map built by models/class.js#buildClassContentLookupMaps: a name carried by
// no class in that map raises `Missing class_id for ...` and the whole save
// fails (services/character/service.js:284-302). The edit form re-offers the
// stale name (routes/characters.js:382-393), so the user submits it in good
// faith and the save dies.
//
// Reads and prints only -- nothing here writes, and it does not run the loader.
//
// Exit 1 while any held name is unresolvable, whether the import causes it or
// not. Once the import is applied nothing can be classified as vanishing again
// -- the loader finds no changes, so before and after agree -- and a row a
// remap missed keeps a name that is by then in neither catalogue, landing in
// the already-unresolvable section. Gating on that section too is what makes
// this exit code mean anything after a load.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { fold, planLoad } from './load-prerelease-classes.mjs';
import {
  KINDS, catalogueNames, fetchAll, fetchHeldRows, groupUnresolvable, itemNames, projectImport
} from './lib/character-impact.mjs';

const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'data',
    'prerelease-classes-2026-08.json');

const setDifference = (left, right) => [...left].filter((value) => !right.has(value));

// The report is only worth its exit code if it measures the same catalogue the
// save path does, so the projection is checked against the live map itself.
const catalogueDrift = async (classes) => {
  const require = createRequire(import.meta.url);
  const { buildClassContentLookupMaps } = require('../models/class.js');
  const maps = await buildClassContentLookupMaps();
  const runtime = {
    abilities: new Set(maps.abilityNameToClassId.keys()),
    gear: new Set(maps.gearNameToClassId.keys())
  };
  const projected = catalogueNames(classes);
  return KINDS.flatMap((kind) => [
    ...setDifference(projected[kind], runtime[kind]).map((name) => `${kind}: "${name}" projected but not in the runtime map`),
    ...setDifference(runtime[kind], projected[kind]).map((name) => `${kind}: "${name}" in the runtime map but not projected`)
  ]);
};

const slotProposal = (kind, name, beforeClass, afterClass) => {
  const slot = itemNames(beforeClass, kind).indexOf(name);
  if (slot === -1) return { slot: null, incoming: null };
  return { slot, incoming: itemNames(afterClass, kind)[slot] ?? null };
};

// The import reorders items as well as renaming them, so the same-slot item can
// be one that merely moved. The names the import introduces into the class are
// the only ones a vanishing name can have become.
const introducedNames = (kind, beforeClass, afterClass) => {
  const before = new Set(itemNames(beforeClass, kind));
  return itemNames(afterClass, kind).filter((name) => !before.has(name));
};

// Most of these renames are a typo, a diacritic or a curly quote away from the
// name they replace, so comparison ignores exactly those.
const comparable = (name) => fold(name.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim());

const editDistance = (left, right) => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1,
          previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length];
};

const similarity = (left, right) => {
  const [first, second] = [comparable(left), comparable(right)];
  const longest = Math.max(first.length, second.length);
  return longest === 0 ? 1 : 1 - editDistance(first, second) / longest;
};

// Each introduced name can stand in for only one vanishing name, so the closest
// pair is settled first and both sides are then out of the running.
const pairByLikeness = (names, candidates) => {
  const chosen = new Map();
  const taken = new Set();
  const pairs = names.flatMap((name) => candidates.map((candidate) => ({ name, candidate, score: similarity(name, candidate) })));
  for (const { name, candidate } of pairs.sort((left, right) => right.score - left.score)) {
    if (chosen.has(name) || taken.has(candidate)) continue;
    chosen.set(name, candidate);
    taken.add(candidate);
  }
  return chosen;
};

const table = (headers, rows) => {
  const widths = headers.map((header, column) =>
      Math.max(header.length, ...rows.map((row) => String(row[column]).length)));
  const line = (cells) => cells.map((cell, column) => String(cell).padEnd(widths[column])).join('  ').trimEnd();
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
};

const main = async () => {
  const url = process.env.SUPABASE_URL || process.env.API_URL || '';
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SECRET_KEY || '';
  if (!url || !key) {
    console.error('missing credentials: set SUPABASE_URL and SUPABASE_SECRET_KEY.');
    return 1;
  }
  console.log(`target: ${url}`);

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const records = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
  const classes = await fetchAll(supabase, 'classes', '*');
  const plans = planLoad(records, classes);

  const ambiguous = plans.filter((plan) => plan.matches.length > 1);
  if (ambiguous.length) {
    for (const { payload, matches } of ambiguous) {
      console.error(`ambiguous: "${payload.name}" matches ${matches.length} rows -> ` +
          matches.map((row) => `${row.name} (${row.id})`).join(', '));
    }
    console.error(`\nABORTED - ${ambiguous.length} ambiguous class name(s), nothing measured`);
    return 1;
  }

  const drift = await catalogueDrift(classes);
  if (drift.length) {
    console.error('\nthe projected catalogue does not match the live lookup map:');
    for (const entry of drift) console.error(`  ${entry}`);
    console.error('\nABORTED - this report would measure something other than the save path');
    return 1;
  }

  const projected = projectImport(classes, plans);
  const before = catalogueNames(classes);
  const after = catalogueNames(projected);
  const classById = new Map(classes.map((cls) => [cls.id, cls]));
  const projectedById = new Map(projected.map((cls) => [cls.id, cls]));

  const perks = await fetchAll(supabase, 'character_perks', 'id, class_ability_id');
  const perksByAbilityId = new Map();
  for (const perk of perks) {
    perksByAbilityId.set(perk.class_ability_id, (perksByAbilityId.get(perk.class_ability_id) ?? 0) + 1);
  }

  const held = await fetchHeldRows(supabase);
  console.log(`scanned ${held.length} character-held rows across ${classes.length} classes, ` +
      `${new Set(held.map((row) => row.characterId)).size} characters, ${perks.length} perks`);

  if (!held.length) {
    console.error('\nFAILED - no character-held rows were scanned, so this report measures nothing.');
    console.error('  Point SUPABASE_URL at a database that holds characters.');
    return 1;
  }

  const groups = groupUnresolvable(held, before, after);
  for (const group of groups) {
    group.perks = group.kind === 'abilities'
        ? group.rows.reduce((sum, id) => sum + (perksByAbilityId.get(id) ?? 0), 0)
        : 0;
  }

  const vanishing = groups.filter((group) => group.survivesNow);
  const preexisting = groups.filter((group) => !group.survivesNow);

  const introducedFor = (group) => introducedNames(group.kind, classById.get(group.classId),
      projectedById.get(group.classId) ?? classById.get(group.classId));

  const pairings = new Map();
  for (const key of new Set(vanishing.map((group) => `${group.classId} ${group.kind}`))) {
    const peers = vanishing.filter((group) => `${group.classId} ${group.kind}` === key);
    const chosen = pairByLikeness(peers.map((group) => group.name), introducedFor(peers[0]));
    for (const [name, candidate] of chosen) pairings.set(`${key} ${name}`, candidate);
  }

  const summarise = (group) => {
    const cls = classById.get(group.classId);
    const { slot, incoming } = slotProposal(group.kind, group.name,
        cls, projectedById.get(group.classId) ?? cls);
    return {
      className: cls?.name ?? group.classId,
      kind: group.kind === 'abilities' ? 'ability' : 'gear',
      slot: slot === null ? '-' : slot + 1,
      name: group.name,
      incoming: incoming ?? '(no item in that slot)',
      proposal: pairings.get(`${group.classId} ${group.kind} ${group.name}`) ?? '(no new item in this class)',
      rows: group.rows.length,
      characters: group.characters.size,
      perks: group.perks
    };
  };

  const order = (left, right) => left.className.localeCompare(right.className)
      || left.kind.localeCompare(right.kind) || String(left.slot).localeCompare(String(right.slot));
  const proposals = vanishing.map(summarise).sort(order);

  const total = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0);
  const distinctCharacters = new Set(vanishing.flatMap((group) => [...group.characters])).size;
  const abilityRows = total(proposals.filter((row) => row.kind === 'ability'), 'rows');
  const gearRows = total(proposals.filter((row) => row.kind === 'gear'), 'rows');

  console.log(`\n${'='.repeat(72)}\nNAMES THE IMPORT WOULD REMOVE FROM THE CATALOGUE\n${'='.repeat(72)}`);
  if (!proposals.length) {
    console.log('\nnone - every name a character holds survives the import.');
  } else {
    console.log(`\n${table(['class', 'kind', 'slot', 'vanishing name', 'proposed pairing (CONFIRM)', 'same slot after import', 'rows', 'chars', 'perks'],
        proposals.map((row) => [row.className, row.kind, row.slot, row.name, row.proposal, row.incoming, row.rows, row.characters, row.perks]))}`);
    console.log(`\n${proposals.length} names vanish, ${abilityRows + gearRows} rows carry one ` +
        `(${abilityRows} ability, ${gearRows} gear), ${distinctCharacters} characters become unsaveable, ` +
        `${total(proposals, 'perks')} ability perks attached.`);
    console.log('\nThe pairing column is a PROPOSAL: the closest of the names the import adds to');
    console.log('that class. The slot column shows what lands in the same position instead --');
    console.log('the two disagree wherever the import reorders items. Which new item replaces');
    console.log('which old one is a content judgement, so the owner confirms or corrects every');
    console.log('row before Task 10b applies anything.');

    const menu = new Map();
    for (const group of vanishing) {
      const key = `${group.classId} ${group.kind}`;
      if (menu.has(key)) continue;
      menu.set(key, {
        className: classById.get(group.classId)?.name ?? group.classId,
        kind: group.kind === 'abilities' ? 'ability' : 'gear',
        introduced: introducedFor(group)
      });
    }
    const menuRows = [...menu.values()]
        .sort((left, right) => left.className.localeCompare(right.className) || left.kind.localeCompare(right.kind));
    console.log(`\n${'-'.repeat(72)}\nCORRECTION MENU - every name the import introduces into these classes\n${'-'.repeat(72)}\n`);
    console.log(table(['class', 'kind', 'names the import adds to this class'],
        menuRows.map((row) => [row.className, row.kind, row.introduced.join(' | ') || '(none)'])));
  }

  if (preexisting.length) {
    const rows = preexisting.map(summarise).sort(order);
    console.log(`\n${'='.repeat(72)}\nALREADY UNRESOLVABLE BEFORE THE IMPORT (not caused by it)\n${'='.repeat(72)}\n`);
    console.log(table(['class', 'kind', 'held name', 'rows', 'chars', 'perks'],
        rows.map((row) => [row.className, row.kind, row.name, row.rows, row.characters, row.perks])));
    console.log(`\n${rows.length} names, ${total(rows, 'rows')} rows, ` +
        `${new Set(preexisting.flatMap((group) => [...group.characters])).size} characters. ` +
        'These characters cannot be saved today; the import neither causes nor fixes it.');
    console.log('This section fails the run: after a load it is also where a row a remap missed');
    console.log('would appear, so it is read rather than skipped.');
  }

  return proposals.length || preexisting.length ? 1 : 0;
};

if (import.meta.main) process.exitCode = await main();
