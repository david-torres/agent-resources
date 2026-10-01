const { test, expect } = require('bun:test');
const Handlebars = require('handlebars');
const handlebarsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../../util/handlebars');
const { registerAccessPartials } = require('../../../test/helpers/access-partials');
const { EDITION_PURCHASE_URLS, EDITION_LABELS } = require('../../../util/starter-content');

const ADVENT_URL = 'https://enclave-aspirant.backerkit.com/hosted_preorders/822768';
const ASPIRANT_URL = 'https://enclave-aspirant.backerkit.com/hosted_preorders/822771';

const render = (template, context = {}, helperOverrides = {}) => {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper(helperOverrides);
  registerAccessPartials(hb);
  return hb.compile(template)({ profile: { timezone: 'UTC' }, ...context });
};

test('each edition has its own purchase page and label', () => {
  expect(EDITION_PURCHASE_URLS).toEqual({ advent: ADVENT_URL, aspirant: ASPIRANT_URL });
  expect(EDITION_LABELS).toEqual({ advent: 'Advent', aspirant: 'Aspirant' });
});

test("the Advent CTA links to Advent's purchase page, not Aspirant's", () => {
  const html = render('{{> access/unlock-cta edition="advent"}}');
  expect(html).toContain(`href="${ADVENT_URL}"`);
  expect(html).toContain('Buy Advent');
  expect(html).not.toContain(ASPIRANT_URL);
});

test("the Aspirant CTA links to Aspirant's purchase page, not Advent's", () => {
  const html = render('{{> access/unlock-cta edition="aspirant"}}');
  expect(html).toContain(`href="${ASPIRANT_URL}"`);
  expect(html).toContain('Buy Aspirant');
  expect(html).not.toContain(ADVENT_URL);
});

test('the purchase link opens in a new tab without an opener', () => {
  expect(render('{{> access/unlock-cta edition="advent"}}')).toContain('target="_blank" rel="noopener noreferrer"');
});

test('every CTA offers code redemption', () => {
  const html = render('{{> access/unlock-cta edition="advent"}}');
  expect(html).toContain('href="/classes/redeem/bulk"');
  expect(html).toContain('Redeem a code');
});

test('with no purchase URL configured the CTA is redeem-only', () => {
  const html = render('{{> access/unlock-cta edition="advent"}}', {}, { edition_purchase_url: () => '' });
  expect(html).not.toContain('Buy ');
  expect(html).toContain('Redeem a code');
});

test('an unknown edition gets a redeem-only CTA', () => {
  const html = render('{{> access/unlock-cta edition=edition}}', { edition: null });
  expect(html).not.toContain('Buy ');
  expect(html).toContain('Redeem a code');
});

test('the edition helpers answer empty for an unknown edition', () => {
  expect(customHelpers.edition_label('advent')).toBe('Advent');
  expect(customHelpers.edition_label('bogus')).toBe('');
  expect(customHelpers.edition_purchase_url('bogus')).toBe('');
});

const TRIAL = { state: 'trial', endsAt: '2026-10-08T12:00:00Z', daysLeft: 10, urgent: false, endsToday: false };

test('a trial badge names the end date in warning colours', () => {
  const html = render('{{> access/trial-badge status=status}}', { status: TRIAL });
  expect(html).toContain('TRIAL · ends Oct 8, 2026');
  expect(html).toContain('is-warning');
  expect(html).toContain('data-trial-badge');
});

test('an urgent trial badge turns danger', () => {
  const html = render('{{> access/trial-badge status=status}}', { status: { ...TRIAL, daysLeft: 3, urgent: true } });
  expect(html).toContain('is-danger');
  expect(html).not.toContain('is-warning');
});

test('a trial-ended alert completes its lead with the end date and offers the CTA', () => {
  const html = render(
    '{{> access/trial-ended-alert lead="Ability and gear descriptions are hidden because" edition="advent" endedAt=endedAt}}',
    { endedAt: '2026-09-20T12:00:00Z' }
  );
  expect(html).toContain('Ability and gear descriptions are hidden because your Advent free trial ended Sep 20, 2026.');
  expect(html).toContain('role="alert"');
  expect(html).toContain('notification is-danger');
  expect(html).toContain(`href="${ADVENT_URL}"`);
});

test('a trial-ended alert without a lead reads as a sentence of its own', () => {
  const html = render('{{> access/trial-ended-alert edition="advent" endedAt=endedAt}}', { endedAt: '2026-09-20T12:00:00Z' });
  expect(html).toContain('Your Advent free trial ended Sep 20, 2026.');
});

test('the trial-ended sentence renders with and without a lead', () => {
  const context = { endedAt: '2026-09-20T12:00:00Z' };
  expect(render('{{> access/trial-ended-text edition="advent" endedAt=endedAt lead=null}}', context).trim())
    .toBe('Your Advent free trial ended Sep 20, 2026.');
  expect(render('{{> access/trial-ended-text edition="aspirant" endedAt=endedAt lead="Heads up:"}}', context).trim())
    .toBe('Heads up: your Aspirant free trial ended Sep 20, 2026.');
});

test('the edition upsell shows each locked edition as its label, blurb, and CTA, without a class list', () => {
  const upsell = [
    { edition: 'advent', label: 'Advent', blurb: 'Unlock the Advent rulebook and its six core classes.' },
    { edition: 'aspirant', label: 'Aspirant', blurb: 'Unlock the full Aspirant versions of the six base classes, plus six new Aspirant classes.' }
  ];
  const html = render('{{> access/edition-upsell upsell=upsell}}', { upsell });
  const panels = html.split('data-upsell-edition=').slice(1);
  expect(panels).toHaveLength(2);
  expect(panels[0]).toMatch(/<span>Advent<\/span>/);
  expect(panels[0]).toContain('<p>Unlock the Advent rulebook and its six core classes.</p>');
  expect(panels[0]).toContain(`href="${ADVENT_URL}"`);
  expect(panels[1]).toMatch(/<span>Aspirant<\/span>/);
  expect(panels[1]).toContain('<p>Unlock the full Aspirant versions of the six base classes, plus six new Aspirant classes.</p>');
  expect(panels[1]).toContain(`href="${ASPIRANT_URL}"`);
  expect(html).toContain('fa-lock');
  expect(html).not.toContain('<ul');
  expect(html).not.toMatch(/href="\/classes\/(?!redeem\/)/);
});

test('the Aspirant feature upsell explains creation and conversion and links to buying and redemption', () => {
  const html = render('{{> access/aspirant-feature-upsell}}');
  expect(html).toContain('Aspiring');
  expect(html).toContain('convert an Advent character');
  expect(html).toContain('Buy Aspirant');
  expect(html).toContain(EDITION_PURCHASE_URLS.aspirant);
  expect(html).toContain('/classes/redeem/bulk');
});
