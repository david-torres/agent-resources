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
// it. It is never enforced -- validateStatLimits returns early for advent --
// and recording a false value to signal "unenforced" would be a lie in the one
// module that exists to be authoritative. SIGNATURE_CAP.advent in
// util/merx-economy.js is null for the same kind of reason: Advent has no such
// cap, so null is the true answer there.
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

// null for an economy this module has no figure for, so a caller must decide
// what to do rather than silently enforcing zero.
const plusAllotment = ({ economy, level } = {}) => {
    const base = CREATION_PLUSES[economy];
    if (base == null) return null;
    const levels = Math.max(1, Math.floor(Number(level)) || 1);
    return base + LEVEL_PLUSES_PER_LEVEL * (levels - 1);
};

// The third Trait's Stat gets +1 to its VALUE at creation (Advent pg. 16) --
// a different mechanic from the +1 CAP every Trait grants, and the two are
// easy to conflate.
//
// Aspiring has no such grant: pg. 90's three Trait-Stat pluses are three of
// the four the player distributes, not a bonus on top. Handing an
// aspirant-shaped grant to an aspiring character would understate what the
// player spent by one.
const traitGrantFor = (traits, economy) => {
    if (economy === 'aspiring') return {};
    const rows = Array.isArray(traits) ? traits : [];
    const third = rows[2];
    return (third && third.stat) ? { [third.stat]: 1 } : {};
};

const sumValues = (map) => Object.values(map || {})
    .reduce((total, value) => total + (Math.floor(Number(value)) || 0), 0);

// What the PLAYER assigned, recovered from a stored total by removing the two
// automatic grants. This is the same arithmetic the wizard performs at
// public/js/character-wizard.js:810 when it decides how many boxes remain
// assignable.
const assignedPluses = ({ stats, classSpread, traitGrant } = {}) =>
    sumValues(stats) - sumValues(classSpread) - sumValues(traitGrant);

const breachesAgainst = (stats, capOf) => Object.keys(stats || {})
    .map((stat) => ({ stat, value: Math.floor(Number(stats[stat])) || 0, cap: capOf(stat) }))
    .filter((row) => row.value > row.cap);

const capBreaches = ({ stats, traits, capPurchases } = {}) =>
    breachesAgainst(stats, (stat) => statCapFor(stat, { traits, capPurchases }));

const creationCeilingBreaches = (stats) => breachesAgainst(stats, () => CREATION_STAT_CAP);

module.exports = {
    statCapFor,
    plusAllotment,
    traitGrantFor,
    assignedPluses,
    capBreaches,
    creationCeilingBreaches,
    BASE_STAT_CAP,
    CREATION_STAT_CAP,
    CAP_INCREASE_PLUS_COST,
    CREATION_PLUSES,
    LEVEL_PLUSES_PER_LEVEL,
    TRAIT_COUNT,
    STAT_SANITY_BOUND
};
