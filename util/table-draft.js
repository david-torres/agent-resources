// An unsaved table lives entirely in its ?c= (registered ids) and ?g=
// (unregistered characters) query string, so it works signed
// out and can be bookmarked before anyone saves it. Saving turns it into a
// game table (routes/tables.js POST /).
const { normalizeGuestInput, toDisplayMember } = require('../services/game-tables/policy');
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
  let guests;
  try { guests = JSON.parse(query.g || '[]'); } catch { return { error: { status: 400, message: 'Invalid unregistered characters.' } }; }
  if (!Array.isArray(guests) || guests.length > PARTY_CAP) return { error: { status: 400, message: 'Invalid unregistered characters.' } };
  const normalized = [];
  for (const guest of guests) {
    if (!guest || typeof guest !== 'object' || Array.isArray(guest)) return { error: { status: 400, message: 'Invalid unregistered character.' } };
    const result = normalizeGuestInput(guest);
    if (result.errors) return { error: { status: 400, message: result.errors.join(' ') } };
    normalized.push({ name: result.data.guest_name, class_label: result.data.guest_class_label, ...result.data.guest_stats });
  }
  // A new registered member must not evict an existing draft guest.
  const existing = parseMembership({ c: query.c });
  const adding = isValidUuid(String(query.add || '')) && !existing.ids.includes(query.add);
  const blockedAdd = adding && existing.ids.length + normalized.length >= PARTY_CAP;
  const { ids, droppedOverCap } = parseMembership(blockedAdd ? { ...query, add: undefined } : query);

  const { data: rows, error } = await loadCharacters(ids, client);
  if (error) return { error };

  // .in() makes no ordering promise; impose the URL's order.
  const byId = new Map((rows || []).map((row) => [row.id, row]));
  const members = ids.map((id) => byId.get(id)).filter(Boolean).map((row) => ({
    ...row, memberId: row.id, isGuest: false, canRemove: true, canViewDetails: true,
  }));

  const kept = normalized.filter((_, i) => String(i) !== String(query.removeGuest)).slice(0, PARTY_CAP - members.length);
  const unresolved = ids.length - members.length;
  const tableCsv = members.map((member) => member.id).join(',');
  members.push(...kept.map((guest, i) => ({
    ...toDisplayMember({ id: String(i), guest_name: guest.name, guest_class_label: guest.class_label, guest_stats: guest }),
    canRemove: true, canEdit: false,
  })));
  return {
    members,
    summary: summarizeParty(members),
    tableCsv,
    tableGuests: JSON.stringify(kept),
    droppedOverCap: droppedOverCap + Number(blockedAdd) + normalized.filter((_, i) => String(i) !== String(query.removeGuest)).length - kept.length,
    unresolved,
    privateCount: members.filter((member) => member.is_public === false).length,
  };
};

module.exports = { parseMembership, resolveDraft };
