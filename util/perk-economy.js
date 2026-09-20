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

module.exports = {
    priceOfAbility,
    perkAllotment,
    perkFigures,
    ABILITY_PRICE,
    FREE_CORE_ABILITIES,
    PERK_GRANT,
    PERKS_PER_LEVEL,
    ABILITY_PERK_COST,
    PERK_WORD_LIMIT,
    COMPOUND_WORD_BONUS,
    PERKS_PER_ABILITY,
    ABILITY_CAP
};
