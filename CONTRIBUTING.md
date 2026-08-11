# Contributing

## Local workflow

Use Bun for the application and test commands. Install dependencies with
`bun install`, copy `.env.dist` to `.env`, then run `bun run setup`.

Run `bun run check`, `bun run test`, and `bun run test:http` before opening a
pull request. Database integration tests require a local Supabase stack:
`supabase start`, `supabase db reset`, then `bun run test:integration`.
The integration workflow runs automatically when database-facing code changes.

End-to-end browser tests are the fourth tier: `supabase start`,
`bun run seed:local`, then `bun run test:e2e`. Run them for changes to
`public/`, `views/`, or anything affecting navigation. They currently exit
non-zero by design — nine tests deliberately characterize known defects. See
[the findings report](docs/superpowers/reports/2026-08-03-e2e-findings.md)
before treating a failure as new.

## Writing E2E specs

New specs go in `e2e/specs/`. Unlike the other tiers there is **no file to
register** — Playwright discovers `e2e/specs/*.spec.js` automatically.

- Seed through `e2e/fixtures/` under a prefix from `newPrefix()`, and clean up in
  `afterAll`. Never write unprefixed rows; the suite must never reset the
  developer's database.
- Pick an identity with `test.use({ storageState: ADMIN_STATE })` or
  `PLAYER_STATE`.

The gotchas below were each learned the expensive way. The findings report's
"Method notes" section has the full versions.

- **A retrying assertion cannot test a transient state**, or a non-change that is
  already true. `expect().not.toHaveClass()` polls for 10s and will run straight
  past a defect that self-corrects. Use a single-shot `page.evaluate` snapshot,
  or — better for anything shorter than a CDP round-trip — sample painted frames
  from an in-page `requestAnimationFrame` recorder.
  `09-boosted-nav-settle.spec.js` is the reference.
- **Alpine strips `x-cloak` on init**, so `[x-cloak]` selectors are vacuous on
  any settled page. Test liveness with `'<prop>' in Alpine.$data(el)`. Never use
  `_x_dataStack` (internal), and never bare `!!Alpine.$data(el)` — it is
  **always** truthy, even on an element with no `x-data` ancestor.
- **`reuseExistingServer` means a long-lived server does not pick up server-side
  edits.** Use a fresh `E2E_PORT` when mutating `routes/`, `models/`,
  `services/` or `util/`, or your mutation will silently report "no effect".
  Edits to `views/` and `public/js/` do appear immediately.
- **Assert *what* happened, not merely *that* something happened.** A download
  test that only checked a download started passed while saving the sign-in
  page. A test that only checks for a `200` will pass on the login page too.
- **Every negative assertion needs a positive precondition.** "Absent" must never
  score as "present but wrong" — assert the element exists before asserting
  anything about its state, and assert the *transition*, not just the end state.
- **`page.request` shares only the cookie jar, never the `Authorization`
  header.** This app authenticates by header, so a bare `page.request.get` of a
  protected route follows the redirect and reports a cheerful `200` containing
  the sign-in page. Send the header from `localStorage.authToken` explicitly.
- **A hidden `required` control silently kills the request.** An empty,
  non-focusable `required` input makes Chrome's constraint validation fail, htmx
  fire `htmx:validation:halted`, and no request go out at all — which looks
  exactly like a broken endpoint. Seed such fields non-empty.
- **Prove a red test is red *by design*.** Show that a genuine fix turns it
  green, and never gate it on the defect's own marker — that marker is often the
  thing a valid fix removes.

## Change checklist

- Keep route URLs, response shapes, and templates stable unless the change
  explicitly includes a product/API change.
- Add or update focused tests for changed behavior.
- Put schema changes in a new timestamped `supabase/migrations/` file. Do not
  edit an applied migration or add a parallel schema file.
- Run the relevant test tier. Run local integration tests for database writes.
- Document migrations, rollback considerations, and user-visible effects in
  the pull request.

## Ownership and review

Changes to `models/character.js`, `services/character/`, Supabase migrations,
authentication, or authorization need review from a maintainer familiar with
that domain. Keep cross-domain refactors incremental and independently
revertible.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).
