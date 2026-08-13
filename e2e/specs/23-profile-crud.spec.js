// e2e/specs/23-profile-crud.spec.js
//
// Profile has no create or delete -- it is provisioned with the account -- so
// the lifecycle here is view -> edit -> round-trip.
//
// The form arrives by htmx: the Edit button (profile.handlebars:18) swaps
// partials/profile-form into #profile-info. But despite the form's
// hx-target="#profile-info" hx-swap="innerHTML", the route answers
// HX-Location: /profile with an empty body (routes/profile.js:118) -- the
// whole page navigates and #profile-info is never partially swapped. Assert
// on the reloaded page.
//
// `name` is the field under test rather than bio or conduit_briefing: those
// are data-toast-editor (hidden textareas), and `name` is echoed straight
// back into #user-name (profile.handlebars:6), giving a visible round-trip.
//
// THIS SPEC RESTORES THE ORIGINAL NAME in afterAll. The player profile is
// shared infrastructure created once by global-setup's ensurePlayer() and
// never torn down (global-setup.js:29-51); leaving it renamed would leak into
// every later run.
const { test, expect } = require('@playwright/test');
const { connect, profileForEmail } = require('../fixtures/db');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');

test.use({ storageState: PLAYER_STATE });
// Serial: both tests touch the one shared profile row.
test.describe.configure({ mode: 'serial' });

let db;
let profile;
let originalName;

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);
  originalName = profile.name;
});

test.afterAll(async () => {
  try {
    await db.query('update profiles set name = $1 where id = $2', [originalName, profile.id]);
  } finally {
    await db.end();
  }
});

test('the profile page shows the signed-in player', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#user-email')).toContainText(PLAYER_EMAIL);
});

test('editing the profile name round-trips to the database and the page', async ({ page }) => {
  const renamed = `e2e-profile-${Date.now()}`;

  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  await page.locator('button:has-text("Edit Profile")').click();

  const form = page.locator('form[hx-put="/profile"]');
  await expect(form).toBeVisible();
  await form.locator('#name').fill(renamed);
  await form.locator('button[type="submit"]').click();

  // NOT page.waitForURL(url => url.pathname === '/profile') here: the
  // browser is already sitting on /profile before the click (the edit form
  // itself arrived via an in-place htmx swap into #profile-info, never
  // changing the URL), so that predicate is trivially true at the moment
  // it's registered and resolves instantly instead of synchronizing on
  // anything. This exact bug has recurred across this plan (see e.g.
  // 22-classes-crud.spec.js's edit test). The route answers HX-Location:
  // /profile with an empty body (routes/profile.js:118), which is itself a
  // second, chained background request -- so poll Postgres for the write
  // landing, which is the one unambiguous positive signal, then force a
  // fresh navigation to observe the rendered result.
  await expect.poll(async () => {
    const { rows } = await db.query('select name from profiles where id = $1', [profile.id]);
    return rows[0]?.name;
  }, { timeout: 15_000 }).toBe(renamed);

  await page.goto('/profile');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#user-name')).toContainText(renamed);
});
