// ar-7v3k check 11 -- the export dropdowns on the character and class pages --
// plus the systemic follow-up to check 12.
//
// PART 1 (checks 11). Both global dropdown handlers were deleted from
// public/js/app.js and replaced with per-dropdown Alpine state, so outside-click
// and Escape went from document-level behaviour to per-component and are easy to
// lose. The markup is identical in shape in both templates
// (views/character.handlebars:161-171, views/class-view.handlebars:34-46):
//
//   <div class="dropdown is-right" id="export-dropdown"
//        x-data="{ open: false }"
//        :class="open && 'is-active'"
//        @click.outside="open = false"
//        @keydown.escape.window="open = false">
//
// The Escape binding exists, so the plan's "drop the Escape test" contingency
// does not apply. It is bound to `.window`, not to the element, which is worth
// asserting on its own: Escape must close the dropdown with focus anywhere on
// the page, not just inside the dropdown.
//
// PART 2 (generalises check 12). Task 11 confirmed that htmx freezes Alpine's
// computed `class` into its history snapshot and that Alpine cannot remove it on
// restore, because setClassesFromString only removes classes Alpine itself
// added. That was found on the navbar. The same `:class="<expr> && '<class>'"`
// form appears at eight production sites; this file settles empirically whether
// the defect is navbar-specific or systemic, at two representative sites -- this
// task's own export dropdown and the level-up modal.
//
// MEASURED ANSWER: it is systemic, and it is WORSE at the modal. See the block
// comments above the three red tests at the bottom of this file.
//
// No viewport override here, unlike specs 09/10: nothing in this file depends on
// Bulma's 1024px navbar breakpoint. The dropdown and the modal render and behave
// identically at every width.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('export');
let db;
let character;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  const profile = await profileForEmail(db, ADMIN_EMAIL);
  // createdBy is not strictly required -- views/class-view.handlebars:22 gates
  // the whole button bar (export dropdown included) on
  // `admin OR profile.id === class.created_by`, and the signed-in fixture user
  // is an admin -- but owning the row makes every assertion here true for the
  // ordinary "it's my class" reason rather than only for the admin one, and
  // routes/classes.js:371 applies the same either/or to the export endpoint.
  classRow = await seedClass(prefix, { createdBy: profile.id });
  // Owned by the signed-in admin: views/character.handlebars:122 renders the
  // export dropdown only for `character.creator_id === profile.id`, and
  // routes/characters.js:763 rejects an export of someone else's character with
  // a 403. is_public is left at the model default rather than passed as the
  // string 'on' (services/character/input.js:108 compares `=== 'on'`, so a
  // boolean silently produces a PRIVATE character) -- irrelevant either way
  // while the creator is the one viewing it, but the trap is worth naming.
  character = await seedCharacter(prefix, profile, classRow);
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

// character/classRow are assigned in beforeAll, so the URL has to be resolved
// inside each test rather than when the loop body is built.
const CHARACTER_PAGE = 'character page';
const CLASS_PAGE = 'class page';
const urlFor = (label) =>
  label === CHARACTER_PAGE ? `/characters/${character.id}` : `/classes/${classRow.id}`;

// public/js/app.js's start() -> redirectTo() replaces <body> via an outerHTML
// htmx swap on EVERY authed page load (app.js:970-989). Alpine state written
// before that swap lands is silently discarded -- a confirmed product defect
// recorded for Task 17 and deliberately not fixed here. Waiting for the network
// to go quiet pins the starting state to "post-auth-swap" so a click issued
// immediately afterwards is not thrown away.
const openPage = async (page, url) => {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
};

const toggleFor = (page) => page.locator('#export-dropdown button[aria-haspopup="true"]');

for (const label of [CHARACTER_PAGE, CLASS_PAGE]) {
  test(`${label}: the export dropdown toggles, and a click outside closes it`, async ({ page }) => {
    await openPage(page, urlFor(label));

    const toggle = toggleFor(page);
    const dropdown = page.locator('#export-dropdown');
    const menu = page.locator('#export-menu');

    // Positive precondition: the control is on the page at all. Without it a
    // template regression that dropped the whole button bar would leave every
    // "closed" assertion below passing against nothing.
    await expect(toggle).toBeVisible();

    // CLOSED FIRST, and this half is load-bearing -- asserting only the open
    // state would pass on a dropdown that was open from page load and never
    // moved. Task 11 measured exactly that failure mode on the navbar: with
    // `x-data` removed, Alpine still evaluates `:class="open && 'is-active'"`,
    // resolves the bare `open` against the global scope, finds `window.open` (a
    // function, therefore truthy) and paints the component open before any
    // click. Assert the TRANSITION, not the end state.
    await expect(dropdown).not.toHaveClass(/is-active/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();

    await toggle.click();
    await expect(dropdown).toHaveClass(/is-active/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();

    // A second click on the trigger. The trigger is INSIDE #export-dropdown, so
    // @click.outside does not fire here -- this is `@click="open = !open"` on
    // the button doing the work, which is a different binding from the one the
    // next block exercises.
    await toggle.click();
    await expect(dropdown).not.toHaveClass(/is-active/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // ...and now @click.outside. The page heading is a deliberate target: it is
    // present on both templates (views/character.handlebars:2,
    // views/class-view.handlebars:2), holds no links, and sits outside the
    // dropdown. A bare `body.click({ position: { x: 5, y: 5 } })` would land on
    // the skip-to-content link (views/layouts/main.handlebars:6).
    await toggle.click();
    await expect(dropdown).toHaveClass(/is-active/);
    await page.locator('h1.title').first().click();
    await expect(dropdown).not.toHaveClass(/is-active/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
  });

  test(`${label}: Escape closes the export dropdown from anywhere on the page`, async ({ page }) => {
    await openPage(page, urlFor(label));

    const toggle = toggleFor(page);
    const dropdown = page.locator('#export-dropdown');

    await expect(dropdown).not.toHaveClass(/is-active/); // see the transition note above
    await toggle.click();
    await expect(dropdown).toHaveClass(/is-active/);

    // The binding is `@keydown.escape.window`, not `@keydown.escape` on the
    // element, and that distinction is the entire point of this test: the
    // dropdown must close on Escape even when the keystroke is delivered
    // somewhere else entirely. Clicking the trigger leaves focus ON the
    // trigger, i.e. inside #export-dropdown, where an element-scoped handler
    // would also work -- so focus is moved out first and the move is asserted,
    // otherwise this test would pass under a mutation from `.window` to a bare
    // element listener and prove nothing.
    const brand = page.locator('.navbar-brand a[href="/"]');
    await brand.focus();
    expect(
      await page.evaluate(() => {
        const active = document.activeElement;
        return !!active && !active.closest('#export-dropdown');
      }),
      'focus must be outside #export-dropdown for this to test the .window modifier'
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dropdown).not.toHaveClass(/is-active/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test(`${label}: both export links resolve to real export files`, async ({ page }) => {
    await openPage(page, urlFor(label));
    await toggleFor(page).click();
    await expect(page.locator('#export-dropdown')).toHaveClass(/is-active/);

    const links = page.locator('#export-menu a[href]');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(2); // zero-iteration guard

    // THE auth header, and it is not optional. Both export routes sit behind
    // `isAuthenticated` (routes/characters.js:746, routes/classes.js:354), and
    // this app authenticates with an `Authorization: Bearer` header written by
    // public/js/app.js's htmx:configRequest hook (app.js:730-736) -- NOT with a
    // cookie. `page.request` shares the browser context's cookie jar and
    // nothing else, so a bare `page.request.get(href)` carries no credentials:
    // util/auth.js:44 answers it with a redirect to /auth/check, Playwright
    // follows the redirect, and the call reports `200`. Measured: status 200,
    // content-type text/html, a 6666-byte sign-in page. The plan's draft
    // asserted only `status === 200` and would therefore have passed with every
    // export endpoint deleted. Asserting the content-type and the body shape is
    // what makes the header itself load-bearing here: drop it and the
    // content-type assertion fails on text/html.
    const token = await page.evaluate(() => localStorage.getItem('authToken'));
    expect(token, 'storageState must carry an authToken; the export routes are authenticated').toBeTruthy();

    const expectations = {
      markdown: { contentType: /^text\/markdown/, check: (body) => body.trimStart().startsWith('#') },
      json: { contentType: /^application\/json/, check: (body) => { JSON.parse(body); return true; } }
    };

    const seen = [];
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute('href');
      const format = new URL(href, page.url()).searchParams.get('format');
      const expected = expectations[format];
      expect(expected, `unexpected export format in ${href}`).toBeTruthy();

      const response = await page.request.get(href, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.text();
      expect(
        {
          status: response.status(),
          contentType: response.headers()['content-type'],
          disposition: response.headers()['content-disposition'],
          bodyLength: body.length,
          bodyIsWellFormed: expected.check(body)
        },
        `export ${format} (${href}) -> ${body.slice(0, 120)}`
      ).toMatchObject({
        status: 200,
        contentType: expect.stringMatching(expected.contentType),
        // The route sets `attachment; filename="..."`. Asserting it separates
        // "the export endpoint answered" from "some page happened to answer
        // with the right content-type".
        disposition: expect.stringContaining('attachment'),
        bodyIsWellFormed: true
      });
      expect(body.length).toBeGreaterThan(0);
      seen.push(format);
    }

    // Both formats, not the same one twice.
    expect(seen.sort()).toEqual(['json', 'markdown']);
  });
}

// ---------------------------------------------------------------------------
// The in-page paint recorder shared by the three history-restore tests below.
//
// Same construction as e2e/specs/09-boosted-nav-settle.spec.js and
// 10-back-button-snapshot.spec.js, and for the same reasons (Task 10's two
// durable lessons): a RETRYING assertion cannot see a transient state at all,
// and a single page.evaluate snapshot is only as reliable as the CDP round-trip
// is fast. Hook htmx's own swap event in-page, sample on requestAnimationFrame,
// and read the accumulated record afterwards, so a state that has already passed
// is still caught.
//
// Hooked on htmx:afterSwap rather than htmx:historyRestore because afterSwap
// also fires on htmx's cache-miss path (loadHistoryFromServer), so the recorder
// still produces frames if the restore mechanism changes underneath this file.
//
// Everything hangs off `document`/`window`, which an innerHTML restore of <body>
// does not replace, so the record survives the restore and dies only on a real
// page load.
//
// `config` is { rootSelector, panelSelector, stateKey }: the component root that
// carries `:class`, the element Bulma shows or hides as a result, and the key
// the component's own x-data declares. Both subjects follow the same Bulma rule
// -- .dropdown-menu and .modal are `display: none` until an `is-active` on their
// root -- so one recorder covers both, and `display !== 'none'` is the
// paint-level statement of "the user can see it".
// ---------------------------------------------------------------------------
const armRestoreProbe = (config) => {
  const probe = { restoreObserved: false, cacheHitPath: null, frames: [] };
  window.__restoreProbe = probe;

  document.addEventListener('htmx:historyCacheHit', (ev) => {
    probe.cacheHitPath = ev.detail && ev.detail.path;
  }, { once: true });
  document.addEventListener('htmx:historyRestore', () => {
    probe.restoreObserved = true;
  }, { once: true });

  document.addEventListener('htmx:afterSwap', () => {
    const tick = () => {
      if (probe.frames.length >= 12) return; // ~200ms of frames
      const root = document.querySelector(config.rootSelector);
      const panel = document.querySelector(config.panelSelector);
      let alpineInitialised = false;
      let alpineState = null;
      try {
        // NOT `!!Alpine.$data(el)`: $data falls back to mergeProxies([]) and
        // returns a truthy Proxy for ANY element, even one with no x-data
        // ancestor, so bare truthiness is vacuous. Presence of the key this
        // component's own x-data declares is the real initialisation test.
        const data = root && window.Alpine ? window.Alpine.$data(root) : null;
        alpineInitialised = !!data && config.stateKey in data;
        alpineState = alpineInitialised ? data[config.stateKey] : null;
      } catch (_) { /* Alpine absent -> stays false, which fails below */ }
      probe.frames.push({
        t: Math.round(performance.now()),
        // Recorded separately from the class/display readings so that "the
        // component is not there at all" cannot masquerade as "the component is
        // painted open" -- getComputedStyle is never reached when the element is
        // absent, `display` records null, and `null !== 'none'`. Task 11 caught
        // exactly that miscount reporting a BLANK PAGE as a stuck-open menu.
        rootPresent: !!root,
        panelPresent: !!panel,
        rootIsActive: !!root && root.classList.contains('is-active'),
        display: panel ? getComputedStyle(panel).display : null,
        // Only meaningful for the modal, but free to record: the body scroll
        // lock is a document-level side effect the component sets in
        // public/js/alpine-components.js and is asserted at zero on both.
        bodyLocked: document.body.classList.contains('modal-open'),
        alpineInitialised,
        alpineState
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { once: true });
};

// Reduces the recorded frames to the numbers the assertions care about. Every
// element's readings are gated on that element existing, so "absent" and
// "present but wrong" stay different failures instead of collapsing into one.
const summarise = (probe) => ({
  restoreObserved: probe.restoreObserved,
  framesSampled: probe.frames.length,
  framesComponentMissing: probe.frames.filter((f) => !f.rootPresent || !f.panelPresent).length,
  // The user-visible defect: a frame the browser rendered with the panel on
  // screen.
  framesPaintedOpen: probe.frames.filter((f) => (
    (f.rootPresent && f.rootIsActive) || (f.panelPresent && f.display !== 'none')
  )).length,
  // Positive precondition, per frame. Without it, a regression that stopped
  // Alpine adopting restored content would sail past the line above: a DEAD
  // component paints identically to a correctly-closed one, because Bulma hides
  // both panels without `is-active` whether or not anything is alive.
  framesWithoutAlpine: probe.frames.filter((f) => !f.alpineInitialised).length,
  // Alpine's own state must agree it is closed. Disagreement in EITHER direction
  // is a bug: open state surviving a restore, or (what the red tests below
  // actually find) markup surviving that Alpine believes it has already closed.
  framesAlpineOpen: probe.frames.filter((f) => f.alpineState === true).length,
  framesBodyLocked: probe.frames.filter((f) => f.bodyLocked).length
});

const waitForFrames = (page) => page.waitForFunction(
  () => window.__restoreProbe && window.__restoreProbe.frames.length >= 3,
  null,
  { timeout: 10_000 }
);

// Leaves the character page by clicking the navbar brand link, which is boosted
// like every other same-origin anchor (hx-boost="true" on <body>,
// views/layouts/main.handlebars:5). Returns once the hop has landed, having
// asserted it really was a body swap: a full page load caches no history
// snapshot and would make everything downstream vacuous.
const boostedHopToHome = async (page) => {
  await page.evaluate(() => { window.__preNav = true; });
  await page.locator('.navbar-brand a[href="/"]').click();
  await page.waitForURL((url) => url.pathname === '/');
  expect(
    await page.evaluate(() => window.__preNav === true),
    'expected a boosted body swap on the way out; a full page load caches no history snapshot'
  ).toBe(true);
};

test('the character page comes back from the back button with a closed, live dropdown', async ({ page }) => {
  // The positive control for the two red dropdown/modal tests below, and a
  // regression guard in its own right. Two separate things are proved here and
  // both matter for reading the failures that follow:
  //
  //  1. htmx's history restore re-initialises Alpine correctly on restored
  //     content on THIS page. Without that, the red tests could be misread as
  //     "history restore breaks Alpine", which is not what happens -- Alpine is
  //     fully alive on a restored page, it just cannot remove a class it never
  //     added.
  //  2. `@click.outside` is what keeps the ORDINARY route safe. Leaving the
  //     page by clicking any link outside the dropdown fires
  //     `@click.outside="open = false"` first -- the anchor's own listener runs
  //     at the target before Alpine's document-level one, but htmx's snapshot is
  //     taken later, in the response handler -- so Alpine has already removed
  //     `is-active` by the time saveCurrentPageToHistory runs. Measured: the
  //     cached snapshot for this route contains
  //     `<div class="dropdown is-right" id="export-dropdown"`, with no
  //     is-active. Delete @click.outside and this test goes red, which is the
  //     single sharpest statement of what that binding is worth.
  //
  // /characters/:id is authOptional (routes/characters.js:777), so page.goto
  // lands on it directly. That matters more than it looks: on a PROTECTED route
  // the initial load goes through /auth/check and app.js:986's raw
  // `history.replaceState(null, '', url)` never tells htmx about the final URL,
  // so htmx caches that page's snapshot under the /auth/check key and the back
  // button takes the cache-MISS path instead (measured on /classes/my:
  // snapshot url "/auth/check?r=%2Fclasses%2Fmy"). That is Task 11's separately
  // filed blank-page defect, and it would mask everything this file is
  // measuring.
  await openPage(page, urlFor(CHARACTER_PAGE));

  const dropdown = page.locator('#export-dropdown');
  const toggle = toggleFor(page);
  await expect(dropdown).not.toHaveClass(/is-active/);
  await toggle.click();
  await expect(dropdown).toHaveClass(/is-active/);

  await boostedHopToHome(page);

  await page.evaluate(armRestoreProbe, {
    rootSelector: '#export-dropdown', panelSelector: '#export-menu', stateKey: 'open'
  });
  await page.goBack();
  await page.waitForURL((url) => url.pathname.startsWith(`/characters/${character.id}`));
  await waitForFrames(page);

  const probe = await page.evaluate(() => window.__restoreProbe);
  const summary = summarise(probe);
  expect(summary.framesSampled).toBeGreaterThanOrEqual(3); // zero-iteration guard
  expect(summary, `restored-dropdown paint probe: ${JSON.stringify(probe)}`).toMatchObject({
    // htmx served its own cached snapshot rather than re-fetching from the
    // server. Both signals are needed: the cache-MISS path
    // (loadHistoryFromServer) also fires htmx:historyRestore, so
    // htmx:historyCacheHit is the only discriminator between the two.
    restoreObserved: true,
    framesComponentMissing: 0,
    framesPaintedOpen: 0,
    framesWithoutAlpine: 0,
    framesAlpineOpen: 0,
    framesBodyLocked: 0
  });
  expect(probe.cacheHitPath).toBe(`/characters/${character.id}`);

  // ...and live, not merely correct-looking. If the restored snapshot had no
  // component behind it every assertion above would still pass: Bulma hides
  // .dropdown-menu without .is-active whether or not Alpine exists.
  await expect(page.locator('#export-dropdown')).not.toHaveClass(/is-active/);
  await toggleFor(page).click();
  await expect(page.locator('#export-dropdown')).toHaveClass(/is-active/);
  await expect(toggleFor(page)).toHaveAttribute('aria-expanded', 'true');
});

// ---------------------------------------------------------------------------
// EXPECTED TO FAIL (1 of 3). Characterizes a real, confirmed, reproducible
// product defect -- not a bug in the test. Do not "fix" it by changing
// production code under this task and do not loosen the assertions. If it starts
// passing because someone fixed the underlying bug, that is the correct way for
// it to go green.
//
// THE ANSWER TO PART 2, HALF ONE: check 12's frozen-`:class` defect is NOT
// navbar-specific. It reproduces verbatim on the export dropdown, on both the
// character and class pages (both measured; only the character page is asserted
// here, to keep one red test per defect rather than one per template).
//
// What makes it reachable, given the positive-control test above proves
// @click.outside protects the ordinary route: the export links live INSIDE
// #export-dropdown, so clicking one does not fire @click.outside. The dropdown
// is still open when htmx's saveCurrentPageToHistory (dist line 3251) snapshots
// body.innerHTML on the way out. Measured cached snapshot:
//
//   <div class="dropdown is-right is-active" id="export-dropdown"
//
// Back -> restoreHistory (dist 3342) reinstates that markup verbatim -> Alpine
// re-initialises with `open: false` -> evaluates `open && 'is-active'` -> false
// -> setClassesFromString(el, '') -> adds nothing, and the undo pass removes
// nothing, because Alpine only ever removes classes IT added.
//
// Repro by hand: open the export dropdown, click "Markdown (.md)", press Back.
// Observed on every run: `dropdown is-right is-active`, #export-menu
// `display: block`, Alpine alive with `open: false`. NOTHING on that page
// closes it -- measured after the restore: Escape does nothing, clicking
// outside does nothing, and clicking the trigger toggles Alpine's `open`
// true/false/true while the class never moves. The trigger also reports
// `aria-expanded="false"` while the menu is visibly expanded, the same
// alive-but-powerless a11y symptom Task 11 recorded on the navbar burger. Any
// subsequent navigation clears it.
//
// RECOMMENDED FIX (a production change, deliberately NOT applied -- this branch
// reports defects, it does not fix them):
//
//   views/character.handlebars:163  and  views/class-view.handlebars:36
//   -  :class="open && 'is-active'"
//   +  :class="{ 'is-active': open }"
//
// Alpine's setClassesFromObject DOES remove a falsy class it did not add (its
// forRemove branch calls classList.remove on any falsy key already present);
// setClassesFromString only ever removes what it added. Same fix, same reason,
// as the one recorded in 10-back-button-snapshot.spec.js for
// views/partials/nav.handlebars:6,14 -- and verified here the same way: applied
// and reverted, this test goes green.
//
// DO NOT reach for hx-history="false" or historyCacheSize: 0 instead. Both make
// this test pass and both are worse than the defect: with the snapshot cache out
// of play, Back falls through to htmx's loadHistoryFromServer, whose raw XHR
// sends HX-Request: true and no Authorization header, which produces a blank
// page on protected routes and a silently signed-out render on auth-optional
// ones. See task-11-report.md.
// ---------------------------------------------------------------------------
test('going back after using an export link restores a closed dropdown', async ({ page }) => {
  await openPage(page, urlFor(CHARACTER_PAGE));

  const dropdown = page.locator('#export-dropdown');
  await expect(dropdown).not.toHaveClass(/is-active/); // assert the transition, not the end state
  await toggleFor(page).click();
  await expect(dropdown).toHaveClass(/is-active/);

  // Leaving via a link INSIDE the dropdown: the one route @click.outside does
  // not intercept, and the ordinary way a user leaves this page with the
  // dropdown open (it is what the dropdown is FOR).
  await page.evaluate(() => { window.__preNav = true; });
  const exportLink = page.locator('#export-menu a[href*="format=markdown"]');
  await expect(exportLink).toBeVisible();
  await exportLink.click();
  await page.waitForURL((url) => url.pathname.endsWith('/export'));
  expect(
    await page.evaluate(() => window.__preNav === true),
    'expected a boosted body swap on the way out; a full page load caches no history snapshot'
  ).toBe(true);

  await page.evaluate(armRestoreProbe, {
    rootSelector: '#export-dropdown', panelSelector: '#export-menu', stateKey: 'open'
  });
  await page.goBack();
  await page.waitForURL((url) => url.pathname.startsWith(`/characters/${character.id}`));
  await waitForFrames(page);

  const probe = await page.evaluate(() => window.__restoreProbe);
  const summary = summarise(probe);
  expect(summary.framesSampled).toBeGreaterThanOrEqual(3); // zero-iteration guard

  // THE defect. framesPaintedOpen is what the user sees; framesAlpineOpen: 0
  // holding at the same time is the signature that separates this from "Alpine
  // restored open state" -- Alpine says closed, the screen says open.
  // framesComponentMissing: 0 keeps that reading honest: a restore that produced
  // no dropdown at all must report as its own failure, not as this one.
  expect(summary, `restored-dropdown paint probe: ${JSON.stringify(probe)}`).toMatchObject({
    restoreObserved: true,
    framesComponentMissing: 0,
    framesPaintedOpen: 0,
    framesWithoutAlpine: 0,
    framesAlpineOpen: 0
  });

  // Steady state, after every settle and microtask has had its chance. Weaker
  // than the probe (a retrying assertion cannot see a transient) but it would
  // catch a LATE re-open the 12-frame window misses, so both are kept.
  await expect(page.locator('#export-dropdown')).not.toHaveClass(/is-active/);
  await expect(page.locator('#export-menu')).toBeHidden();

  // ...and closed because Alpine is driving it, not because Alpine is dead.
  await toggleFor(page).click();
  await expect(page.locator('#export-dropdown')).toHaveClass(/is-active/);
});

// ---------------------------------------------------------------------------
// EXPECTED TO FAIL (2 of 3). Same standing as the test above.
//
// THE ANSWER TO PART 2, HALF TWO -- and it is worse than a frozen class, and
// needs no history snapshot at all.
//
// public/js/alpine-components.js's modalBase adds `modal-open` to
// document.body on open and removes it on close, and
// public/css/styles.css:253-255 gives `body.modal-open { overflow: hidden; }`.
// The class is a DOCUMENT-level side effect owned by a COMPONENT-level lifetime,
// and nothing releases it when the component is destroyed. htmx's boosted swap
// replaces body.innerHTML; `<body>`'s own class attribute is not part of the
// swap (cleanInnerHtmlForHistory, dist 3238, snapshots innerHTML), so
// `modal-open` outlives the component that set it.
//
// Measured after one boosted hop with the level-up modal open:
//   { url: "/", bodyClass: "modal-open", overflow: "hidden", anyActiveModal: false }
// A page with no modal on it, that the user cannot scroll, with nothing on
// screen to explain why. Only a full page load (or opening and properly closing
// another modal) clears it.
//
// IS THIS REACHABLE? Yes, without a mouse trick. A Bulma modal here has no focus
// trap and the page behind it is neither `inert` nor `aria-hidden`, so every
// link on the page stays keyboard-focusable and Enter-activatable while the
// modal covers the screen -- asserted below before the navigation, so this test
// cannot be dismissed as driving an unreachable state. Tab out of the modal,
// press Enter on any link, and the lock comes with you. That is an ordinary
// keyboard-user interaction, and the missing focus trap is a defect in its own
// right.
//
// RECOMMENDED FIX: give the lock the same lifetime as the thing that needs it --
// e.g. `destroy() { document.body.classList.remove('modal-open') }` on
// modalBase (Alpine calls destroy() when it tears a component down), or derive
// the lock from "is any .modal.is-active on the page" rather than from a
// counter-free add/remove pair. Deliberately NOT applied here.
// ---------------------------------------------------------------------------
test('navigating away from an open modal releases the body scroll lock', async ({ page }) => {
  await openPage(page, urlFor(CHARACTER_PAGE));

  const modal = page.locator('#levelUpModal');
  await expect(modal).not.toHaveClass(/is-active/); // assert the transition
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);

  // The bridge public/js/character-level-up.js uses: a window CustomEvent that
  // modalBase's @open-modal.window listener picks up (covered in detail by
  // 05-level-up-modal.spec.js).
  await page.locator('#levelUpBtn').click();
  await expect(modal).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/modal-open/);

  // The reachability precondition, asserted rather than assumed: a link outside
  // the modal still takes focus while the modal is open. If the modal ever gains
  // a focus trap, or the background is marked `inert`, this fails and the rest of
  // the test stops being a statement about anything a user can do.
  const brand = page.locator('.navbar-brand a[href="/"]');
  expect(
    await page.evaluate(() => {
      const link = document.querySelector('.navbar-brand a[href="/"]');
      link.focus();
      return document.activeElement === link && !link.closest('#levelUpModal');
    }),
    'a link outside the modal must be focusable for the keyboard escape route to be real'
  ).toBe(true);

  await page.evaluate(() => { window.__preNav = true; });
  await page.keyboard.press('Enter'); // activates the focused link -> boosted hop
  await page.waitForURL((url) => url.pathname === '/');
  expect(
    await page.evaluate(() => window.__preNav === true),
    'expected a boosted body swap; a full page load rebuilds <body> and would clear the lock for trivial reasons'
  ).toBe(true);

  // THE defect: the scroll lock followed the user to a page that has no modal.
  const landed = await page.evaluate(() => ({
    path: location.pathname,
    bodyClass: document.body.className,
    overflow: getComputedStyle(document.body).overflow,
    activeModals: document.querySelectorAll('.modal.is-active').length
  }));
  expect(landed, `state after leaving an open modal: ${JSON.stringify(landed)}`).toMatchObject({
    path: '/',
    // Positive precondition: the modal really is gone from the new page, so
    // "still locked" cannot be explained away as "the modal is still open".
    activeModals: 0,
    overflow: 'visible'
  });
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);
});

// ---------------------------------------------------------------------------
// EXPECTED TO FAIL (3 of 3). Same standing as the two tests above.
//
// The two defects compounding: the frozen `:class` from check 12 AND the leaked
// body lock, on the same element, after the back button.
//
// views/partials/character-level-up.handlebars:2 uses the identical binding form
// the navbar and the export dropdown use -- `:class="show && 'is-active'"` --
// so the modal's `is-active` is frozen into htmx's snapshot exactly the same
// way. Measured cached snapshot:
//
//   <div id="levelUpModal" class="modal is-active"
//
// and, after Back:
//
//   { cls: "modal is-active", display: "flex", alpineShow: FALSE,
//     bodyClass: "modal-open", overflow: "hidden" }
//
// A stuck-open MODAL is materially worse than a stuck-open navbar or dropdown,
// and this is the part worth escalating:
//
//   - `.modal` is a full-viewport fixed overlay. Measured with
//     document.elementFromPoint at the bottom centre of the restored page:
//     `DIV.modal-background`. The overlay swallows every click on the page.
//   - The body scroll lock is still on, so the page cannot be scrolled either.
//   - NOTHING dismisses it. Escape and a background click both route through
//     modalBase.close(), which starts `if (!this.show) return;` -- and `show` is
//     already false, because Alpine re-initialised it that way. Measured: after
//     Escape, still `modal is-active`; after a background click, still
//     `modal is-active`.
//   - Re-opening does not help either. Clicking Level Up again leaves
//     `show: false` on the restored page (the modal is inert as well as stuck),
//     and even if it did open, Alpine's setClassesFromString would find
//     `is-active` already present, add nothing, and therefore have nothing to
//     remove on the next close.
//
// So a signed-in user who opens Level Up, tabs to a link, presses Enter, and
// then presses Back lands on a correct-looking URL with an opaque overlay over
// the whole viewport, no scrolling, and no way out except a reload or another
// navigation. Both underlying causes are already described above; the `:class`
// half is fixed by `:class="{ 'is-active': show }"` at
// views/partials/character-level-up.handlebars:2 (and at the four other modal
// sites carrying the same form), the lock half by giving the lock a
// component-independent lifetime.
//
// BOTH halves are needed, measured separately rather than assumed. The `:class`
// fix alone takes framesPaintedOpen from 6 to 0 and leaves framesBodyLocked at
// 5 -- this test stays red, correctly, on a page that no longer shows a phantom
// modal but still cannot be scrolled. Adding
// `destroy() { document.body.classList.remove('modal-open') }` to modalBase in
// public/js/alpine-components.js on top of it turns this test AND the
// scroll-lock test above green. Applied and reverted; no production change
// ships from this task.
// ---------------------------------------------------------------------------
test('going back after leaving an open modal restores a dismissed, unlocked page', async ({ page }) => {
  await openPage(page, urlFor(CHARACTER_PAGE));

  const modal = page.locator('#levelUpModal');
  await expect(modal).not.toHaveClass(/is-active/);
  await page.locator('#levelUpBtn').click();
  await expect(modal).toHaveClass(/is-active/);

  await page.evaluate(() => {
    window.__preNav = true;
    document.querySelector('.navbar-brand a[href="/"]').focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === '/');
  expect(
    await page.evaluate(() => window.__preNav === true),
    'expected a boosted body swap on the way out; a full page load caches no history snapshot'
  ).toBe(true);

  await page.evaluate(armRestoreProbe, {
    rootSelector: '#levelUpModal', panelSelector: '#levelUpModal', stateKey: 'show'
  });
  await page.goBack();
  await page.waitForURL((url) => url.pathname.startsWith(`/characters/${character.id}`));
  await waitForFrames(page);

  const probe = await page.evaluate(() => window.__restoreProbe);
  const summary = summarise(probe);
  expect(summary.framesSampled).toBeGreaterThanOrEqual(3); // zero-iteration guard

  expect(summary, `restored-modal paint probe: ${JSON.stringify(probe)}`).toMatchObject({
    restoreObserved: true,
    framesComponentMissing: 0,
    framesPaintedOpen: 0,
    framesWithoutAlpine: 0,
    framesAlpineOpen: 0,
    // The scroll lock, per frame. Asserted alongside the paint so a fix that
    // addressed only one of the two causes still reports the other.
    framesBodyLocked: 0
  });

  // Steady state, and then the two dismissal paths a user would actually reach
  // for. Both are no-ops today (modalBase.close() early-returns because `show`
  // is already false), so this section documents that the page is not merely
  // wrong on arrival but unrecoverable in place.
  await expect(modal).not.toHaveClass(/is-active/);
  await expect(page.locator('body')).not.toHaveClass(/modal-open/);
  await page.keyboard.press('Escape');
  await expect(modal).not.toHaveClass(/is-active/);

  // ...and closed because Alpine is driving it, not because Alpine is dead.
  await page.locator('#levelUpBtn').click();
  await expect(modal).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/modal-open/);
});

// ---------------------------------------------------------------------------
// EXPECTED TO FAIL (bonus, a fourth confirmed defect found while writing the
// "both export links resolve" test above). Same standing as the three above.
//
// The export links never export anything. `hx-boost="true"` on <body>
// (views/layouts/main.handlebars:5) boosts EVERY same-origin anchor in the
// document, and neither export template opts out with `hx-boost="false"` or a
// `download` attribute -- even though the codebase already knows that idiom
// (views/partials/signin-form.handlebars:12,
// views/partials/section-heading.handlebars:1).
//
// So clicking "Markdown (.md)" does not download a file. htmx issues an AJAX GET
// (with the Authorization header its configRequest hook adds, so the server
// happily returns the real export), ignores the `Content-Disposition:
// attachment` header entirely, and swaps the raw file into <body>. Measured on
// the character page: no `download` event, URL pushed to
// /characters/<id>/export?format=markdown, and body.innerHTML replaced with
//
//   # <character name>\n\n**<class>** · Level 1\n\n🎭 **Personality:** `Brave`...
//
// The class page behaves identically with ?format=json -- raw JSON rendered as
// the page body. Asserted once rather than once per template, to keep one red
// test per defect.
//
// THE OBVIOUS FIX DOES NOT WORK, and that is the more useful half of this
// finding. `hx-boost="false"` on the export anchors was applied and measured:
// htmx correctly stops boosting them (internal `boosted: false`), the browser
// performs a REAL navigation -- and a real navigation carries no
// `Authorization: Bearer` header, because that header is written by JavaScript
// (public/js/app.js:730-736), never by the browser. Observed request chain:
//
//   document /characters/<id>/export?format=markdown
//   -> document /auth/check?r=%2Fcharacters%2F<id>%2Fexport%3Fformat%3Dmarkdown
//   -> app.js start() -> redirectTo() re-issues it as an XHR *with* the header
//   -> and swaps the response into <body>
//
// i.e. exactly the same raw markdown in the page, by a longer road. Every
// header-authenticated endpoint in this app is structurally un-downloadable:
// browsers only download from navigations (or `<a download>` same-origin
// fetches), and neither can produce that header.
//
// RECOMMENDED FIX (architectural, deliberately NOT applied here). Either:
//   (a) fetch the export from the Alpine component with the auth header and
//       hand the browser a Blob -- `URL.createObjectURL(blob)` on an
//       `<a download>` -- which is the shape that makes this test pass;
//       verified in isolation, a blob + download attribute does fire a real
//       download and leaves the page untouched; or
//   (b) make the export routes accept the session cookie / a short-lived
//       signed token in the query string, so a plain navigation authenticates,
//       and then `hx-boost="false"` becomes sufficient.
// A template-only change is not enough, and this test is deliberately written
// against the user-visible outcome ("a file arrives, the page stays put")
// rather than against either mechanism.
// ---------------------------------------------------------------------------
test('clicking an export link downloads the file instead of replacing the page', async ({ page }) => {
  await openPage(page, urlFor(CHARACTER_PAGE));

  await toggleFor(page).click();
  const exportLink = page.locator('#export-menu a[href*="format=markdown"]');
  await expect(exportLink).toBeVisible();

  // Armed before the click: a download that is going to happen at all happens
  // within a few hundred ms, so the 5s budget only ever costs anything on the
  // failing (current) path.
  const downloadStarted = page.waitForEvent('download', { timeout: 5_000 }).then(() => true, () => false);
  await exportLink.click();
  const started = await downloadStarted;

  const after = await page.evaluate(() => ({
    path: location.pathname,
    pageIntact: !!document.querySelector('#export-dropdown'),
    bodyStart: document.body.innerHTML.trim().slice(0, 80)
  }));

  expect(
    { downloadStarted: started, ...after },
    `state after clicking the Markdown export link: ${JSON.stringify(after)}`
  ).toMatchObject({
    downloadStarted: true,
    // A download leaves the page it was triggered from untouched. Both halves
    // are asserted because either one alone could be satisfied the wrong way:
    // a page that merely failed to navigate is not a download, and a download
    // that also navigated away is not the fix anyone wants.
    pageIntact: true,
    path: `/characters/${character.id}`
  });
});
