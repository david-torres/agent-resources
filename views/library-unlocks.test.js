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
  const src = fs.readFileSync(
    path.join(__dirname, 'library-unlocks.handlebars'), 'utf8'
  );
  return hb.compile(src)(context);
}

const PDF_A = '11111111-1111-4111-8111-111111111111';
const PDF_B = '22222222-2222-4222-8222-222222222222';

const RULES = [
  { id: PDF_A, title: 'Core Rules', edition: 'Advent v2', is_active: true },
  { id: PDF_B, title: 'Core Rules', edition: 'Advent v1', is_active: false }
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

const CONTEXT = { rules: RULES, grants: GRANTS, codes: CODES, breadcrumbs: [] };

test('grant form posts rules_pdf_id to /library/unlocks', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('action="/library/unlocks"');
  expect(html).toContain('name="rules_pdf_id"');
  expect(html).toContain('name="profile_name"');
  expect(html).toContain('name="profile_id"');
});

test('codes form hx-posts to /library/codes with a codeResult target', () => {
  const html = renderUnlocks(CONTEXT);
  expect(html).toContain('hx-post="/library/codes"');
  expect(html).toContain('hx-target="#codeResult"');
  expect(html).toContain('id="codeResult"');
  expect(html).toContain('name="max_uses"');
  expect(html).toContain('name="amount"');
});

test('document selects label inactive PDFs', () => {
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
