const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../../util/handlebars');
const handlebarsHelpers = require('handlebars-helpers')();

function render(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  const perkSrc = fs.readFileSync(path.join(__dirname, 'character-ability-perk.handlebars'), 'utf8');
  hb.registerPartial('character-ability-perk', perkSrc);
  const src = fs.readFileSync(path.join(__dirname, 'character-perk-group.handlebars'), 'utf8');
  return hb.compile(src)(context);
}

test('perk group uses linkValue for data-ability-id and the Add Perk request', () => {
  // linkValue and domKey are deliberately different here to verify each is
  // wired to the right attributes (linkValue -> data/URL, domKey -> element ids).
  const html = render({
    linkValue: 'Quick Strike',
    domKey: 'g0',
    abilityName: 'Quick Strike',
    abilityPerks: []
  });
  expect(html).toContain('data-ability-id="Quick Strike"');
  expect(html).toContain('id="perks-list-g0"');
  expect(html).toContain('ability_id=Quick%20Strike');
  expect(html).toContain('hx-target="#perks-list-g0"');
  expect(html).toContain('Quick Strike</h4>');
});

test('perk group renders existing perks for the ability (edit/server path keyed by id)', () => {
  const html = render({
    linkValue: 'ability-1',
    domKey: 'ability-1',
    abilityName: 'Strike',
    abilityPerks: [
      { class_ability_id: 'ability-1', text: 'Deal +1', position: 0, compounds_with: null }
    ]
  });
  expect(html).toContain('value="Deal +1"');
  expect(html).toContain('value="ability-1"');
});
