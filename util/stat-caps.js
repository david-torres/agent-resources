// The single definition of every Stat Cap and plus-allotment figure ENCLAVE:
// Aspirant V1 states, and all the arithmetic over them.
//
// Deliberately require-free, exactly like util/merx-economy.js: this module is
// pure arithmetic over values its callers hand it, so it can be read in one
// sitting and tested without a database, a class row or a request.
//
// Page numbers are PRINTED pages of ENCLAVE: Aspirant V1 (the PDF page is the
// printed page plus five). Where a figure is stated on two pages, both are
// cited -- this project has twice cited one page for a rule the book states
// twice.

// A Stat's Cap is not a constant under Aspirant. It starts here (pg. 3,
// restated pg. 6) and rises with Traits and purchases; pg. 3's "Scaling
// Beyond" sidebar states there is no theoretical maximum, which is why no
// upper bound appears in this module or in a CHECK constraint.
const BASE_STAT_CAP = 5;

// During creation no Stat may exceed +++ counting EVERY source -- the class
// spread and the third Trait's grant included, not just what the player
// assigned (Advent pg. 16 step 4c, carried unchanged by Aspirant pg. 3).
const CREATION_STAT_CAP = 3;

// pg. 3: two pluses buy +1 Cap. A third is then needed to fill it, which is
// why buying a Cap is a poor deal unless the Stat is already at its ceiling.
const CAP_INCREASE_PLUS_COST = 2;

// Total pluses at creation, before level growth.
//
// `advent` records 6 because 6 is the true Advent figure and the wizard uses
// it. Whether a save is held to it is a decision for whatever validates the
// save, not for this module; recording a false value here to signal
// "unenforced" would be a lie in the one place that exists to be
// authoritative. SIGNATURE_CAP.advent in util/merx-economy.js is null for a
// different reason that looks similar: Advent has no such cap at all, so null
// is the true figure there.
const CREATION_PLUSES = { advent: 6, aspirant: 6, aspiring: 4 };

const LEVEL_PLUSES_PER_LEVEL = 2;

// pg. 110: Flavor cannot grant "a fourth Personality Trait", so three is a
// hard ceiling rather than a starting number. All 981 live trait rows already
// sit at exactly three per character.
const TRAIT_COUNT = 3;

// NOT a rules figure. The pre-existing [0, 20] clamp in
// services/character/input.js normalizeStatsPayload needs a name rather than a
// literal, and it is a guard against a runaway request body, not the Cap. The
// Cap is statCapFor below, and it is what refuses an illegal build.
const STAT_SANITY_BOUND = 20;

// pg. 3, restated pg. 6: each Trait grants +1 Cap to the Stat it is affiliated
// with. Reads `trait.stat`, the column Task 2 adds -- never a name lookup, so
// a self-made Trait word cannot silently cost its Cap.
const statCapFor = (stat, { traits, capPurchases } = {}) => {
    const rows = Array.isArray(traits) ? traits.filter(Boolean) : [];
    const fromTraits = rows.reduce((n, trait) => n + (trait.stat === stat ? 1 : 0), 0);
    const purchased = Math.max(0, Math.floor(Number((capPurchases || {})[stat])) || 0);
    return BASE_STAT_CAP + fromTraits + purchased;
};

// The app's existing settable maximum for a character's level (previously a
// literal 20 duplicated in normalizeWizardPayload, services/character/
// input.js). Named and centralized here so normalizeLevel enforces the same
// ceiling everywhere: without one, normalizeLevel(Infinity) was Infinity and
// normalizeLevel(1e9) gave plusAllotment an allotment over two billion,
// silently passing any stat total on the classic/expert save path. Two other
// sites clamp a SUBMITTED level against this same ceiling, and both read it
// from here: normalizeWizardPayload (services/character/input.js), which the
// wizard alone calls, and levelUp's requestedLevel (services/character/
// service.js). Distinct from MAX_LEVEL in util/character-derived.js, which
// caps the level derived from completed missions -- a different concept.
const LEVEL_CEILING = 20;

// The one clamp for "what level is this character": a whole number in
// [1, LEVEL_CEILING]. A missing, non-numeric, or sub-1 level all read as
// level 1; a level above the ceiling reads as the ceiling; none of that is
// treated as an error. Only fractional levels in [0, 2) floor to 1 --
// normalizeLevel(2.9) is 2, not 1. Exported so every caller who needs to know
// whether a character is AT level 1 -- not just how many pluses that level
// grants -- reads it from here rather than re-deriving it; two independent
// copies of this clamp is how a future change to one of them silently
// desyncs a level-gated rule from plusAllotment's own idea of the level.
const normalizeLevel = (level) => Math.min(LEVEL_CEILING, Math.max(1, Math.floor(Number(level)) || 1));

// null for an economy this module has no figure for, so a caller must decide
// what to do rather than silently enforcing zero.
const plusAllotment = ({ economy, level } = {}) => {
    const base = CREATION_PLUSES[economy];
    if (base == null) return null;
    return base + LEVEL_PLUSES_PER_LEVEL * (normalizeLevel(level) - 1);
};

// Sums a stat-name -> value map (a character's Stats, or any other such map),
// tolerant of the same junk statCapFor's capPurchases branch tolerates.
// plusAllotment is compared against sumValues(stats) directly -- the book's
// six (Advent pg. 16, carried by Aspirant pg. 3) is a creation TOTAL across
// Class Stats, the third Trait's value grant, and the player's own pluses,
// not a figure to net the automatic grants out of first. This is also the
// same total the wizard's step-2 display checks against
// (public/js/character-wizard.js:810's class + personality + user pluses).
const sumValues = (map) => Object.values(map || {})
    .reduce((total, value) => total + (Math.floor(Number(value)) || 0), 0);

const breachesAgainst = (stats, capOf) => Object.keys(stats || {})
    .map((stat) => ({ stat, value: Math.floor(Number(stats[stat])) || 0, cap: capOf(stat) }))
    .filter((row) => row.value > row.cap);

const capBreaches = ({ stats, traits, capPurchases } = {}) =>
    breachesAgainst(stats, (stat) => statCapFor(stat, { traits, capPurchases }));

const creationCeilingBreaches = (stats) => breachesAgainst(stats, () => CREATION_STAT_CAP);

// One wording for "this Stat is over its Cap", so a change to it cannot leave
// two different messages for one rule. Formats a single capBreaches row. Its two
// callers report differently on purpose and that stays theirs: validateStatLimits
// (services/character/input.js) pushes one per breach into its `{ ok, errors }`
// array, and statCapError (services/character/service.js) joins them into the
// single `{ status, message }` sendRouteError renders. Only the sentence is
// shared.
const capBreachMessage = ({ stat, value, cap }) => `${stat} is ${value}, over its Cap of ${cap}.`;

// A stat-name -> Cap map, for a surface that renders one control per Stat and
// needs each Stat's real ceiling rather than a literal. A presentation helper,
// not a rule: it serves the three editable Stat surfaces (the classic edit
// form, the live stat editor, and the level-up modal), all rendered from
// routes/characters.js, which already loads a character's traits (as
// [{name, stat}]) and stat_cap_purchases -- everything statCapFor needs. Kept
// server-side so the figures stay in this module.
//
// DELIBERATELY the one economy-aware function here. Everywhere else in this
// module the economy is the caller's decision and this file is agnostic to it;
// statCapMap owns the branch instead. That asymmetry is on purpose: a caller
// that forgets the branch renders a Cap advent does not have, and three view
// surfaces would each have to remember. Two of them already forgot the Cap
// itself once.
//
// advent is flatly BASE_STAT_CAP. The +1 per Trait and the purchase are Aspirant
// rules (pg. 3, restated pg. 6), so advent has no Trait-Cap mechanic to render at
// all -- the same scoping validateStatLimits applies with its own early return.
// It also matters concretely: 26 of the 327 live characters carry two Traits on
// one Stat and every one of them is advent, so counting Traits there would read
// as a Cap of 7 on a rule advent does not have.
//
// getStatCap in public/js/character-wizard.js is a MIRROR of this function --
// a second implementation of the same branch, for the one surface this module
// cannot reach, since nothing serves it to the browser. Nothing enforces that
// the two agree; a change to the rule here has to be made there by hand. The
// mirror is also where the advent branch was missed while every caller of this
// function had it right.
//
// The stat names come from the caller (util/enclave-consts.js statList) rather
// than from here, so this module stays require-free.
const statCapMap = ({ statList, economy, traits, capPurchases } = {}) =>
    Object.fromEntries((Array.isArray(statList) ? statList : []).map((stat) => [
        stat,
        economy === 'advent' ? BASE_STAT_CAP : statCapFor(stat, { traits, capPurchases })
    ]));

module.exports = {
    statCapFor,
    normalizeLevel,
    plusAllotment,
    sumValues,
    capBreaches,
    creationCeilingBreaches,
    capBreachMessage,
    statCapMap,
    BASE_STAT_CAP,
    CREATION_STAT_CAP,
    CAP_INCREASE_PLUS_COST,
    CREATION_PLUSES,
    LEVEL_PLUSES_PER_LEVEL,
    TRAIT_COUNT,
    STAT_SANITY_BOUND,
    LEVEL_CEILING
};
