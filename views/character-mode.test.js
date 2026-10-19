const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const helpers = require('../util/handlebars');
const hb = Handlebars.create();
hb.registerHelper(require('handlebars-helpers')());
hb.registerHelper(helpers);
hb.registerPartial('breadcrumbs', '');
hb.registerPartial('private-badge', '');
const advent = { rules_edition: 'advent', rules_version: 'v1', content_format: 'advent' };
const aspirant = { rules_edition: 'aspirant', rules_version: 'v1', content_format: 'aspirant' };

for (const [mode, classRules, expected] of [
  ['aspirant', advent, 'Aspirant'],
  ['advent', advent, 'Advent'],
  [null, advent, 'Advent'],
  [null, aspirant, 'Aspirant'],
  ['aspiring', null, 'Aspiring'],
]) {
  test(`character mode ${mode} with ${classRules?.content_format} class displays ${expected}`, () => {
    const character = { creator_mode: mode, linked_class: classRules, name: 'Ash' };
    for (const file of ['character.handlebars', 'character-form.handlebars']) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
      const header = source.slice(source.indexOf('<div class="tags mb-4">'), source.indexOf('</div>', source.indexOf('<div class="tags mb-4">')) + 6);
      const html = hb.compile(header)({ character, characterClass: classRules });
      expect(html).toContain(`Mode: ${expected}`);
      if (classRules) expect(html).toContain(`Class edition: ${classRules.rules_edition === 'advent' ? 'Advent' : 'Aspirant'} v1`);
    }
    const html = hb.compile(fs.readFileSync(path.join(__dirname, 'character-list.handlebars'), 'utf8'))({ characters: [character] });
    expect(html).toContain(`data-sort-value="${expected}"`);
    expect(html).toContain(`class="tag is-primary">${expected}</span>`);
  });
}
