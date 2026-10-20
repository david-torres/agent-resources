const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/table-live.js'), 'utf8');

function harness() {
  let busy = false;
  let ping, interval;
  let nextTimer = 0;
  const timers = new Map();
  const requests = [];
  const listeners = {};
  const tracker = { id: 'tracker-m1', dataset: { version: '3' }, classList: { contains: () => busy }, querySelector: () => null };
  const root = { dataset: { tableLive: 't1', liveMode: 'realtime' } };
  const client = {
    auth: { onAuthStateChange() {} }, removeChannel() {},
    channel: () => ({ on(_event, _filter, cb) { ping = cb; return this; }, subscribe(cb) { cb('SUBSCRIBED'); return this; } }),
  };
  const document = {
    readyState: 'complete', visibilityState: 'visible',
    addEventListener: (name, cb) => { listeners[name] = cb; },
    getElementById: () => tracker,
    querySelector: () => root,
    querySelectorAll: () => [tracker],
  };
  const context = { window: {}, document, App: { getSupabaseClient: () => client },
    htmx: { ajax: (...args) => requests.push(args) },
    setTimeout: cb => { timers.set(++nextTimer, cb); return nextTimer; },
    clearTimeout: id => timers.delete(id), setInterval: cb => { interval = cb; },
  };
  vm.runInNewContext(source, context);
  const flush = () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(cb => cb()); };
  flush();
  requests.length = 0;
  return { document, requests, flush, timers, ping: () => ping({ new: { member_id: 'm1' } }),
    periodic: () => interval(), busy: value => { busy = value; }, listeners };
}

test('a live update waits for an active request and then catches up without another event', () => {
  const h = harness();
  h.busy(true);
  h.ping();
  h.flush();
  expect(h.requests).toHaveLength(0);
  expect(h.timers.size).toBe(1);
  h.busy(false);
  h.flush();
  expect(h.requests[0][1]).toBe('/tables/t1/members/m1/tracker?v=3');
});

test('periodic refresh bypasses the state version to reload changed sheet inputs', () => {
  const h = harness();
  h.busy(true);
  h.periodic();
  h.flush();
  h.ping();
  h.busy(false);
  h.flush();
  expect(h.requests[0][1]).toBe('/tables/t1/members/m1/tracker');
});

test('hidden pages do not perform periodic full refreshes', () => {
  const h = harness();
  h.document.visibilityState = 'hidden';
  h.periodic();
  h.flush();
  expect(h.requests).toHaveLength(0);
});
