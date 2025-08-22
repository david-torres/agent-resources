const { getUserFromToken, getProfile } = require('./supabase');

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

  const authToken = req.headers['authorization'].split(' ')[1];
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
    } else {
      res.locals.profile = null;
    }

    if (req.headers['redirect-to']) {
      const referer = new URL(req.headers['referer']).pathname;
      if (referer != req.headers['redirect-to']) {
        res.header('HX-Push-Url', req.headers['redirect-to']);
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

  const authToken = req.headers['authorization'].split(' ')[1];
  const refreshToken = req.headers['refresh-token'];
  const user = await getUserFromToken(authToken, refreshToken);
  res.locals.user = user;
  if (user) {
    res.locals.profile = await getProfile(user);
  } else {
    res.locals.profile = null;
  }
  if (req.headers['redirect-to']) {
    const referer = new URL(req.headers['referer']).pathname;
    if (referer != req.headers['redirect-to']) {
      res.header('HX-Push-Url', req.headers['redirect-to']);
    }
  }

  next();
}

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  if (!res.locals.user) {
      return res.status(401).json({ error: 'Not authenticated' });
  }

  const { data: profile, error } = await getUserProfile(res.locals.user.id);
  if (error || profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
  }

  next();
};
 
module.exports = { isAuthenticated, authOptional, requireAdmin };