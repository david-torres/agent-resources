const { createRemoteJWKSet, jwtVerify } = require('jose');

const ALGORITHMS = ['ES256', 'RS256'];

// Codes jose uses for a token that is simply not acceptable. Anything else
// (JWKS timeout, network failure) is an outage and must surface as a 500
// rather than telling the client to re-authenticate.
const INVALID_TOKEN_CODES = new Set([
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS'
]);

const oauthIssuer = () => `${(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/auth/v1`;

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const createOAuthTokenVerifier = ({ issuer, keys }) => async (token) => {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, { issuer, algorithms: ALGORITHMS }));
  } catch (err) {
    if (INVALID_TOKEN_CODES.has(err?.code)) return { ok: false };
    throw err;
  }
  // Website session JWTs share issuer and key with OAuth tokens; only an
  // OAuth grant stamps client_id.
  if (!isNonEmptyString(payload.client_id) || !isNonEmptyString(payload.sub)) return { ok: false };
  return { ok: true, claims: payload };
};

let defaultVerifier;
const verifyOAuthAccessToken = (token) => {
  if (!defaultVerifier) {
    const issuer = oauthIssuer();
    defaultVerifier = createOAuthTokenVerifier({
      issuer,
      keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
    });
  }
  return defaultVerifier(token);
};

module.exports = { oauthIssuer, createOAuthTokenVerifier, verifyOAuthAccessToken };
