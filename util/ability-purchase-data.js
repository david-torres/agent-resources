// The data the character edit form's ability purchase surface mounts
// against, served to the browser as a JSON island the way the Signature
// purchase surface serves its own (util/gear-purchase-data.js). Shaped here
// rather than inline in the route so the payload can be tested without a
// request, and so there is one place that decides who gets the surface at
// all. A later change reads this island from the browser; nothing here
// renders anything.
//
// It is built from data the edit GET already holds: the character, its
// class, and every class the player has unlocked. Nothing here queries.
const { perkFigures, priceOfAbility, abilityPerkSpend } = require('./perk-economy');
const { tagAbilities } = require('./character-derived');
const { normalizeLevel } = require('./stat-caps');

// An ability is identified by the class that prints it plus its name -- two
// classes may print the same name, and they are different abilities. See
// util/gear-purchase-data.js#entryKey for why the join uses NUL rather than a
// printable separator: both parts come out of Postgres `text`, which rejects
// U+0000 outright, so no stored value can collide with the join itself.
const abilityKey = (classId, name) => `${classId || ''}\x00${name}`;

const toRow = (item, classId, className, type) => ({
  name: (item && item.name) || '',
  class_id: classId || null,
  class_name: className || '',
  type: type === 'advanced' ? 'advanced' : 'core'
});

// A class's own printed roster: its Core abilities plus its Advanced ones,
// each tagged with the rank it was printed under.
const rosterOf = (cls) => {
  if (!cls || !cls.id) return [];
  const core = Array.isArray(cls.abilities)
    ? cls.abilities.map((a) => toRow(a, cls.id, cls.name, 'core'))
    : [];
  const advanced = Array.isArray(cls.advanced_abilities)
    ? cls.advanced_abilities.map((a) => toRow(a, cls.id, cls.name, 'advanced'))
    : [];
  return [...core, ...advanced];
};

// The full catalogue an aspirant or aspiring character may buy from: the
// character's own class first, then every other class the caller says is
// unlocked. `allClasses` is expected to already be collapsed to one entry per
// version family (util/class-list-grouping.js#latestClassVersions, the same
// collapse the caller applies before util/gear-purchase-data.js sees a class
// list) -- this module trusts that and only deduplicates by class + name, so
// a class that arrived three times here would still print three times.
//
// Rows already seen keep their first appearance rather than being
// overwritten, so the character's own class -- added first -- wins a name
// collision against a cross-class print of the same ability name.
const buildCatalogue = (characterClass, allClasses) => {
  const seen = new Set();
  const rows = [];
  const add = (row) => {
    if (!row.name) return;
    const key = abilityKey(row.class_id, row.name);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  for (const row of rosterOf(characterClass)) add(row);
  for (const cls of (Array.isArray(allClasses) ? allClasses : [])) {
    for (const row of rosterOf(cls)) add(row);
  }
  return { rows, seen };
};

// Everything the catalogue above must additionally carry so nothing already
// true of the character goes missing from the picker: an aspiring
// character's three-pick pool, and any ability the character already owns
// whose donor class the catalogue above did not reach.
//
// The pool is added unconditionally, bought or not -- the defect this
// mirrors is util/gear-purchase-data.js's aspiringSignatures handling: a pick
// that falls out of the catalogue is a pick that can never be acquired, and
// whether it has been bought yet has no bearing on whether it still needs to
// be buyable.
const addUncatalogued = (rows, seen, { allClasses, character, economy }) => {
  const add = (classId, name, type, className) => {
    if (!name) return;
    const key = abilityKey(classId, name);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(toRow({ name }, classId, className, type));
  };
  const classes = Array.isArray(allClasses) ? allClasses : [];
  const classNameFor = (classId) => {
    const donor = classes.find((cls) => cls && cls.id === classId);
    return donor ? donor.name : '';
  };

  if (economy === 'aspiring') {
    for (const pick of ((character && character.aspiring_abilities) || [])) {
      if (!pick || !pick.class_id) continue;
      add(pick.class_id, pick.name, pick.type, classNameFor(pick.class_id));
    }
  }
  for (const owned of ((character && character.abilities) || [])) {
    if (!owned) continue;
    add(owned.class_id || null, owned.name, owned.type, classNameFor(owned.class_id));
  }
};

// Prices every row against the served figures. tagAbilities resolves
// cross-class and rank the same way the Perk breakdown does, so a row here
// and a row in derivePerkBreakdown never disagree about what it costs.
const priceRows = (rows, { economy, characterClass, character, classFamilyOf }) => {
  const characterClassId = (character && character.class_id) || (characterClass && characterClass.id) || null;
  const tags = tagAbilities(rows, {
    economy,
    characterClassId,
    aspiringAbilities: character && character.aspiring_abilities,
    classFamilyOf
  });
  return rows.map((row, i) => ({
    ...row,
    crossClass: tags[i].crossClass,
    type: tags[i].type,
    price: priceOfAbility({ crossClass: tags[i].crossClass, type: tags[i].type })
  }));
};

// What the character already owns, for the picker to preselect.
const buildOwned = (character) => ((character && character.abilities) || [])
  .filter((a) => a && a.name)
  .map((a) => ({
    name: a.name,
    class_id: a.class_id || null,
    type: a.type === 'advanced' ? 'advanced' : 'core'
  }));

// Null for the advent economy: those characters keep the ability pickers
// they have always had (routes/characters.js's `character-class-abilities`
// partial), and a null island is what views/character-form.handlebars gates
// the whole surface on -- the same contract util/gear-purchase-data.js
// establishes for Signatures. Only the two V1 economies buy here.
//
// `classFamilyOf` is optional: a caller that has not resolved the
// character's version-family map may omit it, and cross-class then compares
// by class_id alone -- the same default util/character-derived.js#sameFamily
// falls back to when nothing is supplied.
//
// The level is served through normalizeLevel rather than raw, and the
// character's existing Ability-Perk spend is served as its own figure,
// because both are inputs to services/character/service.js's ratchet
// (util/perk-economy.js#perkSpend = unlockSpend + abilityPerkSpend) that a
// browser file must be told rather than re-derive -- a stored level past the
// ceiling, or an un-served Ability-Perk spend, would let the surface show an
// earned balance the server does not agree with.
const buildAbilityPurchaseData = ({ character, characterClass, allClasses, economy, classFamilyOf }) => {
  if (economy !== 'aspirant' && economy !== 'aspiring') return null;
  const { rows, seen } = buildCatalogue(characterClass, allClasses);
  addUncatalogued(rows, seen, { allClasses, character, economy });
  return {
    economy,
    figures: perkFigures(),
    entries: priceRows(rows, { economy, characterClass, character, classFamilyOf }),
    owned: buildOwned(character),
    aspiringAbilities: (character && character.aspiring_abilities) || [],
    level: normalizeLevel(character && character.level),
    abilityPerkSpend: abilityPerkSpend(character && character.ability_perks)
  };
};

// The inverse of the island: what the purchase surface submits. Mirrors
// util/gear-purchase-data.js#applyGearPurchases exactly, for the Ability
// half of the same problem -- see that function's comment for why JSON
// rather than the classic pickers' bare strings, why an empty field is
// silence rather than an instruction, and why this answers usability instead
// of throwing.
//
// public/js/character-ability-purchases.js#serialize always writes an
// explicit `type` on every purchased row (from the priced catalogue entry,
// never guessed), so a row that omits it here reaches
// services/character/service.js#resolveSubmittedAbilities with no type of
// its own -- which that resolver reads as "keep whatever is stored", not as
// Core.
const applyAbilityPurchases = (body) => {
  if (!body || typeof body.abilities_json !== 'string') return true;
  const submitted = body.abilities_json.trim();
  delete body.abilities_json;
  if (!submitted) return true;
  let parsed;
  try {
    parsed = JSON.parse(submitted);
  } catch (_) {
    return false;
  }
  if (!Array.isArray(parsed)) return false;
  body.abilities = parsed;
  return true;
};

module.exports = { buildAbilityPurchaseData, applyAbilityPurchases };
