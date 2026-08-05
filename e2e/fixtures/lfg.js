require('../../util/env');
const { supabaseAdmin } = require('../../models/_base');
const { createLfgPost, joinLfgPost, updateJoinRequest } = require('../../models/lfg');
const { actorFromProfile } = require('../../util/actor');

// THE TRAP THIS MODULE EXISTS TO CLOSE — read before writing an LFG fixture.
//
// `lfg_posts.host_id` is a DENORMALIZED column, not the source of truth.
// models/lfg.js#applyConduitMeta runs on the way out of every read
// (getLfgPost, getLfgPosts, getLfgPostsByCreator, getLfgJoinedPosts, ...) and
// OVERWRITES `post.host_id` from the post's join_requests: it is the profile of
// the one request with `status: 'approved'` AND `join_type: 'conduit'`, or
// `null` if there is none. A row inserted with `host_id: <someone>` and no such
// join request therefore reads back as `host_id: null`, and every template
// branch keyed on it — `(eq post.host_id profile.id)` in lfg-form.handlebars,
// `{{#if post.host_id}}disabled{{/if}}` in lfg-join-form.handlebars, the
// "Conduit needed" tag — takes the WRONG side, silently.
//
// Measured, not assumed: a raw `insert({ ..., host_id: admin.id })` (the shape
// the Task 15 plan proposed) renders the edit form as
// `x-data="{ hosting: false }"` with the checkbox UNCHECKED for the very
// profile named in the column. That is a fixture bug that looks exactly like a
// product bug.
//
// This is deliberate product behaviour, not a defect and not a refactor
// regression: commit cdb2acf, "Make approved conduit join_requests the source
// of truth for lfg_posts.host_id", introduced applyConduitMeta in the same
// change, and services/lfg/service.js#syncConduitHostId writes the column back
// from the same join request after every moderation.
//
// So: everything here goes through the real service seam (the same one
// routes/lfg.js calls), exactly as e2e/fixtures/character.js does, rather than
// raw inserts — that is the only way a fixture cannot drift from what the app
// itself writes.

// Creates a post through services/lfg's createPost. `hosting: true` posts the
// form's own `host_id: 'on'` checkbox value, which reconcileCreatorRole turns
// into an AUTO-APPROVED conduit join request for the creator (service.js:186 —
// a joiner who is the post's creator is approved immediately) and then
// syncConduitHostId denormalizes onto the column. That is precisely the state
// a real "I will Conduit this game" tick produces.
const seedLfgPost = async (prefix, creatorProfile, {
  title = `${prefix}-post`,
  description = 'Fixture LFG post',
  // A local-time string, because normalizeLfgInput runs it through
  // `moment.tz(date, timezone)` exactly as the datetime-local input's value
  // would arrive from the browser.
  date = '2027-01-01T18:00',
  maxCharacters = 4,
  isPublic = true,
  hosting = false
} = {}) => {
  const actor = { ...actorFromProfile(creatorProfile), timezone: creatorProfile.timezone || 'UTC' };
  const input = {
    title,
    description,
    date,
    max_characters: maxCharacters,
    // The checkbox serialisation the real form produces: present-and-'on' when
    // ticked, absent when not (services/lfg/input.js:20-21 tests for exactly
    // that, and `false` would be truthy-present in a real form body).
    ...(isPublic ? { is_public: 'on' } : {}),
    ...(hosting ? { host_id: 'on' } : {})
  };
  const { data, error } = await createLfgPost(actor, input);
  if (error) throw new Error(`seedLfgPost(${title}): ${JSON.stringify(error)}`);
  return data;
};

// A join request from someone who is NOT the post's creator, i.e. one that
// lands `pending` and needs moderating. `supabaseAdmin` is passed as the
// character-ownership client on purpose: joinLfgPost's default is the ANON
// singleton, which sees a character only if RLS lets it, so a private fixture
// character would fail the read and report as "You can only join with your own
// character" rather than as a fixture problem.
const seedJoinRequest = async (post, joinerProfile, {
  joinType = 'player',
  characterId = null,
  approveAs = null
} = {}) => {
  const { data, error } = await joinLfgPost(post.id, joinerProfile.id, joinType, characterId, supabaseAdmin);
  if (error) throw new Error(`seedJoinRequest(${post.title}): ${JSON.stringify(error)}`);
  const request = Array.isArray(data) ? data[0] : data;
  if (approveAs) {
    const { error: approveError } = await updateJoinRequest(
      actorFromProfile(approveAs), request.id, 'approved', post.id
    );
    if (approveError) throw new Error(`approve(${request.id}): ${JSON.stringify(approveError)}`);
  }
  return request;
};

module.exports = { seedLfgPost, seedJoinRequest };
