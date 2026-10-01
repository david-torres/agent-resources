require('../util/require-local-supabase');
const { test, expect } = require('bun:test');
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const { statList } = require('../util/enclave-consts');
const { buildEditionMechanicsAudit } = require('../scripts/audit-edition-mechanics');
const { computeVersionFamily } = require('../util/class-family');
const migration = readFileSync(require.resolve('../supabase/migrations/20261001000002_aspirant_edition_versions.sql'), 'utf8')
  .replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');

test('metadata migration preserves production-shaped characters, timestamps, links and mechanics; rerun is a no-op', async () => {
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('ALTER TABLE public.classes DROP CONSTRAINT IF EXISTS classes_published_rules_identity');
    const { rows: [user] } = await db.query("INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES(gen_random_uuid(),$1,'{}','{}') RETURNING id", [`edition-${crypto.randomUUID()}@example.test`]);
    const { rows: [profile] } = await db.query("INSERT INTO profiles(user_id,name) VALUES($1,'Edition rehearsal') RETURNING id", [user.id]);
    const classes = [];
    for (let i = 0; i < 23; i++) {
      const { rows: [row] } = await db.query(`INSERT INTO classes(name,rules_edition,rules_version,content_format,base_class_id,created_at,updated_at)
        VALUES($1,$2,'v2',$3,$4,'2026-09-01','2026-09-28') RETURNING *`,
        [`Edition rehearsal ${i}`, i < 21 ? 'aspirant' : 'advent', i < 6 || i >= 21 ? 'advent' : 'aspirant', i === 1 ? classes[0].id : null]);
      classes.push(row);
    }
    const characters = [];
    for (let i = 0; i < 48; i++) {
      const { rows: [row] } = await db.query(`INSERT INTO characters(creator_id,name,class,class_id,creator_mode,auto_calculate,level,completed_missions,commissary_reward,${statList.join(',')})
        VALUES($1,$2,'Rehearsal',$3,$4,$5,$6,$7,0,${statList.map(() => 1).join(',')}) RETURNING *`,
        [profile.id, `Edition character ${i}`, classes[i < 43 ? i % 6 : 6 + i % 15].id, i < 43 ? null : 'aspirant', i === 0, i === 0 ? 5 : 3, i === 0 ? 11 : 4]);
      characters.push(row);
    }
    for (let i = 0; i < 11; i++) {
      const { rows: [mission] } = await db.query("INSERT INTO missions(name,date,outcome,creator_id) VALUES('Rehearsal',now(),'success',$1) RETURNING id", [profile.id]);
      await db.query('INSERT INTO mission_characters(mission_id,character_id) VALUES($1,$2)', [mission.id, characters[0].id]);
    }
    const charIds = characters.map(row => row.id);
    const snapshot = async () => {
      const { rows: classRows } = await db.query('SELECT * FROM classes WHERE id=ANY($1::uuid[]) ORDER BY id', [classes.map(row => row.id)]);
      const { rows: characterRows } = await db.query('SELECT * FROM characters WHERE id=ANY($1::uuid[]) ORDER BY id', [charIds]);
      const { rows: links } = await db.query(`SELECT mc.*,to_jsonb(m) AS missions FROM mission_characters mc JOIN missions m ON m.id=mc.mission_id WHERE character_id=ANY($1::uuid[]) ORDER BY mc.id`, [charIds]);
      return { classes: classRows, characters: characterRows, links };
    };
    const before = await snapshot();
    const beforeReport = buildEditionMechanicsAudit(before);
    expect(beforeReport.safe_metadata_change).toBe(true);
    await db.query(migration);
    const after = await snapshot();
    expect(after.characters).toEqual(before.characters);
    expect(after.links).toEqual(before.links);
    expect(after.classes).toEqual(before.classes.map(row => row.rules_edition === 'aspirant' ? { ...row, rules_version: 'v1' } : row));
    expect(computeVersionFamily(after.classes, classes[0].id)).toEqual(computeVersionFamily(before.classes, classes[0].id));
    const afterReport = buildEditionMechanicsAudit(after);
    expect(afterReport.safe_metadata_change).toBe(true);
    expect(afterReport.characters.map(row => row.proposed)).toEqual(beforeReport.characters.map(row => row.proposed));
    expect(after.characters.find(row => row.id === characters[0].id).level).toBe(5);
    await db.query(migration);
    expect(await snapshot()).toEqual(after);
    await db.query('SAVEPOINT invalid_writer');
    await expect(db.query("INSERT INTO classes(name,rules_edition,rules_version) VALUES('Invalid','aspirant','v2')")).rejects.toThrow();
    await db.query('ROLLBACK TO SAVEPOINT invalid_writer');
  } finally { await db.query('ROLLBACK'); await db.end(); }
}, 30000);
