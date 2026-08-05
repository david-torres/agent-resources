// ar-7v3k check 10 -- the two LFG forms whose conditional sections became
// Alpine in 3a09932 ("convert form field-dependency toggles to Alpine"):
// lfg-form.handlebars's Conduit checkbox -> #character-select, and
// lfg-join-form.handlebars's join-type radios -> #character-select.
//
// BOTH PARTIALS USE THE ID #character-select. Every locator here is scoped to
// its own form; a bare `#character-select` would silently mean whichever one
// happens to be in the document.
//
// THE THREE VACUITY TRAPS THIS FILE IS BUILT AROUND:
//
//   1. `toBeHidden()` ON AN x-cloak ELEMENT PROVES NOTHING ON ITS OWN.
//      `[x-cloak] { display: none !important }` (public/css/styles.css:1336)
//      hides the create form's picker BEFORE Alpine initialises, so a bare
//      `toBeHidden()` passes with x-show deleted, with Alpine dead, or with the
//      Alpine script tag removed. Closed the way Task 13 established: the
//      `#character-select:not([x-cloak])` inversion (Alpine strips the
//      attribute on init) plus `'hosting' in Alpine.$data(form)` for liveness --
//      never `!!Alpine.$data(el)`, which is a truthy Proxy for ANY element
//      (Task 10). See e2e/specs/12-offscreen-mission.spec.js.
//
//   2. THE "LAZY LOAD" IS NOT LAZY, AND THE PLAN'S TEST FOR IT WAS VACUOUS
//      TWICE OVER. The plan asserted `expect(page.locator('body'))
//      .toContainText(/E2E Player/i)` after clicking Show. Measured on the
//      running app:
//        - `#join-requests-inline` is `class="block is-hidden"` with
//          `hx-trigger="revealed"`, and htmx's isScrolledIntoView reads a
//          display:none element's all-zero getBoundingClientRect as IN VIEW
//          (`top < innerHeight && bottom >= 0` with top === bottom === 0). So
//          htmx fires `revealed` at page load: ONE GET /lfg/:id/requests before
//          any click, `data-hx-revealed="true"`, and the panel's markup --
//          including the player's name and the character's name -- already sits
//          in the DOM, merely hidden.
//        - Playwright's toContainText reads textContent, which includes hidden
//          text. The plan's assertion was therefore already true before the
//          click, on a page where the button did nothing at all.
//      Closed by asserting VISIBILITY, not presence, in both directions, and by
//      proving the content is server-sourced (the initial HTML's panel is
//      empty) rather than static markup. The eager fetch itself is a
//      pre-existing defect and is recorded in the task report, not asserted
//      here -- see the note above that test.
//
//   3. x-model ON A CHECKBOX MAKES `toBeChecked()` UNABLE TO SEE THE SEEDING.
//      The `checked` attribute and the `x-data` initialiser derive from the
//      same `(eq post.host_id profile.id)`, so `toBeChecked()` passes whatever
//      the initialiser does. The bug this test exists to catch -- "an
//      initialiser that ignores the server-rendered value and defaults to
//      false" -- is only visible in Alpine's own `hosting` value, which is
//      asserted directly, on BOTH branches (a hosted post and an unhosted one)
//      so neither a hardcoded `true` nor a hardcoded `false` survives.
//
// ** THE FIXTURE TRAP: lfg_posts.host_id IS NOT THE SOURCE OF TRUTH **
// models/lfg.js#applyConduitMeta overwrites `post.host_id` on every read from
// the post's approved conduit join request. The plan's fixture
// (`insert({ ..., host_id: admin.id })`) reads back as host_id NULL and renders
// `x-data="{ hosting: false }"` with the checkbox unchecked -- a fixture bug
// that looks exactly like the product bug this file is hunting. e2e/fixtures/lfg.js
// goes through the real service seam instead; the full argument is in its header.
//
// PRODUCT DEFECTS FOUND WHILE WRITING THIS FILE (all PRE-EXISTING, none a
// refactor regression; evidence in task-15-report.md):
//   A. Back-navigation to an LFG post that has an approved, character-bearing
//      party member comes back SIGNED OUT. Covered by the deliberately-red test
//      at the bottom of this file, with a green positive control beside it.
//   B. GET /lfg/:id/requests is fetched on every post view by the creator, and
//      again on the first Show click (two identical requests). Reported, not
//      tested -- see trap 2.
//   C. A viewer who is neither the post's creator/host nor an admin can never
//      see that a post already has a Conduit: RLS hides both the conduit's
//      join_request and (for a non-public profile) its profile row, so
//      applyConduitMeta finds nothing and reports host_id null. They get
//      "Conduit needed" and an ENABLED Conduit radio on a filled post, and the
//      submit then fails with "Conduit slot is already filled". This is why the
//      conduit-disabled test below is viewed as the ADMIN (is_admin() bypasses
//      the RLS that hides it) rather than as the player.
//
// Inherited and load-bearing here:
//   - public/js/app.js:970-989 replaces the whole <body> via an outerHTML htmx
//     swap on EVERY authed page load, discarding Alpine state written before it
//     lands. openPage() waits for networkidle so every reading is pinned to the
//     post-swap component. Confirmed product defect, worked around, not fixed.
//   - Absent != present-but-wrong: every reading below is gated on its element
//     existing, and presence is asserted separately.
//   - A retrying assertion cannot test a transient, nor a non-change that is
//     already true.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { seedCharacter } = require('../fixtures/character');
const { seedLfgPost, seedJoinRequest } = require('../fixtures/lfg');
const { ADMIN_EMAIL, ADMIN_STATE, PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

const prefix = newPrefix('lfg');

let db;
let character;
// admin is creator AND conduit; carries one PENDING player request so the
// creator's join-requests panel has something to reveal.
let hostedPost;
// admin is creator, nobody is conduit, no requests. Three jobs: the create
// form's `hosting: false` branch, the player's join form (Conduit selectable),
// and the green control for the history-restore pair -- it renders no
// hx-history="false", so its snapshot IS cached.
let unhostedPost;
// the PLAYER is creator and conduit, so the admin sees a filled conduit slot.
let conduitPost;
// one APPROVED, character-bearing join request, which is the only shape that
// renders views/lfg-post.handlebars:90's hx-history="false".
let partyPost;

test.beforeAll(async () => {
  db = await connect();
  const admin = await profileForEmail(db, ADMIN_EMAIL);
  const player = await profileForEmail(db, PLAYER_EMAIL);

  const classRow = await seedClass(prefix, { createdBy: admin.id });
  // Owned by the PLAYER: services/lfg's join() refuses a character the joining
  // profile does not own ("You can only join with your own character").
  character = await seedCharacter(prefix, player, classRow);

  hostedPost = await seedLfgPost(prefix, admin, { title: `${prefix}-hosted-post`, hosting: true });
  unhostedPost = await seedLfgPost(prefix, admin, { title: `${prefix}-unhosted-post` });
  conduitPost = await seedLfgPost(prefix, player, { title: `${prefix}-conduit-post`, hosting: true });
  partyPost = await seedLfgPost(prefix, admin, { title: `${prefix}-party-post` });

  await seedJoinRequest(hostedPost, player, { joinType: 'player', characterId: character.id });
  await seedJoinRequest(partyPost, player, {
    joinType: 'player', characterId: character.id, approveAs: admin
  });
});

test.afterAll(async () => {
  // cleanupByPrefix reaches lfg_join_requests two ways, and BOTH are needed
  // here: by lfg_post_id (the posts above) and by character_id. The second was
  // added for this spec -- lfg_join_requests_character_id_fkey has no
  // referential action, so a character-bound request is a hard FK block on the
  // character delete. See the comment in e2e/fixtures/db.js.
  await cleanupByPrefix(db, prefix);
  await db.end();
});

// See the app.js:970-989 note in the header.
const openPage = async (page, url) => {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
};

// ONE non-retrying read of everything the create-form assertions depend on, so
// a failure names WHICH cause fired instead of just "expected hidden".
const readCreateForm = (page) => page.evaluate(() => {
  const form = document.querySelector('form:has(input[name="host_id"])');
  const picker = form ? form.querySelector('#character-select') : null;
  const checkbox = form ? form.querySelector('input[type="checkbox"][name="host_id"]') : null;
  let data = null;
  try {
    // NOT `!!Alpine.$data(form)`: $data falls back to mergeProxies([]) and is
    // truthy for ANY element, even one with no x-data ancestor. Presence of the
    // key this form's own x-data declares is the real test.
    data = form && window.Alpine ? window.Alpine.$data(form) : null;
  } catch (_) { /* Alpine absent -> alpineInitialised stays false */ }
  const alpineInitialised = !!data && 'hosting' in data;
  return {
    formPresent: !!form,
    pickerPresent: !!picker,
    checkboxPresent: !!checkbox,
    // Alpine removes x-cloak on init, so `true` here means the CSS is what is
    // hiding the picker -- i.e. Alpine never ran and `hidden` proves nothing.
    stillCloaked: !!picker && picker.hasAttribute('x-cloak'),
    pickerDisplay: picker ? getComputedStyle(picker).display : null,
    alpineInitialised,
    // THE assertion trap 3 exists for. Nothing in the DOM distinguishes a
    // correctly-seeded `hosting` from one the initialiser hardcoded.
    hosting: alpineInitialised ? data.hosting : null,
    checked: checkbox ? checkbox.checked : null
  };
});

const readJoinForm = (page) => page.evaluate(() => {
  const form = document.querySelector('form:has(#join-player-opt)');
  const picker = form ? form.querySelector('#character-select') : null;
  const playerOpt = form ? form.querySelector('#join-player-opt') : null;
  const conduitOpt = form ? form.querySelector('input[type="radio"][value="conduit"]') : null;
  let data = null;
  try {
    data = form && window.Alpine ? window.Alpine.$data(form) : null;
  } catch (_) { /* Alpine absent -> alpineInitialised stays false */ }
  const alpineInitialised = !!data && 'joinType' in data;
  return {
    formPresent: !!form,
    pickerPresent: !!picker,
    playerOptPresent: !!playerOpt,
    conduitOptPresent: !!conduitOpt,
    pickerDisplay: picker ? getComputedStyle(picker).display : null,
    alpineInitialised,
    joinType: alpineInitialised ? data.joinType : null,
    playerChecked: playerOpt ? playerOpt.checked : null,
    conduitChecked: conduitOpt ? conduitOpt.checked : null,
    conduitDisabled: conduitOpt ? conduitOpt.disabled : null
  };
});

// The server's own markup, fetched with the Bearer header this app
// authenticates with. public/js/app.js:730-736 writes it; the browser never
// does, and page.request shares only the cookie jar -- without it
// util/auth.js:33 redirects to /auth/check and Playwright reports a 200
// sign-in page (Task 12's Claim D). Needed for anything the live DOM
// structurally cannot see, x-cloak above all: Alpine strips it on init, so the
// attribute could be deleted from the template with every live assertion still
// passing and a flash of expanded fields restored on every load.
const serverMarkup = async (page, url) => {
  const token = await page.evaluate(() => localStorage.getItem('authToken'));
  expect(token, 'storageState must carry an authToken; this route is authenticated').toBeTruthy();
  const response = await page.request.get(url, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status(), `GET ${url}`).toBe(200);
  return response.text();
};

test.describe('the create/edit form, as the post\'s creator', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a post the viewer conduits starts hosting, with the character picker hidden', async ({ page }) => {
    // Reached the way a user reaches it -- the My Posts tab's Edit button,
    // hx-get + hx-swap="outerHTML" into `closest table` -- rather than by
    // navigating to /lfg/:id/edit. That route renders the partial with
    // `layout: false`, so a direct visit exercises app.js's whole-body
    // replacement instead of an htmx fragment swap, and Alpine's adoption of
    // SWAPPED-IN content (the thing that would actually regress) would go
    // untested. The direct-visit path is covered by the next test.
    await openPage(page, '/lfg');
    const row = page.locator('#lfg-posts tr').filter({ hasText: hostedPost.title });
    await expect(row, 'the seeded post must be listed on My Posts').toHaveCount(1);
    await row.locator('button:has-text("Edit")').click();

    const form = page.locator('form:has(input[name="host_id"])');
    const picker = form.locator('#character-select');
    const hosting = form.locator('input[type="checkbox"][name="host_id"]');

    // Positive precondition: the picker exists at all. Without it every
    // "hidden" assertion below passes against nothing.
    await expect(form).toHaveCount(1);
    await expect(picker).toHaveCount(1);
    // ...and Alpine has initialised this subtree -- see trap 1. This is also
    // the settle signal for the htmx swap: until Alpine has processed the
    // swapped-in nodes the attribute is still there.
    await expect(form.locator('#character-select:not([x-cloak])')).toHaveCount(1);
    await expect(picker).toBeHidden();

    const state = await readCreateForm(page);
    expect(state, `create-form state on a hosted post: ${JSON.stringify(state)}`).toMatchObject({
      formPresent: true,
      pickerPresent: true,
      checkboxPresent: true,
      stillCloaked: false,
      pickerDisplay: 'none',
      alpineInitialised: true,
      // Trap 3. `checked` alone cannot see this: both it and the initialiser
      // derive from the same handlebars condition, so the attribute satisfies
      // toBeChecked() whatever the x-data expression says.
      hosting: true,
      checked: true
    });

    // ...and it TRACKS the checkbox, in both directions. A one-way binding, or
    // an x-show that fired once, would satisfy everything above.
    await hosting.uncheck();
    await expect(picker).toBeVisible();
    const unchecked = await readCreateForm(page);
    expect(unchecked, `after unticking Conduit: ${JSON.stringify(unchecked)}`).toMatchObject({
      alpineInitialised: true,
      hosting: false,
      checked: false
    });
    expect(unchecked.pickerDisplay).not.toBe('none');

    await hosting.check();
    await expect(picker).toBeHidden();
    const rechecked = await readCreateForm(page);
    expect(rechecked, `after re-ticking Conduit: ${JSON.stringify(rechecked)}`).toMatchObject({
      alpineInitialised: true,
      pickerDisplay: 'none',
      hosting: true,
      checked: true
    });

    // The FOUC half, which the live DOM structurally cannot see.
    const html = await serverMarkup(page, `/lfg/${hostedPost.id}/edit`);
    expect(html, 'the server must seed Alpine from the rendered post, not hardcode a default')
      .toContain('x-data="{ hosting: true }"');
    expect(html, 'the picker must be rendered cloaked, or it flashes open before Alpine boots')
      .toMatch(/<div class="field" id="character-select"[^>]*\sx-cloak[\s>]/);
  });

  test('a post with no conduit starts not-hosting, with the character picker shown', async ({ page }) => {
    // The other branch of the same initialiser, and the reason the test above
    // is not satisfied by a hardcoded `true`. Also the direct-visit path:
    // /lfg/:id/edit renders the partial with `layout: false`, so what lands is
    // app.js's redirectTo() replacing the whole <body> with a bare fragment --
    // a real path (bookmark, reload) with no htmx fragment swap in it.
    await openPage(page, `/lfg/${unhostedPost.id}/edit`);

    const form = page.locator('form:has(input[name="host_id"])');
    const picker = form.locator('#character-select');

    await expect(form).toHaveCount(1);
    await expect(picker).toHaveCount(1);
    await expect(form.locator('#character-select:not([x-cloak])')).toHaveCount(1);
    await expect(picker).toBeVisible();

    const state = await readCreateForm(page);
    expect(state, `create-form state on an unhosted post: ${JSON.stringify(state)}`).toMatchObject({
      formPresent: true,
      pickerPresent: true,
      stillCloaked: false,
      alpineInitialised: true,
      hosting: false,
      checked: false
    });
    expect(state.pickerDisplay).not.toBe('none');

    // Rendered cloaked even though it starts VISIBLE. That is correct and
    // deliberate: x-cloak is removed by Alpine on init, so on this branch it
    // costs one frame of nothing; on the hosted branch it is the only thing
    // preventing the flash. Asserted so the attribute cannot be made
    // conditional on the initial state, which would reintroduce the flash for
    // exactly the case that needs it.
    const html = await serverMarkup(page, `/lfg/${unhostedPost.id}/edit`);
    expect(html).toContain('x-data="{ hosting: false }"');
    expect(html).toMatch(/<div class="field" id="character-select"[^>]*\sx-cloak[\s>]/);
  });
});

test.describe('the join-requests panel, as the post\'s creator', () => {
  test.use({ storageState: ADMIN_STATE });

  // NOTE, so nobody "fixes" this test by asserting presence: the panel's
  // content is ALREADY IN THE DOM before the click (trap 2 in the header).
  // Every assertion here is therefore about VISIBILITY, and the "it came from
  // the server" claim is made against the server's own markup rather than
  // against the live DOM.
  test('the Show button reveals the pending join request, and Hide puts it back', async ({ page }) => {
    await openPage(page, `/lfg/${hostedPost.id}`);

    const panel = page.locator('#join-requests-inline');
    const toggle = page.locator('.notification.is-warning button');
    const requestRow = panel.locator('tr').filter({ hasText: character.name });

    // Preconditions. The notification only renders for the creator and only
    // when pendingCount > 0 (views/lfg-post.handlebars:16-17), so its presence
    // is also the fixture's own integrity check.
    await expect(panel, 'the creator must get a join-requests panel').toHaveCount(1);
    await expect(toggle).toHaveText(/show/i);
    await expect(
      page.locator('.notification.is-warning'),
      'the fixture must leave exactly one PENDING request, or there is nothing to reveal'
    ).toContainText('1 pending join');

    // THE NEGATIVE PRECONDITION, on visibility. `toContainText` reads
    // textContent and would already be satisfied here; `toBeVisible` is not.
    await expect(panel).toBeHidden();
    await expect(requestRow).toBeHidden();

    await toggle.click();

    await expect(panel).toBeVisible();
    await expect(requestRow, 'the seeded request must become visible').toBeVisible();
    // The row, not just the page: the character's name also appears in the
    // party table on some posts, so an unscoped body assertion would not
    // distinguish the panel from the rest of the page.
    await expect(requestRow).toContainText('pending');
    await expect(toggle).toHaveText(/hide/i);

    // ...and back. A one-way reveal satisfies everything above.
    await toggle.click();
    await expect(panel).toBeHidden();
    await expect(requestRow).toBeHidden();
    await expect(toggle).toHaveText(/show/i);

    // What makes "it was revealed" mean "it was fetched": the server renders
    // #join-requests-inline EMPTY. Anything the panel displays therefore
    // arrived over the wire through its hx-get, not as static markup -- so
    // deleting that hx-get cannot leave this test green.
    const html = await serverMarkup(page, `/lfg/${hostedPost.id}`);
    expect(html, 'the panel must be server-rendered empty with an hx-get to fill it')
      .toMatch(new RegExp(`<div id="join-requests-inline"[^>]*hx-get="/lfg/${hostedPost.id}/requests"[^>]*></div>`));
    expect(html, 'the request row must NOT be in the initial document')
      .not.toContain(character.name);
  });
});

test.describe('the join form, as someone who has not joined', () => {
  test.use({ storageState: PLAYER_STATE });

  test('the join-type radios toggle the character picker', async ({ page }) => {
    await openPage(page, `/lfg/${unhostedPost.id}`);

    // The form is not on the page: it arrives through the Join button's
    // hx-get + hx-swap="outerHTML" (views/lfg-post.handlebars:53). So this
    // also covers Alpine adopting htmx-swapped content for the join form.
    await page.locator('button:has-text("Join")').click();

    const form = page.locator('form:has(#join-player-opt)');
    const picker = form.locator('#character-select');
    const conduit = form.locator('input[type="radio"][value="conduit"]');

    await expect(form).toHaveCount(1);
    await expect(picker).toHaveCount(1);
    await expect(picker).toBeVisible();

    // UNLIKE the create form, this picker carries NO x-cloak -- and does not
    // need one, because `joinType: 'player'` and `x-show="joinType === 'player'"`
    // agree that it starts visible, so there is nothing to flash. That makes
    // its initial visible state satisfiable by a page with no Alpine at all,
    // which is why liveness is asserted explicitly and why the real evidence
    // is the toggle below, not this state.
    const start = await readJoinForm(page);
    expect(start, `join-form state on load: ${JSON.stringify(start)}`).toMatchObject({
      formPresent: true,
      pickerPresent: true,
      playerOptPresent: true,
      conduitOptPresent: true,
      alpineInitialised: true,
      joinType: 'player',
      playerChecked: true,
      conduitChecked: false,
      // No conduit on this post, so the option is selectable. The disabled
      // counterpart is the next test -- without it this assertion is satisfied
      // by a template that never disables anything.
      conduitDisabled: false
    });
    expect(start.pickerDisplay).not.toBe('none');

    await conduit.check();
    await expect(picker).toBeHidden();
    const asConduit = await readJoinForm(page);
    expect(asConduit, `after choosing Conduit: ${JSON.stringify(asConduit)}`).toMatchObject({
      alpineInitialised: true,
      pickerDisplay: 'none',
      // x-model wrote the radio's value into the component. Without this, a
      // mutation that changed the string x-show compares against would be
      // indistinguishable from one that broke the binding.
      joinType: 'conduit',
      conduitChecked: true,
      playerChecked: false
    });

    // ...and back, because x-show has to TRACK joinType, not fire once.
    await form.locator('#join-player-opt').check();
    await expect(picker).toBeVisible();
    const asPlayer = await readJoinForm(page);
    expect(asPlayer, `after choosing Player again: ${JSON.stringify(asPlayer)}`).toMatchObject({
      alpineInitialised: true,
      joinType: 'player',
      playerChecked: true,
      conduitChecked: false
    });
    expect(asPlayer.pickerDisplay).not.toBe('none');

    // The server's own markup, for the pairing the missing x-cloak depends on:
    // the initialiser and the x-show expression must agree that the picker
    // starts VISIBLE. Change either half in isolation -- seed 'conduit', or
    // compare against 'conduit' -- and the picker flashes open on every load
    // before Alpine hides it, which no live-DOM assertion can see.
    const html = await serverMarkup(page, `/lfg/${unhostedPost.id}/join`);
    expect(html).toContain(`x-data="{ joinType: 'player' }"`);
    expect(html).toContain(`<div class="field" id="character-select" x-show="joinType === 'player'">`);
  });
});

test.describe('the join form on a post whose conduit slot is filled', () => {
  // Viewed as the ADMIN, not the player, and that is load-bearing rather than
  // convenient: see defect C in the header. RLS hides another user's conduit
  // join_request (and a non-public profile row) from an ordinary viewer, so
  // applyConduitMeta reports host_id null and the player sees this post as
  // "Conduit needed" with the radio ENABLED. is_admin() bypasses both policies,
  // so the admin is the only identity in this suite that can observe the
  // server-rendered `disabled` at all.
  test.use({ storageState: ADMIN_STATE });

  test('the Conduit option is disabled when someone else already conduits', async ({ page }) => {
    await openPage(page, `/lfg/${conduitPost.id}`);
    await page.locator('button:has-text("Join")').click();

    const form = page.locator('form:has(#join-player-opt)');
    const conduit = form.locator('input[type="radio"][value="conduit"]');

    await expect(form).toHaveCount(1);
    await expect(conduit).toBeDisabled();
    await expect(form.locator('label.radio').nth(1)).toContainText('Already assigned');

    const state = await readJoinForm(page);
    expect(state, `join-form state on a conduited post: ${JSON.stringify(state)}`).toMatchObject({
      formPresent: true,
      alpineInitialised: true,
      joinType: 'player',
      conduitDisabled: true,
      // ...and the picker is still shown, because the only selectable role is
      // Player. A `disabled` that also broke the initial state would be a
      // different bug and must not hide behind this one.
      playerChecked: true
    });
    expect(state.pickerDisplay).not.toBe('none');
  });
});

// ---------------------------------------------------------------------------
// The pair below settles the question Task 12 deferred to this task, because
// this is the first spec to seed LFG data: what does
// views/lfg-post.handlebars:90's hx-history="false" actually affect?
//
// ANSWER, measured: it suppresses the history SNAPSHOT of /lfg/:id itself.
// htmx's saveCurrentPageToHistory queries `[hx-history="false" i]`
// DOCUMENT-WIDE before caching, so one such attribute anywhere on the page
// means the page you are leaving is never cached. That attribute renders only
// inside {{#each post.join_requests}} -> {{#if approved}} -> {{#if character}},
// i.e. only for a post with an approved, character-bearing party member. Back
// then misses the cache, htmx falls through to loadHistoryFromServer, whose raw
// XHR carries `HX-Request: true` and NO Authorization header, and /lfg/:id is
// authOptional -- so the server answers with a full SIGNED-OUT render.
//
// Task 12's claim is CONFIRMED, with Task 11's scope correction intact: it is
// not every /lfg/:id, only ones with an approved party member.
//
// PRE-EXISTING, NOT A REFACTOR REGRESSION. `hx-history="false"` on that button
// predates this branch (37efac4, "Conduit unlock"); 3a09932 changed only the
// sibling `hx-on:click` into `@click` and left both history attributes byte for
// byte. Verified with `git show 3a09932 -- views/lfg-post.handlebars`.
// ---------------------------------------------------------------------------

// Installed immediately before goBack(). Everything hangs off document/window,
// which an innerHTML restore of <body> does not replace.
const armBackProbe = () => {
  const probe = { restoreObserved: false, cacheHit: null, cacheMiss: false };
  window.__lfgBack = probe;
  document.addEventListener('htmx:historyCacheHit', (ev) => {
    probe.cacheHit = (ev.detail && ev.detail.path) || true;
  }, { once: true });
  document.addEventListener('htmx:historyCacheMiss', () => { probe.cacheMiss = true; }, { once: true });
  document.addEventListener('htmx:historyRestore', () => { probe.restoreObserved = true; }, { once: true });
};

// Leaves the post through the breadcrumb's /lfg link (hx-boost'ed by the
// layout's <body hx-boost="true">), then comes back. Returns one non-retrying
// reading of the restored page. Non-retrying on purpose: a retrying assertion
// on "am I signed in" would spend its whole timeout on the failing case and
// still report nothing about WHY.
const leaveAndReturn = async (page, post) => {
  await openPage(page, `/lfg/${post.id}`);

  // Read on the OUTBOUND page, which is the one whose snapshot is at stake.
  // `partyMembers` counts the per-participant detail boxes, which sit behind
  // exactly the same three conditionals as the hx-history="false" attribute
  // ({{#each join_requests}} -> approved -> has character); it is the fixture
  // shape this pair turns on, and it stays true under either fix.
  // `hxHistoryFalseCount` is DIAGNOSTIC ONLY -- never asserted, because a fix
  // that removes the attribute must turn the red test GREEN, not swap one
  // failure for another.
  const outbound = await page.evaluate(() => ({
    hxHistoryFalseCount: document.querySelectorAll('[hx-history="false"]').length,
    partyMembers: document.querySelectorAll('[id^="character-details-"]').length
  }));

  await page.evaluate(() => { window.__preNav = true; });
  const back = page.locator('.breadcrumb a[href="/lfg"]').first();
  await expect(back).toBeVisible();
  await back.click();
  await page.waitForURL((url) => url.pathname === '/lfg');

  // A boosted click swaps <body> in place. A full page load would replace the
  // document, htmx would cache no snapshot, and Back would re-render from the
  // server with the Authorization header attached by app.js -- making every
  // assertion below pass for entirely the wrong reason.
  expect(
    await page.evaluate(() => window.__preNav === true),
    'expected a boosted body swap on the way out; a full page load makes this test vacuous'
  ).toBe(true);

  await page.evaluate(armBackProbe);
  await page.goBack();
  await page.waitForURL((url) => url.pathname === `/lfg/${post.id}`);
  await page.waitForFunction(() => window.__lfgBack && window.__lfgBack.restoreObserved,
    null, { timeout: 10_000 });
  // The cache-miss path finishes its XHR asynchronously after the event fires.
  await page.waitForTimeout(500);

  return page.evaluate((extra) => ({
    ...extra,
    cacheHit: window.__lfgBack.cacheHit,
    cacheMiss: window.__lfgBack.cacheMiss,
    bodyLength: document.body.innerHTML.length,
    // The nav's Profile link is emitted for any signed-in user
    // (views/partials/nav.handlebars:25) and for nobody else.
    signedIn: !!document.querySelector('a[href="/profile"]'),
    // ...and the restored document is really the post, not some other page the
    // back button happened to land on.
    postTitle: document.querySelector('.lfg-post h3') ? document.querySelector('.lfg-post h3').textContent.trim() : null
  }), outbound);
};

test.describe('the back button after leaving an LFG post', () => {
  test.use({ storageState: ADMIN_STATE });

  // THE POSITIVE CONTROL for the red test below, and a regression guard in its
  // own right: it proves back-navigation to /lfg/:id works, so the failure
  // below cannot be read as "LFG posts just do not survive the back button".
  test('a post with no approved party member comes back signed in', async ({ page }) => {
    const state = await leaveAndReturn(page, unhostedPost);

    expect(state, `restored page: ${JSON.stringify(state)}`).toMatchObject({
      // The preconditions that separate this from the test below: no approved
      // party member, therefore no hx-history="false", therefore a snapshot.
      partyMembers: 0,
      hxHistoryFalseCount: 0,
      cacheMiss: false,
      signedIn: true,
      postTitle: unhostedPost.title
    });
    expect(state.cacheHit, 'the snapshot must have been cached and hit').toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // EXPECTED TO FAIL. This characterizes a real, confirmed, reproducible
  // product defect -- not a bug in the test. Do not "fix" it by changing
  // production code under this task, and do not loosen the assertions.
  //
  // Repro by hand: open any LFG post that has an approved party member, click
  // a link out of it, press Back. The page comes back rendered SIGNED OUT --
  // signed-out nav, no Join/Unjoin controls, no error, at a URL that looks
  // correct. Measured: bodyLength 16326 -> 7156, nav "GAME INFO SOCIAL
  // LOGIN/SIGNUP", `htmx:historyCacheMiss` on the way in.
  //
  // It is the first deterministic reproduction of the CRITICAL cache-miss
  // defect Task 11 recorded (task-11-report.md, "the cache-miss path renders a
  // permanently blank page"): the same mechanism, reached here with no cache
  // eviction and no configuration change, just by viewing a post with a party.
  //
  // TWO INDEPENDENT FIXES WOULD TURN THIS GREEN, and both are correct:
  //   - drop hx-history="false" (and hx-push-url="false") from the Details
  //     button at views/lfg-post.handlebars:90-91. It is a leftover from when
  //     that button was an hx-on:click toggle; it is now a plain Alpine
  //     @click that issues no htmx request at all, so neither attribute can
  //     have any effect other than this one.
  //   - make htmx's history-restore fetch carry the app's Authorization header
  //     (the general fix for Task 11's defect, which reaches every route).
  // -------------------------------------------------------------------------
  test('a post with an approved party member comes back signed in', async ({ page }) => {
    const state = await leaveAndReturn(page, partyPost);

    // FIXTURE INTEGRITY, asserted first and separately: the post must really
    // render an approved, character-bearing party member, because that is the
    // only shape that reaches the defect. A fixture that quietly stopped
    // producing one would make everything below pass and prove nothing.
    // Deliberately NOT `hxHistoryFalseCount > 0`: removing that attribute is
    // one of the two correct fixes, and a fix must turn this test GREEN rather
    // than trade one failure for another. It is carried in the message instead.
    expect(
      state.partyMembers,
      `the post must have an approved party member or this test is vacuous: ${JSON.stringify(state)}`
    ).toBeGreaterThan(0);

    expect(state, `restored page: ${JSON.stringify(state)}`).toMatchObject({
      signedIn: true,
      postTitle: partyPost.title
    });
  });
});
