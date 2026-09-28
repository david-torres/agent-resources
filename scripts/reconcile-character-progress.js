// One-time audit for totals that predate mission-triggered recalculation.
// Default is read-only. Pass --apply only after reviewing the reported count.
const { supabaseAdmin } = require('../models/_base');
const characterRepository = require('../services/character/repository');
const { calculateCharacterProgress, recalculateCharacterProgress } = require('../services/character/progress');

const PAGE_SIZE = 500;
const fetchAll = async (table, columns, query = q => q) => {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(supabaseAdmin.from(table).select(columns))
      .order('id', { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
};

const groupByCharacter = rows => {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.character_id)) grouped.set(row.character_id, []);
    grouped.get(row.character_id).push(row);
  }
  return grouped;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) {
    throw new Error('Usage: bun scripts/reconcile-character-progress.js [--apply]');
  }
  const apply = args.includes('--apply');
  console.log(`Target: ${new URL(process.env.SUPABASE_URL).host} (${apply ? 'apply' : 'read-only'})`);

  const [characters, gear, links, offscreen, classes] = await Promise.all([
    fetchAll('characters', 'id, class_id, creator_mode, auto_calculate, common_items, aspiring_signatures, completed_missions, commissary_reward, level', q => q.eq('auto_calculate', true)),
    fetchAll('class_gear', 'id, character_id, class_id, name, enchantment, mods'),
    fetchAll('mission_characters', 'id, character_id, missions(outcome)'),
    fetchAll('offscreen_missions', 'id, character_id, merx_gained'),
    fetchAll('classes', 'id, rules_version, content_format')
  ]);

  const gearByCharacter = groupByCharacter(gear);
  const linksByCharacter = groupByCharacter(links);
  const offscreenByCharacter = groupByCharacter(offscreen);
  const classesById = new Map(classes.map(row => [row.id, row]));
  const stale = [];

  for (const character of characters) {
    const rules = classesById.get(character.class_id);
    const totals = calculateCharacterProgress({
      character: { ...character, gear: gearByCharacter.get(character.id) || [] },
      realMissions: (linksByCharacter.get(character.id) || []).map(row => row.missions).filter(Boolean),
      offscreenMissions: offscreenByCharacter.get(character.id) || [],
      classRules: { data: rules?.rules_version || 'v1', contentFormat: rules?.content_format || null }
    });
    if (Object.keys(totals).some(field => character[field] !== totals[field])) {
      stale.push({ id: character.id, current: {
        completed_missions: character.completed_missions,
        commissary_reward: character.commissary_reward,
        level: character.level
      }, totals });
    }
  }

  console.log(`${characters.length} automatic characters checked; ${stale.length} need refresh.`);
  for (const row of stale) {
    console.log(`${row.id}: ${JSON.stringify(row.current)} -> ${JSON.stringify(row.totals)}`);
  }
  if (!apply) return;

  // Re-read each affected character at write time, so a player edit during
  // the audit cannot be overwritten by the earlier snapshot above.
  for (const row of stale) {
    await recalculateCharacterProgress(row.id, characterRepository);
  }
  console.log(`Refreshed ${stale.length} characters.`);
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
