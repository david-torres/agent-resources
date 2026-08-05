// Proves the tier itself works: the server boots, Alpine and htmx load from
// their pinned CDNs, and no x-cloak element is left visible. x-cloak surviving
// past Alpine's start is the signature of Alpine failing to initialise, which
// would make every other spec in this suite fail for the wrong reason.
const { test, expect } = require('@playwright/test');

test('home page boots with Alpine and htmx initialised', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  // `console` alone does NOT cover uncaught exceptions or unhandled promise
  // rejections -- Playwright surfaces those only via `pageerror`. Without this
  // listener a genuine app crash that never calls console.error() would leave
  // consoleErrors empty and this test green, which is the opposite of what its
  // name promises.
  page.on('pageerror', (err) => { consoleErrors.push(`pageerror: ${err.message}`); });

  await page.goto('/');
  await expect(page).toHaveTitle(/Agent Resources/);

  // Alpine sets window.Alpine on start; htmx sets window.htmx on load.
  await expect.poll(() => page.evaluate(() => typeof window.Alpine)).toBe('object');
  expect(await page.evaluate(() => typeof window.htmx)).toBe('object');

  // Alpine strips x-cloak from every element it initialises, so on any settled
  // page `[x-cloak]` matches NOTHING -- confirmed in-browser against Alpine
  // 3.15.12 (ar-7v3k Task 10 review, Claim C), not just on this page. The loop
  // that used to stand here therefore iterated an always-empty collection and
  // asserted nothing at all; it would have passed with Alpine ripped out.
  //
  // Two assertions replace it. The positive one first: the home page's only
  // Alpine root (the navbar, views/partials/nav.handlebars:1) really was
  // adopted, which `typeof window.Alpine` above cannot distinguish -- Alpine
  // can load fine and still never initialise the DOM.
  //
  // Uses the documented `Alpine.$data()` rather than the `_x_dataStack`
  // internal. Note the trap: `!!Alpine.$data(el)` is ALWAYS truthy, even for an
  // element with no x-data ancestor at all, because closestDataStack falls back
  // to [] and mergeProxies([]) still returns a Proxy. Truthiness would be
  // vacuous; presence of the key the navbar's own x-data declares is the real
  // initialisation test.
  await expect
    .poll(() => page.evaluate(() => {
      const nav = document.querySelector('nav[x-data]');
      if (!nav || !window.Alpine) return false;
      return 'open' in window.Alpine.$data(nav);
    }))
    .toBe(true);

  // Only now is the negative one meaningful: nothing anywhere is still cloaked.
  await expect(page.locator('[x-cloak]')).toHaveCount(0);

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
