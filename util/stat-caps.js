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
// silently passing any stat total on the classic/expert save path (level is
// otherwise clamped only inside normalizeWizardPayload, which the wizard
// alone calls). Distinct from MAX_LEVEL in util/character-derived.js, which
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

module.exports = {
    statCapFor,
    normalizeLevel,
    plusAllotment,
    sumValues,
    capBreaches,
    creationCeilingBreaches,
    BASE_STAT_CAP,
    CREATION_STAT_CAP,
    CAP_INCREASE_PLUS_COST,
    CREATION_PLUSES,
    LEVEL_PLUSES_PER_LEVEL,
    TRAIT_COUNT,
    STAT_SANITY_BOUND,
    LEVEL_CEILING
};
