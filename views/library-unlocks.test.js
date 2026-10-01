const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

function renderUnlocks(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', fs.readFileSync(
    path.join(__dirname, 'partials', 'breadcrumbs.handlebars'), 'utf8'
  ));
  hb.registerPartial('unlock-target-options', fs.readFileSync(
    path.join(__dirname, 'partials', 'unlock-target-options.handlebars'), 'utf8'
  ));
  const src = fs.readFileSync(
    path.join(__dirname, 'library-unlocks.handlebars'), 'utf8'
  );
  return hb.compile(src)(context);
}

const PDF_A = '11111111-1111-4111-8111-111111111111';
const PDF_B = '22222222-2222-4222-8222-222222222222';
const PDF_FREE = '33333333-3333-4333-8333-333333333333';
const CLASS_EXCL = '44444444-4444-4444-8444-444444444444';

const RULES = [
  { id: PDF_A, title: 'Core Rules', edition: 'Advent v2', is_active: true },
  { id: PDF_B, title: 'Core Rules', edition: 'Advent v1', is_active: false },
  { id: PDF_FREE, title: 'Quickstart', edition: 'Advent v1', is_active: true, free_access: true }
];

const GRANTS = [
  {
    user_id: 'user-1',
    profile: { id: 'p1', name: 'Alice' },
    granter: { id: 'p9', name: 'Dave' },
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    unlocked_at: '2026-08-01T00:00:00Z',
    expires_at: null,
    isExpired: false
  },
  {
    user_id: 'user-2',
    profile: { id: 'p2', name: 'Bob' },
    granter: null,
    rules_pdf: { id: PDF_B, title: 'Core Rules', edition: 'Advent v1' },
    unlocked_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    isExpired: true
  }
];

const CODES = [
  {
    id: 'code-row-1',
    code: 'abc123def456ghi7',
    rules_pdf_id: PDF_A,
    created_at: '2026-08-10T00:00:00Z',
    expires_at: null,
    max_uses: 5,
    used_count: 2,
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    creator: { id: 'p9', name: 'Dave' },
    isUsable: true
  },
  {
    id: 'code-row-2',
    code: 'zzz999yyy888xxx7',
    rules_pdf_id: PDF_A,
    created_at: '2026-07-01T00:00:00Z',
    expires_at: null,
    max_uses: 1,
    used_count: 1,
    rules_pdf: { id: PDF_A, title: 'Core Rules', edition: 'Advent v2' },
    creator: null,
    isUsable: false
  }
];

const UNLOCKABLE_CLASSES = [{ id: CLASS_EXCL, label: 'Arbiter (Aspirant)' }];

const CONTEXT = { rules: RULES, unlockableRules: [RULES[0]], unlockableClasses: UNLOCKABLE_CLASSES, grants: GRANTS, codes: CODES, breadcrumbs: [] };

test('grant and code selectors show one paid version per family; history filter retains all PDFs', () => {
  const html = renderUnlocks(CONTEXT);
  for (const id of ['grant-document', 'codes-document']) {
    const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))[1];
    expect(select).toContain(`value="pdf:${PDF_A}"`);
    expect(select).not.toContain(PDF_B);
    expect(select).not.toContain(PDF_FREE);
    expect(select).toContain('>Core Rules<');
  }
  const filter = html.match(/<select id="filter-document"[^>]*>([\s\S]*?)<\/select>/)[1];
  expect(filter).toContain(`value="${PDF_FREE}"`);
  expect(filter).toContain(`value="${PDF_B}"`);
});

test('grant form posts unlock_target to /library/unlocks', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('action="/library/unlocks"');
  expect(html).not.toContain('name="rules_pdf_id"');
  expect(html).toContain('name="profile_name"');
  expect(html).toContain('name="profile_id"');
});

test('both document selects are named unlock_target and group Rulebooks apart from Exclusive Classes', () => {
  const html = renderUnlocks(CONTEXT);
  for (const id of ['grant-document', 'codes-document']) {
    const selectTag = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>`))[0];
    expect(selectTag).toContain('name="unlock_target"');
    const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))[1];
    const rulebooks = select.match(/<optgroup label="Rulebooks">([\s\S]*?)<\/optgroup>/)[1];
    expect(rulebooks).toContain(`value="pdf:${PDF_A}"`);
    const classes = select.match(/<optgroup label="Exclusive Classes">([\s\S]*?)<\/optgroup>/)[1];
    expect(classes).toContain(`value="class:${CLASS_EXCL}"`);
    expect(classes).toContain('>Arbiter (Aspirant)<');
  }
});

test('codes form hx-posts to /library/codes with a codeResult target', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('hx-post="/library/codes"');
  expect(html).toContain('hx-target="#codeResult"');
  expect(html).toContain('id="codeResult"');
  expect(html).toContain('name="max_uses"');
  expect(html).toContain('name="amount"');
});

test('document history filter labels inactive PDFs', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain(`Core Rules — Advent v2`);
  expect(html).toContain(`Core Rules — Advent v1 (inactive)`);
});

test('unlock rows carry the filter data attributes', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain(`data-document-id="${PDF_A}" data-profile-name="Alice" data-expired="false"`);
  expect(html).toContain(`data-document-id="${PDF_B}" data-profile-name="Bob" data-expired="true"`);
});

test('expired grants render an Expired tag; non-expiring grants a No expiration tag', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('>Expired<');
  expect(html).toContain('>No expiration<');
});

test('revoke button targets the grant row endpoint', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain(`hx-delete="/library/${PDF_A}/unlocks/user-1"`);
});

test('code rows carry data-usable and show used/max', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('data-usable="true"');
  expect(html).toContain('data-usable="false"');
  expect(html).toContain('2/5');
  expect(html).toContain('1/1');
});

test('empty states render without tables', () => {
  const html = renderUnlocks({ rules: RULES, grants: [], codes: [], breadcrumbs: [] });
  expect(html).toContain('No unlocks yet.');
  expect(html).toContain('No codes yet.');
  expect(html).not.toContain('id="unlocks-table"');
  expect(html).not.toContain('id="codes-table"');
});

test('filter controls default to active unlocks and usable codes', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('id="filter-document"');
  expect(html).toContain('id="filter-profile"');
  expect(html).toContain('<option value="active" selected>');
  expect(html).toContain('<option value="usable" selected>');
});

test('form document selects force an explicit choice via a disabled placeholder', () => {
  const html = renderUnlocks(CONTEXT);
  const placeholders = html.match(/<option value="" selected disabled>Select a document…<\/option>/g) || [];
  expect(placeholders.length).toBe(2);
});

// Granting a core book confers that ruleset's classes as a side effect
// (models/class.js#getEffectiveClassUnlocks). Nothing on the form said so.
test('the grant form warns that a core book also confers its ruleset classes', () => {
  const src = fs.readFileSync(path.join(__dirname, 'library-unlocks.handlebars'), 'utf8');
  const grantForm = src.slice(src.indexOf('action="/library/unlocks"'));

  expect(grantForm.slice(0, grantForm.indexOf('</form>'))).toContain('core rulebook');
});
