const { AuthorizationError } = require('../../util/errors');
const { canMutateOwnProfile } = require('./policy');
const { sanitizeUrlFields } = require('../../util/url');

const REQUIRED_REPOSITORY_METHODS = [
  'fetchOwnProfile',
  'fetchProfileByIdAdmin',
  'fetchProfileByNameAdmin',
  'searchProfilesAdmin',
  'insertProfile',
  'updateAuthUser',
  'updateProfileByUserId',
  'updateDiscord'
];

const requireSelf = (actor, targetUserId) => {
  if (!canMutateOwnProfile(actor, targetUserId)) {
    throw new AuthorizationError('Not authorized to modify this profile', { reason: 'not_self' });
  }
};

/** Application boundary for profile writes: policy -> throw-or-mutate. All
 * profile mutations act on a single user's own record (self, or admin/system
 * acting on behalf of a user). */
class ProfileService {
  constructor(repository) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`ProfileService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
  }

  async updateUser(actor, userId, email, password, fields) {
    requireSelf(actor, userId);

    if (password === '') password = null;
    const attrs = {};
    if (email) attrs.email = email;
    if (password) attrs.password = password;

    if (attrs.email || attrs.password) {
      const { error } = await this.repo.updateAuthUser(userId, attrs);
      if (error) return { data: null, error };
    }

    sanitizeUrlFields(fields, ['image_url']);
    return this.repo.updateProfileByUserId(userId, fields);
  }

  async setDiscordId(actor, userId, discordId, discordEmail = null) {
    requireSelf(actor, userId);
    return this.repo.updateDiscord(userId, discordId, discordEmail);
  }

  // Self-provisioning: called on first sign-in (PGRST116 on the self-read).
  // The system actor drives this on behalf of the just-verified user.
  async createProfileForUser(actor, user) {
    requireSelf(actor, user.id);
    return this.repo.insertProfile({ user_id: user.id, name: `Agent #${user.id}`, role: 'user' });
  }
}

module.exports = { ProfileService };
