// Game tables: a saved roster of registered and unregistered characters that
// anyone with the link can view (docs/superpowers/specs/2026-10-08-game-tables-design.md).
// Rules live in services/game-tables; this router maps requests onto them and
// renders. Member changes answer with the #table-panel fragment.
const express = require('express');
const { authOptional, isAuthenticated } = require('../util/auth');
const { asyncHandler } = require('../util/async-handler');
const { sendError, sendRouteError } = require('../util/http-error');
const { isValidUuid } = require('../util/validate');
const { actorFromLocals } = require('../util/actor');
const { statList } = require('../util/enclave-consts');
const { PARTY_CAP } = require('../util/party-stats');
const { getOwnCharacters, getPartyCharacters, searchPublicCharacters } = require('../models/character');
const { gameTables } = require('../models/game-tables');
const { resolveDraft } = require('../util/table-draft');

const router = express.Router();

const ownCharactersFor = async (res) => {
  if (!res.locals.profile) return [];
  const { data } = await getOwnCharacters(res.locals.profile, res.locals.supabase);
  return data || [];
};

// Node rejects header values outside Latin-1, and class text is full of
// curly apostrophes; JSON allows \u escapes for exactly this.
const asciiJson = (value) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const isParticipantView = (view, profile) =>
  Boolean(profile) && (view.capabilities.canManage || view.members.some((m) => m.ownerId === profile.id));

const actionFrom = (body = {}) => ({
  type: String(body.type || ''),
  pool: body.pool === undefined ? undefined : String(body.pool),
  amount: body.amount === undefined ? undefined : String(body.amount),
  level: body.level === undefined ? undefined : String(body.level),
  source: body.source === undefined ? undefined : String(body.source),
  threshold: body.threshold === undefined ? undefined : Number(body.threshold),
  spent: body.spent === undefined ? undefined : Number(body.spent),
  kind: body.kind === undefined ? undefined : String(body.kind),
  rating: body.rating === undefined ? undefined : String(body.rating),
  index: body.index === undefined ? undefined : Number(body.index),
  version: body.version === undefined ? undefined : Number(body.version),
});

const renderTracker = (res, { tracker, tableId, member }) =>
  res.render('partials/table-tracker', { layout: false, tracker, tableId, memberId: member.memberId });

const panelContext = (view, profile, trackers) => ({
  draft: false,
  table: view.table,
  tableId: view.table.id,
  members: view.members,
  summary: view.summary,
  capabilities: view.capabilities,
  isFull: view.isFull,
  unseatedApproved: view.unseatedApproved,
  partyCap: PARTY_CAP,
  trackers: trackers ? Object.fromEntries(trackers) : {},
  profile,
  statList,
});

const renderPanel = async (res, view, { resetGuestForm = false } = {}) => {
  const { data: trackers, error } = await gameTables.trackers(view, actorFromLocals(res.locals));
  if (error) return sendRouteError(res.req, res, error);
  return res.render('partials/table-panel-update', {
    layout: false, ...panelContext(view, res.locals.profile, trackers), resetGuestForm,
  });
};

const validIds = (req, res, ...names) => {
  if (names.every((name) => isValidUuid(req.params[name]))) return true;
  sendError(req, res, null);
  return false;
};

router.get('/', authOptional, asyncHandler(async (req, res) => {
  const page = {
    profile: res.locals.profile,
    authOptional: true,
    noindex: true,
    activeNav: 'tables',
    breadcrumbs: [{ label: 'Game Tables', href: '/tables' }],
  };
  if (!res.locals.profile) return res.render('tables', { ...page, tables: [] });
  const { data, error } = await gameTables.listFor(res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  res.render('tables', { ...page, tables: data || [] });
}));

router.post('/', isAuthenticated, asyncHandler(async (req, res) => {
  // Only characters this viewer can see may be seated from a draft; RLS on
  // getPartyCharacters decides which those are.
  const requested = String(req.body.c || '').split(',').map((id) => id.trim()).filter(isValidUuid);
  const { data: visible, error: visibleError } = await getPartyCharacters(requested, res.locals.supabase);
  if (visibleError) return sendRouteError(req, res, visibleError);
  const visibleIds = new Set((visible || []).map((character) => character.id));

  const { data, error } = await gameTables.create(
    actorFromLocals(res.locals),
    { name: req.body.name, characterIds: requested.filter((id) => visibleIds.has(id)) },
    res.locals.supabase,
  );
  if (error && !data) return sendRouteError(req, res, error);
  res.header('HX-Location', `/tables/${data.id}`).send();
}));

router.get('/s', authOptional, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const tableId = isValidUuid(String(req.query.tableId || '')) ? String(req.query.tableId) : null;
  if (q.length < 2) {
    return res.render('partials/table-search-results', { layout: false, characters: [], q, tableId });
  }
  const { data: characters, error } = await searchPublicCharacters(q, 12, {});
  if (error) return sendRouteError(req, res, error);
  res.render('partials/table-search-results', { layout: false, characters, q, tableId });
}));

const draftContext = (draft, profile) => ({ draft: true, ...draft, partyCap: PARTY_CAP, profile, statList });

router.get('/new', authOptional, asyncHandler(async (req, res) => {
  const draft = await resolveDraft(req.query, res.locals.supabase);
  if (draft.error) return sendRouteError(req, res, draft.error);
  res.render('table', {
    ...draftContext(draft, res.locals.profile),
    ownCharacters: await ownCharactersFor(res),
    authOptional: true,
    noindex: true,
    activeNav: 'tables',
    breadcrumbs: [{ label: 'New Table', href: '/tables/new' }],
  });
}));

router.get('/new/panel', authOptional, asyncHandler(async (req, res) => {
  const draft = await resolveDraft(req.query, res.locals.supabase);
  if (draft.error) return sendRouteError(req, res, draft.error);
  // The panel owns draft membership, so the address bar learns the new URL
  // from the response.
  res.header('HX-Push-Url', `/tables/new?c=${draft.tableCsv}`);
  res.render('partials/table-panel-update', { layout: false, ...draftContext(draft, res.locals.profile) });
}));

router.get('/:id', authOptional, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { data: view, error } = await gameTables.load(req.params.id, actorFromLocals(res.locals));
  if (error) return sendRouteError(req, res, error);
  const { data: trackers, error: trackersError } = await gameTables.trackers(view, actorFromLocals(res.locals));
  if (trackersError) return sendRouteError(req, res, trackersError);
  res.render('table', {
    ...panelContext(view, res.locals.profile, trackers),
    liveMode: isParticipantView(view, res.locals.profile) ? 'realtime' : 'poll',
    ownCharacters: await ownCharactersFor(res),
    authOptional: true,
    noindex: true,
    activeNav: 'tables',
    breadcrumbs: [{ label: 'Game Tables', href: '/tables' }, { label: view.table.name, href: `/tables/${view.table.id}` }],
  });
}));

router.put('/:id', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { error } = await gameTables.rename(actorFromLocals(res.locals), req.params.id, req.body.name, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  res.header('HX-Refresh', 'true').send();
}));

router.delete('/:id', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { error } = await gameTables.destroy(actorFromLocals(res.locals), req.params.id, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  res.header('HX-Location', '/tables').send();
}));

router.post('/:id/members', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const characterId = String(req.body.character_id || '');
  if (!isValidUuid(characterId)) return sendError(req, res, null);
  const { data, error } = await gameTables.seatCharacter(actorFromLocals(res.locals), req.params.id, characterId, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  return renderPanel(res, data);
}));

router.delete('/:id/members/:memberId', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data, error } = await gameTables.removeMember(actorFromLocals(res.locals), req.params.id, req.params.memberId, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  return renderPanel(res, data);
}));

router.post('/:id/guests', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { data, error } = await gameTables.addGuest(actorFromLocals(res.locals), req.params.id, req.body, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  return renderPanel(res, data, { resetGuestForm: true });
}));

router.get('/:id/guests/new', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  res.render('partials/table-guest-form', { layout: false, tableId: req.params.id, statList });
}));

router.get('/:id/members/:memberId/edit', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data: guest, error } = await gameTables.guestFor(actorFromLocals(res.locals), req.params.id, req.params.memberId);
  if (error) return sendRouteError(req, res, error);
  res.render('partials/table-guest-form', { layout: false, tableId: req.params.id, guest, statList });
}));

router.put('/:id/members/:memberId', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data, error } = await gameTables.editGuest(actorFromLocals(res.locals), req.params.id, req.params.memberId, req.body, res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  return renderPanel(res, data, { resetGuestForm: true });
}));

router.get('/:id/members/:memberId/tracker', authOptional, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const sinceVersion = req.query.v === undefined ? undefined : Number(req.query.v);
  const { data, error } = await gameTables.tracker(actorFromLocals(res.locals), req.params.id, req.params.memberId, { sinceVersion });
  // An htmx poll of a removed member swaps in nothing, which also ends its polling.
  if (error && error.status === 404 && req.get('HX-Request')) return res.status(200).send('');
  if (error) return sendRouteError(req, res, error);
  if (data.unchanged) return res.status(204).send();
  renderTracker(res, data);
}));

router.post('/:id/members/:memberId/actions', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id', 'memberId')) return;
  const { data, error } = await gameTables.act(
    actorFromLocals(res.locals), req.params.id, req.params.memberId, actionFrom(req.body), res.locals.supabase);
  if (error) return sendRouteError(req, res, error);
  res.header('HX-Trigger', asciiJson({
    trackerActed: { memberId: data.member.memberId, actionUrl: data.tracker.actionUrl, ...data.acted },
  }));
  renderTracker(res, data);
}));

router.post('/:id/session', isAuthenticated, asyncHandler(async (req, res) => {
  if (!validIds(req, res, 'id')) return;
  const { error } = await gameTables.newSession(actorFromLocals(res.locals), req.params.id);
  if (error) return sendRouteError(req, res, error);
  res.header('HX-Refresh', 'true').send();
}));

// /party became the draft table; old links and bookmarks keep their roster.
router.partyRedirect = (req, res) => {
  const csv = String(req.query.c || '');
  res.redirect(301, csv ? `/tables/new?c=${encodeURIComponent(csv)}` : '/tables/new');
};

module.exports = router;
