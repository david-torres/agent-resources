const { AuthorizationError } = require('../../util/errors');
const { canMintRulesUnlockCodes } = require('./policy');

const REQUIRED_REPOSITORY_METHODS = [
  'insertUnlockCodes'
];

/** Application boundary for rules-PDF-unlock-code minting: policy ->
 * throw-or-mutate. The remaining privileged rules reads (admin unlock
 * listing, family-id resolution, active-unlock lookup) are pure reads with
 * no capability to gate; models/rules.js calls the repository for those
 * directly, mirroring services/class. */
class RulesService {
  constructor(repository) {
    const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function');
    if (missing.length) throw new TypeError(`RulesService requires repository methods: ${missing.join(', ')}`);
    this.repo = repository;
  }

  // rows are pre-built by the model (crypto-random codes, expiry, etc.);
  // this capability only gates who may mint them.
  async mintUnlockCodes(actor, rows) {
    if (!canMintRulesUnlockCodes(actor)) {
      throw new AuthorizationError('Not authorized to mint unlock codes', { reason: 'not_admin' });
    }
    return this.repo.insertUnlockCodes(rows);
  }
}

module.exports = { RulesService };
