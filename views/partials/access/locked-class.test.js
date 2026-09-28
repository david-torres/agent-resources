const { test, expect } = require('bun:test');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../../util/handlebars');
const { registerAccessPartials } = require('../../../test/helpers/access-partials');

const render = (template, context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  registerAccessPartials(hb);
  return hb.compile(template)(context);
};

const GROUPS = [{ edition: 'aspirant', classes: [{ id: 'bers', name: 'Berserker', teaser_html: '<p>Rage.</p>', locked: true }] }];

test('the form lists a locked class as a disabled option in its edition group', () => {
  const html = render('<select>{{> access/locked-class-options groups=groups}}</select>', { groups: GROUPS });
  expect(html).toContain('<optgroup label="Locked — Aspirant">');
  expect(html).toContain('<option value="" disabled>Berserker — Unlock to play</option>');
});

test('the wizard lists a locked class as a disabled entry with its teaser and CTA', () => {
  const html = render('{{> access/locked-class-list groups=groups}}', { groups: GROUPS });
  expect(html).toContain('Locked — Aspirant');
  expect(html).toContain('disabled aria-disabled="true">Berserker — Unlock to play</button>');
  expect(html).toContain('<p>Rage.</p>');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822771');
});

test('no groups render nothing', () => {
  expect(render('{{> access/locked-class-list groups=groups}}', { groups: [] }).trim()).toBe('');
  expect(render('{{> access/locked-class-options groups=groups}}', {}).trim()).toBe('');
});
