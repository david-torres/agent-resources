const auth = require('../models/auth');
const profile = require('../models/profile');
const character = require('../models/character');
const lfgPost = require('../models/lfg');
const mission = require('../models/mission');
const classModel = require('../models/class');

module.exports = {
  ...auth,
  ...profile,
  ...character,
  ...lfgPost,
  ...mission,
  ...classModel
};