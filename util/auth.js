const { getUserFromToken, getProfile } = require('./supabase');

async function isAuthenticated(req, res, next) {
  if (!req.headers['authorization']) {
    const redirectUrl = req.headers['redirect-to'] || req.originalUrl;
    if (redirectUrl == '/auth' || redirectUrl == '/') {
      res.redirect('/auth/check');
      return;
    }
    res.redirect(`/auth/check?r=${encodeURIComponent(redirectUrl)}`);
    return;
  }

  const authToken = req.headers['authorization'].split(' ')[1];
  const refreshToken = req.headers['refresh-token'];
  const user = await getUserFromToken(authToken, refreshToken);
  if (!user) {
    res.redirect('/auth');
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
 
module.exports = { isAuthenticated, authOptional };