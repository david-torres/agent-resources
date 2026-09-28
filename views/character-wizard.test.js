const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const customHelpers = require('../util/handlebars');
const { economyFigures } = require('../util/merx-economy');
const { registerAccessPartials } = require('../test/helpers/access-partials');

const SOURCE_PATH = path.join(__dirname, 'character-wizard.handlebars');
const SRC = fs.readFileSync(SOURCE_PATH, 'utf8');

// The real gate: the .handlebars SOURCE must never hand-write a Merx figure.
// A served interpolation like `{{economy.prices.signature.own}} Merx` has no
// digit before "Merx" until Handlebars compiles it, so this only matches a
// literal typed straight into the prose.
test('the wizard view source writes down no Merx price', () => {
  const prose = SRC.replace(/<script[\s\S]*?<\/script>/g, '');
  expect(prose).not.toMatch(/\d+\s*Merx/i);
});

// Everything past the top of the file is drawn client-side from the
// `wizard-data` JSON island (public/js/character-wizard.js); the template
// itself only branches on `mode` and interpolates `economy`/`state`, so a
// minimal context is enough to render the real markup.
const renderWizardView = ({ mode, wizardData, ...extra }) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  registerAccessPartials(hb);
  return hb.compile(SRC)({
    mode,
    economy: economyFigures(),
    state: {},
    wizardData,
    ...extra
  });
};

const fixture = ({ mode }) => ({ mode, classes: [], statList: [], personalityMap: {} });

test.each(['advent', 'aspirant', 'aspiring'])(
  "the rendered %s wizard's merxBudget span carries a served figure, not an empty default", (mode) => {
    const html = renderWizardView({ mode, wizardData: fixture({ mode }) });
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '');

    // The span renders `{{lookup economy.grants mode}}` server-side -- a
    // correct pre-JavaScript default (the client overwrites it on first
    // render once a class is chosen). An empty span would be strictly worse:
    // it shows nothing at all if scripts fail to load. Asserting the value
    // matches the served grants (not a literal typed into the template)
    // proves it came from economyFigures(), not from a copy sitting in the
    // view.
    const budgetMatch = body.match(/<span id="merxBudget">([^<]*)<\/span>/);
    expect(budgetMatch).toBeTruthy();
    const rendered = budgetMatch[1].trim();
    expect(rendered).not.toBe('');
    expect(rendered).toBe(String(economyFigures().grants[mode]));
  }
);

// Step 1's Advent | Aspirant toggle reloads the wizard in the other mode, so
// the class cards and the creation rules always come from the same mode.
test.each(['advent', 'aspirant'])('the %s wizard offers a toggle to either mode, marking its own', (mode) => {
  const html = renderWizardView({ mode, wizardData: fixture({ mode }) });
  const toggle = html.match(/<div class="buttons has-addons[^"]*" id="wizardModeToggle"[^>]*>([\s\S]*?)<\/div>/);
  expect(toggle).toBeTruthy();
  const links = [...toggle[1].matchAll(/<a([^>]*)>\s*([^<]*?)\s*<\/a>/g)]
    .map(([, attrs, label]) => ({ attrs, label }));
  expect(links.map((l) => l.label)).toEqual(['Advent', 'Aspirant']);
  expect(links[0].attrs).toContain('href="/characters/wizard?mode=advent"');
  expect(links[1].attrs).toContain('href="/characters/wizard?mode=aspirant"');
  const selected = links.filter((l) => l.attrs.includes('is-selected'));
  expect(selected.map((l) => l.label.toLowerCase())).toEqual([mode]);
  expect(selected[0].attrs).toContain('aria-current="true"');
});

test('the aspiring wizard has no mode toggle', () => {
  const html = renderWizardView({ mode: 'aspiring', wizardData: fixture({ mode: 'aspiring' }) });
  expect(html).not.toContain('wizardModeToggle');
});

const LOCKED = [{ edition: 'aspirant', classes: [{ id: 'bers', name: 'Berserker', teaser_html: '<p>Rage.</p>', locked: true }] }];

test('locked classes sit beside the kiosk as disabled Unlock to play entries', () => {
  const html = renderWizardView({ mode: 'advent', wizardData: fixture({ mode: 'advent' }), lockedClassGroups: LOCKED });
  const lockedAt = html.indexOf('Berserker — Unlock to play');
  expect(lockedAt).toBeGreaterThan(html.indexOf('id="classKiosk"'));
  expect(lockedAt).toBeLessThan(html.indexOf('id="selectedClassPanel"'));
});

test('a lapsed trial alerts above the class pickers', () => {
  const html = renderWizardView({
    mode: 'advent', wizardData: fixture({ mode: 'advent' }),
    profile: { timezone: 'UTC' }, adventTrialEndedAt: '2026-09-20T12:00:00Z'
  });
  const alertAt = html.indexOf('Advent classes are locked because your Advent free trial ended Sep 20, 2026.');
  expect(alertAt).toBeGreaterThan(-1);
  expect(alertAt).toBeLessThan(html.indexOf('id="classKiosk"'));
});

test('the aspiring builder shows no locked list', () => {
  const html = renderWizardView({ mode: 'aspiring', wizardData: fixture({ mode: 'aspiring' }), lockedClassGroups: LOCKED });
  expect(html).not.toContain('Unlock to play');
});
