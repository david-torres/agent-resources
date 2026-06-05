# Code-Redeemable Rules PDF Unlocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users redeem unlock codes for rules PDFs through the existing bulk redeem page, with admin code generation on the library manage page — mirroring the class unlock-code system.

**Architecture:** New `rules_pdf_unlock_codes` table + `redeem_rules_pdf_code_for_user` SECURITY DEFINER RPC (faithful mirror of `class_unlock_codes` / `redeem_class_code_for_user`, including the 20260512 permanent-unlock upsert semantics). Three model helpers in `models/rules.js`, a small class-then-PDF dispatch helper in `util/redeem-code.js`, admin routes on `/library/:id/codes`, and view updates.

**Tech Stack:** Bun + Express + Handlebars + htmx, Supabase (Postgres + RLS), `bun:test` with `mock.module` fakes.

**Spec:** `docs/superpowers/specs/2026-06-04-pdf-unlock-codes-design.md`

**Conventions used below:**
- Model functions are re-exported through the `util/supabase.js` barrel (`...rulesModel` spread) — routes import from `../util/supabase`, never from `../models/*` directly.
- The SQL migration is applied at deploy time like prior migrations; do NOT attempt to run it against a database. `schema.sql` is the canonical full schema and must receive the same DDL.
- All tests run with `bun test <file>`.

---

### Task 1: SQL — migration + schema.sql

**Files:**
- Create: `supabase/migrations/20260604_rules_pdf_unlock_codes.sql`
- Modify: `schema.sql` (three insertion points, anchors below)

No unit test (the repo has no DB test harness); correctness comes from mirroring the proven `redeem_class_code_for_user` shape. Verify by careful diff against the class-code DDL at `schema.sql:399-410` and `schema.sql:641-675`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260604_rules_pdf_unlock_codes.sql` with exactly:

```sql
-- Code-redeemable unlocks for rules PDFs, mirroring class_unlock_codes and
-- redeem_class_code_for_user (incl. the 20260512 permanent-unlock upsert fix).
-- Spec: docs/superpowers/specs/2026-06-04-pdf-unlock-codes-design.md

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

ALTER TABLE rules_pdf_unlock_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rules_pdf_unlock_codes_admin_all" ON rules_pdf_unlock_codes;
CREATE POLICY "rules_pdf_unlock_codes_admin_all"
    ON rules_pdf_unlock_codes FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- Atomic redemption. Always grants a permanent unlock: upserts over any
-- existing row (e.g. an expired starter-trial unlock) by clearing expires_at
-- and keeping the earlier unlocked_at.
CREATE OR REPLACE FUNCTION redeem_rules_pdf_code_for_user(p_code text, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code RECORD;
    v_profile_id uuid;
BEGIN
    SELECT *
    INTO v_code
    FROM rules_pdf_unlock_codes
    WHERE code = p_code
      AND (expires_at IS NULL OR expires_at > now())
      AND used_count < max_uses
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired code';
    END IF;

    -- rules_pdf_unlocks.profile_id is NOT NULL; resolve it explicitly.
    SELECT id INTO v_profile_id FROM profiles WHERE user_id = p_user_id LIMIT 1;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'No profile found for user';
    END IF;

    INSERT INTO rules_pdf_unlocks(user_id, profile_id, rules_pdf_id, unlocked_at, expires_at)
    VALUES (p_user_id, v_profile_id, v_code.rules_pdf_id, now(), NULL)
    ON CONFLICT (user_id, rules_pdf_id) DO UPDATE
    SET expires_at = NULL,
        unlocked_at = LEAST(rules_pdf_unlocks.unlocked_at, EXCLUDED.unlocked_at);

    UPDATE rules_pdf_unlock_codes
    SET used_count = used_count + 1,
        last_redeemed_by = p_user_id,
        last_redeemed_at = now()
    WHERE id = v_code.id;

    RETURN v_code.rules_pdf_id;
END;
$$;
```

- [ ] **Step 2: Mirror the DDL into schema.sql**

Three edits, all verbatim copies of blocks from the migration above:

1. **Table** — after the `rules_pdf_unlocks` block. Anchor: `schema.sql:456-457` reads

   ```sql
   ALTER TABLE rules_pdfs ENABLE ROW LEVEL SECURITY;
   ALTER TABLE rules_pdf_unlocks ENABLE ROW LEVEL SECURITY;
   ```

   Immediately after these two lines, insert a blank line, then the `-- Code-redeemable unlocks for rules PDFs...` comment (first comment line only is fine: `-- One-time unlock codes for rules PDFs, mirroring class_unlock_codes`), the `CREATE TABLE IF NOT EXISTS rules_pdf_unlock_codes (...)` block, and `ALTER TABLE rules_pdf_unlock_codes ENABLE ROW LEVEL SECURITY;` from the migration.

2. **Policy** — after the class-codes policy. Anchor: `schema.sql:590-595` reads

   ```sql
   -- Admin-only policy for managing unlock codes
   DROP POLICY IF EXISTS "class_unlock_codes_admin_all" ON class_unlock_codes;
   CREATE POLICY "class_unlock_codes_admin_all"
       ON class_unlock_codes FOR ALL
       USING (is_admin())
       WITH CHECK (is_admin());
   ```

   Immediately after, insert a blank line then the `DROP POLICY IF EXISTS "rules_pdf_unlock_codes_admin_all" ...` / `CREATE POLICY "rules_pdf_unlock_codes_admin_all" ...` block from the migration.

3. **Function** — after `redeem_class_code_for_user`. Anchor: the function ending at `schema.sql:675` with

   ```sql
       RETURN v_code.class_id;
   END;
   $$;
   ```

   (the variant taking `p_code text, p_user_id uuid`). Immediately after its closing `$$;`, insert a blank line then the full `CREATE OR REPLACE FUNCTION redeem_rules_pdf_code_for_user(...)` block from the migration, including its leading comment.

   Note: line numbers are from the current `main`; after edit 1 and 2 the later anchors shift down — search for the anchor text, don't trust absolute numbers.

- [ ] **Step 3: Sanity-check the SQL pairs match**

Run:
```bash
grep -c "rules_pdf_unlock_codes" schema.sql supabase/migrations/20260604_rules_pdf_unlock_codes.sql
```
Expected: schema.sql ≥ 7 occurrences, migration ≥ 7 occurrences. Then visually diff the function body in both files — they must be identical.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260604_rules_pdf_unlock_codes.sql schema.sql
git commit -m "feat: rules_pdf_unlock_codes table and redemption RPC"
```

---

### Task 2: Model helpers in models/rules.js

**Files:**
- Modify: `models/rules.js` (add `crypto` require at top; three new functions before `module.exports`; extend exports)
- Test: `models/rules-codes.test.js` (create)

Mirrors `createUnlockCodes` / `listUnlockCodes` / `redeemUnlockCode` at `models/class.js:48-92`.

- [ ] **Step 1: Write the failing test**

Create `models/rules-codes.test.js` with exactly:

```js
const { mock, test, expect, afterAll } = require('bun:test');

const realBase = require('./_base');

// Records inserts, eq filters, and rpc calls; resolves with canned data.
const inserted = [];
const eqCalls = [];
const rpcCalls = [];
const fakeClient = {
    from(table) {
        let pendingRows = [];
        const chain = {
            insert(rows) {
                inserted.push({ table, rows });
                pendingRows = rows;
                return chain;
            },
            select() { return chain; },
            eq(column, value) {
                eqCalls.push({ table, column, value });
                return chain;
            },
            order() { return chain; },
            then(onFulfilled, onRejected) {
                return Promise.resolve({ data: pendingRows, error: null }).then(onFulfilled, onRejected);
            }
        };
        return chain;
    },
    rpc(name, args) {
        rpcCalls.push({ name, args });
        return Promise.resolve({ data: 'pdf-1', error: null });
    }
};

mock.module('./_base', () => ({
    supabase: fakeClient,
    supabaseAdmin: fakeClient,
    anonKey: 'test-anon-key',
    createUserClient: () => fakeClient
}));

delete require.cache[require.resolve('./rules')];
const {
    createRulesPdfUnlockCodes,
    listRulesPdfUnlockCodes,
    redeemRulesPdfUnlockCode
} = require('./rules');

afterAll(() => {
    mock.module('./_base', () => realBase);
    delete require.cache[require.resolve('./rules')];
});

test('createRulesPdfUnlockCodes inserts amount rows with unique base64url codes', async () => {
    inserted.length = 0;
    const { data, error } = await createRulesPdfUnlockCodes({
        rulesPdfId: 'pdf-1',
        createdByProfileId: 'profile-1',
        expiresAt: null,
        maxUses: 5,
        amount: 3
    });
    expect(error).toBeNull();
    expect(inserted.length).toBe(1);
    const { table, rows } = inserted[0];
    expect(table).toBe('rules_pdf_unlock_codes');
    expect(rows.length).toBe(3);
    for (const row of rows) {
        expect(row.rules_pdf_id).toBe('pdf-1');
        expect(row.created_by).toBe('profile-1');
        expect(row.expires_at).toBeNull();
        expect(row.max_uses).toBe(5);
        // crypto.randomBytes(12).toString('base64url') => 16 url-safe chars
        expect(row.code).toMatch(/^[A-Za-z0-9_-]{16}$/);
    }
    expect(new Set(rows.map(r => r.code)).size).toBe(3);
    expect(Array.isArray(data)).toBe(true);
});

test('listRulesPdfUnlockCodes filters by rules_pdf_id', async () => {
    eqCalls.length = 0;
    const { error } = await listRulesPdfUnlockCodes('pdf-1');
    expect(error).toBeNull();
    expect(eqCalls).toEqual([
        { table: 'rules_pdf_unlock_codes', column: 'rules_pdf_id', value: 'pdf-1' }
    ]);
});

test('redeemRulesPdfUnlockCode calls the for_user RPC', async () => {
    rpcCalls.length = 0;
    const { data, error } = await redeemRulesPdfUnlockCode('CODE123', 'user-1');
    expect(error).toBeNull();
    expect(data).toBe('pdf-1');
    expect(rpcCalls).toEqual([
        { name: 'redeem_rules_pdf_code_for_user', args: { p_code: 'CODE123', p_user_id: 'user-1' } }
    ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test models/rules-codes.test.js`
Expected: FAIL — `createRulesPdfUnlockCodes is not a function` (the three functions are not exported yet).

- [ ] **Step 3: Implement the helpers**

In `models/rules.js`:

1. Change line 1-2 from

```js
const { supabase, supabaseAdmin } = require('./_base');

```

to

```js
const { supabase, supabaseAdmin } = require('./_base');
const crypto = require('crypto');

```

2. Insert immediately before the `// Resolve the title family of a rules PDF:` comment (currently line 132):

```js
const createRulesPdfUnlockCodes = async ({ rulesPdfId, createdByProfileId, expiresAt = null, maxUses = 1, amount = 1 }) => {
    const inserts = Array.from({ length: amount }, () => ({
        code: crypto.randomBytes(12).toString('base64url'),
        rules_pdf_id: rulesPdfId,
        created_by: createdByProfileId,
        expires_at: expiresAt,
        max_uses: maxUses
    }));

    // authz: callers (admin-only route) gate access; createdByProfileId is set server-side
    const { data, error } = await supabaseAdmin
        .from('rules_pdf_unlock_codes')
        .insert(inserts)
        .select();

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const listRulesPdfUnlockCodes = async (rulesPdfId, client = supabase) => {
    const { data, error } = await client
        .from('rules_pdf_unlock_codes')
        .select('*')
        .eq('rules_pdf_id', rulesPdfId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

const redeemRulesPdfUnlockCode = async (code, userId) => {
    const { data, error } = await supabase
        .rpc('redeem_rules_pdf_code_for_user', { p_code: code, p_user_id: userId });
    if (error) {
        console.error(error);
        return { data: null, error };
    }
    return { data, error: null };
};

```

3. In `module.exports` (currently lines 188-198), add the three names after `deleteRulesPdfUnlock,`:

```js
module.exports = {
    getRulesPdfs,
    getRulesPdf,
    createRulesPdf,
    updateRulesPdf,
    listRulesPdfUnlocks,
    listRulesPdfUnlocksForUser,
    upsertRulesPdfUnlock,
    deleteRulesPdfUnlock,
    createRulesPdfUnlockCodes,
    listRulesPdfUnlockCodes,
    redeemRulesPdfUnlockCode,
    canViewRulesPdf
};
```

(No change needed in `util/supabase.js` — it spreads `...rulesModel`, so the new exports flow through the barrel automatically.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test models/rules-codes.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite to check for fallout**

Run: `bun test`
Expected: all tests pass (the `mock.module` fake is restored in `afterAll`, so other model tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add models/rules.js models/rules-codes.test.js
git commit -m "feat: rules PDF unlock-code model helpers"
```

---

### Task 3: Class-then-PDF dispatch helper

**Files:**
- Create: `util/redeem-code.js`
- Test: `util/redeem-code.test.js` (create)

The bulk redeem route will call this instead of `redeemUnlockCode` directly. Both redeem RPCs raise `Invalid or expired code` on a miss; surfacing the class error after a PDF code failed (or vice versa) would be confusing, so the helper returns one generic error when neither matches.

- [ ] **Step 1: Write the failing test**

Create `util/redeem-code.test.js` with exactly:

```js
const { mock, test, expect, afterAll } = require('bun:test');

const realSupabase = require('./supabase');

let classResult;
let pdfResult;
const classCalls = [];
const pdfCalls = [];

mock.module('./supabase', () => ({
    redeemUnlockCode: async (code, userId) => {
        classCalls.push({ code, userId });
        return classResult;
    },
    redeemRulesPdfUnlockCode: async (code, userId) => {
        pdfCalls.push({ code, userId });
        return pdfResult;
    }
}));

delete require.cache[require.resolve('./redeem-code')];
const { redeemAnyCode } = require('./redeem-code');

afterAll(() => {
    mock.module('./supabase', () => realSupabase);
    delete require.cache[require.resolve('./redeem-code')];
});

const reset = () => {
    classCalls.length = 0;
    pdfCalls.length = 0;
};

test('class code wins without trying the PDF table', async () => {
    reset();
    classResult = { data: 'class-1', error: null };
    pdfResult = { data: null, error: new Error('should not be called') };
    const result = await redeemAnyCode('CODE', 'u1');
    expect(result).toEqual({ type: 'class', id: 'class-1', error: null });
    expect(classCalls).toEqual([{ code: 'CODE', userId: 'u1' }]);
    expect(pdfCalls).toEqual([]);
});

test('falls back to PDF redemption when the class table misses', async () => {
    reset();
    classResult = { data: null, error: new Error('Invalid or expired code') };
    pdfResult = { data: 'pdf-1', error: null };
    const result = await redeemAnyCode('CODE', 'u1');
    expect(result).toEqual({ type: 'pdf', id: 'pdf-1', error: null });
    expect(classCalls.length).toBe(1);
    expect(pdfCalls).toEqual([{ code: 'CODE', userId: 'u1' }]);
});

test('returns one generic error when both tables miss', async () => {
    reset();
    classResult = { data: null, error: new Error('Invalid or expired code') };
    pdfResult = { data: null, error: new Error('Invalid or expired code') };
    const result = await redeemAnyCode('CODE', 'u1');
    expect(result.type).toBeNull();
    expect(result.id).toBeNull();
    expect(result.error.message).toBe('Invalid or expired code');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test util/redeem-code.test.js`
Expected: FAIL — `Cannot find module './redeem-code'`.

- [ ] **Step 3: Implement the helper**

Create `util/redeem-code.js` with exactly:

```js
const { redeemUnlockCode, redeemRulesPdfUnlockCode } = require('./supabase');

// Try a code as a class unlock code first, then as a rules PDF unlock code.
// Returns { type: 'class' | 'pdf', id } on success. When neither table
// matches, returns a single generic error rather than stacking the two
// per-table errors.
const redeemAnyCode = async (code, userId) => {
    const classResult = await redeemUnlockCode(code, userId);
    if (!classResult.error) {
        return { type: 'class', id: classResult.data, error: null };
    }
    const pdfResult = await redeemRulesPdfUnlockCode(code, userId);
    if (!pdfResult.error) {
        return { type: 'pdf', id: pdfResult.data, error: null };
    }
    return { type: null, id: null, error: new Error('Invalid or expired code') };
};

module.exports = { redeemAnyCode };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test util/redeem-code.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add util/redeem-code.js util/redeem-code.test.js
git commit -m "feat: class-then-pdf unlock code dispatch helper"
```

---

### Task 4: Bulk redeem route + redeem/profile copy

**Files:**
- Modify: `routes/classes.js` (imports; bulk redeem loop at lines 201-220)
- Modify: `views/redeem-codes.handlebars` (results block + sidebar copy)
- Modify: `views/profile.handlebars:72` (one-line copy)

Thin glue over the Task 3 helper (which carries the tested behavior); verified by the full suite plus the manual smoke check in Task 6.

- [ ] **Step 1: Update imports in routes/classes.js**

In the destructured require from `'../util/supabase'` (lines 9-27), add `getRulesPdf` after `getClass,`:

```js
    getClasses,
    getClass,
    getRulesPdf,
    createClass,
```

After the other requires (below line 31, next to the other `../util/*` requires), add:

```js
const { redeemAnyCode } = require('../util/redeem-code');
```

- [ ] **Step 2: Replace the bulk redeem loop**

In `routes/classes.js`, replace the loop body (currently lines 201-220):

```js
    const results = [];
    for (const code of codes) {
        try {
            const { data: classId, error } = await redeemUnlockCode(code, userId);
            if (error) {
                results.push({ code, success: false, error: error.message });
                continue;
            }
            let className = null;
            try {
                const { data: classData } = await getClass(classId, res.locals.supabase);
                className = classData?.name || null;
            } catch (_) {
                // ignore
            }
            results.push({ code, success: true, class_id: classId, class_name: className });
        } catch (e) {
            results.push({ code, success: false, error: e?.message || 'Unknown error' });
        }
    }
```

with:

```js
    const results = [];
    for (const code of codes) {
        try {
            const { type, id, error } = await redeemAnyCode(code, userId);
            if (error) {
                results.push({ code, success: false, error: error.message });
                continue;
            }
            if (type === 'pdf') {
                let pdfTitle = null;
                try {
                    const { data: pdfData } = await getRulesPdf(id);
                    pdfTitle = pdfData?.title || null;
                } catch (_) {
                    // ignore
                }
                results.push({ code, success: true, type, pdf_id: id, pdf_title: pdfTitle });
                continue;
            }
            let className = null;
            try {
                const { data: classData } = await getClass(id, res.locals.supabase);
                className = classData?.name || null;
            } catch (_) {
                // ignore
            }
            results.push({ code, success: true, type, class_id: id, class_name: className });
        } catch (e) {
            results.push({ code, success: false, error: e?.message || 'Unknown error' });
        }
    }
```

Note: `redeemUnlockCode` remains imported — it is still used by the single-code `POST /redeem` route (line 519), which stays class-only per the spec.

- [ ] **Step 3: Update the redeem results view**

In `views/redeem-codes.handlebars`, replace the success notification block (lines 24-30):

```handlebars
        {{#if this.success}}
          <div class="notification is-success is-light">
            <strong>{{this.code}}</strong> redeemed.
            {{#if this.class_id}}
              Unlocked class <a class="tag button is-black" href="/classes/{{this.class_id}}/{{this.class_name}}">{{this.class_name}}</a>
            {{/if}}
          </div>
```

with:

```handlebars
        {{#if this.success}}
          <div class="notification is-success is-light">
            <strong>{{this.code}}</strong> redeemed.
            {{#if this.class_id}}
              Unlocked class <a class="tag button is-black" href="/classes/{{this.class_id}}/{{this.class_name}}">{{this.class_name}}</a>
            {{/if}}
            {{#if this.pdf_id}}
              Unlocked rules PDF <a class="tag button is-black" href="/library">{{#if this.pdf_title}}{{this.pdf_title}}{{else}}View in Library{{/if}}</a>
            {{/if}}
          </div>
```

And replace the sidebar copy (line 44):

```handlebars
          Paste one or more unlock codes you received. You can separate them with newlines or commas.
```

with:

```handlebars
          Paste one or more unlock codes you received — codes can unlock classes or rules PDFs. You can separate them with newlines or commas.
```

- [ ] **Step 4: Update the profile copy**

In `views/profile.handlebars` (line 72), replace:

```handlebars
    <p>Unlock codes grant access to official Enclave class PDFs.</p>
```

with:

```handlebars
    <p>Unlock codes grant access to official Enclave class and rules PDFs.</p>
```

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add routes/classes.js views/redeem-codes.handlebars views/profile.handlebars
git commit -m "feat: bulk redeem accepts rules PDF unlock codes"
```

---

### Task 5: Admin code-generation routes on /library

**Files:**
- Modify: `routes/library.js` (imports; two new routes after the unlocks routes, i.e. after the `router.delete('/:id/unlocks/:userId', ...)` handler ending around line 266)

Mirrors `routes/classes.js:479-512`. Route glue over the Task 2 helpers; verified by suite + Task 6 smoke check. Note `routes/library.js` already registers the `id` UUID param guard (line 7) and already has `parseExpiresAt` (line 51) — use it for the code expiry, converting the `datetime-local` value to ISO.

- [ ] **Step 1: Update imports**

In the destructured require from `'../util/supabase'` (lines 9-25), add after `deleteRulesPdfUnlock,`:

```js
    createRulesPdfUnlockCodes,
    listRulesPdfUnlockCodes,
```

- [ ] **Step 2: Add the routes**

Immediately after the `router.delete('/:id/unlocks/:userId', ...)` handler (its closing `});` near line 266), insert:

```js
// Admin: generate unlock codes for a rules PDF
router.post('/:id/codes', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { expires_at, max_uses, amount } = req.body;
    const createdByProfileId = res.locals.profile.id;
    const count = parseInt(amount, 10) || 1;
    const { data, error } = await createRulesPdfUnlockCodes({
        rulesPdfId: id,
        createdByProfileId,
        expiresAt: parseExpiresAt(expires_at),
        maxUses: parseInt(max_uses, 10) || 1,
        amount: count
    });
    if (error) return sendError(req, res, error);

    if (count > 1) {
        return res.render('partials/unlock-code-result', {
            layout: false,
            codes: data
        });
    }

    if (!data || data.length === 0) {
        return sendError(req, res, null, { status: 400, message: 'Unlock code creation returned no rows' });
    }
    const codeRow = data[0];
    return res.render('partials/unlock-code-result', {
        layout: false,
        code: codeRow.code,
        max_uses: codeRow.max_uses,
        expires_at: codeRow.expires_at
    });
});

// Admin: list unlock codes for a rules PDF
router.get('/:id/codes', isAuthenticated, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { data, error } = await listRulesPdfUnlockCodes(id, res.locals.supabase);
    if (error) return sendError(req, res, error);
    return res.json(data);
});
```

(`partials/unlock-code-result` is target-agnostic — it only renders `code(s)`, `max_uses`, `expires_at` — so it is reused unchanged.)

- [ ] **Step 3: Run the full suite**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add routes/library.js
git commit -m "feat: admin unlock-code generation routes for rules PDFs"
```

---

### Task 6: Library-manage code-generation UI + smoke check

**Files:**
- Modify: `views/library-manage.handlebars` (new section per PDF card, after the Grant Access / Current Unlocks columns)

- [ ] **Step 1: Add the code-generation form**

In `views/library-manage.handlebars`, the per-PDF card ends with (currently lines 200-208):

```handlebars
        {{else}}
        <p class="notification is-light">No unlocks yet.</p>
        {{/if}}
      </div>
    </div>
  </div>
  {{/each}}
```

Insert a new section between the closing `</div>` of the columns row and the card's closing `</div>` — i.e. replace:

```handlebars
      </div>
    </div>
  </div>
  {{/each}}
```

with:

```handlebars
      </div>
    </div>

    <h3 class="title is-5">Generate Unlock Codes</h3>
    <form hx-post="/library/{{this.id}}/codes" hx-target="#pdfCodeResult-{{this.id}}" hx-swap="innerHTML transition:true" hx-disabled-elt="input, button, select, textarea" hx-sync="this:abort" hx-on::after-request="if(event.detail.successful) this.reset()">
      <div class="columns">
        <div class="column">
          <div class="field">
            <label class="label">Expires At (optional)</label>
            <div class="control">
              <input class="input" type="datetime-local" name="expires_at">
            </div>
            <p class="help">Expiry of the code itself; redeemed unlocks are permanent.</p>
          </div>
        </div>
        <div class="column">
          <div class="field">
            <label class="label">Max Uses</label>
            <div class="control">
              <input class="input" type="number" min="1" name="max_uses" value="1">
            </div>
          </div>
        </div>
        <div class="column">
          <div class="field">
            <label class="label">Amount</label>
            <div class="control">
              <input class="input" type="number" min="1" name="amount" value="1">
            </div>
          </div>
        </div>
      </div>
      <div class="field">
        <div class="control">
          <button class="button is-primary" type="submit">
            <span class="icon"><i class="fas fa-key"></i></span>
            <span>Generate Code(s)</span>
          </button>
        </div>
      </div>
    </form>
    <div id="pdfCodeResult-{{this.id}}" class="mt-4"></div>
  </div>
  {{/each}}
```

- [ ] **Step 2: Run the full suite one final time**

Run: `bun test`
Expected: all tests pass.

- [ ] **Step 3: Manual smoke check (requires a configured local environment)**

If a local Supabase environment with the migration applied is available (`bun run dev`):

1. As admin, open `/library/manage`, generate 1 code for a PDF → code appears in the result box.
2. As a non-admin user, paste the code at `/classes/redeem/bulk` → success row "Unlocked rules PDF …".
3. Open `/library` → the PDF shows as unlocked, no expiry; `/library/:id/view` works.
4. Paste the same single-use code again → "Invalid or expired code".

If no local DB is available, note that in the final report — the SQL is deploy-time and the smoke check moves to staging.

- [ ] **Step 4: Commit**

```bash
git add views/library-manage.handlebars
git commit -m "feat: unlock-code generation UI on library manage page"
```
