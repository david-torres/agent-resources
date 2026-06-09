require('../util/env');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TARGET_EMAIL = 'scakah@gmx.de';

(async () => {
  // 1. Find the user by email via the admin auth API.
  const { data: { users }, error: userErr } = await supabase.auth.admin.listUsers();
  if (userErr) {
    console.error('listUsers error:', userErr.message);
    process.exit(1);
  }
  const user = users.find((u) => (u.email || '').toLowerCase() === TARGET_EMAIL.toLowerCase());
  if (!user) {
    console.error('No user found with email', TARGET_EMAIL);
    process.exit(1);
  }
  console.log('Found user:', user.id, user.email);

  // 2. Fetch every class id.
  const { data: classes, error: classErr } = await supabase
    .from('classes')
    .select('id, name');
  if (classErr) {
    console.error('classes error:', classErr.message);
    process.exit(1);
  }
  console.log('Found', classes.length, 'classes');

  // 3. Skip classes the user already has an unlock for.
  const { data: existing, error: existingErr } = await supabase
    .from('class_unlocks')
    .select('class_id')
    .eq('user_id', user.id);
  if (existingErr) {
    console.error('existing unlocks error:', existingErr.message);
    process.exit(1);
  }
  const alreadyUnlocked = new Set((existing || []).map((r) => r.class_id));
  const toInsert = classes.filter((c) => !alreadyUnlocked.has(c.id));
  console.log('Already unlocked:', alreadyUnlocked.size, '· to insert:', toInsert.length);

  if (toInsert.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // 4. Insert unlocks. Split into chunks to stay under URL/header limits.
  const rows = toInsert.map((c) => ({ user_id: user.id, class_id: c.id }));
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error: insErr } = await supabase.from('class_unlocks').insert(batch);
    if (insErr) {
      console.error('insert error at chunk', i, ':', insErr.message);
      process.exit(1);
    }
    console.log('Inserted', batch.length, 'unlocks (', i + batch.length, '/', rows.length, ')');
  }

  console.log('Done. Unlocked all classes for', TARGET_EMAIL);
})();
