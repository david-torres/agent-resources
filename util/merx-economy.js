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
// Advent grants no Merx -- it grants the four Signatures the Aspirant rule
// replaces, which its own consumer still needs to honour separately.
const CREATION_GRANT = { advent: 0, aspirant: 12, aspiring: 10 };

// pg. 85: "you can never bring more than 12 Signature Items on a mission".
// pg. 92: aspiring "Signature Cap is set at 8, and they may never have more
// than four total Abilities". Advent has no cap in the rules the app models,
// so null means "not capped" rather than zero.
const SIGNATURE_CAP = { advent: null, aspirant: 12, aspiring: 8 };
// pg. 7: "A character may never have more than six total Abilities, and this
// cap cannot be increased". pg. 92: aspiring may never have more than four.
const ABILITY_CAP = { advent: null, aspirant: 6, aspiring: 4 };

// pg. 87: "A given Signature may hold up to two Mods".
const MODS_PER_SIGNATURE = 2;
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

// pg. 90: an aspiring character's chosen Signatures "are treated as belonging
// to your Class for the purposes of acquisition and improvement", so it never
// pays the surcharge. It also has no class_id to compare against, which would
// otherwise make every one of its items read as cross-class.
const isCrossClass = (item, { economy, characterClassId }) => {
    if (economy === 'aspiring') return false;
    return !!characterClassId && !!item.class_id && item.class_id !== characterClassId;
};

const modsOf = (item) => (Array.isArray(item.mods) ? item.mods : []);

const equipmentSpend = (gear, { economy, characterClassId } = {}) => {
    const items = Array.isArray(gear) ? gear.filter(Boolean) : [];
    return items.reduce((total, item) => {
        const crossClass = isCrossClass(item, { economy, characterClassId });
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

// pg. 8 charges an Enchantment a cap slot, so the cap has to be judged against
// the Enchantments a save LEAVES on a character, not only the ones its payload
// mentions. A submitted item that omits its `enchantment` key keeps whatever
// is stored -- the three-state model services/character/input.js
// normalizeGearEquipment and the save_character_atomic RPC share -- so
// counting the submission alone lets two saves walk a character past the cap:
// six enchanted Signatures, then twelve bare ones.
//
// Pairing mirrors the RPC's (class_id, name, occurrence) matching, with one
// concession: a bare "ClassName::ItemName" submission carries a class NAME,
// not a class_id, and the update path resolves no gear. So a submitted item
// must match a stored row's name, and its class_id as well only when it
// carries one. Claiming each row at most once is the occurrence index.
//
// Where several stored rows share a name, an enchanted one is claimed first,
// and an item that submits its own `enchantment` claims nothing. Both choices
// make the imprecision one-sided: the RPC resolves every bare copy of a name
// to the ONE class_id the catalogue maps it to and deletes the same-named rows
// of other classes, so the Enchantment it preserves may not be the one claimed
// here. Claiming the enchanted row first means this can report a slot MORE
// than the save will produce, never fewer. The worst case is refusing a save
// that already sits exactly on the cap in an ambiguous same-name-across-
// classes build; the opposite bias would leave the two-save breach open.
const withPreservedEnchantments = (submitted, stored) => {
    const items = Array.isArray(submitted) ? submitted.filter(Boolean) : [];
    const rows = Array.isArray(stored) ? stored.filter(Boolean) : [];
    if (rows.length === 0) return items;

    const unclaimed = new Set(rows);
    const claimFor = (item) => {
        const candidates = [...unclaimed].filter((row) => row.name === item.name
            && (!item.class_id || row.class_id === item.class_id));
        const claimed = candidates.find((row) => row.enchantment) || candidates[0];
        if (claimed) unclaimed.delete(claimed);
        return claimed || null;
    };

    return items.map((item) => {
        if (typeof item !== 'object' || 'enchantment' in item) return item;
        const row = claimFor(item);
        return { ...item, enchantment: (row && row.enchantment) || null };
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

module.exports = {
    economyFor,
    priceOfSignature,
    priceOfEnchantment,
    priceOfMod,
    equipmentSpend,
    signatureSlotsUsed,
    withPreservedEnchantments,
    countWordsExcludingRatings,
    COMMON_ITEM_PRICE,
    CREATION_GRANT,
    SIGNATURE_CAP,
    ABILITY_CAP,
    MODS_PER_SIGNATURE,
    ENCHANTMENT_WORD_LIMIT,
    MOD_WORD_LIMIT
};
