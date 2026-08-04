// ar-7v3k check 6. clearingModal must blank the generated code on EVERY close
// path -- a stale code shown on reopen looks like a freshly issued one, and the
// user would hand out a code that is already spent.
const { test, expect } = require('@playwright/test');
const { connect, newPrefix, profileForEmail, cleanupByPrefix } = require('../fixtures/db');
const { seedClass } = require('../fixtures/class');
const { ADMIN_EMAIL, ADMIN_STATE } = require('../global-setup');

test.use({ storageState: ADMIN_STATE });

const prefix = newPrefix('unlock');
let db;
let classRow;

test.beforeAll(async () => {
  db = await connect();
  await profileForEmail(db, ADMIN_EMAIL);
  // The "Generate Unlock Code" trigger button (class-view.handlebars:31-33)
  // is wrapped in `{{#unless (or (eq class.status 'beta') (eq class.status
  // 'alpha'))}}` -- it never renders for an alpha/beta class. seedClass
  // defaults to 'alpha' (matching the column's own DB default), so this
  // spec must explicitly ask for 'release' or the trigger is simply absent
  // and every test below would time out waiting for it.
  classRow = await seedClass(prefix, { status: 'release' });
});

test.afterAll(async () => {
  await cleanupByPrefix(db, prefix);
  await db.end();
});

const openAndGenerate = async (page) => {
  await page.locator('button', { hasText: /generate unlock code/i }).click();
  await expect(page.locator('#unlockCodeModal')).toHaveClass(/is-active/);
  // Confirmed via routes/classes.js's POST /:id/codes (requireAdmin) that this
  // is the only type="submit" button inside #unlockCodeModal -- the trigger,
  // the header delete "x", and the footer Close button are all
  // @click="closeAndClear()" with no [type="submit"].
  await page.locator('#unlockCodeModal button[type="submit"]').click();
  // Positive precondition (see task brief lesson 5): prove a code was
  // genuinely rendered into the result target before any close-path test
  // gets to assert it is gone. Without this, `toBeEmpty()` after close would
  // pass vacuously even if the modal, selector, or generate step were broken.
  await expect(page.locator(`#codeResult-${classRow.id}`)).not.toBeEmpty();
};

for (const [name, close] of [
  // Bulma centers the modal-card over the full-viewport .modal-background, so
  // a default (bounding-box-center) click lands on the card itself and
  // Playwright reports the card intercepting the pointer event. Click a
  // corner instead -- still within .modal-background, outside the centered
  // card.
  ['background click', async (page) => page.locator('#unlockCodeModal .modal-background').click({ position: { x: 5, y: 5 } })],
  ['header delete button', async (page) => page.locator('#unlockCodeModal .delete').first().click()],
  ['footer close', async (page) => page.locator('#unlockCodeModal .modal-card-foot .button', { hasText: /close/i }).click()],
  ['escape key', async (page) => page.keyboard.press('Escape')]
]) {
  test(`closing via ${name} clears the code before reopen`, async ({ page }) => {
    await page.goto(`/classes/${classRow.id}`);
    await openAndGenerate(page);

    await close(page);
    await expect(page.locator('#unlockCodeModal')).not.toHaveClass(/is-active/);
    await expect(page.locator('body')).not.toHaveClass(/modal-open/);

    await page.locator('button', { hasText: /generate unlock code/i }).click();
    await expect(page.locator('#unlockCodeModal')).toHaveClass(/is-active/);
    await expect(page.locator(`#codeResult-${classRow.id}`)).toBeEmpty();
  });
}
