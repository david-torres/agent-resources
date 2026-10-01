// Read-only report. This script intentionally has no apply/repair mode.
const { resolveCharacterMechanics, assertPublishedClassRules } = require('../util/character-rules');
const { calculateCharacterProgress } = require('../services/character/progress');
const { economyFor } = require('../util/merx-economy');
const { familyResolver } = require('../util/class-family');

const buildEditionMechanicsAudit = ({ classes, characters, links = [], offscreen = [], gear = [] }) => {
  const byId = new Map(classes.map(row => [row.id, row]));
  const targets = classes.filter(row => row.rules_edition === 'aspirant' && row.rules_version === 'v2');
  const errors = [];
  for (const row of classes) {
    try {
      assertPublishedClassRules(row);
      if (!['advent', 'aspirant'].includes(row.content_format)) throw new Error('Unsupported content format');
    } catch (error) { errors.push({ class_id: row.id, message: error.message }); }
  }
  const rows = characters.map(character => {
    const currentRules = character.class_id ? byId.get(character.class_id) : null;
    try {
      if (character.class_id && !currentRules) throw new Error('Linked class is unavailable');
      const proposedRules = currentRules?.rules_edition === 'aspirant' && currentRules.rules_version === 'v2'
        ? { ...currentRules, rules_version: 'v1' } : currentRules;
      const currentMechanics = resolveCharacterMechanics({ classRules: currentRules, creatorMode: character.creator_mode });
      const proposedMechanics = resolveCharacterMechanics({ classRules: proposedRules, creatorMode: character.creator_mode });
      const inputs = {
        character: { ...character, gear: gear.filter(row => row.character_id === character.id) },
        realMissions: links.filter(row => row.character_id === character.id).map(row => row.missions).filter(Boolean),
        offscreenMissions: offscreen.filter(row => row.character_id === character.id),
        classFamilyOf: familyResolver(classes, character.class_id)
      };
      const progress = rules => calculateCharacterProgress({ ...inputs,
        classRules: { data: rules, classRules: rules, contentFormat: rules?.content_format || null } });
      const current = progress(currentRules);
      const proposed = progress(proposedRules);
      return { character_id: character.id, class_id: character.class_id, auto_calculate: !!character.auto_calculate,
        creator_mode: character.creator_mode ?? null, currentMechanics, proposedMechanics,
        economy: economyFor({ contentFormat: currentRules?.content_format, creatorMode: character.creator_mode }),
        stored: { level: character.level, completed_missions: character.completed_missions, commissary_reward: character.commissary_reward },
        current, proposed, unchanged: currentMechanics === proposedMechanics && JSON.stringify(current) === JSON.stringify(proposed) };
    } catch (error) { return { character_id: character.id, class_id: character.class_id, error: error.message, unchanged: false }; }
  });
  return { read_only: true, classes: targets, characters: rows, errors,
    safe_metadata_change: errors.length === 0 && rows.every(row => row.unchanged) };
};

const main = async () => {
  if (process.argv.length > 2) throw new Error('Usage: bun scripts/audit-edition-mechanics.js (read-only; no flags)');
  const { fetchAll } = require('./lib/fetch-all');
  const [classes, characters, links, offscreen, gear] = await Promise.all([
    fetchAll('classes', 'id, name, rules_edition, rules_version, content_format, base_class_id, created_at, updated_at'),
    fetchAll('characters', 'id, class_id, creator_mode, auto_calculate, common_items, aspiring_signatures, completed_missions, commissary_reward, level'),
    fetchAll('mission_characters', 'id, character_id, missions(id, outcome, difficulty, danger)'),
    fetchAll('offscreen_missions', 'id, character_id, merx_gained'),
    fetchAll('class_gear', 'id, character_id, class_id, name, enchantment, mods')
  ]);
  const report = buildEditionMechanicsAudit({ classes, characters, links, offscreen, gear });
  console.log(JSON.stringify(report, null, 2));
  if (!report.safe_metadata_change) process.exitCode = 1;
};
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildEditionMechanicsAudit };
