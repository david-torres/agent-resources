const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../util/handlebars');
const { registerAccessPartials } = require('../../test/helpers/access-partials');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  registerAccessPartials(hb);
  return hb.compile(fs.readFileSync(path.join(__dirname, 'library-book.handlebars'), 'utf8'))({
    profile: { timezone: 'UTC' },
    ...context
  });
};

const book = (over = {}) => ({
  primary: {
    id: 'adv', title: 'Enclave: Advent', edition: 'v1', book_type: 'core', rules_edition: 'advent',
    canView: true, isUnlocked: true, expires_at: '2026-10-08T12:00:00Z', ...over
  },
  previous: []
});
const TRIAL = { advent: { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false }, aspirant: { state: 'none' } };

test('the Advent book card carries the TRIAL badge during the trial', () => {
  const html = render({ ...book(), editionAccess: TRIAL });
  expect(html).toContain('TRIAL · ends Oct 8, 2026');
  expect(html).not.toContain('Expires');
});

test('a supplement card never carries the TRIAL badge', () => {
  const html = render({ ...book({ book_type: 'supplement', title: 'GM Screen' }), editionAccess: TRIAL });
  expect(html).not.toContain('TRIAL ·');
  expect(html).toContain('Expires');
});

test('a lapsed core book card offers its edition CTA', () => {
  const html = render({
    ...book({ canView: false, isUnlocked: true, expires_at: '2026-09-20T12:00:00Z' }),
    editionAccess: { advent: { state: 'expired', endedAt: '2026-09-20T12:00:00Z' }, aspirant: { state: 'none' } }
  });
  expect(html).toContain('Access expired');
  expect(html).toContain('https://enclave-aspirant.backerkit.com/hosted_preorders/822768');
});

test('a lapsed supplement card offers no CTA', () => {
  const html = render({ ...book({ book_type: 'supplement', canView: false, isUnlocked: true }) });
  expect(html).toContain('Access expired');
  expect(html).not.toContain('backerkit');
});
