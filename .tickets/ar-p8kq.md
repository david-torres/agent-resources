---
id: ar-p8kq
status: open
deps: []
links: [ar-w9d2, ar-t2mv]
created: 2026-08-02T02:35:10Z
type: bug
priority: 2
assignee: David Torres
tags: [seeding, local-dev, rules-pdf, starter-unlocks]
---
# Starter rules-PDF unlock fails on every local profile creation

`models/profile.js` grants a starter rules-PDF unlock referencing `STARTER_RULES_PDF_ID` (now in `util/starter-content.js`), a production UUID. Nothing seeds `rules_pdfs`, so on any locally-seeded install every profile creation logs:

```
Failed to grant starter rules unlock: {
  code: "23503",
  details: 'Key (rules_pdf_id)=(a10948ac-...) is not present in table "rules_pdfs".'
}
```

The error is logged and swallowed, so profile creation succeeds but the user gets no rules unlock and the Library shows nothing they can open.

This is the last of three symptoms of the same root cause — the local seed does not produce a usable environment. ar-w9d2 fixed the starter *class* ids; ar-t2mv fixed empty class gear/abilities; this is the rules half.

## Why it was not fixed alongside those

`rules_pdfs.storage_path` is `NOT NULL` and points at an object in the `rules-pdfs` bucket. The real rules PDF is not in the repo and cannot be, so seeding this row is not a pure-data change like the other two — it needs a deliberate placeholder, which is a product decision rather than a mechanical fix.

## What makes this tractable

- The `rules-pdfs` bucket **already exists locally** — created by `supabase/migrations/20240101000000_baseline_schema.sql:1429`, with RLS policies alongside it.
- The upload path convention is `<rulesPdfId>/<timestamp>-<sanitized-name>.pdf` (`models/pdf.js:70-84`).
- `models/pdf.js` validates that uploads begin with the `%PDF-` signature, so a placeholder must be a genuinely valid PDF, not an empty file.
- `rules_pdfs` is `UNIQUE (edition, title)`, and per `util/rules-family.js` the `edition` column holds the *version* while versions of one product share a `title` — so an unlock on one version covers the whole title family.

Only the **id** must match `STARTER_RULES_PDF_ID`; title and edition are free to be local-appropriate values, since nothing outside this row depends on them.

## Approach

Add a seed step in the established shape — `util/seed-rules.js` exposed as `bun run seed:rules`, called from `scripts/seed-local.mjs` after classes, idempotent (skip when the row already exists) like every other step there.

It should upload a small, valid placeholder PDF to the `rules-pdfs` bucket and insert the row with `STARTER_RULES_PDF_ID`. The placeholder's content must make clear on sight that it is local seed data and not the real rules, so nobody mistakes it for the product.

## Acceptance Criteria

Profile creation against a freshly-seeded local database completes with no foreign-key error and grants a working rules unlock; the Library lists the entry and it opens. The row's id is derived from `util/starter-content.js` rather than restated, so it cannot drift from the grant. Re-running the seed is safe. The placeholder is unmistakably identifiable as such.
