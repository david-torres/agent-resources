const { test, expect } = require('bun:test');
const { getEditionUpsell } = require('./upsell');
const { EDITION_UPSELL_BLURBS } = require('../../util/starter-content');

const ADVENT_BLURB = 'Unlock the Advent rulebook and its six core classes.';
const ASPIRANT_BLURB = 'Unlock the full Aspirant versions of the six base classes, plus six new Aspirant classes.';

test('each edition has its own upsell blurb', () => {
  expect(EDITION_UPSELL_BLURBS).toEqual({ advent: ADVENT_BLURB, aspirant: ASPIRANT_BLURB });
});

test('a lapsed Advent and an unowned Aspirant each get a blurb panel', () => {
  expect(getEditionUpsell({ advent: { state: 'expired', endedAt: 'x' }, aspirant: { state: 'none' } })).toEqual([
    { edition: 'advent', label: 'Advent', blurb: ADVENT_BLURB },
    { edition: 'aspirant', label: 'Aspirant', blurb: ASPIRANT_BLURB }
  ]);
});

test('a trial or owned edition gets no panel', () => {
  expect(getEditionUpsell({ advent: { state: 'trial' }, aspirant: { state: 'owned' } })).toEqual([]);
  expect(getEditionUpsell({ advent: { state: 'owned' }, aspirant: { state: 'none' } })).toEqual([
    { edition: 'aspirant', label: 'Aspirant', blurb: ASPIRANT_BLURB }
  ]);
});

test('no edition status, no panels', () => {
  expect(getEditionUpsell(null)).toEqual([]);
  expect(getEditionUpsell(undefined)).toEqual([]);
});
