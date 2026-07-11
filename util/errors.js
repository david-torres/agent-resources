class AuthorizationError extends Error {
  constructor(message = 'Not authorized', { reason = null } = {}) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = 'forbidden';
    this.status = 403;
    if (reason) this.reason = reason;
  }
}

module.exports = { AuthorizationError };
