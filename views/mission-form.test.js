const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const { registerAccessPartials } = require('../test/helpers/access-partials');

const SRC = fs.readFileSync(path.join(__dirname, 'mission-form.handlebars'), 'utf8');

const renderMissionForm = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', '');
  hb.registerPartial('selected-character-item', '');
  registerAccessPartials(hb);
  return hb.compile(SRC)({ profile: { id: 'profile-1', timezone: 'UTC' }, ...context });
};

const EXISTING = { id: 'mission-1', name: 'Silent Harbor', outcome: 'success' };

test('with Aspirant book access the form offers Difficulty and Danger choices', () => {
  const html = renderMissionForm({ isNew: true, canUseAspirant: true });
  expect(html).toContain('name="difficulty"');
  expect(html).toContain('name="danger"');
  expect(html).not.toContain('data-upsell-edition="aspirant"');
});

test('without Aspirant book access the form hides the stakes choices and promotes the book', () => {
  const html = renderMissionForm({ isNew: true, canUseAspirant: false });
  expect(html).not.toContain('name="difficulty"');
  expect(html).not.toContain('name="danger"');
  expect(html).toContain('High stakes');
  expect(html).toContain('Buy Aspirant');
  expect(html).toContain('/classes/redeem/bulk');
});

test('without Aspirant book access an existing high-stakes mission still shows its stakes read-only', () => {
  const html = renderMissionForm({ isNew: false, canUseAspirant: false, mission: { ...EXISTING, difficulty: 'crisis', danger: 'critical' } });
  expect(html).not.toContain('name="difficulty"');
  expect(html).not.toContain('name="danger"');
  expect(html).not.toMatch(/<(select|input)[^>]*mission-(difficulty|danger)/);
  expect(html).toMatch(/Difficulty(<[^>]*>|[\s:])*Crisis/);
  expect(html).toMatch(/Danger(<[^>]*>|[\s:])*Critical/);
  expect(html).toContain('Buy Aspirant');
});
