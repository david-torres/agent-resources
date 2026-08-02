// routes/nav-manage-navbar.test.js
//
// ar-h6rt: GET /nav/manage rendered its admin table data under the key
// `navItems` -- the same key `util/nav-loader.js` puts the *decorated*
// navbar items into `res.locals` under, and the same key
// `views/partials/nav.handlebars` iterates. Express render-locals win over
// res.locals, so the layout's navbar silently switched to the admin rows.
//
// Those rows come from getAllNavItems(), which returns raw `nav_items`
// records; only getNavItems() computes `href` (models/nav.js:59-65). The
// navbar template reads `navItem.href`, so every link on that one page
// rendered `href=""`.
//
// The user-visible failure is a navigation trap, not just dead links:
//   1. htmx only boosts anchors with a truthy raw href (its `ut()` guard),
//      so an empty href is left as a plain browser navigation.
//   2. `href=""` resolves to the *current* URL, so the browser navigates
//      back to /nav/manage.
//   3. A real navigation carries no Authorization header (tokens live in
//      localStorage), so util/auth.js 302s to /auth/check?r=/nav/manage,
//      which then redirects back to /nav/manage.
// Net effect: clicking "Characters" bounces through an auth check and
// lands on /nav/manage again, with no way out via the navbar.
//
// These tests pin the contract at the route boundary: whatever key the
// admin table uses, the render context must not clobber the navbar data
// the layout already has.
const { test, expect, mock, beforeAll, afterAll } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'test-secret-key';

const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realNav = require('../models/nav');
const realPages = require('../models/pages');

// Raw rows exactly as getAllNavItems() returns them: no `href`, only `url`.
const RAW_ROWS = [
  { id: 'n1', label: 'Characters', type: 'link', url: '/characters', parent_id: null, position: 0, pages: null },
  { id: 'n2', label: 'Admin', type: 'dropdown', url: null, parent_id: null, position: 1, pages: null },
  { id: 'n3', label: 'Manage Navigation', type: 'link', url: '/nav/manage', parent_id: 'n2', position: 0, pages: null }
];

// What util/nav-loader.js actually puts on res.locals: decorated, with href.
const DECORATED_NAV = [
  { id: 'n1', label: 'Characters', type: 'link', url: '/characters', href: '/characters', children: [] },
  { id: 'n2', label: 'Admin', type: 'dropdown', href: '#', children: [
    { id: 'n3', label: 'Manage Navigation', type: 'link', url: '/nav/manage', href: '/nav/manage', children: [] }
  ] }
];

mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => ({ id: 'p-admin', user_id: 'u1', role: 'admin' })
}));
mock.module('../models/nav', () => ({
  // The real util/nav-loader calls this to fill res.locals.navItems, which
  // is what the layout's navbar reads. Keep it wired so the test exercises
  // the production path rather than hand-seeding res.locals.
  getNavItems: async () => ({ data: DECORATED_NAV, error: null }),
  getAllNavItems: async () => ({ data: RAW_ROWS, error: null }),
  getNavItem: async () => ({ data: null, error: null }),
  createNavItem: async () => ({ data: null, error: null }),
  updateNavItem: async () => ({ data: null, error: null }),
  deleteNavItem: async () => ({ data: null, error: null }),
  reorderNavItems: async () => ({ data: null, error: null }),
  getDropdownParents: async () => ({ data: [], error: null })
}));
mock.module('../models/pages', () => ({ getPages: async () => ({ data: [], error: null }) }));

const express = require('express');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');
let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./nav')];
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Stand in for the Handlebars view engine: capture what the route hands
  // to res.render. res.locals.navItems is left to the real
  // util/nav-loader, which isAuthenticated invokes.
  app.use((req, res, next) => {
    res.render = (view, ctx) => res.json({
      view,
      ctx: ctx || {},
      // Express render-locals shadow res.locals, so this is the array the
      // navbar partial will actually iterate.
      navbarSees: (ctx && 'navItems' in ctx) ? ctx.navItems : res.locals.navItems
    });
    next();
  });

  app.use('/nav', require('./nav'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/nav', () => realNav);
  mock.module('../models/pages', () => realPages);
  delete require.cache[require.resolve('./nav')];
});

const getManage = async () => {
  const res = await fetch(`${baseUrl}/nav/manage`, {
    headers: { Authorization: 'Bearer valid-jwt' }
  });
  expect(res.status).toBe(200);
  return res.json();
};

const flatten = (items) => (items || []).flatMap(
  (item) => [item, ...flatten(item.children)]
);

test('every navbar link on /nav/manage renders a usable href', async () => {
  const { navbarSees } = await getManage();

  const links = flatten(navbarSees).filter((item) => item.type !== 'dropdown');
  expect(links.length).toBeGreaterThan(0);

  // An empty href is the trap: htmx refuses to boost it and the browser
  // resolves it back to the current URL.
  for (const link of links) {
    expect(link.href).toBeTruthy();
  }
});

test('/nav/manage does not replace the navbar data with its admin rows', async () => {
  const { navbarSees } = await getManage();
  expect(navbarSees).toEqual(DECORATED_NAV);
});

test('the admin table still receives the hierarchy it needs', async () => {
  const { ctx } = await getManage();

  // Key name is the fix's choice; the data contract is what matters.
  const table = ctx.items || ctx.navItems;
  expect(table).toBeDefined();
  expect(table.map((item) => item.id)).toEqual(['n1', 'n2']);

  const admin = table.find((item) => item.id === 'n2');
  expect(admin.children.map((child) => child.id)).toEqual(['n3']);
});
