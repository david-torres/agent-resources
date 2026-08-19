// "Log this game": turning a played LFG post into a pre-filled mission draft.
//
// Nothing here writes. buildMissionDraft returns a plain object shaped like the
// `mission` context views/mission-form.handlebars already renders, so the log
// starts as an ordinary new-mission form the Conduit can edit before saving.

// Only approved join requests describe who actually played. Pending and
// rejected requests are people who asked; a request with no character is
// either the Conduit's own (join_type 'conduit') or a player whose character
// row was deleted -- lfg_join_requests_character_id_fkey is ON DELETE SET NULL.
const approvedParty = (post) => (post?.join_requests || [])
  .filter(request => request.status === 'approved' && request.character)
  .map(request => request.character);

// The post creator organized the game and the approved Conduit ran it; either
// is entitled to write its log. host_id is trustworthy here because getLfgPost
// re-derives it from the approved conduit join request before returning.
const canLogGame = (post, profileId, now = new Date()) => {
  if (!post || !profileId || !post.date) return false;
  if (new Date(post.date) > now) return false;
  return post.creator_id === profileId || post.host_id === profileId;
};

const buildMissionDraft = (post) => ({
  name: post.title,
  date: post.date,
  // `host` drives the form's resolved-Conduit display; `host_name` is the
  // free-text fallback the form posts when no profile is linked.
  host: post.host_id ? { id: post.host_id, name: post.host_name } : null,
  host_name: post.host_name || '',
  lfg_post_id: post.id,
  characters: approvedParty(post)
});

module.exports = { canLogGame, buildMissionDraft, approvedParty };
