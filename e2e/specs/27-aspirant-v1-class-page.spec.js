// e2e/specs/27-aspirant-v1-class-page.spec.js
//
// The rendered class page for ENCLAVE: Aspirant V1, and the guard that the
// same templates still render the older shape.
//
// views/class-view.handlebars:244 branches on `class.content_format`: an
// 'aspirant' row goes through views/partials/class-signature-columns.handlebars
// (the book's four Signature columns), anything else through the Base/Elective
// split that predates it. Both branches are live in the local catalogue, so
// one spec has to drive both -- the V1 fork below and the pre-release parent it
// forked from are two rows of the same name, and only the fork is 'aspirant'.
//
// Every navigation here is BY ID. Six of the twelve V1 rows share their name
// with the pre-release row they forked from, so `Berserker` no longer names one
// class and any by-name locator would be picking one of two rows at random.
//
// Signed in as the admin, not the player: the pre-release Berserker is
// status='release', and routes/classes.js:483-500 answers a release class with
// class-view-teaser unless the viewer has it unlocked, is its creator, or is an
// admin. Admin is the one of those three that needs no fixture unlock.
const { test, expect } = require('@playwright/test');
const { ASPIRANT_V1_CLASS_IDS, CORE_CLASS_UNLOCKS } = require('../../util/starter-content');
const { ADMIN_STATE } = require('../global-setup');

test.use({
  storageState: ADMIN_STATE,
  // 1280 is the width the overflow assertion below is about, so it is stated
  // here rather than inherited from the Desktop Chrome default.
  viewport: { width: 1280, height: 900 }
});

const V1_GUNSLINGER = ASPIRANT_V1_CLASS_IDS.Gunslinger;
const PRERELEASE_BERSERKER = CORE_CLASS_UNLOCKS.aspirant.Berserker[0];

// Each top-level block of the class page is a `.card` whose `.content` opens
// with an `h3.title.is-3`; the per-item cards nested inside carry `h4`, so
// filtering the outer `.card` on the h3 lands on the block and not on its
// children. `exact` matters: 'Abilities' and 'Advanced Abilities' are two
// separate blocks.
const section = (page, heading) => page.locator('.card').filter({
  has: page.getByRole('heading', { level: 3, name: heading, exact: true })
});

// A plain page load carries no Authorization header, so the server first
// answers the guest render and public/js/app.js re-fetches it as the signed-in
// user (see the INITIAL_SESSION branch in _onAuthStateChange). Waiting on a
// block the teaser does not have means the assertions run against the authed
// render.
const openClass = async (page, id) => {
  await page.goto(`/classes/${id}`);
  await page.waitForLoadState('networkidle');
  await expect(
    section(page, 'Signature Gear'),
    `/classes/${id} must render the full class page, not the release teaser`
  ).toHaveCount(1);
};

// Keeps failures readable: "expected 3, got [Cowboy Hat, Bandolier]" names the
// column and the items it did find, where a bare toHaveCount(3) would not.
const cardTitles = (scope) => scope.locator('.card h4.title').allTextContents();

test.describe('the V1 fork', () => {
  test('renders twelve Signatures in the book\'s four columns, each with a Default Enchantment', async ({ page }) => {
    await openClass(page, V1_GUNSLINGER);

    const gear = section(page, 'Signature Gear');
    const columns = gear.locator('.column.signature-column');
    await expect(
      columns,
      'an aspirant class renders its Signature Gear in the four columns of the book page'
    ).toHaveCount(4);

    const seen = [];
    for (let column = 1; column <= 4; column++) {
      const titles = await cardTitles(columns.nth(column - 1));
      expect(titles, `Gunslinger V1 Signature column ${column}`).toHaveLength(3);
      seen.push(...titles);
    }
    expect(seen, 'Gunslinger V1 Signatures, in column order').toHaveLength(12);
    expect(new Set(seen).size, `twelve distinct Signatures, got ${seen.join(', ')}`).toBe(12);

    const cards = gear.locator('.column.signature-column .card');
    for (let i = 0; i < 12; i++) {
      const card = cards.nth(i);
      const item = seen[i];
      const enchantment = card.locator('.class-enchantment');
      await expect(
        enchantment,
        `Signature "${item}" must render a Default Enchantment block`
      ).toHaveCount(1);
      const name = (await enchantment.locator('p strong').first().innerText()).trim();
      expect(name, `the Default Enchantment on Signature "${item}" must be named`).not.toBe('');
    }
  });

  test('renders six abilities in a core and an advanced block, each with two sample perks and one Compounded variant', async ({ page }) => {
    await openClass(page, V1_GUNSLINGER);

    for (const heading of ['Abilities', 'Advanced Abilities']) {
      const block = section(page, heading);
      await expect(block, `Gunslinger V1 must render an "${heading}" block`).toHaveCount(1);

      const titles = await cardTitles(block);
      expect(titles, `Gunslinger V1 "${heading}"`).toHaveLength(3);

      const cards = block.locator('.card');
      for (let i = 0; i < 3; i++) {
        const ability = titles[i];
        const perks = cards.nth(i).locator('.class-sample-perks > div');
        await expect(
          perks,
          `ability "${ability}" (${heading}) must show its two sample perks`
        ).toHaveCount(2);
        // The Compounded line is the only <em> under a perk: powerRatings
        // (util/markdown.js) permits `sup` and nothing else, so no perk text
        // can contribute one.
        await expect(
          cards.nth(i).locator('.class-sample-perks em'),
          `exactly one sample perk of "${ability}" (${heading}) must carry a Compounded variant`
        ).toHaveCount(1);
      }
    }
  });

  test('renders the Expanded Tips split into a Player and a Conduit list', async ({ page }) => {
    await openClass(page, V1_GUNSLINGER);

    const tips = section(page, 'Expanded Tips');
    await expect(tips, 'Gunslinger V1 must render an Expanded Tips block').toHaveCount(1);

    for (const audience of ['Player', 'Conduit']) {
      const column = tips.locator('.columns > .column').filter({
        has: page.getByRole('heading', { level: 4, name: audience, exact: true })
      });
      await expect(
        column,
        `Expanded Tips must have exactly one "${audience}" column`
      ).toHaveCount(1);
      const entries = await column.locator('> ul > li').allTextContents();
      expect(
        entries.length,
        `the "${audience}" Expanded Tips list must not be empty`
      ).toBeGreaterThan(0);
    }
  });

  test('renders Power Ratings as sup elements, never as literal markup', async ({ page }) => {
    await openClass(page, V1_GUNSLINGER);

    // Power Ratings are stored as literal `<sup>H</sup>` inside description,
    // perk and enchantment text, so this is the one assertion that separates
    // "the renderer emitted an element" from "the renderer escaped the markup
    // and the reader sees the tag".
    const sups = page.locator('sup');
    const ratings = await sups.allTextContents();
    expect(
      ratings.length,
      'the class page must emit at least one <sup> element for a Power Rating'
    ).toBeGreaterThan(0);

    const notARating = ratings.filter((text) => !/^[LMH](–[LMH])?$/.test(text.trim()));
    expect(
      notARating,
      `every <sup> on the page should hold a Power Rating; these did not: ${notARating.join(' | ')}`
    ).toEqual([]);

    await expect(
      page.locator('body'),
      'an escaped Power Rating would put the literal text "<sup>" on screen'
    ).not.toContainText('<sup>');
  });

  test('does not scroll sideways at 1280px', async ({ page }) => {
    await openClass(page, V1_GUNSLINGER);

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const limit = root.clientWidth;
      const offenders = [...document.querySelectorAll('.signature-column *')]
        .filter((el) => el.getBoundingClientRect().right > limit + 1)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className} @${Math.round(el.getBoundingClientRect().right)}px`);
      return { scrollWidth: root.scrollWidth, clientWidth: limit, offenders };
    });

    expect(
      overflow.offenders,
      'nothing inside the four Signature columns may reach past the viewport'
    ).toEqual([]);
    expect(
      overflow.scrollWidth,
      `the page scrolls sideways: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
    ).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

// The load forked twelve new rows and touched none of the old ones. This is the
// rendered half of that claim: the parent still reaches the pre-'aspirant'
// branch of the template, which has no four-column layout and no advanced
// block at all.
test.describe('the pre-release parent it forked from', () => {
  test('still renders six Signatures as Base and Elective, and three abilities with no advanced block', async ({ page }) => {
    await openClass(page, PRERELEASE_BERSERKER);

    const gear = section(page, 'Signature Gear');
    await expect(
      gear.locator('.column.signature-column'),
      'a non-aspirant class must not pick up the four-column Signature layout'
    ).toHaveCount(0);

    const halves = gear.locator('.columns > .column.is-half');
    await expect(
      halves,
      'the pre-release Berserker keeps the two-column Base/Elective split'
    ).toHaveCount(2);

    const labelled = [];
    for (let i = 0; i < 2; i++) {
      const label = (await halves.nth(i).locator('p').first().innerText()).trim();
      const titles = await cardTitles(halves.nth(i));
      labelled.push([label, titles]);
      expect(titles, `pre-release Berserker "${label}"`).toHaveLength(3);
    }
    expect(
      labelled.map(([label]) => label),
      'the two halves are Base Gear then Elective Gear'
    ).toEqual(['Base Gear', 'Elective Gear']);
    expect(
      labelled.flatMap(([, titles]) => titles),
      'six Signatures in total, as before the load'
    ).toHaveLength(6);

    const abilities = await cardTitles(section(page, 'Abilities'));
    expect(abilities, 'pre-release Berserker abilities').toHaveLength(3);

    await expect(
      page.getByRole('heading', { level: 3, name: 'Advanced Abilities', exact: true }),
      'the pre-release Berserker has no advanced abilities, so the block must not render'
    ).toHaveCount(0);
  });
});
