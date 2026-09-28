const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const { registerAccessPartials } = require('../test/helpers/access-partials');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', '');
  registerAccessPartials(hb);
  return hb.compile(fs.readFileSync(path.join(__dirname, 'library-locked.handlebars'), 'utf8'))({
    profile: { timezone: 'UTC' },
    rulesPdf: { id: 'adv', title: 'Enclave: Advent' },
    ...context
  });
};

test('a lapsed trial names the end date and offers the Advent CTA', () => {
  const html = render({ edition: 'advent', trialEndedAt: '2026-09-20T12:00:00Z' });
  expect(html).toContain('Enclave: Advent is locked');
  expect(html).toContain('Your Advent free trial ended Sep 20, 2026.');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822768');
});

test('otherwise it is a generic locked message with the CTA', () => {
  const html = render({ edition: 'advent', trialEndedAt: null });
  expect(html).toContain('You need an unlock to read this rulebook.');
  expect(html).not.toContain('free trial ended');
  expect(html).toContain('Buy Advent');
});

test('a book with no edition gets a redeem-only CTA', () => {
  const html = render({ edition: null, trialEndedAt: null });
  expect(html).not.toContain('Buy ');
  expect(html).toContain('Redeem a code');
});
