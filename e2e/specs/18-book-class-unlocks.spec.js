// Full-stack proof that holding a rules PDF grants the core class roster of
// that book's ruleset, computed on read (models/class.js#getEffectiveClassUnlocks):
// a book grants its roster, the derivation reaches the character wizard (not
// just the profile page), a book for one ruleset never leaks classes from
// another, and an expired book revokes the classes it granted.
//
// The E2E Player is a blank slate: global-setup.js inserts its profile
// directly through supabaseAdmin, bypassing provisionProfile, so the account
// starts with no rules-PDF unlock and no class unlocks. This spec grants the
// Advent book itself and tears the grant down, so it does not depend on
// signup behaviour.
const { test, expect } = require('@playwright/test');
const { connect, profileForEmail } = require('../fixtures/db');
const { PLAYER_EMAIL, PLAYER_STATE } = require('../global-setup');
const { STARTER_RULES_PDF_ID, CORE_CLASS_UNLOCKS } = require('../../util/starter-content');

test.use({ storageState: PLAYER_STATE });

const adventClassNames = Object.keys(CORE_CLASS_UNLOCKS.advent);
// Any single aspirant core class proves cross-ruleset isolation; Berserker is
// simply the first entry in the roster.
const [aspirantClassName, aspirantClassId] = Object.entries(CORE_CLASS_UNLOCKS.aspirant)[0];

// Librarian specifically (per the task brief) proves the wizard consults
// CORE_CLASS_UNLOCKS.advent, not some other list -- looked up by key rather
// than pasted as a bare literal, so a future roster edit that drops it fails
// loudly here instead of silently asserting on a name no longer granted.
const wizardCheckClassName = 'Librarian';
if (!Object.prototype.hasOwnProperty.call(CORE_CLASS_UNLOCKS.advent, wizardCheckClassName)) {
  throw new Error(`'${wizardCheckClassName}' is no longer part of CORE_CLASS_UNLOCKS.advent`);
}

let db;
let profile;
let bookTitle;
// Any grant this account already held for this book, captured before this
// test's insert/expiry steps touch it, so afterAll can restore it exactly
// rather than deleting a real grant out from under the account. The E2E
// Player has none today, but util/starter-content.js's own doc comment
// ("New profiles receive the Advent book") describes exactly the future
// change that would put one there.
let preexistingUnlock = null;
// Separate from preexistingUnlock's value: distinguishes "captured, and
// there was none" from "never captured" (setup failed before or during the
// capture query). afterAll must tell those apart -- collapsing them into
// one falsy check is exactly how a delete-on-uncaptured-state regression
// creeps back in.
let preexistingUnlockCaptured = false;
// Direct class_unlocks rows for the Advent roster, captured and cleared for
// the duration of this spec. A direct unlock outranks a book-derived one and
// suppresses the "Included with <book>" badge -- correctly, since the class
// is then held outright -- so an ambient direct grant would mask exactly the
// derivation under test. The E2E Player has none of its own; these appear
// when another checkout's code, or an older starter path, has run against
// this database. Restored verbatim in afterAll.
let preexistingClassUnlocks = [];
let classUnlocksCaptured = false;
const adventClassIds = Object.values(CORE_CLASS_UNLOCKS.advent);

test.beforeAll(async () => {
  db = await connect();
  profile = await profileForEmail(db, PLAYER_EMAIL);

  // Captured immediately after `profile` is assigned and before any other
  // setup statement -- in particular before the rules_pdfs title lookup
  // below, which throws when the seed row is missing. afterAll only ever
  // deletes when preexistingUnlockCaptured is true and the captured value is
  // null; if setup throws anywhere after this point, afterAll already knows
  // whether a row existed and won't fall through to an unconditional delete.
  const { rows: existingRows } = await db.query(
    'select profile_id, granted_by, expires_at from rules_pdf_unlocks where user_id = $1 and rules_pdf_id = $2',
    [profile.user_id, STARTER_RULES_PDF_ID]
  );
  preexistingUnlock = existingRows[0] || null;
  preexistingUnlockCaptured = true;

  const { rows: directRows } = await db.query(
    'select class_id, unlocked_at, expires_at from class_unlocks where user_id = $1 and class_id = any($2::uuid[])',
    [profile.user_id, adventClassIds]
  );
  preexistingClassUnlocks = directRows;
  classUnlocksCaptured = true;
  if (directRows.length) {
    await db.query(
      'delete from class_unlocks where user_id = $1 and class_id = any($2::uuid[])',
      [profile.user_id, adventClassIds]
    );
  }

  // The badge text names the book by its DB title, not a hardcoded literal --
  // reading it here keeps the assertion honest if the seeded title ever
  // changes, and fails loudly (rather than silently mismatching) if the
  // seeded row is missing.
  const { rows } = await db.query('select title from rules_pdfs where id = $1', [STARTER_RULES_PDF_ID]);
  if (!rows[0]) {
    throw new Error(`No rules_pdfs row for ${STARTER_RULES_PDF_ID}. Run \`bun run seed:local\` and re-run the suite.`);
  }
  bookTitle = rows[0].title;
});

test.afterAll(async () => {
  // try/finally so a throwing cleanup query still reaches db.end() -- the
  // connection is always released when there is one to release.
  try {
    // `profile` can be undefined (profileForEmail threw) while `db` is still
    // a live connection; `preexistingUnlockCaptured` can be false (setup
    // threw before or during that capture). Neither case may reach the
    // delete branch -- that is exactly the destructive path this guard
    // exists to close.
    if (profile && preexistingUnlockCaptured) {
      if (preexistingUnlock) {
        // Restore, don't delete -- this row predates the test.
        await db.query(
          `update rules_pdf_unlocks set profile_id = $1, granted_by = $2, expires_at = $3
           where user_id = $4 and rules_pdf_id = $5`,
          [preexistingUnlock.profile_id, preexistingUnlock.granted_by, preexistingUnlock.expires_at, profile.user_id, STARTER_RULES_PDF_ID]
        );
      } else {
        await db.query(
          'delete from rules_pdf_unlocks where user_id = $1 and rules_pdf_id = $2',
          [profile.user_id, STARTER_RULES_PDF_ID]
        );
      }
    }

    // Same guard shape as above: only restore rows we actually captured.
    if (profile && classUnlocksCaptured && preexistingClassUnlocks.length) {
      for (const row of preexistingClassUnlocks) {
        await db.query(
          `insert into class_unlocks (user_id, class_id, unlocked_at, expires_at)
           values ($1, $2, $3, $4)
           on conflict (user_id, class_id) do update
             set unlocked_at = excluded.unlocked_at,
                 expires_at = excluded.expires_at`,
          [profile.user_id, row.class_id, row.unlocked_at, row.expires_at]
        );
      }
    }
  } finally {
    if (db) {
      await db.end();
    }
  }
});

test('a book grants, the wizard sees, other rulesets stay locked, and expiry revokes the roster', async ({ page }) => {
  // ON CONFLICT rather than a bare insert: if a prior worker crashed after
  // granting the book but before its afterAll ran (Playwright retries a
  // crashed worker's test even with retries:0), a stale row from that
  // attempt would otherwise collide on the (user_id, rules_pdf_id) primary
  // key. Upserting makes this step idempotent regardless. Only expires_at is
  // touched, so a pre-existing row's profile_id/granted_by survive untouched
  // for afterAll's restore.
  await db.query(
    `insert into rules_pdf_unlocks (user_id, profile_id, rules_pdf_id, expires_at)
     values ($1, $2, $3, null)
     on conflict (user_id, rules_pdf_id) do update set expires_at = null`,
    [profile.user_id, profile.id, STARTER_RULES_PDF_ID]
  );

  await test.step('a book grants its roster', async () => {
    await page.goto('/profile');
    for (const name of adventClassNames) {
      const row = page.locator('tr', { hasText: name });
      // Precondition, not an assumption: proves the row genuinely rendered
      // (rather than toContainText below passing vacuously against a
      // missing row) before checking what it says.
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(`Included with ${bookTitle}`);
    }
  });

  await test.step('the wizard sees them', async () => {
    await page.goto('/characters/wizard');
    // Proves the derivation reaches filterClassDataForUser (routes/characters.js),
    // a separate consumer of getEffectiveClassUnlocks from the profile page.
    await expect(page.locator('.wizard-kiosk-ribbon-name', { hasText: wizardCheckClassName })).toBeVisible();
  });

  await test.step('cross-ruleset isolation: the Aspirant roster stays locked', async () => {
    await page.goto(`/classes/${aspirantClassId}/${encodeURIComponent(aspirantClassName)}`);
    await expect(page.locator('body')).toContainText('Locked content');
    // The full class-view page (unlocked) always renders this heading; its
    // absence here confirms the teaser template rendered, not the real one.
    await expect(page.locator('body')).not.toContainText('Signature Gear');
  });

  await test.step('expiry revokes derived access', async () => {
    await db.query(
      `update rules_pdf_unlocks set expires_at = now() - interval '1 day' where user_id = $1 and rules_pdf_id = $2`,
      [profile.user_id, STARTER_RULES_PDF_ID]
    );
    await page.goto('/profile');
    // Positive anchor before the negative loop: views/profile.handlebars
    // gates the whole "Unlocked Classes" box behind `{{#if unlockedClasses}}`,
    // which Handlebars treats as falsy for an empty array -- so the correct
    // post-expiry page has zero matching rows, and so does a 500, an
    // unhandled render error, or a bounce to /auth from an expired
    // storage-state JWT. Prove the page actually rendered, signed in as this
    // user (same marker as e2e/specs/01-auth-state.spec.js), before trusting
    // that the six rows are gone for the right reason.
    await expect(page.locator('#user-email')).toHaveText(PLAYER_EMAIL);
    for (const name of adventClassNames) {
      await expect(page.locator('tr', { hasText: name })).toHaveCount(0);
    }
  });
});
