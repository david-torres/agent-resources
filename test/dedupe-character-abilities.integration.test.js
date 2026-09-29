// Covers scripts/dedupe-character-abilities.js against Postgres. The four
// tables are temporary copies that shadow the real ones for this connection
// only, so the fixture can hold duplicates whether or not
// class_abilities_character_name_key exists.
require('../util/require-local-supabase');

const { test, expect, beforeAll, afterAll } = require('bun:test');
const { Client } = require('pg');
const { dedupeCharacterAbilities } = require('../scripts/dedupe-character-abilities');

const db = new Client({
  connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
});
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RAVEN = id(1);
const CLEAN = id(2);
const ILLUSIONIST = id(10);
const MESMER = id(11);
const [A1, A2, A3, A4, B1] = [id(101), id(102), id(103), id(104), id(201)];
const [P1, P2, P3, P4, P5] = [id(301), id(302), id(303), id(304), id(305)];

const run = (apply, log = () => {}) => dedupeCharacterAbilities({ client: db, apply, log });

beforeAll(async () => {
  await db.connect();
  await db.query(`
    create temp table characters (id uuid primary key, name text not null);
    create temp table classes (id uuid primary key, name text not null, content_format text not null);
    create temp table class_abilities (
      id uuid primary key, character_id uuid not null, name text not null, class_id uuid not null,
      type text not null default 'core'
    );
    create temp table character_perks (
      id uuid primary key, character_id uuid not null, class_ability_id uuid not null,
      text text not null, compounds_with uuid, position integer not null default 0
    );
  `);
  await db.query('insert into characters values ($1, $2), ($3, $4)', [RAVEN, 'Raven', CLEAN, 'Clean']);
  await db.query(
    `insert into classes values ($1, 'Illusionist', 'advent'), ($2, 'Mesmer', 'aspirant')`,
    [ILLUSIONIST, MESMER]
  );
  await db.query(
    `insert into class_abilities values
      ($1, $6, 'Veneer', $8, 'core'), ($2, $6, 'veneer ', $9, 'core'), ($3, $6, 'VENEER', $8, 'advanced'),
      ($4, $6, 'Phantasm', $8, 'core'), ($5, $7, 'Veneer', $8, 'core')`,
    [A1, A2, A3, A4, B1, RAVEN, CLEAN, ILLUSIONIST, MESMER]
  );
  await db.query(
    `insert into character_perks (id, character_id, class_ability_id, text, compounds_with, position) values
      ($1, $6, $7, 'Kept perk.', null, 0),
      ($2, $6, $8, 'Moved first.', null, 0),
      ($3, $6, $8, 'Moved compound.', $2, 1),
      ($4, $6, $9, 'Moved last.', null, 0),
      ($5, $6, $10, 'Untouched.', null, 0)`,
    [P1, P2, P3, P4, P5, RAVEN, A1, A2, A3, A4]
  );
});

afterAll(() => db.end());

test('the dry run lists every row of each duplicate name as KEEP or DELETE, and writes nothing', async () => {
  const lines = [];
  const report = await run(false, line => lines.push(line));
  expect(lines).toEqual([
    `${RAVEN} Raven: 3 Abilities named "Veneer"`,
    `  KEEP   "Veneer", Illusionist (advent), core, 1 Perk, ${A1}`,
    `  DELETE "veneer ", Mesmer (aspirant), core, 2 Perks, ${A2}`,
    `  DELETE "VENEER", Illusionist (advent), advanced, 1 Perk, ${A3}`,
    'Characters holding an Ability name more than once: 1. Read-only: nothing written.'
  ]);
  expect(report.characters).toMatchObject([
    { id: RAVEN, name: 'Raven', names: [{ name: 'Veneer', kept: A1, deleted: [A2, A3] }] }
  ]);
  expect(report.applied).toEqual([]);
  const { rows: [{ n }] } = await db.query('select count(*)::int as n from class_abilities');
  expect(n).toBe(5);
});

test('--apply keeps the lowest id, moves every Perk after the kept row\'s own, and a second run finds nothing', async () => {
  expect(await run(true)).toMatchObject({ applied: [RAVEN], failed: [] });

  const { rows: abilities } = await db.query(
    'select id from class_abilities where character_id = $1 order by id', [RAVEN]
  );
  expect(abilities.map(row => row.id)).toEqual([A1, A4]);

  const { rows: perks } = await db.query(
    'select id, class_ability_id, position, compounds_with from character_perks order by id'
  );
  expect(perks).toEqual([
    { id: P1, class_ability_id: A1, position: 0, compounds_with: null },
    { id: P2, class_ability_id: A1, position: 1, compounds_with: null },
    { id: P3, class_ability_id: A1, position: 2, compounds_with: P2 },
    { id: P4, class_ability_id: A1, position: 3, compounds_with: null },
    { id: P5, class_ability_id: A4, position: 0, compounds_with: null }
  ]);

  expect((await run(false)).characters).toEqual([]);
});
