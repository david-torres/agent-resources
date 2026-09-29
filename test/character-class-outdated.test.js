// test/character-class-outdated.test.js
//
// Exercises public/js/character-class-outdated.js under jsdom: the character
// form's Class select hides outdated class options behind a
// "Show outdated classes" checkbox. Loaded on both create and edit forms.
const { test, expect, describe } = require('bun:test');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE_PATH = path.join(__dirname, '..', 'public', 'js', 'character-class-outdated.js');

const CHECKBOX = '<input type="checkbox" id="char-show-outdated-classes">';

const selectHtml = (selectedValue) => {
  const opt = (value, label, outdated) =>
    `<option value="${value}"${outdated ? ' data-outdated' : ''}${value === selectedValue ? ' selected' : ''}>${label}</option>`;
  return `<select id="char-class-id">
    <option disabled>Advent v1 Classes</option>
    ${opt('1', 'Gunslinger v1', true)}
    ${opt('2', 'Wrangler v1', true)}
    <option disabled>Advent v2 Classes</option>
    ${opt('3', 'Gunslinger v2', false)}
    ${opt('4', 'Wrangler v2', false)}
    <option disabled>Aspirant Preview v1 Classes</option>
    ${opt('5', 'Drifter v1', true)}
    ${opt('6', 'Preacher v1', false)}
  </select>`;
};

const boot = ({ selected = '3', withCheckbox = true } = {}) => {
  const dom = new JSDOM(
    `<!doctype html><html><body>${selectHtml(selected)}${withCheckbox ? CHECKBOX : ''}</body></html>`
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const doc = dom.window.document;
  const select = doc.getElementById('char-class-id');
  const selectChanges = [];
  select.addEventListener('change', () => selectChanges.push(select.value));
  new Function(fs.readFileSync(SOURCE_PATH, 'utf8'))();
  return {
    window: dom.window,
    select,
    selectChanges,
    checkbox: doc.getElementById('char-show-outdated-classes'),
    option: (value) => doc.querySelector(`#char-class-id option[value="${value}"]`),
    header: (label) => [...doc.querySelectorAll('#char-class-id option')].find((o) => o.textContent === label)
  };
};

const toggle = ({ window, checkbox }, checked) => {
  checkbox.checked = checked;
  checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
};

const isHidden = (el) => el.hidden === true;

describe('CharacterClassOutdated', () => {
  test('starts unchecked when the selected class is current', () => {
    const { checkbox } = boot({ selected: '3' });
    expect(checkbox.checked).toBe(false);
  });

  test('starts checked when the selected class is outdated', () => {
    const { checkbox } = boot({ selected: '1' });
    expect(checkbox.checked).toBe(true);
  });

  test('unchecked hides and disables outdated options, leaving current ones pickable', () => {
    const ui = boot({ selected: '3' });
    for (const v of ['1', '2', '5']) {
      expect(isHidden(ui.option(v))).toBe(true);
      expect(ui.option(v).disabled).toBe(true);
    }
    for (const v of ['3', '4', '6']) {
      expect(isHidden(ui.option(v))).toBe(false);
      expect(ui.option(v).disabled).toBe(false);
    }
  });

  test('hides a group header whose class options are all hidden', () => {
    const ui = boot({ selected: '3' });
    expect(isHidden(ui.header('Advent v1 Classes'))).toBe(true);
    expect(isHidden(ui.header('Advent v2 Classes'))).toBe(false);
    expect(isHidden(ui.header('Aspirant Preview v1 Classes'))).toBe(false);
  });

  test('never hides the currently selected option, even when outdated and unchecked', () => {
    const ui = boot({ selected: '1' });
    toggle(ui, false);
    expect(isHidden(ui.option('1'))).toBe(false);
    expect(ui.option('1').disabled).toBe(false);
    expect(isHidden(ui.option('2'))).toBe(true);
    expect(isHidden(ui.header('Advent v1 Classes'))).toBe(false);
  });

  test('checking the box shows and re-enables every option live', () => {
    const ui = boot({ selected: '3' });
    toggle(ui, true);
    for (const v of ['1', '2', '3', '4', '5', '6']) {
      expect(isHidden(ui.option(v))).toBe(false);
      expect(ui.option(v).disabled).toBe(false);
    }
    expect(isHidden(ui.header('Advent v1 Classes'))).toBe(false);
  });

  test('unchecking again re-hides outdated options live', () => {
    const ui = boot({ selected: '3' });
    toggle(ui, true);
    toggle(ui, false);
    expect(isHidden(ui.option('1'))).toBe(true);
    expect(ui.option('1').disabled).toBe(true);
    expect(isHidden(ui.header('Advent v1 Classes'))).toBe(true);
  });

  test('with no explicit selection, hides an implicitly selected outdated option and moves to the first current class', () => {
    const ui = boot({ selected: null });
    expect(ui.checkbox.checked).toBe(false);
    expect(isHidden(ui.option('1'))).toBe(true);
    expect(ui.option('1').disabled).toBe(true);
    expect(ui.select.value).toBe('3');
    expect(ui.selectChanges).toEqual(['3']);
  });

  test('keeps an outdated class the user picked visible and selected after unchecking', () => {
    const ui = boot({ selected: null });
    toggle(ui, true);
    ui.select.value = '2';
    ui.select.dispatchEvent(new ui.window.Event('change', { bubbles: true }));
    toggle(ui, false);
    expect(isHidden(ui.option('2'))).toBe(false);
    expect(ui.option('2').disabled).toBe(false);
    expect(ui.select.value).toBe('2');
    expect(isHidden(ui.option('1'))).toBe(true);
  });

  test('does nothing when the form has no outdated-classes checkbox', () => {
    const ui = boot({ selected: '3', withCheckbox: false });
    for (const v of ['1', '2', '5']) {
      expect(isHidden(ui.option(v))).toBe(false);
      expect(ui.option(v).disabled).toBe(false);
    }
  });
});
