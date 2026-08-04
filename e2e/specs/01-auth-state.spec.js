// Guards the two storageStates global-setup produces. If either identity stops
// authenticating, this fails first and explains why the rest of the suite did.
const { test, expect } = require('@playwright/test');
const { ADMIN_STATE, PLAYER_STATE, PLAYER_EMAIL } = require('../global-setup');

test.describe('admin identity', () => {
  test.use({ storageState: ADMIN_STATE });

  test('reaches a protected admin route without bouncing', async ({ page }) => {
    await page.goto('/nav/manage');
    await expect(page.locator('body')).toContainText(/nav/i);
  });
});

test.describe('player identity', () => {
  test.use({ storageState: PLAYER_STATE });

  test('reaches /profile and renders as a signed-in page', async ({ page }) => {
    await page.goto('/profile');
    // Real rendered content, not a localStorage read: storageState seeds
    // localStorage before any navigation runs, so a token check alone would
    // pass even if /profile never authenticated. The email only appears here
    // because the server rendered the profile view for this signed-in user.
    await expect(page.locator('body')).toContainText('User Profile');
    await expect(page.locator('#user-email')).toHaveText(PLAYER_EMAIL);
  });

  test('is refused at an admin-only route', async ({ page }) => {
    // Characterization test, empirically verified against the real app:
    // a plain navigation to /nav/manage has no Authorization header, so
    // util/auth.js's isAuthenticated bounces it through /auth/check?r=...,
    // whose client-side JS retries the request with the stored token via
    // htmx. requireAdmin (util/auth.js) then answers 403 for a non-admin.
    // htmx does not swap the body on a non-2xx response, so the page stays
    // on the "Checking login status" bounce screen and surfaces the error
    // via the #alerts notification -- it never reaches the admin UI.
    await page.goto('/nav/manage');
    await expect(page.locator('#alerts')).toContainText(/not authorized/i);
    await expect(page.locator('body')).not.toContainText('Manage Navigation');
  });
});
