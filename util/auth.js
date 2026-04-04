const { getUserFromToken, getProfile } = require('./supabase');
const { getSystemMessage } = require('./system-message');
const { getPendingJoinRequestCount } = require('../models/lfg');
const { loadNavItems } = require('./nav-loader');
const { verifyAgentToken, AGENT_TOKEN_PREFIX } = require('../models/agent-token');

const getBearerToken = (req) => {
  const header = req.headers['authorization'];
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme !== 'Bearer' || !value) return null;
  return value;
};

async function isAuthenticated(req, res, next) {
  if (!req.headers['authorization']) {
    const redirectUrl = req.headers['redirect-to'] || req.originalUrl;
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
  const refreshToken = req.headers['refresh-token'];
  const user = await getUserFromToken(authToken, refreshToken);
  if (!user) {
    if (req.get('HX-Request')) {
      res.set('HX-Redirect', '/auth');
      return res.status(200).end();
    }
    return res.redirect('/auth');
  } else {
    res.locals.user = user;
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

    if (req.headers['redirect-to']) {
      const referer = new URL(req.headers['referer']).pathname;
      if (referer != req.headers['redirect-to']) {
        res.header('HX-Push-Url', req.headers['redirect-to']);
      }
    }

    // Load nav items after user/profile is set
    await loadNavItems(req, res, () => {});
    next();
  }
}

async function authOptional(req, res, next) {
  res.header('X-Auth-Optional', 'true');
  res.locals.authOptional = true;

  if (!req.headers['authorization']) {
    // Load nav items even without auth
    await loadNavItems(req, res, () => {});
    next();
    return;
  }

  const authToken = getBearerToken(req);
  const refreshToken = req.headers['refresh-token'];
  const user = await getUserFromToken(authToken, refreshToken);
  res.locals.user = user;
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
  if (req.headers['redirect-to']) {
    const referer = new URL(req.headers['referer']).pathname;
    if (referer != req.headers['redirect-to']) {
      res.header('HX-Push-Url', req.headers['redirect-to']);
    }
  }

  // Load nav items after user/profile is set (or not set)
  await loadNavItems(req, res, () => {});
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
