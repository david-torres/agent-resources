// Proves the tier itself works: the server boots, Alpine and htmx load from
// their pinned CDNs, and no x-cloak element is left visible. x-cloak surviving
// past Alpine's start is the signature of Alpine failing to initialise, which
// would make every other spec in this suite fail for the wrong reason.
const { test, expect } = require('@playwright/test');

test('home page boots with Alpine and htmx initialised', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto('/');
  await expect(page).toHaveTitle(/Agent Resources/);

  // Alpine sets window.Alpine on start; htmx sets window.htmx on load.
  await expect.poll(() => page.evaluate(() => typeof window.Alpine)).toBe('object');
  expect(await page.evaluate(() => typeof window.htmx)).toBe('object');

  // Alpine strips x-cloak from every element it initialises.
  const cloaked = page.locator('[x-cloak]');
  for (let i = 0; i < await cloaked.count(); i++) {
    await expect(cloaked.nth(i)).toBeHidden();
  }

  expect(consoleErrors).toEqual([]);
});

// Bulma hides .navbar-burger via `display:none` at its 1024px desktop
// breakpoint (it's a mobile-nav affordance) — the default Desktop Chrome
// viewport this suite otherwise runs at is wider than that, so the burger
// is only clickable at a narrower viewport.
test.describe('narrow viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the navbar burger toggles the menu', async ({ page }) => {
    await page.goto('/');
    const burger = page.locator('#navbar-burger');
    const menu = page.locator('#navbar-menu');

    await expect(menu).not.toHaveClass(/is-active/);
    await burger.click();
    await expect(menu).toHaveClass(/is-active/);
    await burger.click();
    await expect(menu).not.toHaveClass(/is-active/);
  });
});
