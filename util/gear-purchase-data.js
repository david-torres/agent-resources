// The data the character edit form's Merx purchase surface mounts against,
// served to the browser as a JSON island the way the wizard serves its own
// (views/character-wizard.handlebars's #wizard-data). Shaped here rather than
// inline in the route so the payload can be tested without a request, and so
// there is one place that decides who gets the surface at all.
//
// It is built from data the edit GET already holds: the character, its class,
// and the missions it already fetched for deriveCharacterTotals. Nothing here
// queries.
const { economyFigures } = require('./merx-economy');
const { renderMarkdown } = require('./markdown');

// A Signature is identified by the class that prints it plus its name -- two
// classes may print the same name, and they are different items.
//
// The two parts are joined on NUL, written as an escape so this file stays
// ordinary text. A printable separator would be a guess: an item name is
// class- or player-authored prose, so ':', '|', '::' and every other visible
// candidate can legitimately occur in one and collapse two distinct entries
// into one key. NUL cannot: both parts come out of Postgres `text` (a UUID
// column and a name column or the class JSONB), and Postgres rejects U+0000
// in text outright, so no stored value can contain it.
const entryKey = (classId, name) => `${classId || ''}\x00${name}`;

// One entry as SignatureEntry.render consumes it: the printed item, its text
// already rendered, and the class it belongs to so the mount can price a
// cross-class purchase.
const toEntry = (item, classId, className) => ({
  name: item.name || '',
  class_id: classId || null,
  class_name: className || '',
  description_html: renderMarkdown(item.description || ''),
  meters: Array.isArray(item.meters) ? item.meters : [],
  column: item.column || null,
  position: item.position || null,
  default_enchantment: item.default_enchantment || null
});

// What the grid offers: every Signature the character's class prints, plus an
// entry for anything the character already owns that the roster does not
// cover -- a cross-class purchase, or any Signature at all for an aspiring
// character, which is class-less and whose picks come from other classes'
// rosters. Without the second half those rows would have no controls, and an
// aspiring character would see an empty grid.
//
// A stored class_gear row arrives merged with its class's printed entry
// (services/character/repository.js#getCharacterGear), so it already carries
// the description, meters and Default Enchantment the entry needs.
const buildEntries = (characterClass, allClasses, gear, economy, aspiringSignatures) => {
  const roster = Array.isArray(characterClass && characterClass.gear)
    ? characterClass.gear.map((item) => toEntry(item, characterClass.id, characterClass.name))
    : [];
  const seen = new Set(roster.map((entry) => entryKey(entry.class_id, entry.name)));
  const catalogue = [];
  // An aspiring character is class-less, so it has no roster of its own to
  // list. Its Class is three named Signatures (pg. 90) and the rest of the
  // catalogue is what it may acquire at the cross-class tier -- the same
  // reach an aspirant character gets through the wizard's shop.
  if (economy === 'aspiring') {
    for (const cls of (Array.isArray(allClasses) ? allClasses : [])) {
      if (!cls || !cls.id || !Array.isArray(cls.gear)) continue;
      for (const item of cls.gear) {
        if (!item || !item.name) continue;
        const key = entryKey(cls.id, item.name);
        if (seen.has(key)) continue;
        seen.add(key);
        catalogue.push(toEntry(item, cls.id, cls.name));
      }
    }
    // The pool has to outlive ownership (pg. 90 design intent): a character
    // that bought none of its three picks at creation must still be able to
    // buy its own invented Class later, even once a donor class's unlock has
    // lapsed or a newer version has superseded it in allClasses -- the same
    // reason routes/characters.js injects the character's own class into the
    // Class <select> above. allClasses may still hold the donor and its full
    // printed item; only fall back to a bare entry when it does not.
    for (const pick of (Array.isArray(aspiringSignatures) ? aspiringSignatures : [])) {
      if (!pick || !pick.class_id || !pick.name) continue;
      const key = entryKey(pick.class_id, pick.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const donorClass = (Array.isArray(allClasses) ? allClasses : [])
        .find((cls) => cls && cls.id === pick.class_id);
      const donorItem = donorClass && Array.isArray(donorClass.gear)
        ? donorClass.gear.find((item) => item && item.name === pick.name)
        : null;
      catalogue.push(donorItem
        ? toEntry(donorItem, pick.class_id, donorClass.name)
        : toEntry({ name: pick.name }, pick.class_id, ''));
    }
  }
  const carried = [];
  for (const row of gear) {
    if (!row || !row.name) continue;
    const key = entryKey(row.class_id, row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    carried.push(toEntry(row, row.class_id, row.class_name));
  }
  return [...roster, ...catalogue, ...carried];
};

// What the character already owns. `enchantment` and `mods` are read as they
// are stored; the mount's serialiser decides which of them a save mentions.
const buildPurchases = (gear) => gear
  .filter((row) => row && row.name)
  .map((row) => ({
    name: row.name,
    class_id: row.class_id || null,
    enchantment: row.enchantment || null,
    mods: Array.isArray(row.mods) ? row.mods : []
  }));

// Null for the advent economy: those characters keep the gear[] selects they
// have always had, and a null island is what views/character-form.handlebars
// gates the whole surface on. Only the two V1 economies buy here.
const buildGearPurchaseData = ({ economy, characterClass, allClasses, character, missionMerx }) => {
  if (economy !== 'aspirant' && economy !== 'aspiring') return null;
  const gear = Array.isArray(character && character.gear) ? character.gear : [];
  return {
    economy,
    figures: economyFigures(),
    characterClassId: (character && character.class_id) || null,
    // The three Signatures this character's Class is made of (pg. 90). The
    // browser prices against the same pool the server will, or the surface
    // would offer a purchase the save then refuses.
    aspiringSignatures: (character && character.aspiring_signatures) || [],
    // Mission income alone. The surface adds the creation grant from the
    // figures above, so the budget is never written down as a single total
    // that could disagree with either half.
    earnedMerx: Math.max(0, Number(missionMerx) || 0),
    entries: buildEntries(characterClass, allClasses, gear, economy, character && character.aspiring_signatures),
    purchases: buildPurchases(gear)
  };
};

// The inverse of the island: what the purchase surface submits. It posts its
// Signatures as JSON in one field rather than as the bare "Class::Item"
// strings the classic gear[] selects post, because only JSON can carry an
// Enchantment object -- and, just as importantly, only JSON can tell an
// explicit null ("un-enchant this Signature") from an absent key, which the
// save reads as "keep whatever is stored" (services/character/input.js
// normalizeGearEquipment, and the save_character_atomic RPC behind it).
//
// An EMPTY field is silence, not an empty list: the input renders empty and
// is filled by the mount, so a page whose script never ran must leave `gear`
// alone and save everything else, rather than either wiping the character's
// Signatures or refusing every save on the form.
//
// Answers whether the body is usable instead of throwing: a throw inside a
// route handler is reported as a generic "unexpected error" at best and names
// no field.
const applyGearPurchases = (body) => {
  if (!body || typeof body.gear_json !== 'string') return true;
  const submitted = body.gear_json.trim();
  delete body.gear_json;
  if (!submitted) return true;
  let parsed;
  try {
    parsed = JSON.parse(submitted);
  } catch (_) {
    return false;
  }
  if (!Array.isArray(parsed)) return false;
  body.gear = parsed;
  return true;
};

module.exports = { buildGearPurchaseData, applyGearPurchases };
