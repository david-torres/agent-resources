// The Perk economy ENCLAVE: Aspirant V1 prints on page 7, with the grants and
// caps from pages 3, 90 and 92, and the three figures Aspirant defers to
// Advent -- the earn rate, the Ability Perk cost and the Compound rule --
// supplied by the project owner and recorded in the spec under "Rules supplied
// outside the book".
//
// This is the only place these figures are written down, so that every
// consumer -- a derivation, a validator, a browser view -- reads the same
// numbers instead of keeping its own copy. The third currency module, beside
// util/merx-economy.js (Merx) and util/stat-caps.js (Pluses).
//
// Both siblings are require-free. This module takes exactly one require, and
// only because util/stat-caps.js asks for it: normalizeLevel is exported there
// expressly so callers read the level clamp rather than re-deriving it, since
// two independent copies is how a level-gated rule silently desyncs. Nothing
// else is imported, and no class, pool or economy is resolved here -- every
// consumer passes what it knows.
const { normalizeLevel } = require('./stat-caps');

// pg. 7: "Unlocking an Advanced Ability from your own Class costs 2 Perks";
// "Cross-Classing a Core Ability costs 3 Perks, and an Advanced Ability costs
// 4 Perks". pg. 90 step 3b prices an aspiring character's own-pool Core at 1.
//
// Cross-Class is uniformly +2 over own at every tier, written out rather than
// expressed as `own + 2` for the same reason SIGNATURE_PRICE is
// (util/merx-economy.js): a future edition can break the pattern without a
// rewrite here.
const ABILITY_PRICE = {
    own: { core: 1, advanced: 2 },
    cross: { core: 3, advanced: 4 }
};

// pg. 7: "In addition to their three Core Abilities". Those three are free,
// which is exactly why the book never prints an own-Core price: for advent and
// aspirant that cell can never be charged, because a character's own Core
// roster IS the allowance. pg. 90 gives an aspiring character no allowance at
// all -- its two Core picks cost 1 Perk each -- which is the only way the
// own/core cell is ever reached.
const FREE_CORE_ABILITIES = { advent: 3, aspirant: 3, aspiring: 0 };

// pg. 3: "Characters start with a Perk, which they may use immediately or save
// for later", listed under "Changes to Character Creation" beside the 12-Merx
// change -- so the starting Perk is Aspirant's addition and Advent grants none.
// pg. 90 step 5: an aspiring character starts with 3.
const PERK_GRANT = { advent: 0, aspirant: 1, aspiring: 3 };

// Advent's rate. ENCLAVE: Aspirant V1 says progression works "exactly as
// outlined in Advent" (pg. 3) and does not restate it; supplied by the project
// owner.
const PERKS_PER_LEVEL = 1;

// Advent's rate, supplied with it: applying a Perk to an Ability costs one
// Perk. A Compound is a separate character_perks row, so it costs one more
// simply by being a row -- which is why perkSpend has no compound term.
const ABILITY_PERK_COST = 1;

// Advent pg. 30 by way of pg. 7's cross-reference, supplied verbatim:
// "Compounding an existing Perk, strengthening what that Perk already does and
// increasing its maximum length by +5 words (still counts towards Perk cap)."
// The parenthetical is already true without code: a compound is its own row,
// so it already occupies one of the PERKS_PER_ABILITY slots.
const PERK_WORD_LIMIT = 25;
const COMPOUND_WORD_BONUS = 5;
const PERKS_PER_ABILITY = 5;

// pg. 7: "A character may never have more than six total Abilities, and this
// cap cannot be increased, even via Flavor". pg. 92: aspiring "may never have
// more than four total Abilities".
//
// Advent reads 3, not null. Its siblings use null for "the rules this app
// models state no cap" (SIGNATURE_CAP.advent, util/merx-economy.js), and that
// is not the case here: Advent has no unlock path whatsoever, so its three
// Core Abilities are the entire roster a character can hold. Three is the true
// figure, not an absent one.
const ABILITY_CAP = { advent: 3, aspirant: 6, aspiring: 4 };

const tier = (crossClass) => (crossClass ? 'cross' : 'own');

// Anything that is not the literal 'advanced' is a Core ability. The database
// CHECK on class_abilities.type already admits only 'core' and 'advanced', so
// this only ever absorbs an unset field on an unsaved submission.
const rank = (type) => (type === 'advanced' ? 'advanced' : 'core');

const priceOfAbility = ({ crossClass, type } = {}) => ABILITY_PRICE[tier(crossClass)][rank(type)];

// grant + perLevel * (level - 1), identical in shape to plusAllotment
// (util/stat-caps.js), so a level-1 character holds only its creation grant.
// null for an economy this module has no figure for, so a caller must decide
// what to do rather than silently enforcing zero.
const perkAllotment = ({ economy, level } = {}) => {
    const base = PERK_GRANT[economy];
    if (base == null) return null;
    return base + PERKS_PER_LEVEL * (normalizeLevel(level) - 1);
};

// The whole economy as plain data, for a consumer that cannot require this
// module -- a browser IIFE reading a JSON island. Built by calling the pricing
// function rather than restating the table, so there is still exactly one
// place a price is written down. Returns a fresh object each call.
const perkFigures = () => ({
    grants: { ...PERK_GRANT },
    perksPerLevel: PERKS_PER_LEVEL,
    abilityCap: { ...ABILITY_CAP },
    freeCoreAbilities: { ...FREE_CORE_ABILITIES },
    abilityPerkCost: ABILITY_PERK_COST,
    perkWordLimit: PERK_WORD_LIMIT,
    compoundWordBonus: COMPOUND_WORD_BONUS,
    perksPerAbility: PERKS_PER_ABILITY,
    prices: {
        ability: {
            own: {
                core: priceOfAbility({ crossClass: false, type: 'core' }),
                advanced: priceOfAbility({ crossClass: false, type: 'advanced' })
            },
            cross: {
                core: priceOfAbility({ crossClass: true, type: 'core' }),
                advanced: priceOfAbility({ crossClass: true, type: 'advanced' })
            }
        }
    }
});

// An ability list is priced by waiving the first FREE_CORE_ABILITIES own-class
// Core abilities and charging everything else at its cell. Each entry arrives
// already tagged { crossClass, type }; resolving which class an ability
// belongs to, or whether it sits in an aspiring character's pool, is the
// caller's job.
//
// The waiver is order-independent: every waivable entry costs the same 1, so
// which three of four own Cores are waived cannot change the total.
const unlockSpend = (abilities, economy) => {
    const list = (Array.isArray(abilities) ? abilities : []).filter(Boolean);
    const free = FREE_CORE_ABILITIES[economy] ?? 0;
    let waived = 0;
    let spend = 0;
    for (const ability of list) {
        const crossClass = !!ability.crossClass;
        const type = rank(ability.type);
        if (!crossClass && type === 'core' && waived < free) {
            waived += 1;
            continue;
        }
        spend += priceOfAbility({ crossClass, type });
    }
    return spend;
};

// Deliberately no compound term. A Compound is its own character_perks row
// pointing at the perk it improves, so counting rows already charges 2 Perks
// for a compounded perk; adding a term for compounds_with would double-charge
// it.
const abilityPerkSpend = (abilityPerks) =>
    (Array.isArray(abilityPerks) ? abilityPerks.filter(Boolean) : []).length * ABILITY_PERK_COST;

const perkSpend = ({ economy, abilities, abilityPerks } = {}) =>
    unlockSpend(abilities, economy) + abilityPerkSpend(abilityPerks);

// null for an economy with no grant figure, mirroring perkAllotment, so a
// caller decides rather than being handed a zero that looks like an answer.
const perkBreakdown = ({ economy, level, abilities, abilityPerks } = {}) => {
    const earned = perkAllotment({ economy, level });
    if (earned == null) return null;
    const spend = perkSpend({ economy, abilities, abilityPerks });
    return {
        earned,
        spend,
        remaining: Math.max(0, earned - spend),
        deficit: Math.max(0, spend - earned)
    };
};

// Two severities.
//
// `hard` is a rule the book states as absolute -- pg. 7's cap "cannot be
// increased, even via Flavor" -- or a spend the character cannot pay for.
// `soft` is content legal in another edition but not in this character's:
// Advent has no Cross-Classing rule (pg. 3 lists it among Aspirant's
// additions), so an Advent character holding another class's Ability is
// outside its edition rather than over a limit.
//
// Every breach carries `overage`, the amount by which the rule is broken.
// That, not the raw count, is what the ratchet compares: a character who
// levels up and spends the new Perk has the same overage and is no worse off,
// while comparing raw spend would refuse that save.
const ABILITY_CAP_RULE = 'ability-cap';
const PERK_DEFICIT_RULE = 'perk-deficit';
const CROSS_CLASS_EDITION_RULE = 'cross-class-edition';

const buildBreaches = ({ economy, level, abilities, abilityPerks } = {}) => {
    const list = (Array.isArray(abilities) ? abilities : []).filter(Boolean);
    const breaches = [];

    const cap = ABILITY_CAP[economy];
    if (cap != null && list.length > cap) {
        breaches.push({
            severity: 'hard',
            rule: ABILITY_CAP_RULE,
            count: list.length,
            limit: cap,
            overage: list.length - cap,
            detail: `${list.length} Abilities, and the cap is ${cap}.`
        });
    }

    const breakdown = perkBreakdown({ economy, level, abilities, abilityPerks });
    if (breakdown && breakdown.deficit > 0) {
        breaches.push({
            severity: 'hard',
            rule: PERK_DEFICIT_RULE,
            count: breakdown.spend,
            limit: breakdown.earned,
            overage: breakdown.deficit,
            detail: `${breakdown.spend} Perks spent of ${breakdown.earned} earned.`
        });
    }

    if (economy === 'advent') {
        const crossCount = list.filter((ability) => ability.crossClass).length;
        if (crossCount > 0) {
            breaches.push({
                severity: 'soft',
                rule: CROSS_CLASS_EDITION_RULE,
                count: crossCount,
                limit: 0,
                overage: crossCount,
                detail: `${crossCount} Cross-Class ${crossCount === 1 ? 'Ability' : 'Abilities'}; `
                    + 'Cross-Classing is an Aspirant rule (pg. 3).'
            });
        }
    }

    return breaches;
};

// The ratchet. An existing breach is grandfathered: a save that leaves it as
// it stands goes through, and only one that makes it WORSE is refused. This
// is what lets 13 already-breaching characters stay editable without a stored
// per-character allowance -- the allowance IS the stored row.
//
// Soft breaches are excluded: a notice is information, not a limit.
const worsenedBreaches = (storedBreaches, submittedBreaches) => {
    const storedOverage = new Map(
        (Array.isArray(storedBreaches) ? storedBreaches : [])
            .map((breach) => [breach.rule, breach.overage])
    );
    return (Array.isArray(submittedBreaches) ? submittedBreaches : [])
        .filter((breach) => breach.severity === 'hard')
        .filter((breach) => breach.overage > (storedOverage.get(breach.rule) ?? 0));
};

module.exports = {
    priceOfAbility,
    perkAllotment,
    perkFigures,
    unlockSpend,
    perkSpend,
    perkBreakdown,
    buildBreaches,
    worsenedBreaches,
    ABILITY_PRICE,
    FREE_CORE_ABILITIES,
    PERK_GRANT,
    PERKS_PER_LEVEL,
    ABILITY_PERK_COST,
    PERK_WORD_LIMIT,
    COMPOUND_WORD_BONUS,
    PERKS_PER_ABILITY,
    ABILITY_CAP,
    ABILITY_CAP_RULE,
    PERK_DEFICIT_RULE,
    CROSS_CLASS_EDITION_RULE
};
