const moment = require('moment-timezone');
const { trimStrings } = require('../../util/trim-input');

const cloneInput = (input) => ({ ...(input || {}) });

/**
 * Convert an LFG form payload into a persistence row without modifying the
 * request object. Role selection remains separate because it is stored as a
 * join request rather than on lfg_posts.
 */
const normalizeLfgInput = (input, { creatorId, timezone } = {}) => {
  const data = trimStrings(cloneInput(input));
  const characterId = data.character || null;
  const hostFlag = data.host_id === 'on';
  delete data.character;
  delete data.host_id;
  delete data.creator_name;
  delete data.host_name;
  delete data.join_requests;

  if (creatorId) data.creator_id = creatorId;
  data.is_public = data.is_public === true || data.is_public === 'on';
  data.date = moment.tz(data.date, timezone).utc();

  return { data, role: { hostFlag, characterId } };
};

module.exports = { cloneInput, normalizeLfgInput };
