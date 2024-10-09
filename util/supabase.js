const auth = require('../models/auth');
const profile = require('../models/profile');
const character = require('../models/character');
const lfgPost = require('../models/lfg');

module.exports = {
  ...auth,
  ...profile,
  ...character,
  ...lfgPost
};