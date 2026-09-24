// e2e/specs/27-aspirant-v1-class-page.spec.js
//
// The rendered class page for ENCLAVE: Aspirant V1, and the guard that the
// same templates still render the older shape.
//
// views/class-view.handlebars:244 branches on `class.content_format`: an
// 'aspirant' row goes through views/partials/class-signature-sides.handlebars
// (the book's Signature spread folded into two sides), anything else through the Base/Elective
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
const { RAISED_NOTATION } = require('../../util/aspirant-verify');
const { ADMIN_STATE } = require('../global-setup');

test.use({
  storageState: ADMIN_STATE,
  // 1280 is the width the overflow assertion below is about, so it is stated
  // here rather than inherited from the Desktop Chrome default.
  viewport: { width: 1280, height: 900 }
});

const V1_GUNSLINGER = ASPIRANT_V1_CLASS_IDS.Gunslinger;
const V1_VESSEL = ASPIRANT_V1_CLASS_IDS.Vessel;
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

// Keeps failures readable: "expected 6, got [Cowboy Hat, Bandolier]" names the
// page and the items it did find, where a bare toHaveCount(3) would not.
const cardTitles = (scope) => scope.locator('.card h4.title').allTextContents();

test.describe('the V1 fork', () => {
  test('renders twelve Signatures on two sides folded from the book\'s spread, each with a Default Enchantment', async ({ page }) => {
    await openClass(page, V1_GUNSLINGER);

    const gear = section(page, 'Signature Gear');
    const sides = gear.locator('.column.signature-side');
    // signatureSides always returns two arrays, so this count can only ever
    // be 0 or 2 -- it is a smoke check that the aspirant side wrapper
    // rendered at all. The per-side assertions below are what actually pin
    // the fold: book columns 1 and 3 on the left, 2 and 4 on the right.
    await expect(
      sides,
      'signature-side wrapper must be present (smoke check; see per-side checks below for the two-sided layout)'
    ).toHaveCount(2);

    // The 6/6 split checked here can't tell a stored `column` value from
    // list order, because the route falls back to list position when a
    // column isn't set, and, measured now, 0 of the 144 stored Signature
    // items in the local catalogue disagree with their array order. What
    // actually pins the stored column/position is the artifact verifier
    // (util/aspirant-verify.js), which re-derived all 144 items' column and
    // position from the PDF's raw coordinates.
    const seen = [];
    for (let side = 1; side <= 2; side++) {
      const titles = await cardTitles(sides.nth(side - 1));
      expect(titles, `Gunslinger V1 Signature side ${side}`).toHaveLength(6);
      seen.push(...titles);
    }
    expect(seen, 'Gunslinger V1 Signatures, left side then right').toHaveLength(12);
    expect(new Set(seen).size, `twelve distinct Signatures, got ${seen.join(', ')}`).toBe(12);
    // Book fidelity (the other 10 names, and every other class) is the PDF
    // verifier's job; these two anchor that this page is Gunslinger's own
    // row and not some other class's.
    expect(seen[0], 'Gunslinger V1 first Signature, top of the left side').toBe('Cowboy Hat');
    expect(seen[11], 'Gunslinger V1 twelfth Signature, bottom of the right side').toBe('Hip Flask');

    const cards = gear.locator('.column.signature-side .card');
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
      // Anchors this block to Gunslinger's own row: a template that rendered
      // the wrong class's abilities would still satisfy every count check
      // above.
      if (heading === 'Abilities') {
        expect(titles, 'Gunslinger V1 core abilities').toEqual(['Trickshot', 'Standoff', 'Shootout']);
      } else {
        expect(titles[0], 'Gunslinger V1 first advanced ability').toBe('High Noon');
        // The artifact stores this with a curly apostrophe (U+2018), not '.
        expect(titles[1], 'Gunslinger V1 second advanced ability').toBe('Stick ‘Em Up');
        expect(titles[2], 'Gunslinger V1 third advanced ability').toBe('Surefire');
      }

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

    await expect(
      page.locator('body'),
      'an escaped Power Rating would put the literal text "<sup>" on screen'
    ).not.toContainText('<sup>');

    // Power Ratings reach the page through two independent sanitisers, and a
    // page-wide sup count cannot fail when only one of them breaks: the
    // other keeps emitting sups into the same page. Scoping each check to a
    // spot only one sanitiser writes to is what makes each break fail on its
    // own.
    //
    // An ability's own description is rendered by `renderMarkdown`
    // (views/class-view.handlebars:302/326) as the first <p> inside its
    // card -- before class-meters/paired_action/notes/sample_perks, which
    // are all `renderPowerRatings` and would otherwise leave a sup behind in
    // the same section even with renderMarkdown broken.
    const abilityDescriptionSupCounts = await Promise.all(
      ['Abilities', 'Advanced Abilities'].map((heading) => section(page, heading)
        .locator('.card .content > p:first-of-type sup')
        .count())
    );
    expect(
      abilityDescriptionSupCounts.reduce((a, b) => a + b, 0),
      'an ability description (the renderMarkdown path) must render at least one Power Rating as a <sup>'
    ).toBeGreaterThan(0);

    // .class-sample-perks and .class-enchantment are rendered entirely
    // through `renderPowerRatings` (views/partials/class-sample-perks.handlebars,
    // views/partials/class-enchantment.handlebars) -- neither partial calls
    // `renderMarkdown`, so these two are clean of the other path.
    await expect(
      page.locator('.class-sample-perks sup').first(),
      'a sample perk (the renderPowerRatings path) must render at least one Power Rating as a <sup>'
    ).toBeAttached();
    await expect(
      page.locator('.class-enchantment sup').first(),
      'a Default Enchantment (the renderPowerRatings path) must render at least one Power Rating as a <sup>'
    ).toBeAttached();
  });

  test('renders zero-bounded and plus-suffixed Power Ratings in the book\'s notation', async ({ page }) => {
    // Gunslinger's own <sup> contents are exactly H, M, L, L-H, L-M -- the one
    // shape a naive /^[LMH](-[LMH])?$/ regex allows, which is why that regex
    // read as passing while rejecting most of the book's real ratings.
    // Vessel's <sup> contents include a zero-bounded rating, a plus-suffixed
    // one, and a plus-suffixed range, so asserting RAISED_NOTATION here (and
    // not on Gunslinger) is what makes the assertion capable of failing.
    await openClass(page, V1_VESSEL);

    const ratings = await page.locator('sup').allTextContents();
    expect(ratings.length, 'Vessel must render at least one Power Rating').toBeGreaterThan(0);

    const notARating = ratings.filter((text) => !RAISED_NOTATION.test(text.trim()));
    expect(
      notARating,
      `every <sup> on the page should hold a Power Rating; these did not: ${notARating.join(' | ')}`
    ).toEqual([]);

    // Proves the run above wasn't vacuous: Vessel's page must actually
    // exercise the notation shapes a bare /^[LMH](-[LMH])?$/ regex rejects.
    const trimmed = ratings.map((text) => text.trim());
    expect(trimmed.some((text) => text.startsWith('0–')), `no zero-bounded rating seen: ${trimmed.join(' | ')}`).toBe(true);
    expect(trimmed.some((text) => text.endsWith('+')), `no plus-suffixed rating seen: ${trimmed.join(' | ')}`).toBe(true);
  });

  test('does not scroll sideways at 1280px', async ({ page }) => {
    // This has about 3px of headroom at 1280px, measured against the
    // current copy. An editorial text change to a Signature or ability can
    // turn this red without any layout regression -- read a future failure
    // here as that content warning first, not as a broken assertion.
    await openClass(page, V1_GUNSLINGER);

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const limit = root.clientWidth;
      const offenders = [...document.querySelectorAll('.signature-side *')]
        .filter((el) => el.getBoundingClientRect().right > limit + 1)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className} @${Math.round(el.getBoundingClientRect().right)}px`);
      return { scrollWidth: root.scrollWidth, clientWidth: limit, offenders };
    });

    expect(
      overflow.offenders,
      'nothing inside the two Signature sides may reach past the viewport'
    ).toEqual([]);
    expect(
      overflow.scrollWidth,
      `the page scrolls sideways: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
    ).toBeLessThanOrEqual(overflow.clientWidth);
  });
});

// The load forked twelve new rows and touched none of the old ones. This is the
// rendered half of that claim: the parent still reaches the pre-'aspirant'
// branch of the template, which has no two-sided Signature layout and no advanced
// block at all.
test.describe('the pre-release parent it forked from', () => {
  test('still renders six Signatures as Base and Elective, and three abilities with no advanced block', async ({ page }) => {
    await openClass(page, PRERELEASE_BERSERKER);

    const gear = section(page, 'Signature Gear');
    await expect(
      gear.locator('.column.signature-side'),
      'a non-aspirant class must not pick up the two-sided Signature layout'
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
    const allTitles = labelled.flatMap(([, titles]) => titles);
    expect(allTitles, 'six Signatures in total, as before the load').toHaveLength(6);
    // The pre-release parent's six Signatures are the V1 fork's first six --
    // a subset, not a disjoint set -- so there is no name the parent carries
    // that the fork doesn't. The only name that distinguishes the two rows
    // runs the other way: `Skull Helm` is one of the six the fork added and
    // the parent never had. A template that rendered the fork's row here
    // instead of the parent's would leak it in.
    expect(
      allTitles,
      'the pre-release parent must not carry a Signature the V1 fork added'
    ).not.toContain('Skull Helm');

    const abilities = await cardTitles(section(page, 'Abilities'));
    expect(abilities, 'pre-release Berserker abilities').toHaveLength(3);

    await expect(
      page.getByRole('heading', { level: 3, name: 'Advanced Abilities', exact: true }),
      'the pre-release Berserker has no advanced abilities, so the block must not render'
    ).toHaveCount(0);
  });
});
