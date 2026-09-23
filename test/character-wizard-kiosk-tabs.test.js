// test/character-wizard-kiosk-tabs.test.js
//
// Step 1's kiosk carousel now groups classes into sections the server
// stamps on each row (wizardData.classes[].section: 'yours' | 'prerelease' |
// 'pcc'). This file specs the tab strip (#classKioskTabs) that switches
// which section's cards are visible in #classKioskTrack, the search box's
// all-sections override, the initial-active-tab resolution and the V1
// ribbon copy change. Follows test/character-wizard-client.test.js's
// pattern: boot the jsdom wizard via bootWizard/fixture and read the DOM +
// getState() directly -- no other unit coverage exists for the browser IIFE.
const { test, expect, describe } = require('bun:test');
const { bootWizard, fixture } = require('./helpers/wizard-fixture');

const classFor = (id, name, section, overrides = {}) => ({
  id,
  name,
  content_format: 'advent',
  section,
  stat_spread: {},
  gear: [],
  class_gear: [],
  base_gear: [],
  abilities: [],
  advanced_abilities: [],
  ...overrides
});

const tabEls = () => Array.from(document.querySelectorAll('#classKioskTabs [data-section]'));
const cardDisplay = (id) => document.querySelector('.wizard-kiosk-card[data-id="' + id + '"]').style.display;

describe('the step-1 kiosk groups classes into section tabs', () => {
  test('renders one tab per non-empty section, in order yours -> prerelease -> pcc, each labelled with its count', () => {
    const classes = [
      classFor('y1', 'Yours One', 'yours'),
      classFor('y2', 'Yours Two', 'yours'),
      classFor('p1', 'Pre One', 'prerelease'),
      classFor('c1', 'PCC One', 'pcc'),
      classFor('c2', 'PCC Two', 'pcc'),
      classFor('c3', 'PCC Three', 'pcc')
    ];
    bootWizard(fixture({ mode: 'advent', classes }));

    const tabs = tabEls();
    expect(tabs.map((el) => el.getAttribute('data-section'))).toEqual(['yours', 'prerelease', 'pcc']);
    expect(tabs.map((el) => el.textContent.trim())).toEqual([
      'Your classes (2)', 'Pre-release (1)', 'PCCs (3)'
    ]);
  });

  test('a section with no classes has no tab', () => {
    const classes = [classFor('y1', 'Yours One', 'yours')];
    bootWizard(fixture({ mode: 'advent', classes }));

    const tabs = tabEls();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].getAttribute('data-section')).toBe('yours');
  });

  test('only cards of the active section are visible', () => {
    const classes = [
      classFor('y1', 'Yours One', 'yours'),
      classFor('p1', 'Pre One', 'prerelease')
    ];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    expect(cardDisplay('y1')).not.toBe('none');
    expect(cardDisplay('p1')).toBe('none');
  });

  test('the starting section follows a preselected class into a non-default section', () => {
    const classes = [
      classFor('y1', 'Yours One', 'yours'),
      classFor('p1', 'Pre One', 'prerelease')
    ];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'p1' }));

    const active = tabEls().find((el) => el.classList.contains('is-active'));
    expect(active && active.getAttribute('data-section')).toBe('prerelease');
  });

  test('with no preselect, the first non-empty section is active and the random pick is drawn from it', () => {
    const classes = [
      classFor('y1', 'Yours One', 'yours'),
      classFor('y2', 'Yours Two', 'yours'),
      classFor('p1', 'Pre One', 'prerelease')
    ];
    const wizard = bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: null }));

    const active = tabEls().find((el) => el.classList.contains('is-active'));
    expect(active && active.getAttribute('data-section')).toBe('yours');
    expect(['y1', 'y2']).toContain(wizard.getState().classId);
  });

  test('clicking a tab makes it active and shows only that section\'s cards, without changing the selected class', () => {
    const classes = [
      classFor('y1', 'Yours One', 'yours'),
      classFor('p1', 'Pre One', 'prerelease')
    ];
    const wizard = bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const preTab = tabEls().find((el) => el.getAttribute('data-section') === 'prerelease');
    preTab.click();

    const active = tabEls().find((el) => el.classList.contains('is-active'));
    expect(active && active.getAttribute('data-section')).toBe('prerelease');
    expect(cardDisplay('p1')).not.toBe('none');
    expect(cardDisplay('y1')).toBe('none');
    expect(wizard.getState().classId).toBe('y1');
  });

  test('a search match from another section is shown regardless of the active tab, and clearing it restores the active section alone', () => {
    const classes = [
      classFor('y1', 'Common Wolf', 'yours'),
      classFor('p1', 'Common Fox', 'prerelease'),
      classFor('c1', 'Zzz Unrelated', 'pcc')
    ];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const search = document.getElementById('classSearch');
    search.value = 'Common';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(cardDisplay('y1')).not.toBe('none');
    expect(cardDisplay('p1')).not.toBe('none');
    expect(cardDisplay('c1')).toBe('none');

    search.value = '';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(cardDisplay('y1')).not.toBe('none');
    expect(cardDisplay('p1')).toBe('none');
  });

  test('an aspirant-edition class\'s ribbon reads "Aspirant · V1", not "Aspirant Preview · V1"', () => {
    const classes = [
      classFor('a1', 'Old Guard', 'yours', { rules_edition: 'aspirant', rules_version: 'v1' })
    ];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'a1' }));

    const ribbon = document.querySelector('.wizard-kiosk-card[data-id="a1"] .wizard-kiosk-ribbon-edition');
    expect(ribbon.textContent).toBe('Aspirant · V1');
  });

  test('aspiring mode renders no kiosk tabs', () => {
    bootWizard(fixture({ mode: 'aspiring', classes: [], preselectedClassId: null }));
    expect(document.getElementById('classKioskTabs').children.length).toBe(0);
  });
});
