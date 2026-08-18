// e2e/specs/24-onboarding.spec.js
//
// A brand-new signup, never seen before, meets the onboarding path question
// on the home page and (once answered) the new-player checklist -- and the
// answer survives a hard reload.
//
// Why a throwaway user rather than the shared fixtures: ADMIN_EMAIL and
// PLAYER_EMAIL (e2e/global-setup.js) are long-lived infrastructure that own
// characters, which gates them OUT of onboarding by design
// (services/home/onboarding.js computeOnboarding: askPath && (hasCharacters
// || hasMissions) => hidden). Only a profile with no characters, no missions
// and no stored onboarding.path sees the question, so this file creates one.
//
// No profiles row is inserted for the new user (unlike global-setup's
// ensurePlayer, which inserts one explicitly for its long-lived player). That
// is deliberate: models/profile.js getProfile auto-provisions a profile on
// the first authenticated request for a confirmed user with none
// (fetchOwnProfile misses -> provisionProfile), which is the real first-time
// signup path this spec means to exercise, not a shortcut around it.
//
// Sign-in mirrors e2e/global-setup.js's real /auth form flow exactly (also
// used by e2e/specs/15-auth-redirect.spec.js): selectors verified against
// views/partials/signin-form.handlebars (#sign-in-email, #sign-in-password,
// `#sign-in button[type="submit"]` -- there is no #sign-in-submit id), and
// the completion signal is App.signIn writing both localStorage keys, not a
// URL wait -- waiting on a URL would race the post-sign-in redirect, which
// itself is a client-side history.replaceState + htmx body swap
// (public/js/app.js redirectTo), not a hard navigation.
const { test, expect } = require('@playwright/test');
const { supabaseAdmin } = require('../../models/_base');

const EMAIL = 'e2e-onboarding@testing.com';
const PASSWORD = 'e2e-onboarding-password';

// Genuinely unauthenticated start, same as 15-auth-redirect.spec.js: no
// project-level storageState is configured, so this is documentation as much
// as it is a guard.
test.use({ storageState: { cookies: [], origins: [] } });

let userId;

// profiles.user_id, class_unlocks.user_id and rules_pdf_unlocks.user_id all
// reference auth.users(id) with NO ACTION (verified against the live schema:
// pg_constraint.confdeltype = 'a' for all three, not 'c' for cascade) -- there
// is no migration that cascades the delete. The provisioning path this spec
// exercises (models/profile.js getProfile -> provisionProfile ->
// grantStarterUnlocks) writes exactly those three tables for a fresh user
// with no characters, so supabaseAdmin.auth.admin.deleteUser(userId) alone
// always fails with "Database error deleting user" -- and previously that
// error was ignored, so cleanup failed silently, the leftover user survived
// into the next run, and that run's beforeAll delete failed the same silent
// way, then createUser threw "email already registered" before any
// assertion ran. Delete the dependent rows first, in FK order, and check
// every error so a failed cleanup is loud instead of a leak.
const removeUserAndDependents = async (id) => {
  const { error: pdfError } = await supabaseAdmin.from('rules_pdf_unlocks').delete().eq('user_id', id);
  if (pdfError) throw pdfError;
  const { error: classError } = await supabaseAdmin.from('class_unlocks').delete().eq('user_id', id);
  if (classError) throw classError;
  const { error: profileError } = await supabaseAdmin.from('profiles').delete().eq('user_id', id);
  if (profileError) throw profileError;
  const { error: userError } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (userError) throw userError;
};

test.beforeAll(async () => {
  // Idempotent: delete a leftover from a previous run, then create fresh so
  // the profile (once auto-provisioned on sign-in) has no characters, no
  // path, and an unseen onboarding card.
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === EMAIL);
  if (existing) await removeUserAndDependents(existing.id);

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true
  });
  if (error) throw error;
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await removeUserAndDependents(userId);
});

test('a fresh signup is asked the path question and gets the new-player checklist', async ({ page }) => {
  await page.goto('/auth');
  await page.fill('#sign-in-email', EMAIL);
  await page.fill('#sign-in-password', PASSWORD);
  await page.click('#sign-in button[type="submit"]');

  // Same signal global-setup.js and 15-auth-redirect.spec.js wait on: App.signIn
  // writes both keys on success, and waiting on them rather than on a URL
  // avoids racing the post-sign-in redirect.
  await page.waitForFunction(
    () => !!localStorage.getItem('authToken') && !!localStorage.getItem('refreshToken'),
    null,
    { timeout: 15_000 }
  );

  // We were on /auth (onAuthPage), so _handleAuthStateChange's SIGNED_IN
  // branch runs redirectTo('/') -- a client-side history.replaceState + htmx
  // body swap, not a hard navigation, so poll the URL rather than
  // page.waitForURL.
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/');
  await page.waitForLoadState('networkidle');

  const card = page.locator('#onboarding-card');
  await expect(card).toContainText('Have you played Enclave before?');

  await card.getByRole('button', { name: /show me the ropes/ }).click();
  await expect(card).toContainText('Set your agent name');
  await expect(card).toContainText('Learn the game');
  await expect(card).toContainText('Create your first character');
  await expect(card).toContainText('Find a game');

  // The choice persisted: a hard reload still shows the checklist, not the
  // question.
  await page.reload();
  await expect(page.locator('#onboarding-card')).toContainText('Set your agent name');
});
