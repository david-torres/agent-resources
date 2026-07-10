const { normalizeMissionInput } = require('./input');

const REQUIRED_ADAPTER_METHODS = [
  'canEdit', 'getHost', 'createMissionRow', 'updateMissionRow', 'deleteMissionRow',
  'getMissionProfileIds', 'getCharacterCreator', 'upsertMissionCharacter',
  'deleteMissionCharacter', 'mergeMissions', 'getMission', 'recalcBadges'
];

/** Coordinates mission writes and badge side effects independently of Supabase. */
class MissionService {
  constructor(adapter) {
    const missing = REQUIRED_ADAPTER_METHODS.filter(method => typeof adapter?.[method] !== 'function');
    if (missing.length) throw new TypeError(`MissionService requires adapter methods: ${missing.join(', ')}`);
    this.adapter = adapter;
  }

  async createMission(input, actor) {
    const data = normalizeMissionInput(input, { creatorId: actor.id });
    const result = await this.adapter.createMissionRow(data);
    if (!result.error && data.host_id) await this.adapter.recalcBadges([data.host_id]);
    return result;
  }

  async updateMission(id, input, actor) {
    if (!await this.adapter.canEdit(id, actor)) {
      return { data: null, error: 'Unauthorized: You do not have permission to edit this mission' };
    }
    const existing = await this.adapter.getHost(id);
    const data = normalizeMissionInput(input);
    const result = await this.adapter.updateMissionRow(id, data);
    if (!result.error) await this.adapter.recalcBadges([existing.data?.host_id, data.host_id]);
    return result;
  }

  async deleteMission(id, actor) {
    const affected = await this.adapter.getMissionProfileIds(id);
    const result = await this.adapter.deleteMissionRow(id, actor.id);
    if (!result.error) await this.adapter.recalcBadges(affected);
    return result;
  }

  async addCharacter(id, characterId) {
    const result = await this.adapter.upsertMissionCharacter(id, characterId);
    if (!result.error) await this.recalcCharacterCreator(characterId);
    return result;
  }

  async removeCharacter(id, characterId) {
    const result = await this.adapter.deleteMissionCharacter(id, characterId);
    if (!result.error) await this.recalcCharacterCreator(characterId);
    return result;
  }

  async recalcCharacterCreator(characterId) {
    const character = await this.adapter.getCharacterCreator(characterId);
    await this.adapter.recalcBadges([character.data?.creator_id]);
  }

  async mergeMissions(primaryId, secondaryId, actor) {
    const [canPrimary, canSecondary] = await Promise.all([
      this.adapter.canEdit(primaryId, actor), this.adapter.canEdit(secondaryId, actor)
    ]);
    if (!canPrimary || !canSecondary) {
      return { data: null, error: 'You must be able to edit both missions to merge them' };
    }
    const affected = [
      ...(await this.adapter.getMissionProfileIds(primaryId)),
      ...(await this.adapter.getMissionProfileIds(secondaryId))
    ];
    const result = await this.adapter.mergeMissions(primaryId, secondaryId, actor.id);
    if (result.error) return { data: null, error: result.error };
    await this.adapter.recalcBadges(affected);
    return this.adapter.getMission(primaryId);
  }
}

module.exports = { MissionService };
