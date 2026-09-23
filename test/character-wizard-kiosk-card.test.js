// test/character-wizard-kiosk-card.test.js
//
// Step 1's kiosk card (#classKioskTrack .wizard-kiosk-card) is an art
// background plus name/PCC and edition ribbons. Many classes carry
// image_url: null, rendering as an empty dark rectangle. This file specs
// the "art-less" dossier treatment those cards should get instead: a
// .wizard-kiosk-dossier with the class's teaser as plain text and stat
// chips, a section stamp, and a deterministic per-card hue -- plus that the
// step summary's class card (built from the same card markup) picks up the
// same treatment. Follows test/character-wizard-kiosk-tabs.test.js's
// pattern: boot the jsdom wizard via bootWizard/fixture and read the DOM
// directly.
const { test, expect, describe } = require('bun:test');
const { bootWizard, fixture } = require('./helpers/wizard-fixture');

const classFor = (id, name, section, overrides = {}) => ({
  id,
  name,
  content_format: 'advent',
  section,
  image_url: null,
  stat_spread: {},
  gear: [],
  class_gear: [],
  base_gear: [],
  abilities: [],
  advanced_abilities: [],
  ...overrides
});

const cardFor = (id) => document.querySelector('.wizard-kiosk-card[data-id="' + id + '"]');

describe('the step-1 kiosk gives an art-less card a text dossier', () => {
  test('a card whose class has no image_url is art-less and carries a dossier', () => {
    const classes = [classFor('y1', 'Yours One', 'yours')];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const card = cardFor('y1');
    expect(card.classList.contains('is-artless')).toBe(true);
    expect(card.querySelector('.wizard-kiosk-dossier')).not.toBeNull();
  });

  test('the dossier renders the teaser as plain text, stripped of markup', () => {
    const classes = [classFor('y1', 'Yours One', 'yours', {
      teaser_html: '<p>You are a <em>martial</em> channeler.</p>'
    })];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const dossier = cardFor('y1').querySelector('.wizard-kiosk-dossier');
    expect(dossier.textContent).toContain('You are a martial channeler.');
    expect(dossier.innerHTML).not.toContain('<em>');
  });

  test('a class with no teaser falls back to its overview, as plain text', () => {
    const classes = [classFor('y1', 'Yours One', 'yours', {
      teaser_html: '',
      overview_html: '<p>A <strong>silver-tongued</strong> rogue.</p>'
    })];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const teaser = cardFor('y1').querySelector('.wizard-kiosk-dossier-teaser');
    expect(teaser.textContent).toBe('A silver-tongued rogue.');
  });

  test('the dossier shows stat chips, one per positive stat_spread entry, ordered by value descending', () => {
    const classes = [classFor('y1', 'Yours One', 'yours', {
      stat_spread: { will: 2, might: 1, grit: 0 }
    })];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const chips = Array.from(cardFor('y1').querySelectorAll('.wizard-kiosk-stat'))
      .map((el) => el.textContent.trim());
    expect(chips).toEqual(['++Will', '+Might']);
  });

  test('the dossier stamps "Pre-release" for a prerelease-section class', () => {
    const classes = [classFor('p1', 'Pre One', 'prerelease')];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'p1' }));

    const stamp = cardFor('p1').querySelector('.wizard-kiosk-stamp');
    expect(stamp.textContent.trim()).toBe('Pre-release');
  });

  test('the dossier stamps "In development" for a pcc-section class', () => {
    const classes = [classFor('c1', 'PCC One', 'pcc')];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'c1' }));

    const stamp = cardFor('c1').querySelector('.wizard-kiosk-stamp');
    expect(stamp.textContent.trim()).toBe('In development');
  });

  test('a "yours"-section class has no stamp', () => {
    const classes = [classFor('y1', 'Yours One', 'yours')];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    expect(cardFor('y1').querySelector('.wizard-kiosk-stamp')).toBeNull();
  });

  test('the card sets a deterministic --card-hue custom property from the class id', () => {
    const classes = [classFor('y1', 'Yours One', 'yours')];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));
    const first = cardFor('y1').style.getPropertyValue('--card-hue').trim();

    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));
    const second = cardFor('y1').style.getPropertyValue('--card-hue').trim();

    expect(first).toMatch(/^\d+$/);
    expect(first).toBe(second);
    const hue = Number(first);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThanOrEqual(359);
  });

  test('a card whose class has an image_url is unchanged: no is-artless, no dossier', () => {
    const classes = [classFor('y1', 'Yours One', 'yours', { image_url: 'https://example.test/art.png' })];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const card = cardFor('y1');
    expect(card.classList.contains('is-artless')).toBe(false);
    expect(card.querySelector('.wizard-kiosk-dossier')).toBeNull();
  });

  test('an art-less card still renders its name and edition ribbons', () => {
    const classes = [classFor('y1', 'Yours One', 'yours')];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const card = cardFor('y1');
    expect(card.querySelector('.wizard-kiosk-ribbon-name').textContent).toBe('Yours One');
    expect(card.querySelector('.wizard-kiosk-ribbon-edition')).not.toBeNull();
  });

  test('the step summary\'s class card for an art-less selected class is also art-less', () => {
    const classes = [classFor('y1', 'Yours One', 'yours')];
    bootWizard(fixture({ mode: 'advent', classes, preselectedClassId: 'y1' }));

    const summaryCard = document.querySelector('#summaryClass .wizard-kiosk-card.is-summary');
    expect(summaryCard.classList.contains('is-artless')).toBe(true);
  });
});
