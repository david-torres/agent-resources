const { test, expect } = require('bun:test');
const fs = require('node:fs');
const Handlebars = require('handlebars');
const { JSDOM } = require('jsdom');
const { groupRulesVersions, buildLibrarySections } = require('../util/library-list-grouping');
const { registerAccessPartials } = require('../test/helpers/access-partials');
const hb = Handlebars.create();
hb.registerHelper(require('handlebars-helpers')());
hb.registerHelper(require('../util/handlebars'));
hb.registerPartial('breadcrumbs', '');
registerAccessPartials(hb);
hb.registerPartial('library-book', fs.readFileSync(`${__dirname}/partials/library-book.handlebars`, 'utf8'));
hb.registerHelper('date_tz', value => value);
const render = hb.compile(fs.readFileSync(`${__dirname}/library.handlebars`, 'utf8'));
const rows = [
  { id: 'glossary', title: 'Keyword Glossary', rules_edition: 'advent', book_type: 'supplement', free_access: true, canView: true },
  { id: 'expansion', title: 'Enclave: Aspirant', rules_edition: 'aspirant', book_type: 'core' },
  { id: 'core', title: 'Enclave: Advent', rules_edition: 'advent', book_type: 'core', canView: true, expires_at: '2026-10-01' },
  { id: 'start', title: 'Quickstart', rules_edition: 'advent', free_access: true, canView: true },
  { id: 'other', title: 'Bestiary', rules_edition: 'advent', book_type: 'supplement' }
];
const context = data => ({ librarySections: buildLibrarySections(groupRulesVersions(data)) });

test('reading order separates free essentials, core rules, expansion and references', () => {
  const doc = new JSDOM(render(context(rows))).window.document;
  expect([...doc.querySelectorAll('section')].map(s => s.id)).toEqual(['quickstart', 'advent', 'aspirant', 'reference']);
  expect(doc.querySelector('#advent').textContent).toContain('30-day free trial');
  expect(doc.querySelector('#advent a').getAttribute('href')).toBe('/library/core/view');
  expect(doc.querySelector('#quickstart a').getAttribute('href')).toBe('/library/start/view');
  expect(doc.querySelector('#aspirant').textContent).toContain('Unlock required');
  expect(doc.querySelector('#aspirant a')).toBeNull();
  expect(doc.querySelector('#reference').textContent).toContain('Bestiary');
  expect(doc.querySelector('#reference a').getAttribute('href')).toBe('/library/glossary/view');
});

test('expired grants and admin overrides retain their access states', () => {
  const expired = { ...rows[2], canView: false, isUnlocked: true };
  const html = render(context([expired]));
  expect(html).toContain('Access expired 2026-10-01');
  expect(html).not.toContain('/library/core/view');
  const admin = render({ ...context([{ ...expired, canView: true, isAdminOverride: true }]), isAdmin: true });
  expect(admin).toContain('Admin Override');
  expect(admin).toContain('/library/core/view');
  expect(admin).toContain('/library/manage');
});

test('previous versions stay with their book and empty sections remain navigable', () => {
  const html = render(context([{ ...rows[0], edition: 'v2' }, { ...rows[0], id: 'old', edition: 'v1' }]));
  expect(html).toContain('/library/old/view');
  expect(html).toContain('No PDFs available in this section yet.');
  expect(render(context([]))).toContain('Fillable Character Sheet');
});
