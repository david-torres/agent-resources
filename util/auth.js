const { supabase, createUserClient } = require('../models/_base');
const { getUserFromToken } = require('../models/auth');
const { getProfile, getProfileByUserIdAdmin } = require('../models/profile');
const { getSystemMessage } = require('./system-message');
const { verifyOAuthAccessToken } = require('./oauth-token');
const { getPendingJoinRequestCount } = require('../models/lfg');
const { verifyAgentToken, AGENT_TOKEN_PREFIX } = require('../models/agent-token');
const { populateNavItems } = require('./nav-loader');

function isSameOriginPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  return true;
}

function safeRefererPath(refererHeader) {
  if (typeof refererHeader !== 'string' || refererHeader.length === 0) return null;
  try {
    return new URL(refererHeader).pathname;
  } catch {
    return null;
  }
}

// htmx re-fetches a URL whose history snapshot it no longer holds and swaps
// the response into <body> verbatim -- it never reads HX-Redirect on this
// path. Answering a restore the way an ordinary htmx request is answered
// (200, HX-Redirect, empty body) therefore paints a blank page at a
// correct-looking URL, recoverable only by a manual reload. Anything sent
// back here has to be renderable on its own.
const isHistoryRestore = (req) => req.get('HX-History-Restore-Request') === 'true';

const getBearerToken = (req) => {
  const header = req.headers['authorization'];
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) return null;
  return value;
};

async function isAuthenticated(req, res, next) {
  if (!req.headers['authorization']) {
    if (isHistoryRestore(req)) {
      return res.render('auth');
    }

    const headerRedirect = req.headers['redirect-to'];
    const redirectUrl = isSameOriginPath(headerRedirect) ? headerRedirect : req.originalUrl;
    const dest = (redirectUrl == '/auth' || redirectUrl == '/')
      ? '/auth/check'
      : `/auth/check?r=${encodeURIComponent(redirectUrl)}`;

    if (req.get('HX-Request')) {
      res.set('HX-Redirect', dest);
      return res.status(200).end();
    }
    return res.redirect(dest);
  }

  const authToken = getBearerToken(req);
  const user = await getUserFromToken(authToken);
  if (!user) {
    if (isHistoryRestore(req)) {
      return res.render('auth');
    }
    if (req.get('HX-Request')) {
      res.set('HX-Redirect', '/auth');
      return res.status(200).end();
    }
    return res.redirect('/auth');
  } else {
    res.locals.user = user;
    res.locals.supabase = createUserClient(authToken);
    if (user) {
      res.locals.profile = await getProfile(user);
      res.locals.systemMessage = getSystemMessage();
      if (res.locals.profile) {
        const { count } = await getPendingJoinRequestCount(res.locals.profile.id, res.locals.supabase);
        res.locals.pendingLfgRequests = count;
      }
    } else {
      res.locals.profile = null;
      res.locals.systemMessage = null;
    }

    await populateNavItems(req, res);

    const redirectTo = req.headers['redirect-to'];
    if (isSameOriginPath(redirectTo)) {
      const referer = safeRefererPath(req.headers['referer']);
      if (referer !== redirectTo) {
        res.header('HX-Push-Url', redirectTo);
      }
    }

    next();
  }
}

async function authOptional(req, res, next) {
  res.header('X-Auth-Optional', 'true');
  res.locals.authOptional = true;

  if (!req.headers['authorization']) {
    res.locals.supabase = supabase;
    next();
    return;
  }

  const authToken = getBearerToken(req);
  const user = await getUserFromToken(authToken);
  res.locals.user = user;
  res.locals.supabase = createUserClient(authToken);
  if (user) {
    res.locals.profile = await getProfile(user);
    res.locals.systemMessage = getSystemMessage();
    if (res.locals.profile) {
      const { count } = await getPendingJoinRequestCount(res.locals.profile.id, res.locals.supabase);
      res.locals.pendingLfgRequests = count;
    }
  } else {
    res.locals.profile = null;
    res.locals.systemMessage = null;
  }
  await populateNavItems(req, res);
  const redirectTo = req.headers['redirect-to'];
  if (isSameOriginPath(redirectTo)) {
    const referer = safeRefererPath(req.headers['referer']);
    if (referer !== redirectTo) {
      res.header('HX-Push-Url', redirectTo);
    }
  }

  next();
}

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  if (!res.locals.user || !res.locals.profile) {
      return res.status(401).json({ error: 'Not authenticated' });
  }

  if (res.locals.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
  }

  next();
};

const resolveAgentAuth = async (req) => {
  const headerToken = getBearerToken(req);
  const agentToken = req.headers['x-agent-token'] || (headerToken && headerToken.startsWith(AGENT_TOKEN_PREFIX) ? headerToken : null);

  if (!agentToken) {
    return { ok: false, status: 401, error: 'Missing agent token' };
  }

  const { data, error } = await verifyAgentToken(agentToken);
  if (error || !data?.profile) {
    return { ok: false, status: 401, error: 'Invalid agent token' };
  }

  return {
    ok: true,
    auth: {
      user: { id: data.userId },
      profile: data.profile,
      agentToken: { id: data.tokenId, name: data.tokenName, hint: data.tokenHint },
      supabase
    }
  };
};

const MCP_PROFILE_FIELDS = ['id', 'user_id', 'name', 'role', 'timezone'];
const PROFILE_NOT_FOUND = 'PGRST116';

const pickProfile = (profile) => Object.fromEntries(MCP_PROFILE_FIELDS.map((field) => [field, profile[field]]));

// MCP callers authenticate with either an agent token (routed to the
// existing agent-token path) or a Supabase OAuth access token (verified
// against the project's JWKS and mapped to the caller's profile).
const resolveMcpAuth = async (req) => {
  const bearer = getBearerToken(req);
  if (req.headers['x-agent-token'] || bearer?.startsWith(AGENT_TOKEN_PREFIX)) {
    const result = await resolveAgentAuth(req);
    return result.ok ? result : { ok: false, reason: 'invalid', error: result.error };
  }
  if (!bearer) return { ok: false, reason: 'missing', error: 'Missing access token' };

  const invalid = { ok: false, reason: 'invalid', error: 'Invalid access token' };
  const verified = await verifyOAuthAccessToken(bearer);
  if (!verified.ok) return invalid;

  const { sub, client_id: clientId } = verified.claims;
  const { data: profile, error } = await getProfileByUserIdAdmin(sub);
  if (error && error.code !== PROFILE_NOT_FOUND) throw error;
  if (!profile) return invalid;

  return {
    ok: true,
    auth: {
      user: { id: sub },
      profile: pickProfile(profile),
      agentToken: { type: 'oauth', client_id: clientId },
      supabase
    }
  };
};

const isAgentAuthenticated = async (req, res, next) => {
  const result = await resolveAgentAuth(req);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.locals.user = result.auth.user;
  res.locals.supabase = result.auth.supabase;
  res.locals.profile = result.auth.profile;
  res.locals.agentToken = result.auth.agentToken;

  next();
};

module.exports = { isAuthenticated, authOptional, requireAdmin, isAgentAuthenticated, resolveAgentAuth, resolveMcpAuth };
