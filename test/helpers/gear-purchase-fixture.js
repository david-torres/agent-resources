// test/helpers/gear-purchase-fixture.js
//
// Boot recipe for public/js/character-gear-purchases.js's jsdom tests, in the
// shape test/helpers/wizard-fixture.js already establishes for the wizard's
// own IIFE: read the source with fs, evaluate it with `new Function` against a
// jsdom window, then drive the exposed handle.
//
// `fixtureCharacter` builds the JSON island the edit form serves
// (util/gear-purchase-data.js is what builds it for real), so a test states
// only the part it cares about -- the character's gear, its content format,
// how many missions it has succeeded on.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { economyFor, economyFigures } = require('../../util/merx-economy');
const { MERX_PER_MISSION_SUCCESS } = require('../../util/enclave-consts');
const { twelveItems } = require('./wizard-fixture');
const { json: jsonHelper } = require('../../util/handlebars');

const OWN_CLASS_ID = 'c-v1';
const OWN_CLASS_NAME = 'Test Class';

const SIGNATURE_ENTRY_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'signature-entry.js'),
  'utf8'
);
const PURCHASES_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'js', 'character-gear-purchases.js'),
  'utf8'
);

// The mount points views/character-form.handlebars renders for the surface,
// plus the common-items list the spend readout counts. Kept here rather than
// compiled from the template so a client test does not depend on the whole
// form rendering; views/character-form.test.js pins that the template still
// carries these same ids.
const MOUNT_HTML = (islandJson) => `
  <form>
    <div class="block" id="signaturePurchases">
      <script type="application/json" id="gear-purchase-data">${islandJson}</script>
      <p id="purchaseReadouts">
        <span data-merx-spent>0</span> <span data-merx-budget>0</span>
        <span data-slots-used>0</span> <span data-slots-cap>0</span>
      </p>
      <div id="purchaseGrid"></div>
      <div id="purchaseDrawer" hidden></div>
      <div id="purchasePending" hidden></div>
      <input type="hidden" name="gear_json" id="purchaseGearJson">
    </div>
    <div id="common-items-list"></div>
  </form>
`;

// The class's twelve printed Signatures as the island serves them: the
// wizard fixture's entries, given the owning class and a rendered
// description, which is what util/gear-purchase-data.js produces.
const rosterEntries = () => twelveItems().map((item) => ({
  name: item.name,
  class_id: OWN_CLASS_ID,
  class_name: OWN_CLASS_NAME,
  description_html: `<p>${item.description}</p>`,
  meters: item.meters,
  column: item.column,
  position: item.position,
  default_enchantment: item.default_enchantment
}));

const fixtureCharacter = (overrides = {}) => {
  const contentFormat = overrides.contentFormat || 'aspirant';
  const creatorMode = overrides.creatorMode || null;
  const economy = overrides.economy
    || economyFor({ contentFormat, creatorMode });
  const purchases = (overrides.gear || []).map((g) => ({
    name: g.name,
    class_id: g.class_id || OWN_CLASS_ID,
    enchantment: g.enchantment || null,
    mods: Array.isArray(g.mods) ? g.mods : []
  }));
  return {
    economy,
    figures: economyFigures(),
    characterClassId: overrides.characterClassId === undefined
      ? OWN_CLASS_ID
      : overrides.characterClassId,
    // Mission income only. The surface adds the creation grant itself, from
    // the served figures, so no budget total is written down twice.
    earnedMerx: overrides.earnedMerx != null
      ? overrides.earnedMerx
      : (overrides.successfulMissions || 0) * MERX_PER_MISSION_SUCCESS,
    entries: overrides.entries || rosterEntries(),
    purchases,
    aspiringSignatures: overrides.aspiringSignatures || []
  };
};

// Boots a jsdom window around `html` (the mount markup by default), evaluates
// signature-entry.js and character-gear-purchases.js against it in the order
// the view loads them, and returns the mounted handle.
const mountPurchases = (data, options = {}) => {
  // The real view writes the island through the `json` Handlebars helper,
  // which escapes what would otherwise close the script element early.
  const html = options.html || MOUNT_HTML(jsonHelper(data));
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'http://localhost/characters/abc/edit'
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;

  // The island is filled by the markup, never patched in afterwards: a caller
  // passing the rendered template has Handlebars' own `json` output in it, and
  // the default markup above uses the same helper. Setting textContent here
  // would go through the DOM and hide whether that helper escapes what would
  // close the script element early.

  new Function(SIGNATURE_ENTRY_SOURCE)();
  new Function(PURCHASES_SOURCE)();

  // jsdom leaves readyState at 'loading' unless it runs scripts itself, so the
  // mount waits for DOMContentLoaded here where a deferred <script> in a real
  // browser would already have found the document parsed.
  if (!window.CharacterGearPurchases.instance) {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }

  return window.CharacterGearPurchases.instance;
};

module.exports = {
  mountPurchases,
  fixtureCharacter,
  rosterEntries,
  MOUNT_HTML,
  OWN_CLASS_ID,
  OWN_CLASS_NAME
};
