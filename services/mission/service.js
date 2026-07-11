const { normalizeMissionInput } = require('./input');
const { AuthorizationError } = require('../../util/errors');
const { isSystem, isAdmin } = require('../../util/actor');
const { canEditMission: policyCanEdit, isMissionCreator: policyIsCreator } = require('./policy');

const REQUIRED_REPOSITORY_METHODS = [
  'getHost', 'createMissionRow', 'updateMissionRow', 'deleteMissionRow',
  'getMissionProfileIds', 'getCharacterCreator', 'upsertMissionCharacter',
  'deleteMissionCharacter', 'mergeMissions', 'getMission', 'recalcBadges',
  'updateUnregisteredNames', 'upsertEditor', 'deleteEditor',
  'fetchMissionPermissionRow', 'fetchEditorRow', 'fetchCreatorId'
];

const loadEditorRow = async (repo, missionId, actor) => {
  // System/admin never need the editor lookup — the policy already admits
  // them — and a bare profileId with no other relation gains nothing from it.
  if (!actor?.profileId || isSystem(actor) || isAdmin(actor)) return null;
  const { data } = await repo.fetchEditorRow({ missionId, profileId: actor.profileId });
  return data;
};

// Loads the permission row and throws unless the actor can edit (creator,
// host, editor, or admin/system). Returns the loaded mission row so callers
// don't have to fetch it twice (e.g. deleteMission's SQL safety filter).
const requireEditable = async (repo, actor, missionId) => {
  const { data: mission, error } = await repo.fetchMissionPermissionRow(missionId);
  if (error) throw error;
  if (!mission) throw new AuthorizationError('Mission not found', { reason: 'not_found' });
  const editorRow = await loadEditorRow(repo, missionId, actor);
  if (!policyCanEdit(actor, { mission, editorRow })) {
    throw new AuthorizationError('Not authorized to edit this mission', { reason: 'not_editor' });
  }
  return mission;
};

// Narrower than requireEditable: only the creator (or admin/system) passes.
const requireMissionCreator = async (repo, actor, missionId) => {
  const { data: mission, error } = await repo.fetchMissionPermissionRow(missionId);
  if (error) throw error;
  if (!mission) throw new AuthorizationError('Mission not found', { reason: 'not_found' });
  if (!policyIsCreator(actor, mission)) {
    throw new AuthorizationError('Not authorized: mission creator only', { reason: 'not_creator' });
  }
  return mission;
};

/** Coordinates mission writes, authorization, and badge side effects independently of Supabase. */
class MissionService {
  constructor(repository) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`MissionService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
  }

  // No ownership check — the creator becomes the owner. creator_id is
  // derived from the actor (not trusted from input) unless the actor is the
  // system actor, which is allowed to set an explicit creator (e.g. backfill
  // missions created on a user's behalf).
  async createMission(actor, input) {
    const creatorId = isSystem(actor) ? (input?.creator_id ?? null) : (actor?.profileId ?? null);
    const data = normalizeMissionInput(input, { creatorId });
    const result = await this.repo.createMissionRow(data);
    if (!result.error && data.host_id) await this.repo.recalcBadges([data.host_id]);
    return result;
  }

  async updateMission(actor, id, input) {
    await requireEditable(this.repo, actor, id);
    const existing = await this.repo.getHost(id);
    const data = normalizeMissionInput(input);
    const result = await this.repo.updateMissionRow(id, data);
    if (!result.error) await this.repo.recalcBadges([existing.data?.host_id, data.host_id]);
    return result;
  }

  async deleteMission(actor, id) {
    const mission = await requireMissionCreator(this.repo, actor, id);
    const affected = await this.repo.getMissionProfileIds(id);
    // The SQL filter (.eq('creator_id', ...)) is preserved as defense in
    // depth; use the loaded creator_id (not actor.profileId) so admin/system
    // deletions of another user's mission still match a row.
    const result = await this.repo.deleteMissionRow(id, mission.creator_id);
    if (!result.error) await this.repo.recalcBadges(affected);
    return result;
  }

  async addCharacter(actor, { missionId, characterId }) {
    await requireEditable(this.repo, actor, missionId);
    const result = await this.repo.upsertMissionCharacter(missionId, characterId);
    if (!result.error) await this.recalcCharacterCreator(characterId);
    return result;
  }

  async removeCharacter(actor, { missionId, characterId }) {
    await requireEditable(this.repo, actor, missionId);
    const result = await this.repo.deleteMissionCharacter(missionId, characterId);
    if (!result.error) await this.recalcCharacterCreator(characterId);
    return result;
  }

  async recalcCharacterCreator(characterId) {
    const character = await this.repo.getCharacterCreator(characterId);
    await this.repo.recalcBadges([character.data?.creator_id]);
  }

  async setUnregisteredNames(actor, missionId, names) {
    await requireEditable(this.repo, actor, missionId);
    const cleanedNames = (Array.isArray(names) ? names : [])
      .map(n => (typeof n === 'string' ? n.trim() : ''))
      .filter(n => n.length > 0);
    return this.repo.updateUnregisteredNames(missionId, cleanedNames);
  }

  async addEditor(actor, { missionId, profileId }) {
    await requireMissionCreator(this.repo, actor, missionId);
    return this.repo.upsertEditor({ mission_id: missionId, profile_id: profileId, added_by: actor?.profileId ?? null });
  }

  async removeEditor(actor, { missionId, profileId }) {
    await requireMissionCreator(this.repo, actor, missionId);
    return this.repo.deleteEditor({ missionId, profileId });
  }

  async mergeMissions(actor, primaryId, secondaryId) {
    await Promise.all([
      requireEditable(this.repo, actor, primaryId),
      requireEditable(this.repo, actor, secondaryId)
    ]);
    const affected = [
      ...(await this.repo.getMissionProfileIds(primaryId)),
      ...(await this.repo.getMissionProfileIds(secondaryId))
    ];
    const result = await this.repo.mergeMissions(primaryId, secondaryId, actor?.profileId ?? null);
    if (result.error) return { data: null, error: result.error };
    await this.repo.recalcBadges(affected);
    return this.repo.getMission(primaryId);
  }

  // Non-throwing compatibility checks for read/render call sites (e.g. "can
  // this profile see the edit page") that predate the throw-on-deny capabilities.
  async canEditMission(actor, missionId) {
    const { data: mission, error } = await this.repo.fetchMissionPermissionRow(missionId);
    if (error || !mission) return false;
    const editorRow = await loadEditorRow(this.repo, missionId, actor);
    return policyCanEdit(actor, { mission, editorRow });
  }

  async isCreator(actor, missionId) {
    const { data: mission, error } = await this.repo.fetchCreatorId(missionId);
    if (error || !mission) return false;
    return policyIsCreator(actor, mission);
  }
}

module.exports = { MissionService };
