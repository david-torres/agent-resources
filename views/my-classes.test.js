const { test, expect, beforeAll, beforeEach } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

const source = () => fs.readFileSync(
  path.join(__dirname, 'my-classes.handlebars'), 'utf8'
);

test('my-classes has no unreachable historyModal markup', () => {
  expect(source()).not.toContain('historyModal');
});

test('my-classes still renders the duplicate modal', () => {
  expect(source()).toContain('duplicateModal-');
});

test('my-classes no longer calls App.openModal or App.closeModal', () => {
  expect(source()).not.toContain('App.openModal');
  expect(source()).not.toContain('App.closeModal');
});

// Renders the real template (not a hand-written copy) through a Handlebars
// instance with the same helpers registered in production, so the
// {{#each}} loop genuinely emits a distinct modal name per row -- see
// views/partials/character-ability-perk.test.js for the same pattern.
function renderMyClasses(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('breadcrumbs', fs.readFileSync(
    path.join(__dirname, 'partials', 'breadcrumbs.handlebars'), 'utf8'
  ));
  hb.registerPartial('private-badge', fs.readFileSync(
    path.join(__dirname, 'partials', 'private-badge.handlebars'), 'utf8'
  ));
  const src = fs.readFileSync(
    path.join(__dirname, 'my-classes.handlebars'),
    'utf8'
  );
  return hb.compile(src)(context);
}

const THREE_CLASSES = {
  filters: { rules_edition: '', rules_version: '', status: '' },
  classes: [
    { id: 'class-1', name: 'Alpha', status: 'release', is_public: true, rules_edition: 'advent', rules_version: 'v1' },
    { id: 'class-2', name: 'Beta', status: 'beta', is_public: false, rules_edition: 'advent', rules_version: 'v2' },
    { id: 'class-3', name: 'Gamma', status: 'alpha', is_public: true, rules_edition: 'aspirant', rules_version: 'v1' }
  ]
};

const { setupAlpine, render, tick } = require('../test/helpers/alpine-dom');

beforeAll(async () => {
  await setupAlpine();
  require('../public/js/alpine-components.js');
  document.dispatchEvent(new window.CustomEvent('alpine:init'));
});

beforeEach(() => {
  document.body.classList.remove('modal-open');
});

test('the real my-classes template gives each row a distinct modal name', () => {
  const html = renderMyClasses(THREE_CLASSES);
  expect(html).toContain("modal('duplicate-class-1')");
  expect(html).toContain("modal('duplicate-class-2')");
  expect(html).toContain("modal('duplicate-class-3')");
  expect(html).toContain("$dispatch('open-modal', 'duplicate-class-1')");
  expect(html).toContain("$dispatch('open-modal', 'duplicate-class-2')");
  expect(html).toContain("$dispatch('open-modal', 'duplicate-class-3')");
});

test('opening row 2 leaves rows 1 and 3 closed, on the real rendered template', async () => {
  const html = renderMyClasses(THREE_CLASSES);
  await render(html);

  document.querySelector('#row-class-2 .button.is-info').click();
  await tick();

  expect(document.getElementById('duplicateModal-class-1').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('duplicateModal-class-2').classList.contains('is-active')).toBe(true);
  expect(document.getElementById('duplicateModal-class-3').classList.contains('is-active')).toBe(false);
  expect(document.body.classList.contains('modal-open')).toBe(true);
});

test('closing row 2 then opening row 3 opens only row 3, on the real rendered template', async () => {
  const html = renderMyClasses(THREE_CLASSES);
  await render(html);

  document.querySelector('#row-class-2 .button.is-info').click();
  await tick();
  document.querySelector('#duplicateModal-class-2 .delete').click();
  await tick();

  document.querySelector('#row-class-3 .button.is-info').click();
  await tick();

  expect(document.getElementById('duplicateModal-class-1').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('duplicateModal-class-2').classList.contains('is-active')).toBe(false);
  expect(document.getElementById('duplicateModal-class-3').classList.contains('is-active')).toBe(true);
});

test('a close-modal event scoped to row 1 does not close row 3 while it is open', async () => {
  const html = renderMyClasses(THREE_CLASSES);
  await render(html);

  document.querySelector('#row-class-3 .button.is-info').click();
  await tick();
  expect(document.getElementById('duplicateModal-class-3').classList.contains('is-active')).toBe(true);

  window.dispatchEvent(new window.CustomEvent('close-modal', { detail: 'duplicate-class-1' }));
  await tick();

  expect(document.getElementById('duplicateModal-class-3').classList.contains('is-active')).toBe(true);
  expect(document.body.classList.contains('modal-open')).toBe(true);
});
