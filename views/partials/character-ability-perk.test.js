const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

function renderPartial(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  const src = fs.readFileSync(
    path.join(__dirname, 'character-ability-perk.handlebars'),
    'utf8'
  );
  return hb.compile(src)(context);
}

test('character-ability-perk renders sibling-perk compound options without a missing-helper error', () => {
  const html = renderPartial({
    abilityId: 'ability-1',
    position: 1,
    perk: { text: 'Deal extra damage', compounds_with: 'position-0' },
    siblingPerks: [
      { position: 0, text: 'First perk' },
      { position: 1, text: 'Second perk' }
    ]
  });

  // The sibling at position 0 produces a compound option (the current perk at
  // position 1 is excluded by the #unless guard).
  expect(html).toContain('value="position-0"');
  // The current perk compounds_with "position-0", so that option is selected —
  // this is the comparison that used the previously-missing concat helper.
  expect(html).toMatch(/<option value="position-0"\s+selected>/);
});

test('character-ability-perk leaves compound options unselected when nothing compounds', () => {
  const html = renderPartial({
    abilityId: 'ability-1',
    position: 1,
    perk: { text: 'Standalone perk', compounds_with: '' },
    siblingPerks: [
      { position: 0, text: 'First perk' },
      { position: 1, text: 'Second perk' }
    ]
  });

  expect(html).toContain('value="position-0"');
  expect(html).not.toContain('selected');
});
