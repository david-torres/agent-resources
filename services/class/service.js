const { normalizeClassInput } = require('./input');
const { AuthorizationError } = require('../../util/errors');
const { isSystem } = require('../../util/actor');
const { canManageClass, canMintUnlockCodes } = require('./policy');

const REQUIRED_REPOSITORY_METHODS = [
  'insertClass',
  'updateClass',
  'deleteClass',
  'saveClassPdfMetadata',
  'insertUnlockCodes',
  'fetchClassByIdAdmin'
];

const requireManageable = async (repo, actor, id) => {
  const { data: existing, error } = await repo.fetchClassByIdAdmin(id);
  if (error) return { existing: null, error };
  if (!existing) throw new AuthorizationError('Class not found', { reason: 'not_found' });
  if (!canManageClass(actor, existing)) throw new AuthorizationError('Not the class owner', { reason: 'not_owner' });
  return { existing, error: null };
};

/** Application boundary for class writes: load -> policy -> throw-or-mutate. */
class ClassService {
  constructor(repository) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`ClassService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
  }

  // No ownership check — the creator becomes the owner. created_by is
  // derived from the actor (not trusted from input) unless the actor is the
  // system actor, which is allowed to set an explicit owner (e.g. seeding).
  async createClass(actor, input) {
    const created_by = isSystem(actor) ? (input?.created_by ?? null) : (actor?.profileId ?? null);
    return this.repo.insertClass(normalizeClassInput({ ...input, created_by }));
  }

  async updateClass(actor, id, input) {
    const { error } = await requireManageable(this.repo, actor, id);
    if (error) return { data: null, error };
    return this.repo.updateClass(id, normalizeClassInput(input));
  }

  async deleteClass(actor, id) {
    const { error } = await requireManageable(this.repo, actor, id);
    if (error) return { error };
    return this.repo.deleteClass(id);
  }

  async savePdfMetadata(actor, classId, storagePath) {
    if (!classId) return { data: null, error: new Error('Missing class id') };
    const { error } = await requireManageable(this.repo, actor, classId);
    if (error) return { data: null, error };
    return this.repo.saveClassPdfMetadata(classId, {
      pdf_storage_path: storagePath || null,
      pdf_updated_at: storagePath ? new Date().toISOString() : null
    });
  }

  // rows are pre-built by the model (crypto-random codes, expiry, etc.);
  // this capability only gates who may mint them.
  async mintUnlockCodes(actor, rows) {
    if (!canMintUnlockCodes(actor)) {
      throw new AuthorizationError('Not authorized to mint unlock codes', { reason: 'not_admin' });
    }
    return this.repo.insertUnlockCodes(rows);
  }
}

module.exports = { ClassService };
