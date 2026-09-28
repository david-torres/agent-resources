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
  return hb.compile(fs.readFileSync(path.join(__dirname, 'class-view-teaser.handlebars'), 'utf8'))({
    profile: { name: 'Alice', timezone: 'UTC' },
    class: { id: 'gun', name: 'Gunslinger', status: 'release', rules_edition: 'advent', rules_version: 'v1', teaser: 'Quick on the draw.' },
    ...context
  });
};

test('a lapsed trial heads the teaser with when it ended and how to unlock', () => {
  const html = render({ adventTrialEndedAt: '2026-09-20T12:00:00Z' });
  const noticeAt = html.indexOf('Your Advent free trial ended Sep 20, 2026.');
  expect(noticeAt).toBeGreaterThan(-1);
  expect(noticeAt).toBeLessThan(html.indexOf('About this class'));
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822768');
});

test('no lapsed trial, no header', () => {
  expect(render({})).not.toContain('free trial ended');
});
