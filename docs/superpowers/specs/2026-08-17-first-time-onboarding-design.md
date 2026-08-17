# First-Time User Onboarding

## Problem

A brand-new user signs up and lands on the homepage with a single info box —
"Get started with Agent Resources" and three buttons — which disappears once
they own a character. Nothing distinguishes a player who has never heard of
Enclave from a veteran arriving from a Kickstarter code. Nothing tells either
of them that a 30-day Enclave: Advent trial was just granted to their account,
that a quickstart exists, or what order to do things in. The app has no
concept of "learning the game" at all: every rules PDF is locked behind an
unlock, including for signed-out visitors deciding whether to sign up.

## Goals

- Split first-time users at the door: "new to Enclave" vs "already playing",
  and give each a short checklist that ends in a created character and a game.
- Surface the existing auto-granted 30-day Advent trial instead of leaving it
  silent.
- Make the quickstart PDF readable by anyone, signed in or not.
- Keep the checklist honest: steps derive from real data wherever possible.

## Non-goals

Product tours, tooltips-on-every-page, email drip, funnel analytics, any
change to the character wizard or LFG flows themselves, and any change to how
the starter unlocks are granted (`grantStarterUnlocks` stays as is).

## User flow

The current get-started notification in `views/home.handlebars` is replaced by
an **onboarding card** in the same position at the top of the signed-in
homepage. The old notification block is deleted.

**First render** (no `path` stored): the card asks one inline question —
"Have you played Enclave before?" — with two buttons: **"I'm new — show me the
ropes"** and **"I already play."** The choice is stored and the card
re-renders as that path's checklist via htmx swap. A small "switch" link on
the checklist lets the user change paths later; switching rewrites `path` and
keeps any completed-step state.

**New to Enclave — 4 steps:**

1. **Set your agent name** — links to `/profile`. Done when `profiles.name`
   no longer matches the provisioning default (`Agent #<user id>`,
   `services/profile/service.js:59`).
2. **Learn the game** — "Read the free Quickstart, or dive into Enclave:
   Advent — yours free for 30 days (X days left)." Links to both PDFs in the
   library viewer; done when the user opens either. The intro video appears
   under this step as a quiet "Prefer video?" link.
3. **Create your first character** — links to the existing character creation
   entry point. Done when the user owns any character.
4. **Find a game** — links to `/lfg`. Done when the user hosts any LFG post
   or has an accepted signup.

**Already playing — 4 steps:**

1. **Set your agent name** — same as above.
2. **Redeem your unlock code** — links to `/classes/redeem/bulk`. Done on any
   successful redemption. Sub-text notes the 30-day Advent trial the account
   already holds.
3. **Create your first character** — same as above.
4. **Find a game** — same as above.

**Completion and dismissal:** steps render with check marks as they complete.
When all four are done the card shows a one-time "You're all set, Agent"
state, then sets `dismissed` so it never renders again. A "Dismiss" link
hides the card permanently at any time; there is no re-nag. The card offers a
way back only via the path-switch link while it is visible.

**Who sees the card:** genuinely new users only. If, on first render, the
profile already owns characters or mission logs, the card silently sets
`dismissed` and renders nothing — existing accounts are never quizzed.

**Signed-out homepage:** hero, video, and Kickstarter link unchanged, plus one
line linking the quickstart: "Read the free Quickstart — no account needed."

## Data model

One migration adds two columns:

- `profiles.onboarding jsonb NOT NULL DEFAULT '{}'` — only the bits reality
  cannot answer:
  - `path`: `"new"` | `"veteran"`; unset means the card shows the path
    question.
  - `dismissed`: `true` when hidden (manually, on completion, or by the
    existing-account gate).
  - `read_rules`: `true`, set by the library view route when a signed-in user
    opens the quickstart or the starter Advent PDF.
  - `redeemed`: `true`, set by the bulk redeem endpoint on any successful
    redemption.
- `rules_pdfs.free_access boolean NOT NULL DEFAULT false` — marks a PDF as
  viewable without an unlock (the quickstart). Toggled by a checkbox in the
  library manage form. The library list shows a "Free" tag instead of a lock
  for these documents. The unlock-row origin is not recorded in
  `rules_pdf_unlocks`, which is why redemption is marked at the endpoint
  rather than inferred from rows.

## Step derivation

A pure function `computeOnboardingSteps(profile, sections, unlocks)` in
`services/home/onboarding.js` returns the card's render model. Inputs are
already available in `loadHomeSections` on `/`:

- **Name set** — `profiles.name` differs from the `Agent #<user id>` default.
- **Learn the game** — `onboarding.read_rules` is true.
- **Redeemed** — `onboarding.redeemed` is true.
- **Has character** — the existing `hasCharacters` flag.
- **In a game** — host of any LFG post or an accepted signup (same shape the
  upcoming-games section already queries).
- **Days left** — from the starter Advent unlock's `expires_at`
  (`STARTER_RULES_PDF_ID`, `util/starter-content.js`). If the unlock is
  missing or expired, the Learn step offers only the quickstart and drops the
  days-left text.

## Access change

`canViewRulesPdf` (`models/rules.js:161`) returns true for `free_access`
documents before any auth or unlock check, so signed-out visitors can read
the quickstart. All other behavior is unchanged.

## Routes

- `POST /profile/onboarding` — accepts `path` (`new`/`veteran`), `switch`,
  or `dismiss`; updates the jsonb and responds with the re-rendered card
  partial for htmx swap. Auth required.
- `GET /library/:id/view` — after a successful render for a signed-in user,
  fire-and-forget sets `read_rules` when the document is the quickstart
  (free_access) or the starter Advent PDF.
- `POST /classes/redeem/bulk` — on any successful redemption,
  fire-and-forget sets `redeemed`.

## Error handling

Onboarding writes never block their host action: failures to set
`read_rules`/`redeemed` are logged and swallowed. If onboarding state cannot
be loaded, the homepage renders without the card. The card's htmx POSTs
return the standard inline error partial on failure.

## Testing

- Unit tests for `computeOnboardingSteps`: every step true/false, both paths,
  days-left math, expired-trial degradation, the existing-account gate.
- Route tests: `POST /profile/onboarding` (path set, switch, dismiss, auth
  required), `free_access` branch of `canViewRulesPdf` including signed-out,
  `read_rules` marking in the library view route, `redeemed` marking in the
  bulk redeem route.
- View tests (`views/home.test.js` pattern): path-question state, each
  checklist state, completed state, signed-out quickstart link.
- E2E: extend the happy path with one assertion — a fresh signup sees the
  path question on the homepage.
