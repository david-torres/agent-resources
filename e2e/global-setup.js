// Signs both test identities in through the REAL /auth form and saves their
// localStorage as Playwright storageState.
//
// Deliberately not injecting tokens directly: public/js/app.js:74-92 owns the
// authToken/refreshToken contract, and that contract is refactor-adjacent. If
// sign-in breaks, every spec should fail loudly here rather than mysteriously
// later.
require('../util/env');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const { supabaseAdmin } = require('../models/_base');

const ADMIN_EMAIL = 'dummy@testing.com';
const ADMIN_PASSWORD = 'dummypassword';
const PLAYER_EMAIL = 'e2e-player@testing.com';
const PLAYER_PASSWORD = 'e2e-player-password';

const authDir = path.join(__dirname, '.auth');
const ADMIN_STATE = path.join(authDir, 'admin.json');
const PLAYER_STATE = path.join(authDir, 'player.json');

// The player account is infrastructure, not fixture data: fixed address,
// created idempotently (exactly as util/seed-admin.js treats the admin), never
// torn down. It exists so specs can distinguish "a character you own" from one
// you don't. It needs the admin API rather than the direct `insert into
// auth.users` the fixtures use, because it must be able to sign in with a
// password.
const ensurePlayer = async () => {
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;

  let user = list.users.find((u) => u.email === PLAYER_EMAIL);
  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: PLAYER_EMAIL,
      password: PLAYER_PASSWORD,
      email_confirm: true
    });
    if (error) throw error;
    user = data.user;
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id').eq('user_id', user.id).maybeSingle();
  if (!profile) {
    const { error } = await supabaseAdmin.from('profiles').insert({
      user_id: user.id, name: 'E2E Player', is_public: true, timezone: 'UTC', role: 'user'
    });
    if (error) throw error;
  }
};

const signIn = async (browser, baseURL, email, password, statePath) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await page.goto('/auth');
  await page.fill('#sign-in-email', email);
  await page.fill('#sign-in-password', password);
  await page.click('#sign-in button[type="submit"]');

  // App.signIn writes both keys on success; waiting on them rather than on a
  // URL avoids racing the post-sign-in redirect.
  await page.waitForFunction(
    () => !!localStorage.getItem('authToken') && !!localStorage.getItem('refreshToken'),
    null,
    { timeout: 15_000 }
  );

  await context.storageState({ path: statePath });
  await context.close();
};

module.exports = async (config) => {
  const baseURL = config.projects[0].use.baseURL;
  fs.mkdirSync(authDir, { recursive: true });

  await ensurePlayer();

  const browser = await chromium.launch();
  try {
    await signIn(browser, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_STATE);
    await signIn(browser, baseURL, PLAYER_EMAIL, PLAYER_PASSWORD, PLAYER_STATE);
  } finally {
    await browser.close();
  }
};

module.exports.ADMIN_EMAIL = ADMIN_EMAIL;
module.exports.ADMIN_PASSWORD = ADMIN_PASSWORD;
module.exports.PLAYER_EMAIL = PLAYER_EMAIL;
module.exports.PLAYER_PASSWORD = PLAYER_PASSWORD;
module.exports.ADMIN_STATE = ADMIN_STATE;
module.exports.PLAYER_STATE = PLAYER_STATE;
