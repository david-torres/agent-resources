const { test, expect, beforeAll } = require('bun:test');
const fs = require('fs');
const path = require('path');

const source = () => fs.readFileSync(
  path.join(__dirname, 'character-form.handlebars'), 'utf8'
);

test('deceased modal opens through the modal Alpine component, not App.openModal', () => {
  const html = source();
  expect(html).toContain("$dispatch('open-modal', 'deceased')");
  expect(html).toContain("x-data=\"modal('deceased')\"");
  expect(html).not.toContain('App.openModal');
  expect(html).not.toContain('App.closeModal');
  expect(html).not.toContain("getElementById('deceased-modal')");
});

// ar-7v3k fix wave, Fix 4: the test above only pinned x-data and the
// $dispatch call -- not the bindings that actually make the modal Alpine
// component work. Deleting `:class="{ 'is-active': show }"` from the
// template left every test in this file green (proven by deleting it and
// re-running before writing this test): the modal would open in JS state
// but never gain the `is-active` class, so it stays invisible. Brings
// this up to the standard set by
// views/partials/character-level-up.test.js:36-45, which pins all four
// bindings on the real template.
test('deceased-modal carries all four modal bindings on the real template', () => {
  const html = source();
  // Object form, deliberately -- the string form cannot remove a frozen
  // `is-active` (see public/js/alpine-components.js).
  expect(html).toContain(":class=\"{ 'is-active': show }\"");
  expect(html).toContain('@open-modal.window="open($event.detail)"');
  expect(html).toContain('@close-modal.window="close($event.detail)"');
  expect(html).toContain('@keydown.escape.window="close()"');
});

const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

const CONFIRM = `
  <div x-data="{ typed: '', required: 'Vex Kalloway' }">
    <input id="confirm-input" x-model="typed">
    <button id="deceased-submit" :disabled="typed !== required"></button>
  </div>
`;

test('confirm button starts disabled', async () => {
  await setupAlpine();
  await render(CONFIRM);
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('confirm button stays disabled for a partial name', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('confirm button enables on an exact match', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex Kalloway';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(false);
});

test('confirm button re-disables when the name stops matching', async () => {
  await setupAlpine();
  await render(CONFIRM);
  const input = document.getElementById('confirm-input');
  input.value = 'Vex Kalloway';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  input.value = 'Vex Kallowa';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.getElementById('deceased-submit').disabled).toBe(true);
});

test('deceased form no longer uses oninput', () => {
  const html = source();
  expect(html).not.toContain('oninput');
});

test('deceased form no longer uses data-confirm-name', () => {
  const html = source();
  expect(html).not.toContain('data-confirm-name');
});

test('deceased input uses x-model binding', () => {
  const html = source();
  expect(html).toContain('x-model="typed"');
});

test('deceased button uses :disabled binding', () => {
  const html = source();
  expect(html).toContain(':disabled="typed !== required"');
});

test('deceased submit button has no bare disabled attribute', () => {
  const html = source();
  const buttonMatch = html.match(/<button[^>]*id="deceased-submit"[^>]*>/);
  expect(buttonMatch).toBeTruthy();
  const buttonTag = buttonMatch[0];
  // Match ' disabled' not followed by '-' or '=' (avoids matching ':disabled=')
  expect(buttonTag).not.toMatch(/\sdisabled(?![-=])/);
});

// --- stat blocks ----------------------------------------------------------
//
// This form submits through htmx (`hx-post`/`hx-put` on the <form>), which
// serializes the form's own named fields and nothing else -- so the hidden
// input inside each control is the ONLY thing that makes a stat reach the
// server. A test that only checked the blocks render would pass on a form
// that silently posts no stats at all.

const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../util/handlebars');
const { statList } = require('../util/enclave-consts');

const FORM_SRC = fs.readFileSync(path.join(__dirname, 'character-form.handlebars'), 'utf8');

test('character-form renders stat blocks instead of number inputs', () => {
  expect(FORM_SRC).toContain('{{> stat-blocks stat=this name=this');
  // The old field had `type="number" name="{{this}}" ... required`.
  expect(FORM_SRC).not.toMatch(/type="number"\s+name="\{\{this\}\}"/);
});

test('the stat fields are no longer `required`', () => {
  // A hidden input always has a value and 0 is a legitimate stat, so a
  // `required` here could only ever be a false gate.
  const statsSection = FORM_SRC.slice(
    FORM_SRC.indexOf('<label class="label">Stats</label>'),
    FORM_SRC.indexOf('Signature Gear')
  );
  expect(statsSection).not.toContain('required');
});

test('every stat POSTs its own name from a hidden input', async () => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerPartial('stat-blocks', fs.readFileSync(
    path.join(__dirname, 'partials', 'stat-blocks.handlebars'), 'utf8'
  ));

  const statsSection = FORM_SRC.slice(
    FORM_SRC.indexOf('<label class="label">Stats</label>'),
    FORM_SRC.indexOf('Signature Gear')
  );
  const character = Object.fromEntries(statList.map((s, i) => [s, i % 6]));
  // statCaps is required, not optional: stat-blocks interpolates `max` straight
  // into its x-data expression, so omitting it renders `statBlocks(0, , "luck")`
  // and takes the whole component down. Every route that renders this form
  // supplies it (routes/characters.js).
  const statCaps = Object.fromEntries(statList.map((s) => [s, 5]));
  await render(hb.compile(statsSection)({ statList, character, statCaps }));
  await tick();

  const posted = Array.from(document.querySelectorAll('input[type="hidden"]'))
    .map((el) => el.name);
  expect(posted.sort()).toEqual([...statList].sort());
  expect(document.querySelector('input[name="might"]').value)
    .toBe(String(character.might));
});

// --- created-at date bound --------------------------------------------------
//
// normalizeCharacterInput (services/character/input.js) already rejects a
// future created_at server-side, but that error renders as a generic 500
// page (util/http-error.js), not a field-level message. The `max` attribute
// is a client-side convenience that stops most players from ever submitting
// one; the route must supply today's date (UTC) as maxCreatedAt.

// --- personality trait select --------------------------------------------
//
// character.traits is `[{name, stat}]` (Task 5). `itemAt` returns the whole
// object at that index, so the `selected` comparison has to pull `.name`
// back out before comparing it against the option's string value -- compare
// the object itself and every option renders unselected.

const { personalityMap } = require('../util/enclave-consts');

test('the personality select marks the character\'s existing trait as selected', () => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);

  const personalitySection = FORM_SRC.slice(
    FORM_SRC.indexOf('<label class="label">Personality</label>'),
    FORM_SRC.indexOf('<hr />', FORM_SRC.indexOf('<label class="label">Personality</label>'))
  );

  const character = { traits: [{ name: 'brave', stat: 'might' }] };
  const html = hb.compile(personalitySection)({ personalityMap, character });

  const selectedMatch = html.match(/<option value="([^"]+)" data-stat="[^"]+"\s+selected>/);
  expect(selectedMatch).toBeTruthy();
  expect(selectedMatch[1]).toBe('brave');
});

test('the Created date input carries a max attribute sourced from the render context', () => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);

  const inputMatch = FORM_SRC.match(/<input[^>]*id="char-created-at"[^>]*>/);
  expect(inputMatch).toBeTruthy();

  const html = hb.compile(inputMatch[0])({
    character: { created_at: '2026-01-05T00:00:00+00:00' },
    maxCreatedAt: '2026-08-15'
  });

  expect(html).toContain('max="2026-08-15"');
});

// --- self-made Trait words ------------------------------------------------
//
// Task 10 made a Trait word outside the 48-word vocabulary storable. A form
// built only from personalityMap has no <option> for such a word, so the
// browser selects nothing and falls back to each select's FIRST option --
// the same word in all three, which validateTraits then refuses for sharing
// a Stat. The stored word therefore has to render as an option of its own,
// and the Stat has to be submitted alongside the name, because the server can
// only resolve a self-made word's Stat from what the form sends.

const renderPersonality = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  const start = FORM_SRC.indexOf('<label class="label">Personality</label>');
  const section = FORM_SRC.slice(start, FORM_SRC.indexOf('<hr />', start));
  return hb.compile(section)({ personalityMap, ...context });
};

test('a self-made Trait word renders as a selected option of its own', () => {
  const html = renderPersonality({
    character: {
      traits: [
        { name: 'brave', stat: 'might' },
        { name: 'wanderer', stat: 'arcane' },
        { name: 'calm', stat: 'will' }
      ]
    }
  });

  expect(html).toMatch(/<option value="wanderer" data-stat="arcane" selected>/);
  expect(html).toMatch(/Wanderer \(Arcane\)/);
});

test('each Trait slot submits the stored Stat alongside the name', () => {
  const html = renderPersonality({
    character: {
      traits: [
        { name: 'brave', stat: 'might' },
        { name: 'wanderer', stat: 'arcane' },
        { name: 'calm', stat: 'will' }
      ]
    }
  });

  expect(html).toMatch(/name="trait0_stat"[\s\S]*?value="might"/);
  expect(html).toMatch(/name="trait1_stat"[\s\S]*?value="arcane"/);
  expect(html).toMatch(/name="trait2_stat"[\s\S]*?value="will"/);
});

test('three vocabulary Traits add no extra option and stay selected', () => {
  const html = renderPersonality({
    character: {
      traits: [
        { name: 'brave', stat: 'might' },
        { name: 'sly', stat: 'reflex' },
        { name: 'calm', stat: 'will' }
      ]
    }
  });

  const vocabularySize = Object.values(personalityMap).flat().length;
  expect(html.match(/<option /g)).toHaveLength(vocabularySize * 3);

  const selected = [...html.matchAll(/<option value="([^"]+)" data-stat="([^"]+)" selected>/g)];
  expect(selected.map(match => [match[1], match[2]]))
    .toEqual([['brave', 'might'], ['sly', 'reflex'], ['calm', 'will']]);
});

test('a new character submits no Stat, leaving the vocabulary to resolve it', () => {
  // shapeTrait (services/character/input.js) falls back to the vocabulary when
  // no Stat is submitted, which is the right answer for a fresh form sitting
  // on its first option.
  const html = renderPersonality({ character: {} });
  expect(html).toMatch(/name="trait0_stat"[\s\S]*?value=""/);
  expect(html).not.toMatch(/ selected>/);
});

// The round-trip that matters is the whole loop: what the form RENDERS for a
// stored character has to be what the server SHAPES back into the same three
// rows. Asserting only on the markup would miss a name/Stat pairing that the
// browser serializes one way and shapeTrait resolves another.
const { normalizeCharacterInput } = require('../services/character/input');

const submitPersonality = (html) => {
  const payload = {};
  for (const slot of [0, 1, 2]) {
    const select = html.slice(
      html.indexOf(`name="trait${slot}"`),
      html.indexOf('</select>', html.indexOf(`name="trait${slot}"`))
    );
    const chosen = select.match(/<option value="([^"]+)"[^>]*\sselected>/);
    payload[`trait${slot}`] = chosen ? chosen[1] : '';
    const hidden = html.slice(html.indexOf(`name="trait${slot}_stat"`));
    payload[`trait${slot}_stat`] = hidden.match(/value="([^"]*)"/)[1];
  }
  return payload;
};

test('submitting the rendered form preserves all three names and Stats', () => {
  const traits = [
    { name: 'brave', stat: 'might' },
    { name: 'wanderer', stat: 'arcane' },
    { name: 'calm', stat: 'will' }
  ];
  const html = renderPersonality({ character: { traits } });

  const { childData, error } = normalizeCharacterInput(submitPersonality(html), {});

  expect(error).toBeNull();
  expect(childData.traits).toEqual(traits);
});

// --- the per-Stat Cap on the EDIT form ------------------------------------
//
// routes/characters.js renders this form for the edit route and the wizard only
// for creation, so this is the ONLY surface a character is edited on after
// creation -- and a Trait's +1 Cap matters most as a character grows. A literal
// max=5 here meant a V1 character could spend that +1 while being created and
// never again. The cap is computed server-side with statCapFor
// (util/stat-caps.js) and passed in per Stat; no figure is mirrored into a
// client.

const { statCapMap } = require('../util/stat-caps');

const renderStats = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerPartial('stat-blocks', fs.readFileSync(
    path.join(__dirname, 'partials', 'stat-blocks.handlebars'), 'utf8'
  ));
  const section = FORM_SRC.slice(
    FORM_SRC.indexOf('<label class="label">Stats</label>'),
    FORM_SRC.indexOf('Signature Gear')
  );
  return hb.compile(section)({ statList, ...context });
};

// Boxes actually rendered for one Stat, counted off the radiogroup in the
// served HTML -- the blocks are server-rendered, not x-for generated.
const boxCount = (html, stat) => {
  const start = html.indexOf(`data-stat="${stat}"`);
  const group = html.slice(start, html.indexOf('</div>', start));
  return (group.match(/role="radio"/g) || []).length;
};

const renderFor = (character, economy) => renderStats({
  character,
  statCaps: statCapMap({
    statList,
    economy,
    traits: character.traits,
    capPurchases: character.stat_cap_purchases
  })
});

const ASPIRANT_TRAITS = [
  { name: 'brave', stat: 'might' },
  { name: 'calm', stat: 'will' },
  { name: 'alert', stat: 'sensory' }
];

test('a Trait raises the boxes rendered for its own Stat and no other', () => {
  const html = renderFor({ might: 6, traits: ASPIRANT_TRAITS, stat_cap_purchases: {} }, 'aspirant');

  expect(boxCount(html, 'might')).toBe(6);
  expect(boxCount(html, 'will')).toBe(6);
  expect(boxCount(html, 'luck')).toBe(5);
});

test('a purchased Cap is rendered too', () => {
  const html = renderFor(
    { traits: ASPIRANT_TRAITS, stat_cap_purchases: { luck: 2, might: 1 } },
    'aspirant'
  );

  expect(boxCount(html, 'luck')).toBe(7);
  expect(boxCount(html, 'might')).toBe(7);
});

// Advent has no Trait-Cap mechanic at all -- the +1 per Trait and the purchase
// are Aspirant rules (pg. 3, restated pg. 6) -- and 26 live advent characters
// carry two Traits on one Stat, which would otherwise read as a Cap of 7.
test('an advent character renders five boxes everywhere, Traits notwithstanding', () => {
  const html = renderFor({
    might: 2,
    traits: [
      { name: 'brave', stat: 'might' },
      { name: 'forceful', stat: 'might' },
      { name: 'calm', stat: 'will' }
    ],
    stat_cap_purchases: {}
  }, 'advent');

  for (const stat of statList) expect(boxCount(html, stat)).toBe(5);
  expect(html).toContain('statBlocks(2, 5, &quot;might&quot;)');
});

// The new-character render has no character at all, so every Cap is the base
// one and the form is exactly what it was.
test('the new-character form renders five boxes everywhere', () => {
  const html = renderStats({ statCaps: statCapMap({ statList }) });
  for (const stat of statList) expect(boxCount(html, stat)).toBe(5);
});

// A value over the rendered box count must still be visible: every block fills
// and stat-blocks' own over-count indicator carries the real number. A Cap that
// shrank the grid below a stored value would otherwise hide pluses.
test('a stored value above the box count still shows its real number', () => {
  const html = renderFor({ luck: 9, traits: ASPIRANT_TRAITS, stat_cap_purchases: {} }, 'aspirant');

  expect(boxCount(html, 'luck')).toBe(5);
  expect(html).toContain('statBlocks(9, 5, &quot;luck&quot;)');
  expect(html).toContain('x-show="value > max"');
});

// customTrait matches the vocabulary case-insensitively, like shapeTrait's own
// lookup, 20260919000000_traits_stat_affiliation.sql's backfill and the AI
// import. The `selected` comparison has to agree, or a stored "Brave" gets no
// custom option (the word IS in the vocabulary) AND no vocabulary option
// selected -- so the first option wins while the hidden Stat keeps the stored
// one, storing "indulgent" affiliated with might. Latent today: all 981 live
// trait names are lowercase.
test('a capitalized stored Trait selects its vocabulary option', () => {
  const html = renderPersonality({
    character: {
      traits: [
        { name: 'Brave', stat: 'might' },
        { name: 'sly', stat: 'reflex' },
        { name: 'calm', stat: 'will' }
      ]
    }
  });

  const selected = [...html.matchAll(/<option value="([^"]+)" data-stat="([^"]+)" selected>/g)];
  expect(selected.map(match => [match[1], match[2]]))
    .toEqual([['brave', 'might'], ['sly', 'reflex'], ['calm', 'will']]);
  // No extra option: "Brave" is a vocabulary word, not a self-made one.
  const vocabularySize = Object.values(personalityMap).flat().length;
  expect(html.match(/<option /g)).toHaveLength(vocabularySize * 3);
});

// --- the V1 Merx purchase surface ------------------------------------------
//
// This form is shared with every character in the database, nearly all of
// them on the advent content format. The purchase surface is rendered for
// the two V1 populations only -- a class whose content_format is 'aspirant',
// or a creator_mode of 'aspiring' -- and `gearPurchaseData` (built by
// util/gear-purchase-data.js, null for advent) is the single thing the
// template gates on. Everyone else must see exactly today's form.

const { buildGearPurchaseData } = require('../util/gear-purchase-data');
const { mountPurchases } = require('../test/helpers/gear-purchase-fixture');
const { buildAbilityPurchaseData } = require('../util/ability-purchase-data');

const V1_CLASS = {
  id: 'c-v1',
  name: 'Gunslinger',
  content_format: 'aspirant',
  gear: [
    { name: 'Cowboy Hat', description: 'A hat.', column: 1, position: 1 },
    { name: 'Sharps Rifle', description: 'A rifle.', column: 1, position: 2 }
  ]
};

const renderCharacterForm = (overrides = {}) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  // app.js registers `markdown` separately from the util/handlebars bundle;
  // this form reaches it only through its partials.
  hb.registerHelper('markdown', (value) => new Handlebars.SafeString(String(value ?? '')));
  const partialsDir = path.join(__dirname, 'partials');
  for (const file of fs.readdirSync(partialsDir)) {
    if (!file.endsWith('.handlebars')) continue;
    hb.registerPartial(file.replace('.handlebars', ''),
      fs.readFileSync(path.join(partialsDir, file), 'utf8'));
  }
  const character = {
    id: 'abc',
    name: 'Vex Kalloway',
    gear: [{ name: 'Cowboy Hat', class_id: 'c-v1' }],
    common_items: [],
    abilities: [],
    traits: [],
    ...overrides.character
  };
  return hb.compile(FORM_SRC)({
    isNew: false,
    character,
    statList,
    personalityMap,
    statCaps: Object.fromEntries(statList.map((s) => [s, 5])),
    classGearList: { Gunslinger: ['Cowboy Hat', 'Sharps Rifle'] },
    adventDefaultSignatures: 3,
    classAbilityList: {},
    effectiveVersion: overrides.effectiveVersion ?? 'v1',
    maxCreatedAt: '2026-09-19',
    derived: {},
    gearPurchaseData: overrides.gearPurchaseData ?? null,
    abilityPurchaseData: overrides.abilityPurchaseData ?? null
  });
};

const purchaseDataFor = (economy, characterClass) => buildGearPurchaseData({
  economy,
  characterClass,
  character: { class_id: characterClass ? characterClass.id : null, gear: [] },
  missionMerx: 0
});

test('an advent character sees today\'s form, with no purchase controls', () => {
  const html = renderCharacterForm({
    gearPurchaseData: purchaseDataFor('advent', { id: 'c-a', name: 'Ranger', gear: [] })
  });

  expect(html).toContain('name="gear[]"');
  expect(html).not.toContain('id="signaturePurchases"');
  expect(html).not.toContain('gear-purchase-data');
  expect(html).not.toContain('character-gear-purchases.js');
  expect(html).not.toContain('character-ability-purchases.js');
  expect(html).not.toContain('catalogue-controls.js');
});

test('an advent character sees no ability purchase surface', () => {
  const html = renderCharacterForm({
    character: { abilities: [{ name: 'Standoff', class_id: 'c-v1' }] }
  });

  expect(html).toContain('name="abilities[]"');
  expect(html).not.toContain('id="abilityPurchases"');
  expect(html).not.toContain('ability-purchase-data');
  expect(html).not.toContain('character-ability-purchases.js');
  expect(html).not.toContain('catalogue-controls.js');
});

test('a V1 character sees the ability purchase surface script', () => {
  const html = renderCharacterForm({
    abilityPurchaseData: buildAbilityPurchaseData({
      character: { class_id: V1_CLASS.id, abilities: [], ability_perks: [], level: 1 },
      characterClass: V1_CLASS, allClasses: [V1_CLASS], economy: 'aspirant'
    })
  });

  expect(html).toContain('id="abilityPurchases"');
  expect(html).toContain('id="ability-purchase-data"');
  expect(html).toContain('name="abilities_json"');
  expect(html).toContain('/js/character-ability-purchases.js');
  expect(html).toContain('/js/catalogue-controls.js');
  expect(html).not.toContain('name="abilities[]"');
});

test('a V1 character sees the grid', () => {
  const html = renderCharacterForm({ gearPurchaseData: purchaseDataFor('aspirant', V1_CLASS) });

  // The grid's cells are rendered by the mount, not the template, so the
  // template's part is the island and the mount points -- and the gear[]
  // selects must be gone, or the same Signatures would be submitted twice.
  expect(html).toContain('id="signaturePurchases"');
  expect(html).toContain('id="gear-purchase-data"');
  expect(html).toContain('name="gear_json"');
  expect(html).toContain('/js/signature-entry.js');
  expect(html).toContain('/js/character-gear-purchases.js');
  expect(html).toContain('/js/catalogue-controls.js');
  expect(html).not.toContain('name="gear[]"');
});

test('the mounted V1 form renders the grid the component draws', () => {
  const data = purchaseDataFor('aspirant', V1_CLASS);
  const html = renderCharacterForm({ gearPurchaseData: data });

  mountPurchases(data, { html });

  const cells = document.querySelectorAll('[data-signature-name]');
  expect([...cells].map((c) => c.getAttribute('data-signature-name')))
    .toEqual(['Cowboy Hat', 'Sharps Rifle']);
});

test('no economy figure is written into the form', () => {
  // Every price, grant and cap reaches the page through the island, never
  // through rendered prose or markup.
  const purchaseBlock = FORM_SRC.slice(FORM_SRC.indexOf('{{#if gearPurchaseData}}'));
  expect(purchaseBlock).not.toMatch(/\b(\d+)\s*Merx\b/);
  expect(purchaseBlock).not.toMatch(/Signature Cap of \d/);
});

// --- Deprecated fields -------------------------------------------------------
//
// A character whose class became v2 keeps its v1-only text. The edit form shows
// each non-empty field read-only with a clear control, and nothing else can
// change it (services/character/input.js).

const DEPRECATED = { perks: 'Old perk prose', additional_gear: 'Old gear prose' };

test('a v2 character sees its stored v1-only text as read-only Deprecated fields', () => {
  const html = renderCharacterForm({ effectiveVersion: 'v2', character: DEPRECATED });

  expect(html).toContain('Deprecated fields');
  expect(html).toContain('Old perk prose');
  expect(html).toContain('Old gear prose');
  expect(html).toMatch(/<input type="checkbox" name="clear_perks"/);
  expect(html).toMatch(/<input type="checkbox" name="clear_additional_gear"/);
  expect(html).not.toMatch(/name="perks"/);
  expect(html).not.toMatch(/name="additional_gear"/);
});

test('a v2 character is offered a clear control only for a field it has', () => {
  const html = renderCharacterForm({ effectiveVersion: 'v2', character: { perks: 'Old perk prose' } });

  expect(html).toContain('name="clear_perks"');
  expect(html).not.toContain('name="clear_additional_gear"');
});

test('a v2 character with neither field sees no Deprecated fields section', () => {
  const html = renderCharacterForm({ effectiveVersion: 'v2', character: { perks: '', additional_gear: null } });

  expect(html).not.toContain('Deprecated fields');
});

test('a v1 character edits its perks as before and sees no Deprecated fields section', () => {
  const html = renderCharacterForm({ character: DEPRECATED });

  expect(html).not.toContain('Deprecated fields');
  expect(html).toMatch(/<textarea[^>]*name="perks"/);
  expect(html).toMatch(/<textarea[^>]*name="additional_gear"/);
});
