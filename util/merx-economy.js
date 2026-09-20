// The Merx economy ENCLAVE: Aspirant V1 prints on page 85, with the grants,
// caps and word limits from pages 3, 8, 86, 87, 90 and 92.
//
// This is the only place these figures are written down, so that every
// consumer -- an extractor, a verifier, a derivation, a browser view --
// reads the same numbers instead of keeping its own copy.
//
// Pure by design: no requires, no I/O. Every consumer passes what it knows.

// pg. 85. Cross-Class is uniformly +1 at every tier, but it is written out
// rather than expressed as `own + 1` so a future edition can break the pattern
// without a rewrite.
const SIGNATURE_PRICE = { own: 2, cross: 3 };
const DEFAULT_ENCHANTMENT_PRICE = { own: 2, cross: 3 };
const CUSTOM_ENCHANTMENT_PRICE = { own: 3, cross: 4 };
// "the second costing more" -- indexed by how many Mods the Signature already
// holds, so the first Mod reads index 0.
const MOD_PRICE = { own: [1, 2], cross: [2, 3] };
const COMMON_ITEM_PRICE = 1;

// pg. 3: "Instead of four Signature Items (three Default and one Elective),
// characters start with 12 Merx". pg. 90: aspiring starts with 10.
//
// Advent keeps the arrangement Aspirant replaces: three Default Signatures,
// free, plus one Elective. The Elective is a choice rather than a fixed item --
// Advent V2 pg. 16 lets it double up on a Default instead of taking a new one --
// so it is granted as its 2-Merx value and spends like any other Merx: one
// class item, or two common items, or a duplicated Default. Granting four free
// items instead priced only the first of those routes and reported a deficit
// for the other two.
const CREATION_GRANT = { advent: 2, aspirant: 12, aspiring: 10 };

// pg. 85: "you can never bring more than 12 Signature Items on a mission".
// pg. 92: aspiring "Signature Cap is set at 8, and they may never have more
// than four total Abilities". Advent has no cap in the rules the app models,
// so null means "not capped" rather than zero.
const SIGNATURE_CAP = { advent: null, aspirant: 12, aspiring: 8 };

// pg. 87: "A given Signature may hold up to two Mods".
const MODS_PER_SIGNATURE = 2;
// pg. 90: an aspiring character chooses three Signatures, and those three are
// its Class. A count rather than a price, but a rules figure all the same, so
// it lives here with the rest of them.
const ASPIRING_SIGNATURE_PICKS = 3;
// pg. 86 and pg. 87.
const ENCHANTMENT_WORD_LIMIT = 40;
const MOD_WORD_LIMIT = 10;

const tier = (crossClass) => (crossClass ? 'cross' : 'own');

const priceOfSignature = ({ crossClass } = {}) => SIGNATURE_PRICE[tier(crossClass)];

const priceOfEnchantment = ({ source, crossClass } = {}) => {
    if (source === 'custom') return CUSTOM_ENCHANTMENT_PRICE[tier(crossClass)];
    if (source === 'default') return DEFAULT_ENCHANTMENT_PRICE[tier(crossClass)];
    return 0;
};

// `index` is 0-based: a Signature's first Mod is index 0. A Signature holds
// at most MODS_PER_SIGNATURE Mods; an index past the table prices at that
// tier's dearest rate rather than 0, so an impossible third Mod is never free.
const priceOfMod = ({ index, crossClass } = {}) => {
    const prices = MOD_PRICE[tier(crossClass)];
    return index in prices ? prices[index] : prices[prices.length - 1];
};

// pg. 90: an aspiring character's three chosen Signatures "are treated as
// belonging to your Class for the purposes of acquisition and improvement".
// That sentence names three items and makes them a Class; it does not exempt
// the character from the cross-class tier, so a fourth Signature -- including
// one that shares a class with a pick -- costs the surcharge like anyone
// else's. The three arrive as `aspiringSignatures`, the pool stored on
// characters.aspiring_signatures.
//
// An empty or absent pool prices everything own-class, which is what a row
// written before that column existed derives as. The permissive direction is
// deliberate: the strict one would refuse saves for characters that did
// nothing wrong. The wizard validates the pool, so this is a guard for the
// API path and for legacy rows.
const inAspiringPool = (item, pool) => pool.some(
    (pick) => pick.class_id === item.class_id && pick.name === item.name
);

const isCrossClass = (item, { economy, characterClassId, aspiringSignatures } = {}) => {
    if (economy === 'aspiring') {
        const pool = (Array.isArray(aspiringSignatures) ? aspiringSignatures : []).filter(Boolean);
        return pool.length > 0 && !inAspiringPool(item, pool);
    }
    return !!characterClassId && !!item.class_id && item.class_id !== characterClassId;
};

const modsOf = (item) => (Array.isArray(item.mods) ? item.mods : []);

const equipmentSpend = (gear, { economy, characterClassId, aspiringSignatures } = {}) => {
    const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
    return items.reduce((total, item) => {
        const crossClass = isCrossClass(item, { economy, characterClassId, aspiringSignatures });
        const enchantment = item.enchantment || null;
        const mods = modsOf(item);
        const modSpend = mods.reduce(
            (sum, _mod, index) => sum + priceOfMod({ index, crossClass }), 0
        );
        return total
            + priceOfSignature({ crossClass })
            + priceOfEnchantment({ source: enchantment && enchantment.source, crossClass })
            + modSpend;
    }, 0);
};

// pg. 8: an Enchantment "counts towards the Signature Cap of 12", so an
// enchanted Signature occupies two slots; Mods "do not count towards the
// Signature cap" and occupy none.
const signatureSlotsUsed = (gear) => {
    const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
    return items.reduce((slots, item) => slots + 1 + (item.enchantment ? 1 : 0), 0);
};

// pg. 8 charges an Enchantment a cap slot, and every Enchantment and Mod
// costs Merx, so both have to be judged against the equipment a save LEAVES
// on a character, not only the equipment its payload mentions. A submitted
// item that omits `enchantment` and `mods` keeps whatever is stored -- the
// three-state model services/character/input.js normalizeGearEquipment and
// the save_character_atomic RPC share, and the contract the edit form's
// purchase surface serialises to for any row the player did not touch.
// Counting or pricing the submission alone lets an untouched character walk
// past the cap (six enchanted Signatures, then twelve bare ones) and lets an
// auto-calculated edit hand back Merx that is still spent.
//
// Pairing mirrors the RPC's (class_id, name, occurrence) matching, with one
// concession: a bare "ClassName::ItemName" submission carries a class NAME,
// not a class_id, and the update path resolves no gear. So a submitted item
// must match a stored row's name, and its class_id as well only when it
// carries one. Claiming each row at most once is the occurrence index.
//
// Where several stored rows share a name, the dearest is claimed first -- an
// enchanted row over a bare one, and more Mods over fewer -- and an item that
// submits its own equipment claims nothing. Both choices make the imprecision
// one-sided: the RPC resolves every bare copy of a name to the ONE class_id
// the catalogue maps it to and deletes the same-named rows of other classes,
// so the equipment it preserves may not be the one claimed here. Claiming the
// dearest row first means this can report MORE slots and MORE spend than the
// save will produce, never fewer. The worst case is refusing a save that
// already sits exactly on a limit in an ambiguous same-name-across-classes
// build; the opposite bias would leave the two-save breach open.
const withPreservedEquipment = (submitted, stored) => {
    const items = Array.isArray(submitted) ? submitted.filter(Boolean) : [];
    const rows = Array.isArray(stored) ? stored.filter(Boolean) : [];
    if (rows.length === 0) return items;

    const unclaimed = new Set(rows);
    const dearest = (a, b) => (b.enchantment ? 1 : 0) - (a.enchantment ? 1 : 0)
        || modsOf(b).length - modsOf(a).length;
    const claimFor = (item) => {
        const candidates = [...unclaimed].filter((row) => row.name === item.name
            && (!item.class_id || row.class_id === item.class_id));
        const claimed = candidates.sort(dearest)[0];
        if (claimed) unclaimed.delete(claimed);
        return claimed || null;
    };

    return items.map((item) => {
        if (typeof item !== 'object') return item;
        if ('enchantment' in item && 'mods' in item) return item;
        const row = claimFor(item);
        return {
            ...item,
            enchantment: 'enchantment' in item ? item.enchantment : ((row && row.enchantment) || null),
            mods: 'mods' in item ? item.mods : modsOf(row || {})
        };
    });
};

// pg. 86: a Custom Enchantment is "no more than 40 words long, minus Power
// Rating Superscripts". A rating is stored as a <sup> span, so the spans come
// out before the words are counted. Stripping a span to a bare space can
// leave adjacent punctuation (e.g. "damage<sup>M</sup>." becomes "damage .");
// a token is only counted as a word when it has a letter or digit in it.
const RATING_SPAN = /<sup>[\s\S]*?<\/sup>/g;
const WORD_WITH_ALPHANUMERIC = /[\p{L}\p{N}]/u;

const countWordsExcludingRatings = (text) => {
    const stripped = String(text ?? '').replace(RATING_SPAN, ' ').trim();
    if (!stripped) return 0;
    return stripped.split(/\s+/).filter((token) => WORD_WITH_ALPHANUMERIC.test(token)).length;
};

// Which economy a character is under. An aspiring character is class-less,
// so there is no content_format to read and creator_mode is the only signal.
// Everything else reads content_format, which is the shape of the class's
// content. rules_edition is deliberately NOT consulted: the six pre-release
// Aspirant classes are rules_edition 'aspirant' with content_format 'advent'
// and are priced as Advent content, because that is the shape they carry.
const economyFor = ({ contentFormat, creatorMode } = {}) => {
    if (creatorMode === 'aspiring') return 'aspiring';
    return contentFormat === 'aspirant' ? 'aspirant' : 'advent';
};

// The whole economy as plain data, for a consumer that cannot require this
// module -- a browser IIFE reading the wizard's JSON island. Built by calling
// the pricing functions rather than restating the tables, so there is still
// exactly one place a price is written down. Returns a fresh object each call:
// it is handed to JSON.stringify and to callers who have no reason to expect
// the module's own constants back.
const economyFigures = () => ({
    grants: { ...CREATION_GRANT },
    signatureCap: { ...SIGNATURE_CAP },
    modsPerSignature: MODS_PER_SIGNATURE,
    aspiringSignaturePicks: ASPIRING_SIGNATURE_PICKS,
    enchantmentWordLimit: ENCHANTMENT_WORD_LIMIT,
    modWordLimit: MOD_WORD_LIMIT,
    prices: {
        commonItem: COMMON_ITEM_PRICE,
        signature: {
            own: priceOfSignature({ crossClass: false }),
            cross: priceOfSignature({ crossClass: true })
        },
        defaultEnchantment: {
            own: priceOfEnchantment({ source: 'default', crossClass: false }),
            cross: priceOfEnchantment({ source: 'default', crossClass: true })
        },
        customEnchantment: {
            own: priceOfEnchantment({ source: 'custom', crossClass: false }),
            cross: priceOfEnchantment({ source: 'custom', crossClass: true })
        },
        mod: {
            own: [priceOfMod({ index: 0 }), priceOfMod({ index: 1 })],
            cross: [
                priceOfMod({ index: 0, crossClass: true }),
                priceOfMod({ index: 1, crossClass: true })
            ]
        }
    }
});

module.exports = {
    economyFor,
    economyFigures,
    priceOfSignature,
    priceOfEnchantment,
    priceOfMod,
    equipmentSpend,
    signatureSlotsUsed,
    withPreservedEquipment,
    countWordsExcludingRatings,
    COMMON_ITEM_PRICE,
    CREATION_GRANT,
    SIGNATURE_CAP,
    MODS_PER_SIGNATURE,
    ASPIRING_SIGNATURE_PICKS,
    ENCHANTMENT_WORD_LIMIT,
    MOD_WORD_LIMIT
};
