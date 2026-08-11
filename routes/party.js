const express = require('express');
const router = express.Router();
const {
  getPartyCharacters,
  getOwnCharacters,
  searchPublicCharacters
} = require('../models/character');
const { authOptional } = require('../util/auth');
const { sendError } = require('../util/http-error');
const { isValidUuid } = require('../util/validate');
const { summarizeParty } = require('../util/party-stats');

// A party lives entirely in the ?c= query string — there is no parties table.
// The cap keeps the URL short, the breakdown table readable, and the .in()
// below trivially small.
const PARTY_CAP = 8;

// Turn ?c= (plus an optional add/remove) into the id list the party should
// now hold. Pure and synchronous so the resolve step below stays readable.
const parseMembership = (query) => {
  const requested = String(query.c || '')
    .split(',')
    .map(id => id.trim())
    .filter(isValidUuid);

  // Dedupe, preserving first-seen order — that order is the roster order.
  let ids = [...new Set(requested)];

  const add = String(query.add || '').trim();
  if (isValidUuid(add) && !ids.includes(add)) ids.push(add);

  const remove = String(query.remove || '').trim();
  if (isValidUuid(remove)) ids = ids.filter(id => id !== remove);

  const droppedOverCap = Math.max(0, ids.length - PARTY_CAP);
  return { ids: ids.slice(0, PARTY_CAP), droppedOverCap };
};

// Fetch the requested ids and build the render context. Anything RLS will not
// return simply does not come back, which is the whole visibility mechanism —
// see the comment on getPartyCharacters.
const resolveParty = async (query, client) => {
  const { ids, droppedOverCap } = parseMembership(query);

  const { data: rows, error } = await getPartyCharacters(ids, client);
  if (error) return { error };

  // .in() makes no ordering promise, so impose the URL's order rather than
  // letting the roster shuffle between requests.
  const byId = new Map((rows || []).map(row => [row.id, row]));
  const members = ids.map(id => byId.get(id)).filter(Boolean);

  return {
    members,
    summary: summarizeParty(members),
    partyCsv: members.map(member => member.id).join(','),
    droppedOverCap,
    unresolved: ids.length - members.length,
    privateCount: members.filter(member => member.is_public === false).length
  };
};

router.get('/', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const party = await resolveParty(req.query, res.locals.supabase);
  if (party.error) return sendError(req, res, party.error);

  // Signed-out visitors get the public search only. getOwnCharacters is
  // RLS-scoped, so this is the one place private characters enter the page.
  let ownCharacters = [];
  if (profile) {
    const { data } = await getOwnCharacters(profile, res.locals.supabase);
    ownCharacters = data || [];
  }

  res.render('party', {
    profile,
    ...party,
    ownCharacters,
    authOptional: true,
    activeNav: 'party',
    breadcrumbs: [{ label: 'Virtual Party', href: '/party' }]
  });
});

router.get('/panel', authOptional, async (req, res) => {
  const party = await resolveParty(req.query, res.locals.supabase);
  if (party.error) return sendError(req, res, party.error);

  // The panel owns membership, so the browser learns the new URL from the
  // response rather than from the request — the Add/Remove buttons cannot
  // know it in advance. Same header routes/lfg.js:99 uses.
  res.header('HX-Push-Url', `/party?c=${party.partyCsv}`);
  res.render('partials/party-panel', { layout: false, ...party });
});

router.get('/s', authOptional, async (req, res) => {
  // req.query.q can be an array or object (?q=a&q=b, ?q[x]=1) under Express's
  // extended query parser — coerce once, the same way parseMembership does
  // above, so a polluted q can neither throw here nor reach the model layer.
  const q = String(req.query.q || '').trim();
  const { classId } = req.query;
  const hasQuery = q.length >= 2;

  if (!hasQuery && !classId) {
    return res.render('partials/party-search-results', { layout: false, characters: [], q });
  }

  const options = {};
  if (classId) options.classId = classId;

  const { data: characters, error } = await searchPublicCharacters(hasQuery ? q : null, 12, options);
  if (error) return sendError(req, res, error);

  res.render('partials/party-search-results', { layout: false, characters, q });
});

module.exports = router;
