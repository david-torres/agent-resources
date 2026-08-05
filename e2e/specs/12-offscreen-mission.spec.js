// ar-7v3k check 7 -- the offscreen-mission source picker, and the deliberate,
// human-approved behaviour change that came with the Alpine conversion.
//
// The "other" source fields previously carried `style="display: ;"` -- invalid
// CSS, which the browser drops, leaving the block VISIBLE -- so they appeared
// even when a real hosted mission was linked. They now sit behind
// `x-show="sourceId === '__other__'"` with `x-cloak`
// (views/partials/offscreen-mission-form.handlebars:55), so with a linked
// source they must start HIDDEN while the select still shows the linked
// mission selected.
//
// WHY `toBeHidden()` ALONE IS NOT ENOUGH, and why every test here carries two
// extra assertions. `[x-cloak] { display: none !important }`
// (public/css/styles.css:1336) hides the block BEFORE Alpine initialises, so a
// bare `toBeHidden()` passes on a page where `x-show` was deleted, where Alpine
// never booted, or where the script tag was removed entirely. Alpine strips the
// `x-cloak` attribute on init, so `#om-source-other:not([x-cloak])` is the
// inversion that proves initialisation happened, and
// `'sourceId' in Alpine.$data(el)` is the liveness test that a bare
// `!!Alpine.$data(el)` cannot be (Task 10: `$data` falls back to
// `mergeProxies([])` and returns a truthy Proxy for ANY element). Same
// construction as e2e/specs/09-boosted-nav-settle.spec.js's third test.
//
// THE PLAN'S SUSPECTED DEFECT DOES NOT EXIST. The plan flagged
// `x-data="{ sourceId: '' }"` as never receiving the server's selection. The
// form root is
//
//   <form ... x-data="{ sourceId: '' }" x-init="sourceId = $refs.sourceSelect.value">
//
// so `x-init` seeds `sourceId` from the rendered select, and the server marks
// the linked option `selected`
// ({{#if (eq this.id ../offscreenMission.source_mission_id)}}). Alpine's
// initTree walks the root's directives before descending, so `x-init` runs
// before the select's own `x-model` binds and the two agree. Verified
// behaviourally below rather than taken on trust: every test asserts Alpine's
// `sourceId` VALUE, not merely that the select displays the right option --
// that is what proves `x-init` ran and read the right thing, and it is the
// assertion that fails if the seeding is ever removed.
//
// THE FIXTURE TRAP THIS SPEC EXISTS DOWNSTREAM OF: `missions.host_id`, not
// `missions.creator_id`, is what the picker filters on. See the note on
// `hostId` in e2e/fixtures/mission.js.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter, seedOffscreenMission } = require('../fixtures/character');
const { seedMission } = require('../fixtures/mission');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('offscreen');
const OTHER = '__other__';
let db;
let character;
let offscreen;
let linkedMission;
let spareMission;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  const classRow = await seedClass(prefix);
  // routes/characters.js:493 and :453 both 403 unless
  // `character.creator_id === profile.id`, so the character must belong to the
  // signed-in admin. `is_public` is irrelevant here for the same reason.
  character = await seedCharacter(prefix, profile, classRow);

  // Two missions, both seeded rather than borrowed from whatever happens to be
  // in the local database -- the linked case is the whole point of this file
  // and must never silently degrade to the unlinked one. `hostId` is the
  // load-bearing argument: the picker filters `.eq('host_id', profileId)`
  // (models/offscreen-mission.js:169), so a mission carrying only `creator_id`
  // never appears as an <option> and every assertion below would fail looking
  // exactly like a product defect.
  //
  // The SPARE exists for two independent reasons:
  //
  //  1. `/offscreen-missions/new` passes no `currentSourceId`, so the picker
  //     EXCLUDES every mission already used as a source -- which is precisely
  //     the linked one. With no spare, `Other / not in the system` would be the
  //     only <option> in the list, the browser would select it by default, and
  //     the third test's "starts hidden" expectation would be WRONG rather than
  //     failing: showing the fields when Other is genuinely the only choice is
  //     correct behaviour. (Measured: the local database has zero missions, so
  //     this is the state the plan's draft would have hit.)
  //  2. It is dated LATER than the linked mission, and the picker orders by
  //     `date` descending, so the spare is the FIRST <option> on the edit page
  //     and the linked one is not. That is what stops `toHaveValue(linked.id)`
  //     from being satisfiable by a select that simply fell back to its first
  //     option -- asserted explicitly below so a future ordering change cannot
  //     quietly make the test vacuous.
  linkedMission = await seedMission(prefix, profile.id, {
    name: `${prefix}-linked-mission`,
    date: '2026-01-10T18:00:00Z',
    hostId: profile.id
  });
  spareMission = await seedMission(prefix, profile.id, {
    name: `${prefix}-spare-mission`,
    date: '2026-06-20T18:00:00Z',
    hostId: profile.id
  });

  offscreen = await seedOffscreenMission(character.id, profile.id, {
    name: `${prefix}-offscreen`,
    sourceMissionId: linkedMission.id
  });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

const editUrl = () => `/characters/${character.id}/offscreen-missions/${offscreen.id}/edit`;
const newUrl = () => `/characters/${character.id}/offscreen-missions/new`;

// public/js/app.js's start() -> redirectTo() replaces <body> via an outerHTML
// htmx swap on EVERY authed page load (app.js:970-989), discarding the Alpine
// component built by the first parse and rebuilding it from the swapped-in
// markup. Both routes here are `isAuthenticated`, so that swap always happens.
// Waiting for the network to go quiet pins every reading below to the
// post-auth-swap component rather than racing the one that is about to be
// thrown away. Confirmed product defect, recorded for Task 17, worked around
// here rather than fixed.
const openForm = async (page, url) => {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
};

// One non-retrying read of everything the crux depends on, so the failure
// message names WHICH of the four possible causes fired instead of just
// "expected hidden". `present` is recorded first and every other reading is
// gated on it: an absent block must report as its own failure, never as a
// correctly-hidden one (Task 11's lesson -- "absent" and "present but wrong"
// must not collapse into the same value).
const readSourceState = (page) => page.evaluate(() => {
  const other = document.querySelector('#om-source-other');
  const select = document.querySelector('#om-source-select');
  let data = null;
  try {
    // NOT `!!Alpine.$data(el)`: $data falls back to mergeProxies([]) and hands
    // back a truthy Proxy for ANY element, even one with no x-data ancestor.
    // Presence of the key this form's own x-data declares is the real test.
    data = other && window.Alpine ? window.Alpine.$data(other) : null;
  } catch (_) { /* Alpine absent -> alpineInitialised stays false */ }
  const alpineInitialised = !!data && 'sourceId' in data;
  return {
    otherPresent: !!other,
    selectPresent: !!select,
    // Alpine removes x-cloak on init, so `true` here means the CSS is what is
    // hiding the block -- i.e. Alpine never ran, and `hidden` proves nothing.
    stillCloaked: !!other && other.hasAttribute('x-cloak'),
    otherDisplay: other ? getComputedStyle(other).display : null,
    alpineInitialised,
    // The value x-show is actually comparing. This is the assertion that
    // proves x-init ran and read the rendered selection, which the select's
    // own displayed value cannot.
    alpineSourceId: alpineInitialised ? data.sourceId : null,
    selectValue: select ? select.value : null,
    options: select ? Array.from(select.options).map((o) => ({ value: o.value, selected: o.selected })) : []
  };
});

test('editing a linked offscreen mission starts with the other fields hidden', async ({ page }) => {
  await openForm(page, editUrl());

  const other = page.locator('#om-source-other');

  // Positive precondition: the block exists at all. Without it every "hidden"
  // assertion below passes against nothing.
  await expect(other).toHaveCount(1);
  // Alpine has initialised this subtree -- see the x-cloak note in the header.
  await expect(page.locator('#om-source-other:not([x-cloak])')).toHaveCount(1);
  await expect(other).toBeHidden();

  const state = await readSourceState(page);
  expect(state, `source picker state on the edit form: ${JSON.stringify(state)}`).toMatchObject({
    otherPresent: true,
    selectPresent: true,
    stillCloaked: false,
    otherDisplay: 'none',
    alpineInitialised: true,
    // Both halves, and they are different claims. `selectValue` is what the
    // user sees selected; `alpineSourceId` is what x-show compares. Deleting
    // the form's `x-init` leaves the select showing the linked mission (the
    // server rendered it `selected`) while sourceId stays '' -- the block is
    // still hidden, still uncloaked, and only this line catches it.
    selectValue: linkedMission.id,
    alpineSourceId: linkedMission.id
  });

  // ...and the select did not arrive at that value by falling back to its
  // first option. The spare mission is dated later and the picker orders by
  // date descending, so the linked mission is deliberately NOT first; drop the
  // `selected` attribute from the template and the assertions above fail.
  expect(state.options.length, `option list: ${JSON.stringify(state.options)}`)
    .toBeGreaterThanOrEqual(3); // linked + spare + Other
  expect(state.options.some((o) => o.value === spareMission.id)).toBe(true);
  expect(state.options.some((o) => o.value === OTHER)).toBe(true);
  expect(
    state.options[0].value,
    `fixture integrity: the linked mission must not be the first option or the two assertions above are vacuous -- ${JSON.stringify(state.options)}`
  ).not.toBe(linkedMission.id);

  // The FOUC half, which the live DOM structurally cannot see: Alpine strips
  // x-cloak on init, so deleting the attribute from the template leaves every
  // assertion above passing while restoring the flash of expanded fields on
  // every load. Asserted against the server's own markup, fetched with the
  // Bearer header this app authenticates with (public/js/app.js:730-736 writes
  // it; the browser never does, and page.request shares only the cookie jar --
  // without the header util/auth.js:33 answers with a redirect to /auth/check
  // and Playwright reports a 200 sign-in page).
  const token = await page.evaluate(() => localStorage.getItem('authToken'));
  expect(token, 'storageState must carry an authToken; this route is authenticated').toBeTruthy();
  const response = await page.request.get(editUrl(), { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html, 'the server must render the block cloaked, or it flashes open before Alpine boots')
    .toMatch(/<div id="om-source-other"[^>]*\sx-cloak[\s>]/);
});

test('choosing "Other" reveals the other fields, and choosing a mission hides them again', async ({ page }) => {
  await openForm(page, editUrl());

  const other = page.locator('#om-source-other');
  const select = page.locator('#om-source-select');

  // The positive precondition, without which this test proves nothing about
  // the toggle: fields that were visible all along would satisfy every
  // assertion after the selectOption below. Asserted as a transition, not as
  // an end state (Task 11's lesson).
  await expect(other).toHaveCount(1);
  await expect(page.locator('#om-source-other:not([x-cloak])')).toHaveCount(1);
  await expect(other).toBeHidden();

  await select.selectOption(OTHER);

  await expect(other).toBeVisible();
  await expect(page.locator('#om-source-name')).toBeVisible();
  await expect(page.locator('#om-source-date')).toBeVisible();

  const revealed = await readSourceState(page);
  expect(revealed, `source picker state after choosing Other: ${JSON.stringify(revealed)}`).toMatchObject({
    alpineInitialised: true,
    // x-model wrote the select's new value into the component. Without this,
    // a mutation that changed the sentinel the template compares against would
    // be indistinguishable from one that broke the binding.
    alpineSourceId: OTHER,
    selectValue: OTHER
  });
  expect(revealed.otherDisplay).not.toBe('none');

  // ...and back. x-show has to TRACK the select, not merely fire once: a
  // one-way reveal would pass every assertion above.
  await select.selectOption(linkedMission.id);
  await expect(other).toBeHidden();
  await expect(page.locator('#om-source-name')).toBeHidden();

  const rehidden = await readSourceState(page);
  expect(rehidden, `source picker state after re-selecting the mission: ${JSON.stringify(rehidden)}`).toMatchObject({
    otherPresent: true,
    stillCloaked: false,
    otherDisplay: 'none',
    alpineInitialised: true,
    alpineSourceId: linkedMission.id,
    selectValue: linkedMission.id
  });
});

test('a new offscreen mission starts with the other fields hidden', async ({ page }) => {
  await openForm(page, newUrl());

  const other = page.locator('#om-source-other');

  await expect(other).toHaveCount(1);
  await expect(page.locator('#om-source-other:not([x-cloak])')).toHaveCount(1);
  await expect(other).toBeHidden();

  const state = await readSourceState(page);

  // THE precondition for this test meaning anything. `/new` passes no
  // currentSourceId, so the picker excludes the already-linked mission; the
  // spare is what keeps a real hosted mission in the list. If it were absent,
  // `Other` would be the only option, the browser would select it, and
  // "hidden" would be the WRONG expectation rather than a passing one --
  // showing the manual fields when Other is genuinely the only choice is
  // correct behaviour, not a bug. Asserted, not assumed.
  expect(
    state.options.filter((o) => o.value !== OTHER).map((o) => o.value),
    `the picker must offer at least one hosted mission on /new: ${JSON.stringify(state.options)}`
  ).toContain(spareMission.id);
  expect(
    state.options.some((o) => o.value === linkedMission.id),
    'the already-linked mission must be excluded from a NEW form\'s picker'
  ).toBe(false);

  expect(state, `source picker state on the new form: ${JSON.stringify(state)}`).toMatchObject({
    otherPresent: true,
    selectPresent: true,
    stillCloaked: false,
    otherDisplay: 'none',
    alpineInitialised: true
  });
  // A hosted mission is selected, not the sentinel -- the reason the block is
  // hidden. Compared against the sentinel rather than pinned to the spare's id
  // so a concurrently-running spec that seeds its own hosted mission for this
  // profile cannot turn this into a flake.
  expect(state.selectValue).not.toBe(OTHER);
  expect(state.alpineSourceId).toBe(state.selectValue);
});
