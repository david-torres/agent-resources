const { STARTER_RULES_PDF_ID } = require('../../util/starter-content');
const { countCharactersByCreator } = require('../../models/character');
const { hasAnyGameActivity } = require('../../models/lfg');
const { listRulesPdfUnlocksForUser, getRulesPdfs } = require('../../models/rules');

const DAY_MS = 24 * 60 * 60 * 1000;

const defaultDeps = {
  countCharactersByCreator,
  hasAnyGameActivity,
  listRulesPdfUnlocksForUser,
  getRulesPdfs
};

// Same isolation contract as sections.js: a sick read degrades its own step
// to "not done" and the card still renders.
const settle = async (label, fallback, run) => {
  try {
    const { data, error } = await run();
    if (error) {
      console.error(`onboarding read "${label}" failed:`, error);
      return fallback;
    }
    return data;
  } catch (err) {
    console.error(`onboarding read "${label}" threw:`, err);
    return fallback;
  }
};

const viewHref = (id) => `/library/${id}/view`;

const hidden = (extra = {}) => ({
  show: false, askPath: false, persistDismiss: false, path: null,
  nameDone: false, learnDone: false, redeemDone: false,
  characterDone: false, gameDone: false, allDone: false,
  adventDaysLeft: null, adventHref: null, quickstartHref: null,
  ...extra
});

const computeOnboarding = ({ profile, hasCharacters, hasMissions, inGame, starterUnlock, freePdf, now }) => {
  const ob = profile.onboarding || {};
  const quickstartHref = freePdf ? viewHref(freePdf.id) : null;

  if (ob.dismissed) return hidden({ quickstartHref });

  const path = ob.path === 'new' || ob.path === 'veteran' ? ob.path : null;
  const askPath = !path;

  // The existing-account gate: never quiz a profile that plainly isn't new.
  if (askPath && (hasCharacters || hasMissions)) {
    return hidden({ persistDismiss: true, quickstartHref });
  }

  const expiresMs = starterUnlock?.expires_at ? Date.parse(starterUnlock.expires_at) : NaN;
  const adventDaysLeft = expiresMs > now.getTime()
    ? Math.ceil((expiresMs - now.getTime()) / DAY_MS)
    : null;

  const nameDone = profile.name !== `Agent #${profile.user_id}`;
  const learnDone = !!ob.read_rules;
  const redeemDone = !!ob.redeemed;
  const characterDone = !!hasCharacters;
  const gameDone = !!inGame;

  const allDone = !askPath && nameDone && characterDone && gameDone
    && (path === 'new' ? learnDone : redeemDone);

  return {
    show: true,
    askPath,
    persistDismiss: allDone, // "all set" renders once; the stored dismissal ends it
    path,
    nameDone, learnDone, redeemDone, characterDone, gameDone, allDone,
    adventDaysLeft,
    adventHref: adventDaysLeft ? viewHref(STARTER_RULES_PDF_ID) : null,
    quickstartHref
  };
};

const loadOnboarding = async ({ profile, client, hasCharacters, hasMissions, now = new Date() }, deps = defaultDeps) => {
  const findFreePdf = async () => {
    const rules = await settle('free-pdf', [], () => deps.getRulesPdfs({}));
    return rules.find(r => r.free_access && r.is_active) || null;
  };

  if (!profile) {
    const freePdf = await findFreePdf();
    return hidden({ quickstartHref: freePdf ? viewHref(freePdf.id) : null });
  }

  if (profile.onboarding?.dismissed) return hidden();

  const [resolvedHasCharacters, inGame, unlocks, freePdf] = await Promise.all([
    hasCharacters === undefined
      ? settle('character-count', 0, () => deps.countCharactersByCreator(profile.id, client)).then(n => n > 0)
      : hasCharacters,
    settle('game-activity', false, () => deps.hasAnyGameActivity(profile.id, client)),
    settle('starter-unlock', [], () => deps.listRulesPdfUnlocksForUser(profile.user_id, client)),
    findFreePdf()
  ]);

  return computeOnboarding({
    profile,
    hasCharacters: resolvedHasCharacters,
    hasMissions: hasMissions === undefined ? false : hasMissions,
    inGame,
    starterUnlock: unlocks.find(u => u.rules_pdf_id === STARTER_RULES_PDF_ID) || null,
    freePdf,
    now
  });
};

module.exports = { computeOnboarding, loadOnboarding, defaultDeps };
