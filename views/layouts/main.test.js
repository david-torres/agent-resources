const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../util/handlebars');
const { registerAccessPartials } = require('../../test/helpers/access-partials');

const LAYOUT = fs.readFileSync(path.join(__dirname, 'main.handlebars'), 'utf8');
const SYSTEM_BANNER = fs.readFileSync(path.join(__dirname, '..', 'partials', 'alert', 'system-banner.handlebars'), 'utf8');

const renderLayout = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  for (const name of ['head', 'nav', 'feedback-widget']) hb.registerPartial(name, '');
  hb.registerPartial('alert/system-banner', SYSTEM_BANNER);
  registerAccessPartials(hb);
  return hb.compile(LAYOUT)(context);
};

const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };

test('the access banner sits above the system banner', () => {
  const html = renderLayout({
    profile: { timezone: 'UTC' },
    editionAccess: TRIAL,
    systemMessage: { id: 'm1', level: 'info', text: 'Maintenance tonight' }
  });
  const bannerAt = html.indexOf('data-access-banner');
  expect(bannerAt).toBeGreaterThan(-1);
  expect(bannerAt).toBeLessThan(html.indexOf('id="system-banner"'));
});

test('a signed-out page renders without a banner', () => {
  expect(renderLayout({ profile: null })).not.toContain('data-access-banner');
});

test('a failed status lookup renders the page without a banner', () => {
  expect(renderLayout({ profile: { timezone: 'UTC' }, editionAccess: null })).not.toContain('data-access-banner');
});
