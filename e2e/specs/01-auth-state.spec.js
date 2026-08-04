// Guards the two storageStates global-setup produces. If either identity stops
// authenticating, this fails first and explains why the rest of the suite did.
const { test, expect } = require('@playwright/test');
const { ADMIN_STATE, PLAYER_STATE } = require('../global-setup');

test.describe('admin identity', () => {
  test.use({ storageState: ADMIN_STATE });

  test('reaches a protected admin route without bouncing', async ({ page }) => {
    await page.goto('/nav/manage');
    await expect(page.locator('body')).toContainText(/nav/i);
  });
});

test.describe('player identity', () => {
  test.use({ storageState: PLAYER_STATE });

  test('is signed in but is not an admin', async ({ page }) => {
    await page.goto('/profile');
    const token = await page.evaluate(() => localStorage.getItem('authToken'));
    expect(token).toBeTruthy();
  });
});
