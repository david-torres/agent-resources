const { mock, test, expect, afterAll } = require('bun:test');
const fs = require('fs');
const path = require('path');

const realBase = require('./_base');

const rpcCalls = [];

const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; },
      insert() { return chain; },
      update() { return chain; },
      eq() { return chain; },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
      }
    };
    return chain;
  },
  rpc(name, args) {
    rpcCalls.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  }
});

mock.module('./_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  anonKey: 'test-anon-key',
  createUserClient: () => makeClient()
}));

delete require.cache[require.resolve('./profile')];
const { grantStarterUnlocks } = require('./profile');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./profile')];
});

// The starter class rows were the same six the Advent book grants on read
// (util/book-classes.js, wired up in the effective-unlocks resolver). Writing
// them too would leave orphan unlocks when the trial book lapses.
test('the starter grant writes only the rules PDF unlock', async () => {
  rpcCalls.length = 0;
  await grantStarterUnlocks('user-1', 'profile-1');

  const names = rpcCalls.map(call => call.name);
  expect(names).toContain('grant_starter_rules_unlock');
  expect(names).not.toContain('grant_starter_class_unlocks');
});

test('the starter rules grant carries a future expiry', async () => {
  rpcCalls.length = 0;
  await grantStarterUnlocks('user-1', 'profile-1');

  const call = rpcCalls.find(c => c.name === 'grant_starter_rules_unlock');
  expect(new Date(call.args.p_expires_at).getTime()).toBeGreaterThan(Date.now());
});

// The JS caller is gone (Task 2). The function itself is dead weight in the
// schema — and a live SECURITY DEFINER function that writes class_unlocks is
// a grant path nothing audits. Verifies no migration defines the function in
// either CREATE OR REPLACE or plain CREATE form.
test('no migration still defines grant_starter_class_unlocks', () => {
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  const defining = fs.readdirSync(dir).filter(file => {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    return /CREATE(\s+OR\s+REPLACE)?\s+FUNCTION\s+grant_starter_class_unlocks/i.test(sql);
  });

  expect(defining).toEqual([]);
});
