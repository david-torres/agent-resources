// Moves characters already on the Aspirant rules onto their class's Aspirant
// version, when the owner has unlocked it. Default is read-only. Pass --apply
// only after reviewing the list.
const characterRepository = require('../services/character/repository');
const { fetchAll } = require('./lib/fetch-all');
const { findAspirantFork } = require('../util/class-family');
const { upgradeBuild, upgradeSaveArgs, duplicateAbilityBlockers } = require('../util/aspirant-conversion');

const describeItems = (items) => items
  .map(item => `${item.kind} ${item.name}${item.className ? ` (${item.className})` : ''}`)
  .join(', ') || 'none';

const upgradeConvertedCharacters = async ({ apply = false, characterIds = null, log = console.log } = {}) => {
  const [characters, classesResult] = await Promise.all([
    fetchAll('characters', 'id, name, class_id, creator_id, profile:creator_id(name)', (q) => {
      const converted = q.eq('creator_mode', 'aspirant');
      return characterIds ? converted.in('id', characterIds) : converted;
    }),
    characterRepository.getConversionClasses()
  ]);
  if (classesResult.error) throw new Error(`Failed to read classes: ${classesResult.error.message}`);
  const classes = classesResult.data;
  const classesById = new Map(classes.map(row => [row.id, row]));

  // Aspirant creation hides forked Advent classes (withoutForkedAdventClasses),
  // so an Aspirant character on one was converted, not created there.
  const selected = characters.filter((character) => {
    const own = classesById.get(character.class_id);
    return own && own.content_format === 'advent' && findAspirantFork(classes, own.id);
  });

  const accessByOwner = new Map();
  const accessibleClassIdsOf = async (profileId) => {
    if (!accessByOwner.has(profileId)) {
      const { data, error } = await characterRepository.getAccessibleClassIds(profileId);
      if (error) throw new Error(`Failed to read class access for ${profileId}: ${error.message}`);
      accessByOwner.set(profileId, data);
    }
    return accessByOwner.get(profileId);
  };

  const report = { candidates: [], applied: [], failed: [] };
  for (const summary of selected) {
    try {
      const { data: character, error } = await characterRepository.getCharacter(summary.id);
      if (error || !character) {
        report.failed.push({ id: summary.id, error: error ? error.message : 'not found' });
        log(`${summary.id}: could not be read (${error ? error.message : 'not found'})`);
        continue;
      }
      const upgrade = upgradeBuild({
        character,
        classes,
        gear: character.gear,
        abilities: character.abilities,
        abilityPerks: character.ability_perks,
        accessibleClassIds: await accessibleClassIdsOf(summary.creator_id)
      });
      if (!upgrade.target) {
        log(`${character.id} ${character.name}: skipped. Its owner has not unlocked the Aspirant version.`);
        continue;
      }
      const duplicates = duplicateAbilityBlockers({ character, abilities: upgrade.abilities ?? character.abilities });
      if (duplicates.length > 0) {
        const message = duplicates.map(blocker => blocker.detail).join(' ');
        report.failed.push({ id: character.id, error: message });
        log(`${character.id} ${character.name}: skipped. ${message}`);
        continue;
      }
      const candidate = {
        id: character.id,
        name: character.name,
        owner: summary.profile ? summary.profile.name : null,
        fromClass: classesById.get(character.class_id).name,
        toClass: upgrade.target.name,
        moved: upgrade.moved,
        kept: upgrade.kept
      };
      report.candidates.push(candidate);
      log(`${candidate.id} ${candidate.name} (owner ${candidate.owner}): ${candidate.fromClass} -> ${candidate.toClass}`
        + ` [${upgrade.target.id}]; moves: ${describeItems(upgrade.moved)}; stays: ${describeItems(upgrade.kept)}`);
      if (!apply) continue;

      const { error: saveError } = await characterRepository.saveCharacterAtomic(upgradeSaveArgs({ character, upgrade }));
      if (saveError) {
        report.failed.push({ id: character.id, error: saveError.message });
        log(`  failed: ${saveError.message}`);
      } else {
        report.applied.push(character.id);
      }
    } catch (thrown) {
      report.failed.push({ id: summary.id, error: thrown.message });
      log(`${summary.id}: failed (${thrown.message})`);
    }
  }

  log(`${selected.length} converted characters on a forked Advent class.`
    + (apply ? ` ${report.applied.length} upgraded, ${report.failed.length} failed.` : ' Read-only: nothing written.'));
  return report;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) {
    throw new Error('Usage: bun scripts/upgrade-converted-aspirant-classes.js [--apply]');
  }
  const apply = args.includes('--apply');
  console.log(`Target: ${new URL(process.env.SUPABASE_URL).host} (${apply ? 'apply' : 'read-only'})`);
  const report = await upgradeConvertedCharacters({ apply });
  if (report.failed.length > 0) process.exitCode = 1;
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { upgradeConvertedCharacters };
