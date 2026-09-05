// util/image-crop-integrity.integration.test.js
// image_crop is a jsonb column that must hold an object or SQL NULL. A write
// path that passed the raw hidden-field string through instead put a jsonb
// *string* in 142 rows -- `""` where the crop was cleared, and a double-encoded
// crop object where one was set. Every read is a property access
// (`{{character.image_crop.x}}`), so a string silently renders as no crop at
// all. util/crop.js's applyImageCrop closed the write path and
// 20260904000003_repair_image_crop.sql repaired the rows; this notices if a
// third one reopens it.
const { test, expect } = require('bun:test');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const TABLES = ['classes', 'characters', 'profiles'];

test('no image_crop is stored as a jsonb string', async () => {
  const db = new Client({
    connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  });
  await db.connect();
  try {
    const offenders = [];
    for (const table of TABLES) {
      const { rows } = await db.query(
        `select count(*)::int as n from public.${table} where jsonb_typeof(image_crop) = 'string'`
      );
      if (rows[0].n > 0) offenders.push({ table, rows: rows[0].n });
    }
    expect(offenders).toEqual([]);
  } finally {
    await db.end();
  }
});

// The repair rebuilds each recovered crop through the same shape parseImageCrop
// returns, so anything still stored has to survive a round trip through it.
test('every stored image_crop object is one parseImageCrop accepts', async () => {
  const { parseImageCrop } = require('./crop');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const offenders = [];
  for (const table of TABLES) {
    const { data, error } = await sb.from(table).select('id, image_crop').not('image_crop', 'is', null);
    expect(error).toBeNull();
    for (const row of data) {
      const parsed = parseImageCrop(row.image_crop);
      if (parsed === undefined) offenders.push({ table, id: row.id, stored: row.image_crop });
    }
  }
  expect(offenders).toEqual([]);
});
