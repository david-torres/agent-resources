const { AuthorizationError } = require('../../util/errors');
const { canGrantBadge, canRevokeBadge } = require('./policy');

const REQUIRED_REPOSITORY_METHODS = [
  'fetchGrantableBadgeBySlug',
  'upsertGrantedBadge',
  'deleteProfileBadge'
];

// Milestone badges are automatic-only: enforced here (the authoritative
// gate), not just in the routes. This is a domain rule about which badges
// are grantable at all, independent of who is asking — not a policy
// predicate, so it lives in the service rather than policy.js.
const findGrantableBadge = async (repo, badgeSlug) => {
  const { data: badgeRow, error } = await repo.fetchGrantableBadgeBySlug(badgeSlug);
  if (error) return { data: null, error };
  if (!badgeRow || !badgeRow.is_active) {
    return { data: null, error: new Error('Badge not found') };
  }
  if (badgeRow.category === 'milestone') {
    return { data: null, error: new Error('Milestone badges are awarded automatically and cannot be granted or revoked') };
  }
  return { data: badgeRow, error: null };
};

/** Application boundary for badge grant/revoke: policy -> domain guard ->
 * throw-or-mutate. Milestone recalculation is system-by-construction (no
 * user authorization exists for it) and never routes through this service —
 * models/badge.js calls the repository directly for that, mirroring
 * services/rules. */
class BadgeService {
  constructor(repository) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`BadgeService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
  }

  async grantBadge(actor, { profileId, badgeSlug, grantedById }) {
    if (!canGrantBadge(actor)) {
      throw new AuthorizationError('Not authorized to grant badges', { reason: 'not_admin' });
    }
    const { data: badgeRow, error } = await findGrantableBadge(this.repo, badgeSlug);
    if (error) return { data: null, error };

    const { error: upsertError } = await this.repo.upsertGrantedBadge({
      profile_id: profileId,
      badge_id: badgeRow.id,
      granted_by: grantedById || null
    });
    if (upsertError) return { data: null, error: upsertError };
    return { data: { slug: badgeRow.slug }, error: null };
  }

  // Revoking a badge the profile doesn't hold deletes 0 rows — no-op success.
  async revokeBadge(actor, { profileId, badgeSlug }) {
    if (!canRevokeBadge(actor)) {
      throw new AuthorizationError('Not authorized to revoke badges', { reason: 'not_admin' });
    }
    const { data: badgeRow, error } = await findGrantableBadge(this.repo, badgeSlug);
    if (error) return { data: null, error };

    const { error: deleteError } = await this.repo.deleteProfileBadge({ profileId, badgeId: badgeRow.id });
    if (deleteError) return { data: null, error: deleteError };
    return { data: { slug: badgeRow.slug }, error: null };
  }
}

module.exports = { BadgeService };
