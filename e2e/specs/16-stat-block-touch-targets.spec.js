// The coarse-pointer tap targets for the stat block control.
//
// This spec exists because the rule it guards is protected only by SOURCE
// ORDER, which nothing else in the repo can check. `@media (pointer: coarse)`
// adds no specificity and no priority: `@media (pointer: coarse) {
// .stat-blocks { gap: 0.5rem } }` and a plain `.stat-blocks { gap: 0.3rem }`
// are both (0,1,0), so whichever comes LAST in public/css/styles.css wins.
// The media block therefore has to sit below every base rule it overrides.
// It once did not, and the result was a declaration that read like a fix and
// did nothing: 2rem blocks (that half worked, because `.wizard-stat-box`'s
// base rule happened to be above the media block) separated by 0.3rem gaps
// on a phone, replacing what used to be a full-width <input type="number">.
//
// The unit tier cannot catch this -- jsdom performs no layout and evaluates
// no media queries -- and the rest of the e2e suite runs a single desktop
// Chromium project with a fine pointer, so nothing else here ever matches
// `pointer: coarse` at all.
//
// Chromium reports `pointer: coarse` when the PRIMARY pointer is touch, which
// is what a mobile-emulated context (isMobile + hasTouch) produces. CDP's
// Emulation.setEmulatedMedia does not support a `pointer` feature; setting it
// leaves matchMedia('(pointer: coarse)') false, which is why the coarse case
// below asserts matchesCoarse rather than trusting the emulation.
//
// Everything is measured in rem, not px: this app's root font size is 14px,
// not 16px, so hard-coded pixel expectations would encode Bulma's typography
// into a test about tap targets.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

const prefix = newPrefix('touch');
let db;
let character;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  character = await seedCharacter(prefix, profile, classRow, { is_public: 'on' });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

// Measures the real shipped stylesheet against the real stats editor. The
// wizard's own container is injected rather than driven, because its grid only
// renders once three traits are picked and the question here is about the
// stylesheet's cascade, not about the wizard's markup.
const measure = (page) => page.evaluate(() => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="wizard-stat-boxes" id="probe-wizard">'
    + '<div class="wizard-stat-box"></div><div class="wizard-stat-box"></div></div>';
  document.body.appendChild(wrap);
  const statBlocks = document.querySelector('#statsEditor .stat-blocks');
  const statBlock = statBlocks.querySelector('[role="radio"]');
  const wizBoxes = document.getElementById('probe-wizard');
  const wizBox = wizBoxes.querySelector('.wizard-stat-box');
  const inRem = (px) => +(parseFloat(px) / rem).toFixed(3);
  const out = {
    matchesCoarse: window.matchMedia('(pointer: coarse)').matches,
    statBlocksGap: inRem(getComputedStyle(statBlocks).columnGap),
    statBlockWidth: inRem(getComputedStyle(statBlock).width),
    statBlockHeight: inRem(getComputedStyle(statBlock).height),
    wizardBoxesGap: inRem(getComputedStyle(wizBoxes).columnGap),
    wizardBoxWidth: inRem(getComputedStyle(wizBox).width)
  };
  wrap.remove();
  return out;
});

const openEditor = async (page) => {
  await page.goto(`/characters/${character.id}`);
  await page.locator('#statsUnlockBtn').click();
  return measure(page);
};

test('a fine pointer keeps the dense desktop layout', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: ADMIN_STATE, baseURL });
  const page = await context.newPage();
  const fine = await openEditor(page);

  expect(fine.matchesCoarse).toBe(false);
  expect(fine.statBlocksGap).toBe(0.3);
  expect(fine.statBlockWidth).toBe(1.4);
  expect(fine.wizardBoxesGap).toBe(0.3);
  expect(fine.wizardBoxWidth).toBe(1.4);
  await context.close();
});

test('a coarse pointer enlarges both the blocks and the gaps between them', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    storageState: ADMIN_STATE, baseURL,
    viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const coarse = await openEditor(page);

  expect(coarse.matchesCoarse).toBe(true);
  // The size and the GAP are asserted separately on purpose. They come from
  // two different declarations in the same media block, and the failure this
  // spec was written for had the size applying while the gap did not -- so an
  // assertion on size alone would have passed straight through the defect.
  expect(coarse.statBlockWidth).toBe(2);
  expect(coarse.statBlockHeight).toBe(2);
  expect(coarse.statBlocksGap).toBe(0.5);
  // The wizard's own grid keeps the coarse-pointer sizing it already had.
  expect(coarse.wizardBoxWidth).toBe(2);
  expect(coarse.wizardBoxesGap).toBe(0.5);
  await context.close();
});
