# In-App Bug Report / Feature Request Implementation Plan

**Goal:** Let a signed-in user file a bug report or feature request from any
page without leaving the app. Reports become GitHub issues on
`david-torres/agent-resources`. A bug report can optionally carry a screenshot
of the page, the browser's environment details, and the recent browser console
output.

**Architecture:** A floating bug button in the main layout (rendered only when
`profile` is present and GitHub is configured) opens an Alpine modal. The
client collects the optional diagnostics — console output from a ring buffer
installed in `public/js/app.js`, browser info read from `navigator`/`screen`,
and a screenshot rendered by lazily-loaded html2canvas — and POSTs everything
as `multipart/form-data` to `POST /feedback`. The route authenticates with the
existing `isAuthenticated` middleware, rate-limits per profile, and hands off
to a `FeedbackService` that uploads the screenshot to a public Supabase bucket
and creates the GitHub issue.

**Tech Stack:** Express + Handlebars, Alpine 3, htmx 2, Bulma 1, multer
(memory storage), Supabase Storage, GitHub REST v3, Bun test runner.

## Global Constraints

- Signed-in only, on both ends: the widget renders under `{{#if profile}}` and
  the route sits behind `isAuthenticated`. Neither alone is sufficient.
- Diagnostics are opt-in per report and never collected silently: each of
  screenshot, browser info, and console log is a checkbox, and the screenshot
  is previewed before it can be sent.
- The feature is inert without configuration. With no `GITHUB_TOKEN` the widget
  is not rendered and the route answers 503 — no half-working button.
- No secret ever reaches the browser: the GitHub token is used server-side only.
- User-supplied text is neutralized before it enters an issue body
  (@-mentions defused, control characters stripped, lengths capped).
- A screenshot upload failure degrades to an issue without a screenshot; it
  never loses the report.
- Schema changes (the storage bucket) go in a new timestamped migration.

---

### Layer 1: Server

**Files:**
- `services/feedback/input.js` — pure normalization/validation of a submitted
  report. `normalizeFeedbackInput(raw) -> { data, error }`.
- `services/feedback/body.js` — pure Markdown issue-body builder.
  `buildIssueBody(report) -> string`, `buildIssueTitle(report) -> string`.
- `services/feedback/github.js` — REST adapter. `createIssue()`,
  `isGithubConfigured()`, `getIssueRepo()`. `fetch` is injectable for tests.
- `services/feedback/repository.js` — screenshot upload to the public
  `bug-screenshots` bucket via `supabaseAdmin`.
- `services/feedback/service.js` — `FeedbackService` orchestration:
  validate → upload screenshot (best effort) → build body → create issue.
- `routes/feedback.js` — `POST /feedback`, `isAuthenticated`, multer memory
  storage capped at 4 MB, 5 reports per 10 minutes per profile.
- `supabase/migrations/20260831000000_bug_screenshots_bucket.sql`.

**Interfaces:**
- Request: `multipart/form-data` with `kind` (`bug` | `feature`), `title`,
  `description`, `page_url`, `browser_info` (JSON), `console_log` (JSON array
  of `{ level, at, message }`), and an optional `screenshot` file part.
- Response: `201 { url, number }`, or `{ error }` with 400 / 429 / 502 / 503.

### Layer 2: Client

**Files:**
- `public/js/app.js` — console ring buffer (last 50 entries, installed at
  script evaluation so it captures early errors), `App.getConsoleLog()`,
  `App.getBrowserInfo()`, `App.captureScreenshot()`, `App.submitFeedback()`.
- `public/js/alpine-components.js` — `feedbackWidget` component built on the
  shared `modal` base so the body-lock count stays consistent.
- `views/partials/feedback-widget.handlebars` — the button and modal.
- `views/layouts/main.handlebars` — include the partial.
- `public/css/styles.css` — floating action button styling.
- `app.js` — mount the route, expose `res.locals.feedbackEnabled`.

### Tests

- `services/feedback/input.test.js`, `body.test.js`, `github.test.js`,
  `service.test.js` — unit tier.
- `routes/feedback.test.js` — HTTP tier (registered in
  `scripts/run-tests.mjs`).
- `views/partials/feedback-widget.test.js` — partial render.
- `test/feedback-console-buffer.test.js` — executes the real `app.js` in jsdom
  and asserts the ring buffer records, caps, and still delegates to the
  underlying console.
