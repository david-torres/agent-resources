const { getUserFromToken, getProfile } = require('./supabase');
const { getSystemMessage } = require('./system-message');
const { getPendingJoinRequestCount } = require('../models/lfg');
const { verifyAgentToken, AGENT_TOKEN_PREFIX } = require('../models/agent-token');
const { createUserClient } = require('../models/_base');

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

const getBearerToken = (req) => {
  const header = req.headers['authorization'];
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) return null;
  return value;
};

async function isAuthenticated(req, res, next) {
  if (!req.headers['authorization']) {
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
    if (req.get('HX-Request')) {
      res.set('HX-Redirect', '/auth');
      return res.status(200).end();
    }
    return res.redirect('/auth');
  } else {
    res.locals.user = user;
    res.locals.supabaseUser = createUserClient(authToken);
    if (user) {
      res.locals.profile = await getProfile(user);
      res.locals.systemMessage = getSystemMessage();
      if (res.locals.profile) {
        const { count } = await getPendingJoinRequestCount(res.locals.profile.id);
        res.locals.pendingLfgRequests = count;
      }
    } else {
      res.locals.profile = null;
      res.locals.systemMessage = null;
    }

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
    next();
    return;
  }

  const authToken = getBearerToken(req);
  const user = await getUserFromToken(authToken);
  res.locals.user = user;
  res.locals.supabaseUser = createUserClient(authToken);
  if (user) {
    res.locals.profile = await getProfile(user);
    res.locals.systemMessage = getSystemMessage();
    if (res.locals.profile) {
      const { count } = await getPendingJoinRequestCount(res.locals.profile.id);
      res.locals.pendingLfgRequests = count;
    }
  } else {
    res.locals.profile = null;
    res.locals.systemMessage = null;
  }
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

const isAgentAuthenticated = async (req, res, next) => {
  const headerToken = getBearerToken(req);
  const agentToken = req.headers['x-agent-token'] || (headerToken && headerToken.startsWith(AGENT_TOKEN_PREFIX) ? headerToken : null);

  if (!agentToken) {
    return res.status(401).json({ error: 'Missing agent token' });
  }

  const { data, error } = await verifyAgentToken(agentToken);
  if (error || !data?.profile) {
    return res.status(401).json({ error: 'Invalid agent token' });
  }

  res.locals.user = { id: data.userId };
  res.locals.profile = data.profile;
  res.locals.agentToken = {
    id: data.tokenId,
    name: data.tokenName,
    hint: data.tokenHint
  };

  next();
};
 
module.exports = { isAuthenticated, authOptional, requireAdmin, isAgentAuthenticated };
