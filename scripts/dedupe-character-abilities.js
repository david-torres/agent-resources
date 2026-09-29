// One-time cleanup before class_abilities_character_name_key: a character
// holding one Ability name (trimmed, case-folded) more than once keeps the
// row with the lowest id, which takes the other rows' Perks. Default is
// read-only. Pass --apply only after reviewing the list.
//
// Each character is cleaned in its own transaction, which needs a direct
// Postgres connection (SUPABASE_URL + SUPABASE_DB_PASS, as
// scripts/apply-migrations.mjs reads them). Table names are unqualified so the
// integration test can shadow them with temporary tables.
const { Client } = require('pg');

const DUPLICATE_ROWS = `
  select a.id, a.character_id, a.name, a.type, a.class_id, c.name as character_name,
    k.name as class_name, k.content_format, lower(btrim(a.name)) as name_key,
    (select count(*)::int from character_perks p where p.class_ability_id = a.id) as perk_count
  from class_abilities a
  join characters c on c.id = a.character_id
  join classes k on k.id = a.class_id
  where ($1::uuid[] is null or a.character_id = any($1::uuid[]))
    and (a.character_id, lower(btrim(a.name))) in (
      select character_id, lower(btrim(name)) from class_abilities
      group by character_id, lower(btrim(name)) having count(*) > 1
    )
  order by a.character_id, name_key, a.id`;

const planMerges = (rows) => {
  const characters = new Map();
  for (const row of rows) {
    if (!characters.has(row.character_id)) {
      characters.set(row.character_id, { id: row.character_id, name: row.character_name, groups: new Map() });
    }
    const { groups } = characters.get(row.character_id);
    if (!groups.has(row.name_key)) groups.set(row.name_key, []);
    groups.get(row.name_key).push(row);
  }
  return [...characters.values()].map(({ id, name, groups }) => ({
    id,
    name,
    names: [...groups.values()].map(rows => {
      const [kept, ...extra] = rows;
      return { name: kept.name, kept: kept.id, deleted: extra.map(row => row.id), rows };
    })
  }));
};

// The kept row's Perks stay first; the deleted rows' Perks follow in the order
// of those rows, then their own position. A moved Perk keeps its id, so a
// Compound link inside the moved set still resolves.
const mergeRows = async (client, { kept, deleted }) => {
  const { rows: [{ last }] } = await client.query(
    'select coalesce(max(position), -1)::int as last from character_perks where class_ability_id = $1', [kept]
  );
  await client.query(`
    with moved as (
      select id, row_number() over (
        order by array_position($2::uuid[], class_ability_id), position, id
      )::int as n
      from character_perks where class_ability_id = any($2::uuid[])
    )
    update character_perks p set class_ability_id = $1, position = $3::int + moved.n
    from moved where p.id = moved.id`, [kept, deleted, last]);
  await client.query('delete from class_abilities where id = any($1::uuid[])', [deleted]);
};

const describeRow = (row, action) => {
  const perks = `${row.perk_count} ${row.perk_count === 1 ? 'Perk' : 'Perks'}`;
  return `  ${action.padEnd(6)} ${JSON.stringify(row.name)}, ${row.class_name} (${row.content_format}), `
    + `${row.type}, ${perks}, ${row.id}`;
};

const dedupeCharacterAbilities = async ({ client, apply = false, characterIds = null, log = console.log }) => {
  const { rows } = await client.query(DUPLICATE_ROWS, [characterIds]);
  const characters = planMerges(rows);
  const report = { characters, applied: [], failed: [] };
  for (const character of characters) {
    for (const group of character.names) {
      log(`${character.id} ${character.name}: ${group.rows.length} Abilities named ${JSON.stringify(group.name)}`);
      group.rows.forEach((row, index) => log(describeRow(row, index === 0 ? 'KEEP' : 'DELETE')));
    }
    if (!apply) continue;
    try {
      await client.query('begin');
      for (const group of character.names) await mergeRows(client, group);
      await client.query('commit');
      report.applied.push(character.id);
    } catch (error) {
      await client.query('rollback');
      report.failed.push({ id: character.id, error: error.message });
      log(`  failed: ${error.message}`);
    }
  }
  log(`Characters holding an Ability name more than once: ${characters.length}.`
    + (apply ? ` ${report.applied.length} cleaned, ${report.failed.length} failed.` : ' Read-only: nothing written.'));
  return report;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) {
    throw new Error('Usage: bun scripts/dedupe-character-abilities.js [--apply]');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_DB_PASS) {
    throw new Error('Set SUPABASE_URL and SUPABASE_DB_PASS.');
  }
  const apply = args.includes('--apply');
  const { migrationConnectionConfig } = await import('./migration-connection.mjs');
  const config = migrationConnectionConfig(
    process.env.SUPABASE_URL, process.env.SUPABASE_DB_PASS, process.env.SUPABASE_DB_REGION || undefined
  );
  console.log(`Target: ${config.host}:${config.port} (${apply ? 'apply' : 'read-only'})`);
  const client = new Client(config);
  await client.connect();
  try {
    const report = await dedupeCharacterAbilities({ client, apply });
    if (report.failed.length > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { dedupeCharacterAbilities };
