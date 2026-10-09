// An unsaved table lives entirely in its ?c= query string, so it works signed
// out and can be bookmarked before anyone saves it. Saving turns it into a
// game table (routes/tables.js POST /).
const { getPartyCharacters } = require('../models/character');
const { isValidUuid } = require('./validate');
const { summarizeParty, PARTY_CAP } = require('./party-stats');

const parseMembership = (query) => {
  const requested = String(query.c || '')
    .split(',')
    .map((id) => id.trim())
    .filter(isValidUuid);

  // Dedupe, preserving first-seen order: that order is the roster order.
  let ids = [...new Set(requested)];

  const add = String(query.add || '').trim();
  if (isValidUuid(add) && !ids.includes(add)) ids.push(add);

  const remove = String(query.remove || '').trim();
  if (isValidUuid(remove)) ids = ids.filter((id) => id !== remove);

  const droppedOverCap = Math.max(0, ids.length - PARTY_CAP);
  return { ids: ids.slice(0, PARTY_CAP), droppedOverCap };
};

// Anything RLS will not return simply does not come back -- that is the whole
// visibility mechanism for a draft (see getPartyCharacters).
const resolveDraft = async (query, client, loadCharacters = getPartyCharacters) => {
  const { ids, droppedOverCap } = parseMembership(query);

  const { data: rows, error } = await loadCharacters(ids, client);
  if (error) return { error };

  // .in() makes no ordering promise; impose the URL's order.
  const byId = new Map((rows || []).map((row) => [row.id, row]));
  const members = ids.map((id) => byId.get(id)).filter(Boolean).map((row) => ({
    ...row, memberId: row.id, isGuest: false, canRemove: true, canViewDetails: true,
  }));

  return {
    members,
    summary: summarizeParty(members),
    tableCsv: members.map((member) => member.id).join(','),
    droppedOverCap,
    unresolved: ids.length - members.length,
    privateCount: members.filter((member) => member.is_public === false).length,
  };
};

module.exports = { parseMembership, resolveDraft };
