# Code-Redeemable Rules PDF Unlocks — Design

**Date:** 2026-06-04
**Status:** Approved

## Problem

Rules PDF unlocks can only be granted two ways today: the starter trial on
signup (`grant_starter_rules_unlock`) and manual admin grants via
`POST /library/:id/unlocks`. There is no way to hand out a code (e.g. inside
a physical product or as a promo) that a user redeems for PDF access. Classes
already have exactly this via `class_unlock_codes` + the
`redeem_class_code_for_user` RPC; this feature mirrors that system for rules
PDFs.

## Decisions

- **Redeem UX:** the existing bulk redeem page (`/classes/redeem/bulk`)
  accepts both code types. Each pasted code is tried as a class code first,
  then as a PDF code. Codes are random base64url, so cross-table collisions
  are not a concern.
- **Grant terms:** a redeemed code always grants a **permanent** unlock,
  upserting over any existing row (e.g. an expired starter-trial unlock) by
  clearing `expires_at` — the same semantics as the 20260512
  `redeem_class_code` upsert fix.
- **Approach:** faithful mirror of the class system (separate table + RPC),
  not a polymorphic shared codes table and not app-layer redemption. Real FKs
  with `ON DELETE CASCADE`, `FOR UPDATE` locking against double-spend of
  `max_uses`-limited codes, and zero risk to the working class-code system.

## 1. Schema (new migration + `schema.sql`)

New table mirroring `class_unlock_codes` (schema.sql:399):

```sql
CREATE TABLE IF NOT EXISTS rules_pdf_unlock_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    rules_pdf_id uuid NOT NULL REFERENCES rules_pdfs(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    max_uses int NOT NULL DEFAULT 1,
    used_count int NOT NULL DEFAULT 0,
    last_redeemed_by uuid REFERENCES auth.users(id),
    last_redeemed_at timestamptz
);
```

RLS enabled with an admin-only `FOR ALL` policy mirroring
`class_unlock_codes_admin_all`.

One RPC: `redeem_rules_pdf_code_for_user(p_code text, p_user_id uuid)
RETURNS uuid`, `SECURITY DEFINER`:

1. `SELECT ... FOR UPDATE` the code row where `code = p_code`, not expired,
   `used_count < max_uses`; `RAISE EXCEPTION 'Invalid or expired code'` if
   not found.
2. Resolve `v_profile_id` from `profiles WHERE user_id = p_user_id LIMIT 1`;
   `RAISE EXCEPTION` if missing (`rules_pdf_unlocks.profile_id` is
   `NOT NULL`).
3. Upsert: `INSERT INTO rules_pdf_unlocks(user_id, profile_id, rules_pdf_id,
   unlocked_at, expires_at) VALUES (p_user_id, v_profile_id,
   v_code.rules_pdf_id, now(), NULL) ON CONFLICT (user_id, rules_pdf_id) DO
   UPDATE SET expires_at = NULL, unlocked_at =
   LEAST(rules_pdf_unlocks.unlocked_at, EXCLUDED.unlocked_at)`.
4. Increment `used_count`, stamp `last_redeemed_by` / `last_redeemed_at`.
5. Return `v_code.rules_pdf_id`.

**Deliberate divergence from the template:** no client-callable
`redeem_rules_pdf_code(p_code)` variant. The app only calls the `_for_user`
variant server-side; the no-arg class version is legacy surface (YAGNI).

**Family semantics:** the code targets an exact `rules_pdf_id`.
`canViewRulesPdf` (models/rules.js:153) already resolves title families at
view time, so unlocking any version of a title grants viewing across the
whole family with no extra code here.

## 2. Model layer (`models/rules.js`)

Three helpers mirroring `models/class.js:48-92`:

- `createRulesPdfUnlockCodes({ rulesPdfId, createdByProfileId, expiresAt =
  null, maxUses = 1, amount = 1 })` — generates
  `crypto.randomBytes(12).toString('base64url')` codes, inserts via
  `supabaseAdmin` (authz gated by the admin-only route; `created_by` is set
  server-side).
- `listRulesPdfUnlockCodes(rulesPdfId, client = supabase)` — newest first.
- `redeemRulesPdfUnlockCode(code, userId)` — calls the
  `redeem_rules_pdf_code_for_user` RPC.

## 3. Admin routes + UI

- `POST /library/:id/codes` (`isAuthenticated`, `requireAdmin`) — mirrors
  `routes/classes.js:479`: parses `amount` / `max_uses` / `expires_at`,
  renders the existing `partials/unlock-code-result` partial (reused as-is;
  it is target-agnostic).
- `GET /library/:id/codes` (`isAuthenticated`, `requireAdmin`) — JSON list,
  mirrors `routes/classes.js:507`.
- `views/library-manage.handlebars`: per-PDF htmx code-generation form next
  to the existing unlock-grant form, copied from the
  `class-view.handlebars:262` pattern (fields: amount, max uses, code
  expiry; result swapped into a per-PDF target div).

## 4. Redeem dispatch

In the bulk redeem loop (`routes/classes.js:174-220`):

1. Try `redeemUnlockCode(code, userId)` (class).
2. On error, try `redeemRulesPdfUnlockCode(code, userId)`.
3. On success, result rows carry `type` (`'class'` | `'pdf'`) and a display
   name (class name or PDF title, fetched best-effort).
4. If both fail, report a single generic `Invalid or expired code` (not two
   stacked errors).

View/copy updates:

- `views/redeem-codes.handlebars`: results show what was unlocked (class or
  PDF + name); helper copy says codes can unlock classes or rules PDFs.
- `views/profile.handlebars:72`: update the one-liner that says codes only
  grant class PDFs.

The single-code endpoint `POST /classes/redeem` stays class-only; the bulk
page is the universal entry point.

## 5. Error handling

- RPC raises on invalid / expired / exhausted codes and on missing profile;
  these surface as per-code errors in the bulk results list.
- The code-generation route parses `amount` / `max_uses` with
  `parseInt(..., 10) || 1` like the class route.

## 6. Testing (`bun test`, TDD)

- `models/rules-codes.test.js` — fake-client tests in the recording-client
  style of `models/rules-unlock-family.test.js`: insert payload shape, code
  format and per-batch uniqueness, RPC name + args for redemption.
- Bulk-dispatch tests: class-first-then-PDF fallback, PDF success path,
  both-fail generic error. Extract the per-code dispatch into a small
  testable helper if route-level testing is awkward.
- The SQL RPC follows the proven `redeem_class_code_for_user` shape and is
  verified by migration review; the repo has no DB test harness.

## Out of scope

- Code-defined unlock durations (codes always grant permanent unlocks).
- A polymorphic shared codes table.
- PDF support in the single-code `POST /classes/redeem` endpoint.
- Family-level unlock rows (view-time family resolution already covers it).
