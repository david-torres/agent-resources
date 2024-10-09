const { getUserFromToken } = require('./supabase');

async function isAuthenticated(req, res, next) {
  if (!req.headers['authorization']) {
    res.redirect('/auth');
    return;
  }

  const authToken = req.headers['authorization'].split(' ')[1];
  const refreshToken = req.headers['refresh-token'];
  const user = await getUserFromToken(authToken, refreshToken);
  if (!user) {
    res.redirect('/auth');
  } else {
    res.locals.user = user;
    next();
  }
}

module.exports = { isAuthenticated };