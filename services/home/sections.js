const { getRecentCharactersByCreator, getRecentPublicCharacters } = require('../../models/character');
const { getRecentMissionsByCreator, getRecentPublicMissions } = require('../../models/mission');
const { getRecentClassesByCreator } = require('../../models/class');
const { getRecentNews } = require('../../models/pages');
const { getUpcomingForProfile } = require('../../models/lfg');
const { toFeedItem, mergeRecent } = require('./recent-feed');
const { buildExcerpt } = require('./excerpt');

const MINE_LIMIT = 6;
const COMMUNITY_LIMIT = 6;
const UPCOMING_LIMIT = 3;
const NEWS_LIMIT = 2;

const defaultDeps = {
  getRecentCharactersByCreator,
  getRecentPublicCharacters,
  getRecentMissionsByCreator,
  getRecentPublicMissions,
  getRecentClassesByCreator,
  getRecentNews,
  getUpcomingForProfile
};

// The homepage runs six independent reads. All-or-nothing failure would mean one
// sick table blanks the landing page, so each read is isolated: a rejection or an
// { error } response degrades that section to empty and the page still renders.
const settle = async (label, run) => {
  try {
    const { data, error } = await run();
    if (error) {
      console.error(`home section "${label}" failed:`, error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error(`home section "${label}" threw:`, err);
    return [];
  }
};

const loadHomeSections = async ({ profile, client }, deps = defaultDeps) => {
  const signedIn = Boolean(profile);

  const [
    myCharacters, myMissions, myClasses,
    upcomingGames, newsRows, publicCharacters, publicMissions
  ] = await Promise.all([
    signedIn ? settle('my-characters', () => deps.getRecentCharactersByCreator(profile.id, { limit: MINE_LIMIT }, client)) : [],
    signedIn ? settle('my-missions', () => deps.getRecentMissionsByCreator(profile.id, { limit: MINE_LIMIT }, client)) : [],
    signedIn ? settle('my-classes', () => deps.getRecentClassesByCreator(profile.id, { limit: MINE_LIMIT }, client)) : [],
    signedIn ? settle('upcoming-games', () => deps.getUpcomingForProfile(profile.id, { limit: UPCOMING_LIMIT }, client)) : [],
    settle('news', () => deps.getRecentNews({ limit: NEWS_LIMIT }, client)),
    settle('public-characters', () => deps.getRecentPublicCharacters({ limit: COMMUNITY_LIMIT, excludeProfileId: signedIn ? profile.id : null }, client)),
    settle('public-missions', () => deps.getRecentPublicMissions({ limit: COMMUNITY_LIMIT, excludeProfileId: signedIn ? profile.id : null }, client))
  ]);

  const asFeed = (type) => (rows) => rows.map(row => toFeedItem(type, row));

  return {
    // Read from myCharacters directly, not recentMine: recentMine merges
    // characters/missions/classes and truncates to MINE_LIMIT, so a player
    // with characters but 6+ more-recently-updated missions/classes could
    // have every character pushed out of that merged, truncated list. This
    // flag has to reflect "does the player have any characters", full stop.
    //
    // Boolean(...), not myCharacters.length > 0: for a signed-out visitor
    // myCharacters is already [] (never fetched), so this is false either
    // way, but the coercion keeps the field a real boolean rather than
    // depending on `[].length > 0` continuing to be truthy-safe.
    //
    // Caveat: settle() degrades a failed/thrown character query to [], same
    // as an empty result -- so if that one query fails, an established
    // player sees hasCharacters: false (and the get-started callout) for
    // that request. The pre-fix code had this exact failure mode too
    // (getOwnCharacters erroring also read as "no characters"), so this is
    // not a regression -- noted here so it's a known tradeoff, not a miss.
    hasCharacters: Boolean(myCharacters.length > 0),
    recentMine: mergeRecent([
      asFeed('character')(myCharacters),
      asFeed('mission')(myMissions),
      asFeed('class')(myClasses)
    ], MINE_LIMIT),
    upcomingGames,
    news: newsRows.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      created_at: row.created_at,
      excerpt: buildExcerpt(row.content)
    })),
    community: mergeRecent([
      asFeed('character')(publicCharacters),
      asFeed('mission')(publicMissions)
    ], COMMUNITY_LIMIT)
  };
};

module.exports = { loadHomeSections, defaultDeps };
