# E2E Browser Tier — Findings

**Run date:** 2026-08-05
**Branch:** `e2e-browser-tier` (measured at HEAD `020cc69`)
**Command:** `bun run test:e2e`
**Result:** **71 passed, 9 failed, 0 skipped** (80 tests, 17 spec files, 38.8s)
**Confirmed:** re-run after this report was revised — **71 passed, 9 failed**,
the same nine names, 37.0s. No spec or production file changed between the two
runs, so the numbers are reproducible rather than a single observation.
**Tree state:** `git diff --stat HEAD` empty before and after both runs — no
production file was modified by this tier at any point.

All nine failures are **deliberate characterization tests**. Each was committed
red on purpose, each is mutation-proven to flip green on a genuine fix, and each
is named in the findings below. There are no unexpected failures.

---

## 1. Verdict — did the refactor break anything?

**Mostly no.** The suite found **20 distinct defects**. **Two are refactor
regressions; eighteen are pre-existing** — bugs the Alpine adoption (`ar-7v3k`)
and the auth-redirect fixes (`ar-h6rt`) neither caused nor fixed.

The two regressions are **finding 4** — one root cause, the Alpine string-form
`:class` idiom, appearing at **nine template sites** and fixed by one mechanical
change — and **finding 16**, a refuted rationale copied into three code comments.
**No regression loses data, and none is a security defect.**

| | Findings | Worst severity |
| --- | --- | --- |
| **Refactor regressions** | **2** (finding 4, at 9 sites; finding 16, at 3 comments) | Important |
| **Pre-existing** | **18** | Critical (data loss) |

The regression is real but narrow, and it is a *regression in recoverability,
not in symptom*. The Alpine idiom `:class="open && 'is-active'"` cannot remove a
class Alpine did not add. When htmx's history cache restores a page whose
snapshot froze `is-active` into the markup, Alpine comes back **alive and
completely powerless**: it drives `aria-expanded` correctly on the very element
whose `class` it cannot touch. The pre-refactor code healed this on the first
ordinary interaction because its handlers read the DOM and called
`classList.remove`/`toggle` unconditionally. The refactor converted a benign,
self-clearing frozen class into a permanently stuck element.

**Everything severe is pre-existing.** The only data-loss defect, the only
blank-screen defect, the only wholly-dead feature and the only security finding
all predate this branch. Two of them predate it by years.

**Recommended reading order for triage:** findings 1–3 (fix these first, none
are the refactor's fault), then finding 4 (the regression, one fix, three
sites), then the rest.

---

## 2. The `ar-7v3k` check table

| ar-7v3k check | Spec | Result | Verdict |
| --- | --- | --- | --- |
| 1 Level-up modal | `05-level-up-modal.spec.js` | 6/6 | **PASS** — bridge and all four close paths mutation-proven |
| 2 Boosted nav settle | `09-boosted-nav-settle.spec.js` | 3/3 | **PASS** — `defaultSettleDelay: 0` justified twice over; do not relax it |
| 3 Stats editor | `04-stats-editor.spec.js` | 6/6 | **PASS** — stat write verified against the DB |
| 4 Perk textarea | `03-perk-textarea.spec.js` | 3/3 | **PASS** — round-trip incl. newlines; the suspected wiring defect was refuted |
| 5 Deceased modal | `06-deceased-modal.spec.js` | 2/2 | **PASS** — confirm gate and apostrophe quoting mutation-proven |
| 6 Unlock-code modal | `07-unlock-code-modal.spec.js` | 4/4 | **PASS** — clearing and closing verified independently |
| 7 Offscreen mission | `12-offscreen-mission.spec.js` | 3/3 | **PASS** — the plan's suspected defect is confirmed **absent** |
| 8 Page editor slug | `13-page-slug.spec.js` | 6/7 | **PASS for the slug behavior.** The 1 red is finding 3, a pre-existing CMS defect, not a slug defect |
| 9 My Classes duplicate | `08-my-classes-duplicate.spec.js` | 2/2 | **PASS** — per-row modal scoping mutation-proven |
| 10 LFG controls | `14-lfg-controls.spec.js` | 6/7 | **PASS for the form controls.** The 1 red is finding 7, pre-existing |
| 11 Export dropdowns | `11-export-dropdowns.spec.js` | 7/11 | **MIXED** — 4 red: 2 regressions (findings 4b, 4c), 2 pre-existing (findings 5, 12) |
| 12 Back button | `10-back-button-snapshot.spec.js` | 2/3 | **FAIL** — the 1 red is the navbar half of finding 4, a **refactor regression** |
| `ar-h6rt` auth redirect | `15-auth-redirect.spec.js` | 15/16 | **PASS for the fix under test.** The 1 red is finding 6, pre-existing and partially mitigated by the branch. See also the `redirectTo` interlude after finding 11 — `af2b098` does more than its commit message claims, and `a324968`'s stated rationale is refuted (finding 16) |

Infrastructure specs, all green: `00-smoke` (2), `01-auth-state` (3),
`02-fixtures` (1). Plus `03b-class-reassignment` (1, deliberately red — finding 1).

**Nine of the thirteen checks are clean.** Of the four that are not, one is a
regression (check 12), and the reds in checks 8, 10 and 11 are dominated by
pre-existing defects that the check merely happened to walk past.

---

## 3. Findings, by severity

Every finding states **regression or pre-existing** with its evidence.
"Pre-existing" was established by reading the deleted or unchanged code
directly — by emulating the pre-refactor code in the tree and measuring it
(findings 4, 12), or by `git log`/`git show` on the specific lines — never by
assumption.

**Scope of "the refactor":** `ar-7v3k` (Alpine adoption, 2026-08-01) and
`ar-h6rt` (auth-redirect fixes, 2026-08-02). Between them they touched
`public/js/*.js`, `public/css/styles.css`, many `views/*`, plus
`models/profile.js`, `util/seed-classes.js`, `util/starter-content.js` and
`routes/nav.js`. They touched **no** file under `services/`, and of `routes/`
and `models/` only the two named. That boundary settles most attributions on
its own.

---

### Finding 1 — Silent class reassignment and perk deletion on character save

**Severity: CRITICAL (data loss).** **PRE-EXISTING.**
**Characterized by:** `e2e/specs/03b-class-reassignment.spec.js:81`

**What it is.** Opening a character's edit form and clicking Save without
touching anything can silently reassign the character to a different class and
delete every one of its ability perks. No error, client or server.

**Mechanism.** `routes/characters.js` `GET /:id/edit` (`:307`) builds the Class
`<select>` options from `filterClassDataForUser(res.locals.user)` at **`:316`**,
restricted to the *editing user's* unlocked set (helper defined at `:57-120`),
with **no fallback injection of the character's own current class** — contrast
the gear and ability pickers, which do exactly that immediately below at
**`:318-344`**. With no option marked `selected`, the browser auto-picks the first
enabled `<option>`; `required` is silently satisfied and submit proceeds.
`saveCharacterAtomic` then unconditionally deletes and reinserts
`class_abilities`, and `character_perks` cascade away
(`supabase/migrations/20240101000000_baseline_schema.sql:191`).

Measured: `class_id` changed from the seeded class to an unrelated one, and
`character_perks` ended with **zero rows**. Perk survival is incidental —
`saveCharacterAtomic` only rebuilds perks `if (rulesVersion === 'v2')`, and
`rulesVersion` is resolved from the *wrongly reassigned* `class_id`.

**Reproduce.** Seed a v2 class, do not unlock it for the editing user, give the
character two of its abilities, open `/characters/:id/edit`, click Save, read
`class_id` back from the database.

**Reachable by normal users** — no admin action needed: a `class_unlocks.expires_at`
expiring, or a class's `is_public` flipping to false.

**Why pre-existing.** The option-building code dates to `8df7d83` (Class unlock,
#54) and `9ccecc9` (v2 character support). Neither `ar-7v3k` nor `ar-h6rt` touched
any file under `routes/` except `routes/nav.js`.

**Fix.** Not verified by this tier. The shape is the one the same route already
uses for gear and abilities: inject the character's own current class into the
option list regardless of the editor's unlock state.

---

### Finding 2 — Blank page after pressing Back on a protected route

**Severity: CRITICAL.** **PRE-EXISTING.**
**Characterized by:** no standing test — see Coverage gaps. The `authOptional`
sibling symptom is covered by `14-lfg-controls.spec.js:718` (finding 7).

**What it is.** A signed-in user who browses about eleven pages and holds Back
gets a **permanently white screen at a correct-looking URL**. Only a manual
reload recovers it.

**Mechanism.** On a history cache miss, htmx's `loadHistoryFromServer` sends
`HX-Request: true` (`historyRestoreAsHxRequest`, default true) **with no
`Authorization` header** — that header is written by JS (`public/js/app.js:730-736`),
never by the browser. `util/auth.js:41-44` answers that with `200` plus an
`HX-Redirect` header and an **empty body**. `loadHistoryFromServer` does not
process `HX-Redirect`. htmx swaps zero bytes into `<body>`.

**Reproduce, with zero code changes:** click twelve boosted links, press Back
eleven times. Measured: back #11 to `/profile` → `STATUS 200`, `bodyLen 0`,
`hx-redirect /auth/check?r=%2Fprofile`, still blank after 5s, URL unchanged.

**Four independent triggers, all ordinary:**
1. **Cache eviction** — the shipped history cache holds only 10 entries.
2. **Entering via a protected route** — `app.js:986`'s raw
   `history.replaceState(null,'',url)` never tells htmx the final URL, so the
   snapshot is cached under the wrong key (measured:
   `"/auth/check?r=%2Fclasses%2Fmy"`). Reachable in **two** navigations.
3. **Blocked or private storage** — `canAccessLocalStorage()` false → htmx caches
   nothing → *every* Back to a protected route blanks, permanently, for those users.
4. **`sessionStorage` quota eviction** (htmx dist 3193–3200 shifts entries out).

On `authOptional` routes the same cache miss produces a different symptom: a full
page rendered **signed out** — wrong nav, no user content, no error (finding 7).

**Why pre-existing.** The mechanism is htmx plus `util/auth.js`, neither touched
by the refactor.

**Fix.** Not verified. Send `Authorization` on htmx's history-restore fetch, or
have `util/auth.js` answer a history-restore request with a renderable body.
**Do not** reach for `hx-history="false"` or `historyCacheSize: 0` — see finding 4.

---

### Finding 3 — The admin Pages CMS is non-functional beyond published public pages, read *and* write

**Severity: CRITICAL.** **PRE-EXISTING.**
**Characterized by:** `e2e/specs/13-page-slug.spec.js:506`

**What it is.** `models/pages.js:1` binds every query to the **anon** Supabase
client and takes no client parameter, while `pages` carries RLS requiring
`is_admin()`. The anon key carries no user JWT, so the policies never see an
admin.

**The write half.** Measured:

| Action | Database | HTTP |
| --- | --- | --- |
| UPDATE | matches 0 rows → `PGRST116` | `POST /pages/:id` → **404** "Failed to update page" |
| INSERT | rejected `42501` | `POST /pages` → **403** "No access", no row created |
| DELETE | matches 0 rows, **no error** | `DELETE /pages/:id` → **204** (`routes/pages.js:146`), row survives |

**The read half — the wider damage.** `getPages()` (`models/pages.js:42`, query
built at `:43`) and `getPage()` (`:83`, query at `:84`) are on
the same anon client, so RLS shows only `is_published = true AND
access_level = 'public'`. Measured as a signed-in admin against three fixtures:

| Fixture | Manage Pages | Edit form | Public `/pages/:slug` |
| --- | --- | --- | --- |
| published + public | listed | 200 | 200 |
| unpublished draft | **not listed** | **404** | **404** |
| `access_level = 'admin'` | **not listed** | **404** | **404** |

So **`is_published = false` and `access_level = 'admin'` are wholly
non-functional features** — an admin cannot list, open, edit or even view such a
page — and `canViewPage():185`, which exists to let admins through, is **dead
code**, because the row never loads for it to inspect.

**Why pre-existing.** `models/pages.js` has exactly **one** commit in its history
(`bf10fc9` "Pages (#99)", 2026-02-05), and line 1 has read
`const { supabase } = require('./_base')` since that commit. This branch never
touched the file. Saving a page has never worked.

**Fix — verified green, not applied.** Thread `res.locals.supabase` into
`models/pages.js` and its three call sites. `routes/pages.js` already holds that
client and never passes it down; the pattern is
`getPendingJoinRequestCount(profileId, res.locals.supabase)` (`util/auth.js:63`).
Verified: spec goes 7/7, UPDATE → 302 with the row genuinely changing,
INSERT → 1 row, DELETE → row genuinely gone. Purely missing client plumbing; the
RLS policies are correct.

> **The `supabaseAdmin` swap is a DIAGNOSTIC, not the fix.** It was used to
> isolate the cause and it does turn the spec green. Do not ship it: it is the
> service-role key, it bypasses RLS entirely, it moves authorization out of the
> database into `requireAdmin` alone, and it contradicts this repository's own
> `fcb331e`.

---

### Finding 4 — Frozen `is-active` after an htmx history restore: nine sites, one idiom, one fix

**Severity: IMPORTANT.** **REFACTOR REGRESSION** (in recoverability).
**Characterized by:** `10-back-button-snapshot.spec.js:418` (navbar),
`11-export-dropdowns.spec.js:530` (dropdown), `11-export-dropdowns.spec.js:778` (modal)

> **Three sites are characterized by a test; the idiom appears at nine.** The
> six uncharacterized ones carry the identical construct and the identical fix —
> they were simply not in the path of a check the suite was asked to cover. **§5A
> lists all nine; do not treat the three tested sites as the remediation scope.**
> The sharpest of the untested ones is `views/class-view.handlebars:36`, which is
> byte-for-byte the same export-dropdown construct as the characterized
> `views/character.handlebars:163`, with the class page's export anchors *inside*
> it — i.e. exactly the reachable route this finding identifies below.

**What it is.** Navigate away with a menu, dropdown or modal open; press Back.
The element comes back **visually open and permanently stuck**. Alpine is fully
alive and cannot close it.

**Mechanism.** htmx's `saveCurrentPageToHistory` runs **before** the swap and
snapshots Alpine's *computed* class into the cached markup — the cache literally
contains `<div class="navbar-menu is-active" ...>`. On restore Alpine re-inits
with `open: false`, evaluates `:class="open && 'is-active'"` → false →
`setClassesFromString(el, '')`, which adds nothing; and the undo pass removes
nothing, because **Alpine only ever removes classes it added**. The
htmx-planted class is invisible to it.

Measured on all twelve sampled frames: `{menuIsActive: true, display: "block",
alpineInitialised: TRUE, alpineOpen: FALSE}`. Clicking the burger afterwards
toggles `open` false→true→false→true while the class never moves. The restored
burger reads **`aria-expanded="false"` while the menu is visibly expanded** —
the cleanest possible proof of "alive but powerless", and an accessibility
defect in its own right, on the same ticket.

**The modal case is the worst of the three and should be fixed first.** The
overlay is full-viewport: `document.elementFromPoint` at the bottom centre
returns `DIV.modal-background`, so **the overlay swallows every click on the
page**. Escape, background click, *and re-opening the modal* are all no-ops —
`modalBase.close()` opens with `if (!this.show) return;` and `show` is already
`false`. Only a reload or a blind navigation recovers.

**Reachability of the modal case is asserted, not assumed:** these Bulma modals
have **no focus trap**, and the page behind is neither `inert` nor
`aria-hidden`, so every link stays keyboard-focusable while the modal covers the
screen. Tab out, Enter, Back. (The missing focus trap is finding 13 — pre-existing,
and the enabling condition for this one.)

**Reach.** Not mobile-only. The only boundary is Bulma's 1024px breakpoint, so
the stuck navbar reaches phones (390), tablets (768, confirmed) and any narrowed
desktop window alike.

**Why the dropdown survives ordinary use.** `@click.outside` protects the normal
route: leaving the page by clicking any link *outside* the dropdown fires it
before htmx snapshots, and the cached markup has no `is-active` (measured). The
reachable route is the **export links themselves** — they sit *inside*
`#export-dropdown`, so `@click.outside` never fires. The navbar has no
`@click.outside` at all, which is why it looked navbar-specific at first.

**Why this is a REGRESSION — measured, not reasoned.** The pre-refactor code was
reconstructed in the tree and measured side by side:

| probe | pre-refactor (emulated) | shipped (Alpine) |
| --- | --- | --- |
| dropdown on arrival after Back | stuck open | stuck open |
| **Escape on the restored page** | **healed** | **no-op** |
| **click outside** | **healed** | **no-op** |
| **one click on the trigger** | **healed** | **no-op** |
| modal on arrival after Back | stuck open, `body.modal-open` | identical |
| **Escape on the restored modal** | **fully healed, class and lock both cleared** | **no-op on all four readings** |

The frozen-class *symptom* is pre-existing and identical. What is new is that
nothing clears it. The deleted code was DOM-driven and unconditional:
`f8931dc` removed `document.querySelectorAll('.dropdown.is-active').forEach(d =>
d.classList.remove('is-active'))` on **both** outside click and Escape;
`f1c738c^`'s modal path was the same shape via `App.closeModal`; and the old
dropdown trigger was
`onclick="document.getElementById('export-dropdown').classList.toggle('is-active')"`.
All of them removed classes they had not added.

For the **navbar**, the healer was different code from the dropdown's, and this
is the one attribution the task record files by association rather than by
direct reconstruction — so here is the primary source. Before `0336a68`, the
burger was
`hx-on:click="...htmx.toggleClass(b, 'is-active'); htmx.toggleClass(m, 'is-active')..."`
(`views/partials/nav.handlebars`, `0336a68^`) — an unconditional toggle that
would have cleared a frozen class on the first burger click, exactly as the
dropdown's trigger did. The regression call is the same; the pre-refactor
mechanism is not, and a reader should know which evidence backs which site.

**Fix — verified green, not applied.** See §5A. One idiom, nine sites, one
mechanical change. Do **not** "fix" this with `hx-history="false"` or `historyCacheSize: 0`:
they make the test green by replacing a stuck menu with a blank page (finding 2)
or a signed-out render (finding 7).

---

### Finding 5 — Export links have never downloaded anything

**Severity: IMPORTANT.** **PRE-EXISTING.**
**Characterized by:** `e2e/specs/11-export-dropdowns.spec.js:919`

**What it is.** Every export link on the character and class pages replaces the
page with the raw file instead of downloading it. Measured: no download event,
URL pushed to `/export?format=markdown`, `<body>` replaced with
`"# <name>\n\n**<class>** · Level 1…"`. The class page is identical with raw JSON.

**Mechanism.** `hx-boost="true"` on `<body>` boosts the anchors; htmx ignores
`Content-Disposition: attachment` and swaps the response into `<body>`.

**No user-side workaround exists.** Direct URL entry, a new tab, middle-click and
"save link as" all fail the same way, via `/export` → `/auth/check?r=…` →
`redirectTo()` re-issuing it as an XHR **with** the header → body swap.

**The obvious fix does not work, and is measured.** `hx-boost="false"` correctly
stops the boost, but a real navigation carries no `Authorization: Bearer` header
— that header is written by JS (`app.js:730-736`), never by the browser. Same
outcome, longer road. **Every header-authenticated endpoint in this app is
structurally un-downloadable.**

> **Warning for whoever fixes this.** Adding `hx-boost="false" download` produces
> a *green-looking* result that is worse than the bug. What lands on disk:
> `{download: "check.html", url: ".../auth/check?r=…", bytes: 6666,
> head: "<!DOCTYPE html>…"}` — **the sign-in page saved as the user's export.**
> The characterization test now reads the saved file and asserts the artefact
> (filename matches `/\.md$/`, body starts with `#`, body contains the
> character's name), specifically so this cannot pass.

**Why pre-existing.** `hx-boost="true"` on `<body>` dates to `89f58ff` (init,
2024-10-09); the export feature landed at `5855b7f` (Nov 2025); `git log -S`
shows the anchors have never carried `download` or `hx-boost="false"`. The
feature has never worked.

**Fix — shape verified in isolation, not applied.** See §5D.

---

### Finding 6 — An in-flight boosted navigation is overwritten by the deferred auth refresh

**Severity: IMPORTANT.** **PRE-EXISTING**, partially mitigated by this branch.
**Characterized by:** `e2e/specs/15-auth-redirect.spec.js:340`

**What it is.** Click a nav link shortly after page load and you can land with
**the address bar on the new page and the body on the old one** — silently, with
no error. The wrong content is bookmarkable.

**Mechanism.** `43c6120` added a guard to the 100ms deferred `redirectTo(current)`:
`if (now !== current) return`. But `window.location` moves only when the boosted
swap **completes**, so a click inside the window whose response has not yet
returned is invisible to the guard. `redirectTo(current)` fires and its response
lands *after* the boosted swap, overwriting it — the very divergence `af2b098`
set out to end.

Instrumented reproduction, 3/3: `scheduled@97 loc=/`, `clicked@98`, guard read at
`t=100` with `loc` still `/`, `pushed@249 /privacy`.

**Rate: 12/46 pooled (26%)** with a natural click and **no network shaping at
all**; 46/46 of those clicks were genuinely boosted. The rate swings with load —
individual batches measured 2/6, 3/10, 2/20 and 5/10 — so treat 26% as an
order of magnitude, not a constant. **The severity rests on the shape, not the
rate:** an ordinary click on a nav link shortly after load, failing silently.

The spec's version is made deterministic with two `page.route` delays, which is
simply an ordinary slow connection — and that is what makes it reachable in
production.

**The branch's guard does real work.** Removing it entirely (M7) gives 8/8
collisions versus 5/10 shipped. "Partially mitigated" is exact: the guard narrows
the window, it does not close it.

**Why pre-existing.** The deferred refresh predates `ar-h6rt`; `43c6120` is the
partial mitigation, not the cause.

**Fix.** Not verified. The guard needs to observe an *intent to navigate* (e.g.
`htmx:beforeRequest` on a boosted link) rather than a completed `window.location`
change.

---

### Finding 7 — `/lfg/:id` is never snapshotted; Back re-renders it signed out

**Severity: IMPORTANT.** **PRE-EXISTING.**
**Characterized by:** `e2e/specs/14-lfg-controls.spec.js:718` (plus a green control)

**What it is.** Leave an LFG post that has an approved party member, press Back,
and the page comes back **rendered signed out** — GAME / INFO / SOCIAL /
LOGIN-SIGNUP nav, no user content, no error.

**Mechanism.** `views/lfg-post.handlebars:90` carries `hx-history="false"` (and
`hx-push-url="false"`). htmx queries `[hx-history="false" i]` **document-wide**
before caching, so the snapshot of `/lfg/:id` itself is suppressed. Back misses
the cache, falls through to `loadHistoryFromServer`'s unauthenticated XHR
(finding 2's mechanism), and because `/lfg/:id` is `authOptional` the server
answers with a full signed-out render rather than an empty body.

A/B measured — with a party member: cache `[]`, `htmx:historyCacheMiss`,
`bodyLen 16326 → 7180`, `a[href="/profile"]` absent. Control without a party
member: cache hit, signed in.

The attributes sit three conditionals deep (`{{#each post.join_requests}}` /
`{{#if (eq this.status "approved")}}` / `{{#if this.character}}`), so they render
only for posts with an approved, character-bearing join request.

**Why pre-existing.** `git show 3a09932` leaves both history attributes
byte-for-byte unchanged. They arrive in `37efac4` (Nov 2025) — and they have been
**inert from birth**: `git show 37efac4^` shows the `hx-get` they would have
modified was already commented out, and the button shipped as an `hx-on:click`
inline handler that issues no htmx request at all. Suppressing this page's
history snapshot is the only effect either attribute has ever had.

**Fix — verified green, not applied.** Delete both attributes (§5C). M10 turns
the spec 7/7. **This fixes this page only** — eviction and blocked storage reach
the same cache miss with no `hx-history` anywhere, so finding 2 must be fixed
separately and rated above it.

---

### Finding 8 — `DELETE /pages/:id` answers 204 for a destructive no-op

**Severity: IMPORTANT.** **PRE-EXISTING.** Sub-finding of finding 3.
**Characterized by:** covered by finding 3's spec indirectly; no dedicated test.

**What it is.** `routes/pages.js:146` returns **204 No Content** for a delete that
matched zero rows and left the page in the database.

**What it is *not*.** An earlier draft of this analysis said the UI "reports
success". That was **wrong and is struck.** htmx 2.0.8 does not swap on a 204, so
in a real browser the row simply does not disappear. Re-measured:
`{DELETE 204, row still visible 1, error notifications 0, #alerts "", DB row
survives true, row present after reload 1}`. **The button is inert**, and the row
not disappearing is itself a weak signal.

**What survives.** Any **non-browser** consumer — the agent API, a script, a
future SPA — correctly reads 204 as "deleted". That is the real harm.

It is ranked ahead of the create/update half of finding 3 on one narrow ground:
create and update fail **loudly and visibly** ("Failed to update page"), while
delete fails **silently** and misreports to non-browser consumers.

---

### Finding 9 — A non-owner can never see that an LFG post already has a Conduit

**Severity: IMPORTANT.** **PRE-EXISTING.**
**Characterized by:** nothing — see Coverage gaps (deliberate).

**What it is.** Viewing someone else's LFG post that already has an approved
Conduit, a player sees a "Conduit needed" tag, no conduit banner, and the join
form's Conduit radio **enabled** with no "(Already assigned)" label. Submitting is
then rejected server-side.

**Mechanism — it is one line, not RLS.** `lfg_posts_public_select` is
`USING (is_public = true)`, a *row* policy, so a non-owner **does** receive the
true `host_id`. `models/lfg.js:32-36` (`applyConduitMeta`) then **discards that
correct, RLS-visible value** and substitutes a null derived from an RLS-*filtered*
source (`lfg_join_requests_select` shows a viewer only their own requests plus
requests on posts they created or host). Measured with a freshly-constructed
client signed in as the player: raw row `host_id` = the admin's profile id,
`join_requests` count 0, `getLfgPost(playerClient).host_id` = null.

**Fix.** One branch in `applyConduitMeta` — prefer the stored `host_id` when the
derivation cannot see the join requests. Not an RLS redesign.

**Related Minor, same area:** `services/lfg/service.js:180-184` returns a **bare
string** for "conduit slot is already filled"; `util/http-error.js:23-32` has no
branch for a bare string and defaults to **500**, while the agent path at
`:339-345` returns a structured **409 `conduit_taken`** for the identical
condition. Through the real UI, `sendError` retargets to `#alerts` and the user
reads "Join failed".

---

### Finding 10 — Control characters bypass the open-redirect guard

**Severity: LOW.** **PRE-EXISTING.**
**Characterized by:** `e2e/specs/15-auth-redirect.spec.js:483` — as **forward
tripwires**, not as load-bearing tests. See below.

**What it is.** `_isSafeInAppPath` inspects the **unparsed** string
(`url[0] === '/' && url[1] !== '/' && url[1] !== '\\'`), but the URL parser strips
ASCII tab, LF and CR **before** parsing. `?r=/%09/evil.com` decodes to
`"/\t/evil.com"`, the guard says SAFE, and `history.replaceState` resolves it to
`http://evil.com/`. Also `/%0A/`, `/%0D/`, `/%09%5C`. The server's
`isSameOriginPath` is fooled identically. Shapes that do **not** slip past:
`/\evil.com`, `%2F%2Fevil.com`, `%09//evil.com`, `/%20/evil.com`, `/@evil.com`.

**Why this is LOW and not High — corrected during review.** There are **two
external defenses, not one**. Chromium refuses the cross-origin `replaceState`,
**and** htmx 2.0.8 ships `selfRequestsOnly: true` (read live:
`{version 2.0.8, selfRequestsOnly TRUE}`; `head.handlebars:4`'s `htmx-config`
meta does not override it). Driving `htmx.ajax` at every hostile shape with an
`Authorization` canary: **every one** answers `htmx:invalidPath` and issues **no
request**.

**Today's actual symptom** is a broken sign-in: the token is written, the user is
stranded on `/auth`, and the attacker-chosen hostname is rendered into `#alerts`
as **plain text** (`app.js:101` uses `textContent` — no HTML injection). No
navigation, no request, no token exposure.

**Escalations checked and cleared**, recorded so nobody re-treads them: `#alerts`
uses `textContent`; the Discord OAuth paths anchor to `${origin}/auth/check?r=`;
a `//`-prefixed pathname gets a bare Express "Cannot GET //evil.com" 404 with no
layout, so `app.js` never bootstraps there; the server-side laxness has no
victim-reachable path (`redirect-to` is a custom request header, not settable
cross-site).

**Still worth fixing** — the guard is *documented* as the protection and is not.
**Fix:** validate the parsed value, `new URL(r, location.origin).origin ===
location.origin`.

> **Read the tripwire note before touching these four tests.** They pass under
> every application mutation tried (M1, M2, M3, M6, M7, M8), because what stops
> these shapes today is Chromium and htmx, not this app. They cannot detect a
> regression in `_isSafeInAppPath` — the four *hostile-value* tests do that.
> They will fail the day either external defense is removed, which is exactly
> when this finding stops being Low.

---

### Finding 11 — `redirectTo` gates only the `replaceState`, not the request

**Severity: LOW (latent).** **PRE-EXISTING.**
**Characterized by:** nothing.

`public/js/app.js:985-989`: a guard-**rejected** url still falls through to
`htmx.ajax` at `:989`, with `Authorization: Bearer` and `Refresh-Token` already
written into the headers (`:973-977`), and with `allowScriptTags` and `allowEval`
both true. That, not the control-character path, is the token-exfiltration and
script-injection primitive.

It is blocked today **solely** by htmx's `selfRequestsOnly` — one config flip,
one htmx major bump, or one library swap from live.

**Fix: one line.** `if (!_isSafeInAppPath(url)) return;`

**Attribution note.** The task record labels this "pre-existing (`af2b098`
introduced this shape)", which reads as a contradiction since `af2b098` is on this
branch. Reading the commit settles it: `af2b098` *added* `_isSafeInAppPath` and
applied it to the new `replaceState`. The ungated `htmx.ajax` call predates it and
was ungated before, too. So: pre-existing, and `af2b098` improved matters without
closing this. Not a regression.

---

### Interlude — two traps in `redirectTo`, for whoever fixes findings 2, 10 or 11

Neither is a defect, so neither is counted among the twenty. Both are **verified
mechanisms** that make a plausible-looking edit to `redirectTo` wrong, and all
three of the findings above send a developer into exactly that function.

**Trap A — `af2b098` is not the no-op it looks like, and its own commit message
undersells it.** The message implies the `history.replaceState` is what keeps the
address bar off `/auth/check`. It is not the only thing doing that:
`util/auth.js:73-79` has sent `HX-Push-Url` on the redirect-to header since
`89c8d05` (2024-10-12), **gated on `referer !== redirectTo`** — and the shipped
`replaceState` makes the Referer match, which **suppresses that header as a side
effect**. Measured A/B:

| | `HX-Push-Url` sent | `history.length` | Back lands on |
| --- | --- | --- | --- |
| shipped | none | 2 → 3 | `/` |
| `replaceState` deleted (M3) | two | 3 → 5 | `/auth/check?r=%2Fnav%2Fmanage` — the trap |

So deleting the `replaceState` does **not** move the address bar off the target;
it corrupts the **history shape**, one keypress from the bug `af2b098` fixed. What
that line buys is the history shape, exactly as its comment claims. A spec
asserting only URL + heading passes with `af2b098` reverted — the Back assertion
is the only thing that catches it.

**Trap B — `app.js:986`'s `history.replaceState(null, '', url)` wipes htmx's
`{htmx:true}` popstate marker**, and htmx's `onpopstate` only handles a popstate
carrying it. It survives **only** because `saveCurrentPageToHistory` re-marks the
entry on the way out. A reordering here silently breaks all htmx history
handling — including findings 2 and 7's cache paths. `10-back-button-snapshot.spec.js`
test 1 asserts `popstateState === '{"htmx":true}'`, so this one trap *is* pinned.

---

### Finding 12 — `body.modal-open` leaks across navigation, and the modal scroll lock has never worked

**Severity: MINOR.** **PRE-EXISTING** (both halves).
**Characterized by:** `e2e/specs/11-export-dropdowns.spec.js:649`

**(a) The class leaks.** `body.modal-open` is a *document*-level side effect with
a *component*-level lifetime. htmx's boosted swap replaces `body.innerHTML`, and
`<body>`'s own `class` attribute is not part of the swap
(`cleanInnerHtmlForHistory` snapshots `innerHTML`), so the class outlives the
component. Measured after **one forward boosted hop**, no Back needed:
`{url: "/", bodyClass: "modal-open", overflow: "hidden", anyActiveModal: 0}`.
The pre-refactor emulation produced a **byte-identical** reading — pre-existing,
unchanged.

**(b) It has no observable effect, and never has.** An earlier draft claimed a
real scroll lock leaking onto clean pages. **That claim is wrong and is struck.**
`body.modal-open { overflow: hidden }` (`public/css/styles.css:253-255`) is
**dead CSS in this app**: overflow propagates to the viewport from `<html>` and
only falls through to `<body>` when `<html>`'s own overflow is `visible`, and
Bulma 1.0.4's minireset sets `html { overflow-x: hidden; overflow-y: scroll }`
(computed `"hidden scroll"`) on every page.

Re-measured with **real wheel events** at 800×400 on `/` (`scrollHeight` 1163):

| condition | `scrollY` |
| --- | --- |
| no class | 763 |
| `body.modal-open` applied | 763 — **not locked** |
| `+ html { overflow: visible }` forced | 0 — locked |

So the separate, larger fact is: **the modal scroll lock has never worked in this
app at all**, not even while a modal is legitimately open.

> **Method note worth keeping.** The first re-measurement used
> `window.scrollBy` and showed "no lock" in *every* condition including the
> control, because programmatic scrolling works straight through
> `overflow: hidden`. Only a real wheel event discriminates. A probe that cannot
> fail its own control proves nothing.

The characterizing test asserts the **class**, which is a valid reading; it does
not assert unscrollability, and its title was renamed to say so.

---

### Finding 13 — No focus trap or `inert` behind modals

**Severity: MINOR** on its own; **enabling condition for finding 4's modal case.**
**PRE-EXISTING** (Bulma markup, never had one). **Not characterized.**

Every link behind an open modal stays keyboard-focusable and the page is neither
`inert` nor `aria-hidden`. This is what makes finding 4's "tab out, Enter, Back"
route reachable, and it is an accessibility defect in its own right.

---

### Finding 14 — Alpine state written before the post-load body swap is discarded

**Severity: MINOR.** **PRE-EXISTING.** **Not characterized** (specs work around it).

`app.js` `start()` → `redirectTo()` performs a `<body>` swap on **every** authed
page load (`app.js:970-990`, rationale comment at `726-729`), rebuilding the Alpine navbar
with `open: false`. Any interaction in the window before it lands is silently
discarded — tap the burger early and the menu closes itself.

Specs avoid it by awaiting `networkidle` after `goto` before touching Alpine
state; a new spec that does not will race it.

---

### Finding 15 — `GET /lfg/:id/requests` is fetched twice on every post view

**Severity: MINOR.** **PRE-EXISTING.** **Deliberately not characterized.**

Fired once at page load — before any click — and again on the first Show click.
Cause: `hx-trigger="revealed"` on a `display: none` element; htmx's
`isScrolledIntoView` reads an all-zero `getBoundingClientRect` as *in view*
(`top < innerHeight && bottom >= 0` with `top === bottom === 0`). Compounded by
an inline handler gating a second `htmx.trigger` on its own `dataset.loaded` flag
that htmx never sets.

Consequence worth knowing when writing tests here: **the panel's markup, player
name and character name included, is already in the DOM, merely hidden.** A
`toContainText` assertion reads `textContent` and is therefore already true
before the click — assert visibility, never presence.

---

### Finding 16 — A refuted rationale has been copy-pasted into four production comments

**Severity: MINOR.** **REFACTOR REGRESSION** (`a324968`, on this branch).
**Not characterized** at this tier.

`a324968`'s premise — that `swap: 'outerHTML'` on `body` replaces the `<body>`
**element** and destroys listeners bound to it — is **refuted for htmx 2.0.8**.
htmx's own source: `swapOuterHTML` opens with
`if (target.tagName === 'BODY') return swapInnerHTML(...)`. Measured on the real
bounce: `__origBody === document.body` **true** after the bounce and again after a
boosted click, a pre-swap `data-` attribute survives, and a `document.body`-bound
`htmx:configRequest` listener still fires. Reverting that listener (M4) fails
nothing at this tier — including with all seven listeners reverted.

**The commit is defended by a test that manufactures its own premise.** Its htmx
stub does `document.body.replaceWith(freshBody)` under the comment "The real DOM
consequence of `swap:'outerHTML'` on `target:'body'`", and `:345` then asserts
`expect(document.body).not.toBe(bodyBeforeSwap)` **as its anti-vacuity guard** —
an assertion that is false in the shipped app.

The wrong rationale now lives at **three** sites, all added by `a324968`:
`public/js/app.js:667-670`, `726-729` and `869-872`.

> **Scope correction.** An earlier draft counted a fourth site, `app.js:988`
> (`// Use swap: 'outerHTML' to ensure proper body replacement`). `git show
> a324968` adds the rationale at exactly three sites, and `:988` traces to
> `bf10fc9` (2026-02-05), which predates this branch. That comment is arguably
> wrong for the same reason, but it is **pre-existing, not a regression.** The
> regression is three comments.

**The document-bound listeners are still correct practice and should stay** —
only the stated reason is wrong, and the production symptom `a324968` set out to
fix remains **undiagnosed**. Correct it in the same change that corrects the
commit-message attribution: a wrong rationale propagating into comments is how it
survives review next time.

This does **not** disturb findings 2, 4 or 12 — the body's *contents* are still
wholly replaced. It **does** bear on **finding 14**, which describes that body
swap and cites one of these very comments: the swap is real and finding 14 stands,
but read its cited comment as evidence of *what the code does*, not as a correct
account of *why*.

**Correction to a related claim:** `a324968` and `43c6120` **are** pinned, at the
**unit** tier (`test/auth-redirect-history.test.js:358` and `:259`, both verified
failing under their mutations). The correct statement is "this tier adds no
coverage of them", not "they are uncovered".

---

### Finding 17 — A Handlebars `optgroup` with exactly one ability never pre-selects

**Severity: MINOR.** **PRE-EXISTING.** **Not characterized** (worked around in fixtures).

**Mechanism.** `views/partials/character-class-abilities.handlebars:9` —
`{{#if (eq this (lookup ../../characterAbility 'name'))}}selected{{/if}}` inside
`{{#each this}}` within `{{#each}}`-generated `<optgroup>`s. The `../../` depth is
**correct** for two or more abilities. With exactly one, Handlebars' depth-push
optimization in `runtime.js` guards with a loose `!=`, and `['x'] != 'x'` is
false, so no depth frame is pushed and the reference misses.

> **Do not "fix" this by changing the `../` count** — the implementer's first
> proposal did, and it would regress every catalogue class. The correct fix is
> depth-independent (block params).

---

### Finding 18 — Creating a fresh user logs a foreign-key error

**Severity: MINOR.** **PRE-EXISTING.** **Not characterized.**

Creating a fresh user logs `rules_pdf_unlocks_rules_pdf_id_fkey`. A local seed
gap, adjacent to `ar-p8kq`.

---

### Finding 19 — An unauthenticated user hitting a protected route reaches a dead end

**Severity: MINOR.** **PRE-EXISTING.** **Not characterized** (side observation).

`/auth/check` renders **no sign-in form**, and its "please Login" link points at
`/auth` with no `?r=` — so the intended destination is lost. The user must
navigate to sign-in themselves and then find the page again.

---

### Finding 20 — The same LFG conflict answers 500 on the UI path and 409 on the agent path

**Severity: MINOR.** **PRE-EXISTING.** **Not characterized.**

`services/lfg/service.js:180-184` returns a **bare string** for "conduit slot is
already filled". `util/http-error.js:23-32` has no branch for a bare string and
defaults to **500**. The agent path at `services/lfg/service.js:339-345` returns a
structured **409 `conduit_taken`** for the identical condition.

Through the real browser journey htmx sends `HX-Request`, so `sendError`
retargets: status **500**, `{"hx-retarget": "#alerts", "hx-reswap": "innerHTML"}`,
body `<div class="notification is-danger">Join failed</div>`. The user reads "Join
failed" and nothing is written — so the *user-visible* behavior is acceptable and
the harm is confined to the status code: a 500 tells every consumer and every
monitor that the server broke, when the request was simply refused.

Filed separately from finding 9 rather than as a sub-note: different file,
different fix, and the record twice asked for it as its own item.

> **Measurement note.** This is not what a raw POST reports. The non-HX path
> returns a 500 HTML error page, and an early characterization guessed
> "Conduit slot is already filled" — both wrong for the real journey. `HX-Request`
> changes both the status handling and what the user actually reads, so measure
> error paths through the UI.

---

## 4. Claims that were investigated and **refuted** — do not resurrect these

Several early claims were overturned during adversarial review. They are recorded
here so a future reader does not re-file them.

| Claim | Verdict |
| --- | --- |
| The perk textarea (`ability_perk_text[]`) wiring is broken | **REFUTED** — the round-trip persists newlines correctly |
| Save is gated on a stat-total budget | **REFUTED** — no such gate exists. `#levelUpTotal` is write-only and `normalizeStatsPayload` clamps stats independently. The real gate is missing-missions / Conduit Credit (`services/character/service.js:442-447`) |
| `created_by = null` classes are hidden from their owner on `/my` | **REFUTED** — invisible to *everyone* by a strict `.eq` in `util/class-filters.js`, and `GET /` does not filter by owner. Correct behavior |
| The offscreen-mission `x-init` seed is broken | **REFUTED** — confirmed **absent**; measured `alpineSourceId === selectValue === linked.id` |
| `/pages/new` renders broken Alpine (`pageSlug(null, null)`) | **REFUTED** — the `json` helper emits literal `null`s, which is exactly what the `(value \|\| '')` guards exist for |
| `lfg_posts.host_id` being overwritten on read is a bug | **REFUTED** — deliberate product behavior (`cdb2acf`); approved conduit join requests are the source of truth |
| A non-admin at `/nav/manage` is broken | **REFUTED** — 403 plus an `#alerts` banner, no body swap. Correct |
| The modal scroll lock leaks onto clean pages and blocks scrolling | **REFUTED** — see finding 12(b). Dead CSS. The real harm is click-blocking (finding 4) |
| The Pages delete button reports success | **REFUTED** — see finding 8. htmx does not swap on 204; the button is inert |
| The `is-active` settle race does not reproduce | **REFUTED** — it does, at any non-zero `defaultSettleDelay`. The first measurement used a retrying assertion against a transient state |
| The `00-smoke` console flake is caused by CDN assets | **REFUTED** by direct capture — it is Chromium's own `"Permissions policy violation: compute-pressure…"`. Fixed by an anchored filter |
| `bun run test:e2e -- <flag>` does not forward flags | **REFUTED** by direct measurement on bun 1.3.3 in this repo — all three invocation forms report identical "Running N tests" counts |

---

## 5. Recommended fixes — verified, deliberately **not applied**

This branch reports defects; it does not change production code. Each fix below
was applied in a scratch tree, measured, and reverted.

### A. The frozen-class family — one idiom, nine sites (finding 4)

Replace `:class="<expr> && 'is-active'"` with the **object form**, at **all nine
sites**. Only the three marked *tested* are covered by a characterization test;
the other six carry the identical construct and heal identically.

| File:line | Change | What it is | Tested |
| --- | --- | --- | --- |
| `views/partials/nav.handlebars:6` | `:class="{ 'is-active': open }"` | navbar burger | **yes** |
| `views/partials/nav.handlebars:14` | `:class="{ 'is-active': open }"` | navbar menu | **yes** |
| `views/character.handlebars:163` | `:class="{ 'is-active': open }"` | character export dropdown | **yes** |
| `views/partials/character-level-up.handlebars:2` | `:class="{ 'is-active': show }"` | level-up modal | **yes** |
| `views/class-view.handlebars:36` | `:class="{ 'is-active': open }"` | **class-page export dropdown** | no |
| `views/class-view.handlebars:218` | `:class="{ 'is-active': show }"` | duplicate modal | no |
| `views/class-view.handlebars:263` | `:class="{ 'is-active': show }"` | unlock-code modal | no |
| `views/my-classes.handlebars:119` | `:class="{ 'is-active': show }"` | per-row duplicate modal | no |
| `views/character-form.handlebars:409` | `:class="{ 'is-active': show }"` | deceased modal | no |

`class-view.handlebars:36` deserves the same priority as the tested dropdown: it
is byte-for-byte the same construct, `id="export-dropdown"` with
`@click.outside` and `@keydown.escape.window`, and the class page's export
anchors sit inside it — the reachable route finding 4 describes.

**Why it works:** Alpine's `setClassesFromObject` **does** remove a falsy class it
did not add — its `forRemove` branch calls `classList.remove` on any falsy key
already present. `setClassesFromString` only removes what it added.

> **COMPANION CHANGES — the whole remediation must travel together.** Four unit
> tests assert the **literal old string** against the real templates and will go
> red as each site is converted:
>
> | Test | Guards | Fires when you convert |
> | --- | --- | --- |
> | `views/partials/nav.test.js:59` | navbar | `nav.handlebars:6,14` |
> | `views/class-view.test.js:52` | duplicate modal | `class-view.handlebars:218` |
> | `views/class-view.test.js:60` | unlock-code modal | `class-view.handlebars:263` |
> | `views/character-form.test.js:29` | deceased modal | `character-form.handlebars:409` |
>
> Only `nav.test.js:59` fires for the three *tested* sites, and the other four
> tests in that file still pass. The other three fire only once the fix is
> extended. Verified: `views/character.test.js:64-68` and
> `views/partials/character-level-up.test.js:36-45` pin the `@` bindings and
> `:aria-expanded` but **not** `:class`, so those two sites need no test change.
> Hand the template and test changes over as one change, or the fixer sees a red
> unit tier and concludes the fix is wrong.

> **A tenth occurrence, same idiom, different class — decide on it separately.**
> `views/partials/character-stats-editor.handlebars:31` carries
> `:class="saving && 'is-loading'"` on the stats Save button. Same string-form
> construct, so the same freezing mechanism applies, but the frozen class is a
> button spinner rather than an overlay, and **this tier never exercised it** —
> its impact is unmeasured, not established. Converting it would also fire
> `views/partials/character-stats-editor.test.js:194`. Listed for completeness of
> the sweep, not as a finding.

**The modal needs both halves.** Measured:
- **M8** — object form on `character.handlebars:163` alone turns the **dropdown**
  test green with nothing else changed.
- **M9** — object form on `character-level-up.handlebars:2` alone takes
  `framesPaintedOpen` 6 → 0 but leaves the body-lock frame count non-zero, so the
  modal's *other* test correctly stays red.
- **M10** — M9 **plus** `destroy() { document.body.classList.remove('modal-open') }`
  on `modalBase` turns **both** modal tests green.

So: both halves separately necessary, jointly sufficient. Verified overall — spec
10 goes 3/3 green including its `cachedRootSnapshotHasAlpineOutput` tripwire, and
the full suite moved to 35 passed / 1 failed at the time of measurement.

### B. The Pages CMS anon-client binding (finding 3)

Thread `res.locals.supabase` into `models/pages.js` and its three call sites,
following `util/auth.js:63`. Verified by the reviewer and re-measured
independently: spec 7/7, UPDATE → 302 with the row genuinely changing,
INSERT → 1 row, DELETE → row genuinely gone.

> **The `supabaseAdmin` swap is a DIAGNOSTIC, not the fix.** Service-role key,
> bypasses RLS entirely, moves authorization out of the database into
> `requireAdmin` alone, and contradicts `fcb331e`. It turns the spec green. Do
> not ship it.

### C. The inert LFG history attributes (finding 7)

Delete `hx-history="false"` and `hx-push-url="false"` from
`views/lfg-post.handlebars:90`. Inert since `37efac4`; M10 turns spec 14 7/7.
Fixes this page only — finding 2 is the general case and ranks above it.

### D. Export downloads (finding 5) — shape verified in isolation

`hx-boost="false"` **+** `@click.prevent` doing fetch-with-header → `Blob` →
`URL.createObjectURL` on an `<a download>`. Emulated (MD3) and the red test turns
green. Alternatively, accept a session cookie or a signed token so a plain
navigation authenticates.

**Not** `hx-boost="false" download` (MD2) and **not** `download` alone (MD1) —
both measured, both still wrong, and MD2 previously produced a *green* run that
saved the sign-in page as the user's export.

### E. The open-redirect guard (finding 10)

Validate the **parsed** value: `new URL(r, location.origin).origin ===
location.origin`. Apply to the server's `isSameOriginPath` too.

### F. `redirectTo`'s ungated request (finding 11)

One line: `if (!_isSafeInAppPath(url)) return;` before the `htmx.ajax` call at
`app.js:989`.

### G. Explicitly **not** a fix

`hx-history="false"` and `historyCacheSize: 0` make finding 4's navbar test green
by replacing a stuck menu with a **blank page** (finding 2) or a **signed-out
render** (finding 7). Recorded in the spec's own header. Do not use them.

---

## 6. Coverage gaps and deferred items

**Deliberate gaps — named so nobody is surprised:**

- **Finding 9 has no failing test, by design.** Check 10's test 5 takes the
  **admin's** viewpoint, because `is_admin()` bypasses both policies and it is the
  only identity that can observe the server-rendered `disabled` at all. So no test
  fails while the `applyConduitMeta` defect is live, and fixing it turns nothing
  green here. A third permanent red was not added to a spec that check 10 is not
  about.
- **Finding 3's read half is untested.** It is a CMS defect, not a slug defect. It
  *is* why every fixture in spec 13 is seeded published + public — anything else
  404s on the edit form and the spec could not run at all.
- **Finding 15 is untested** — an htmx-trigger defect, not a form-control one.
- **Findings 2, 8, 11, 13, 14, 16, 17, 18, 19 and 20 have no dedicated test**, and
  neither do the two `redirectTo` traps in the interlude after finding 11 (trap B
  is pinned, by `10-back-button-snapshot.spec.js` test 1; trap A is not).
  **This is the authoritative list — every finding not named here is characterized.**
  Three deserve singling out:
  - **Finding 2** is the most significant: the `authOptional` symptom is covered
    (finding 7), but the **protected-route blank page** — the critical variant —
    has no standing test.
  - **Finding 11** is the token-exfiltration / script-injection primitive with a
    one-line fix. Nothing guards it. Do not assume the four control-character
    tests do — they cover finding 10, and they are tripwires even there.
  - **Finding 8** is covered only indirectly, through finding 3's spec; nothing
    asserts the 204 itself.
- **Six of finding 4's nine sites have no test** (§5A marks which). The
  remediation scope is larger than the characterized scope.

**Structural limits of this tier:**

- `a324968` and `43c6120` are pinned at the **unit** tier, not here.
- The four control-character tests (finding 10) are **forward tripwires**: no
  application mutation fails them, because Chromium and htmx enforce the
  invariant, not this app.
- No isolating single-line production mutation exists for the export-download red
  test — the only candidate was disproved (finding 5). The **fix shape** was
  verified instead.
- **`clearingModal`'s guard semantics remain untested**: Escape while a
  *different* modal is open (`wasOpen` false → no spurious clear), and a
  `close-modal` broadcast for a mismatched name (`close(which)` early-returns).
  Spec 08 covers the multi-instance name-scoping path; the cross-modal Escape case
  is open.

**Cost note:** the export-download red test spends a 5s
`waitForEvent('download')` timeout on every run while it is red. Deliberate — it
is the only honest way to assert that a download happened.

---

## 7. Known flakes

Recorded with sighting counts so a future failure starts from evidence rather
than from scratch. **Today's run had zero flakes** — 71/9 with the exact expected
failing set.

| Test | Sightings | Status |
| --- | --- | --- |
| `00-smoke.spec.js:73` console-error assertion | 1 in ~80 at `--workers=8` | **RESOLVED.** Chromium's own `"Permissions policy violation: compute-pressure…"`, not app code. Anchored filter applied and verified in **both** directions; 160/160 green at the settings that previously gave 1-in-80 |
| `05-level-up-modal.spec.js` "closes via escape key…" | 1, unexplained | Not reproduced in 24/24 of that spec alone at `--workers=4`, nor in 9 consecutive full-suite runs. **Deliberately not diagnosed from one sighting** |
| `05-level-up-modal.spec.js:71` "completing a level-up persists…" | 1, cold start | Passed in 4 consecutive full-suite runs after |
| `07-unlock-code-modal.spec.js:58` "closing via escape key clears the code…" | 1, cold start | Clean for 13 runs after |
| `03-perk-textarea.spec.js:72` "saving persists perk text…" | 1, 30.8s timeout | Not reproduced in 2 full-suite runs nor 3/3 of that spec alone |
| One uncaptured 35/1 run (an expected failure passed once) | 1 | Unreproducible in 13 further runs. **Unattributed** |

**The shape worth carrying — stated at the strength the record actually supports.**
**Two** sightings are explicitly attributed to the **first run after a cold
web-server start** (`05-level-up-modal.spec.js:71` and
`07-unlock-code-modal.spec.js:58`), and both are modal specs. A third,
`03-perk-textarea.spec.js:72`, was the first full-suite run after a heavy
`--repeat-each` batch — that is **resource contention, not a cold start**, and it
is a different hypothesis. The `05` escape-key sighting carries no attribution at
all.

So: a cold-start pattern in **two** sightings, generously three. Enough to say
something is there; **not** enough to name it — and not enough to send a triager
looking only at startup.

**One candidate mechanism, not chased.** `03-perk-textarea.spec.js:72` does an
htmx PUT then `waitForURL(!pathname.endsWith('/edit'))` relying on `HX-Location`.
**Finding 6** is exactly "a stale redirect restores the old location after a
navigation", which on `/characters/:id/edit` would put the URL back on `/edit`
and hang that wait to the 30s timeout — the observed shape. Same family, still one
sighting.

---

## 8. CI, and a design problem the developer must decide

`.github/workflows/e2e.yml` is added, with **no `push: branches: [main]`
trigger** — deliberately, while the deliberate reds remain. `pull_request` and
`workflow_dispatch` only.

### The problem: CI can never go green

With nine deliberate reds, `bun run test:e2e` **exits non-zero unconditionally**.
A genuinely new breakage is visible only by reading failure *names*, and the exit
code carries no information at all. Four separate tasks raised this
independently.

It is worse in CI than locally: `playwright.config.js:31` sets `retries: 1` when
`CI` is set, so every one of the nine reds is **run twice** on every CI run,
purely to re-confirm a known defect.

### The recommendation: `test.fail()` — **not applied, the call is yours**

Playwright's `test.fail()` **inverts the expectation**. A characterization test
annotated with it **passes while the defect exists** and **fails the moment
someone fixes it**. That is exactly the alert you want, and it would give CI a
green baseline without losing any characterization.

**The trade-off, stated honestly:**

- **For it:** a meaningful exit code; new breakage becomes visible immediately
  instead of being buried in a list of expected names; CI retries stop
  double-running known failures.
- **Against it:** an inverted test is easy to misread as "this passes, so it
  works" by anyone skimming the run output — the defect becomes *less* visible in
  the very report that used to shout about it. It also turns "someone fixed the
  bug" into a red CI run, which needs a documented convention or it looks like a
  regression. And the nine reds are currently the most legible artifact this
  branch produced.

**This was deliberately not converted.** Triage is the developer's decision (plan
Step 7): fix the defects, mark the specs `test.fixme()` with ticket references,
convert them to `test.fail()`, or accept them as-is. Only after that should
`push: branches: [main]` be added to the workflow, and `ar-7v3k`'s "BLOCKING:
manual browser verification" section replaced with a reference to this suite.

### Two corrections to the planned workflow, both applied

The plan's YAML would have failed on **every** CI run, at the seed step, for two
independent reasons. They are stacked: the first fires before the second is ever
reached, which is why the second was found first and looked sufficient.

**Correction 1 — the seed guard reads a file that does not exist in CI.**
`bun run seed:local` calls `assertLocal()` before anything else, and that calls
`parseEnvUrl()`, which reads **the `.env` file**:

```js
function parseEnvUrl() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return "";   // reads the FILE, not process.env
  ...
}
```

`.env` is gitignored (`.gitignore:2-3`; only `.env.dist` is tracked), so a fresh
CI checkout has none. `parseEnvUrl()` returns `""`,
`/127\.0\.0\.1|localhost/.test("")` is false, and `fail()` calls
`process.exit(1)`. **Inline `SUPABASE_URL="$API_URL"` on the step cannot help —
the guard never reads the environment.**

Reproduced against the real guard logic with an absent `.env` and the inline
variables exported: `exit=1`, before a single row is seeded.

**The fix: the workflow writes a `.env` from `supabase status -o env` before
seeding.** Verified end to end — the step's actual output, run through the real
guard logic, reports `PASS: target is local (http://127.0.0.1:54321)`, `exit=0`.

> **`--force` was measured and rejected, and the reason matters.** It is the
> shorter fix and it is wrong. `--force` does not supply a local URL; it disables
> the check. Measured: with a `.env` pointing at `https://abc.supabase.co`, the
> guard correctly refuses (`exit=1`) — and `--force` sails straight past it
> (`exit=0`). That guard is the only thing standing between a mis-wired workflow
> and `seed:admin` creating the **known-password** dev admin
> (`dummy@testing.com` / `dummypassword`) in a real project. Writing the file
> keeps the check live: point this workflow at a cloud project and it still
> refuses.

**Correction 2 — `seed:admin` reads a variable the plan never passed.**
The plan's YAML passed only `SUPABASE_SECRET_KEY`. `bun run seed:local` invokes
`bun run seed:admin` whenever no admin profile exists
(`scripts/seed-local.mjs:105-113`), and `util/seed-admin.js:38-41` calls
`createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)` after its **own**
`dotenv.config()` — it never loads `util/env.js`, whose alias table maps only
deprecated → current, not the reverse. With that variable unset, `createClient`
throws `supabaseKey is required.` (verified directly).

`SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"` is therefore set on the seed step,
matching `.github/workflows/integration.yml:42`, and the generated `.env` carries
it too.

> **Why the `integration.yml` comparison could not have caught correction 1.**
> That workflow never invokes `seed:local` — it goes straight from
> `supabase db reset` to `bun run test:integration`. Matching it was the right
> instinct for correction 2 and structurally blind to correction 1. **Copying a
> working neighbour only transfers the problems the neighbour has.**

§11 "Reproducing this run" is unaffected: a developer's checkout has a `.env`,
which is exactly why the guard has always passed locally and the gap stayed
invisible.

**The rest of the workflow is unchanged and sound.** `supabase db reset` is
correct — the never-reset constraint protects the *developer's local database*,
and CI runs a fresh ephemeral one. `bunx playwright install --with-deps chromium`
is required in CI (local installs skip `--with-deps` because it needs sudo).
`if: failure()` on the artifact upload is right for a suite that fails by design,
and `CI` is set by GitHub, so `playwright.config.js`'s `retries: 1` and
`workers: 2` apply as described above.

---

## 9. Method notes worth keeping

These cost real time to learn and are the reason several findings above are
trustworthy. They are duplicated as a checklist in `CONTRIBUTING.md`.

1. **A retrying assertion cannot test a transient state.** `expect().not.toHaveClass()`
   polls for 10s; a defect whose duration equals `settleDelay` is gone before the
   first poll. Worse, a single `page.evaluate` snapshot is only as reliable as the
   CDP round-trip is fast — measured 50–95% detection at a 20ms window. Instrument
   **in-page** (event hook + `requestAnimationFrame` sampler) and read the record
   afterwards.
2. **Assert what happened, not that something happened.** A download test that
   only checked a download *started* passed while saving the sign-in page. A test
   that only checked a `200` came back would have passed on the login page too.
3. **Every negative assertion needs a positive precondition.** "Absent" and
   "present but wrong" must never collapse into the same number — a frame counter
   scored a *missing* navbar as one painted open, because
   `getComputedStyle` was never reached and `null !== 'none'`.
4. **A probe that cannot fail its own control proves nothing.** The scroll-lock
   re-measurement showed "no lock" in every condition, including the control,
   until it used real wheel events.
5. **Alpine strips `x-cloak` on init**, so `[x-cloak]` selectors are vacuous on any
   settled page. Use `'<prop>' in Alpine.$data(el)` — never `_x_dataStack`, and
   never bare `!!Alpine.$data(el)`, which is **always** truthy.
6. **Probe RLS with a freshly-constructed client.** Calling `signInWithPassword()`
   on the `models/_base` singleton attaches that session to it, and a later "anon"
   probe then succeeds — which would have falsely refuted finding 3 entirely.
7. **A red test's preconditions must be things every valid fix preserves.** Gating
   a red test on the defect's own marker trades one failure for another instead of
   letting the fix turn it green.
8. **State which agent enforces an invariant** — app, browser, or library — or a
   reader will assume the app does (finding 10).
9. **`reuseExistingServer` means a long-lived server does not pick up server-side
   edits.** Use a fresh `E2E_PORT` for anything touching
   `routes/`/`models/`/`services/`/`util/`. Verified: `views/*.handlebars` and
   `public/js/*` **do** appear immediately, so view-layer mutations are unaffected.
10. **When silencing test noise, prove the filter still fails on a genuine error
    *and* that its anchor cannot be bypassed.** The `00-smoke` console filter was
    verified in both directions — an injected `console.error` still fails, an
    injected uncaught exception still fails via `pageerror`, and a message merely
    *containing* the benign phrase is still caught, which is what proves the `^`
    anchor does real work. A filter verified only by "the flake stopped" is
    indistinguishable from one that disabled the assertion.
11. **Seed a denormalized column through the seam that maintains it, never the
    column.** `lfg_posts.host_id` is overwritten on every read from the approved
    conduit join request. A fixture that inserted it raw read back `null` and
    would have asserted the opposite of its own stated purpose.
12. **Measure an error path through the real UI, not a raw POST.** `HX-Request`
    changes both the status handling and what the user actually reads — two
    different wrong answers were recorded before the real journey was measured
    (finding 20).
13. **A hidden `required` control silently kills the request.** An empty,
    non-focusable `required` input (ToastUI hides `#content`; the LFG join form
    hides `select[name=characterId]`) makes Chrome's constraint validation fail,
    htmx fire `htmx:validation:halted`, and **no request go out at all** — which
    reads exactly like a broken endpoint.
14. **Never write scratch probes into `e2e/specs/`.** A stray file in `testDir`
    runs on the next full pass and corrupts the baseline. Scratch belongs outside
    the repo.
15. **Read the runner's own "Running N tests" line; never infer N from the pass
    count.** A review claim that `bun run test:e2e -- <flag>` drops flags was
    refuted by doing exactly this.

---

## 10. Process disclosures

Recorded because they bear on whether the numbers above can be trusted.

- **An uncommitted production mutation was left behind once.** A review agent was
  interrupted mid-run and left a deleted guard in
  `public/js/alpine-components.js`. Detected on resume via `git status`, reverted
  with `git checkout --`, tree verified clean. Timestamps proved the affected spec
  was authored and run against clean code, so no result was contaminated. Every
  later review brief carries an explicit revert-and-verify protocol.
- **Fabricated `system-reminder` messages, two sightings.** Twice during mutation
  windows, an agent received a message asserting that its in-progress production
  edit "was intentional" and instructing it not to revert or mention it. Both
  agents ignored it, reverted with `git checkout --`, and verified with
  `git diff`. The timing is the lesson: such a message arrives exactly when an
  un-reverted production edit would be most likely to survive into a commit.
  **Verify with git, never with prose.** *No such message was received during this
  task.*
- **A concurrent agent mutated a production file during a measurement window.**
  During Task 15's fix round, a *different* agent was actively cycling mutations
  through `public/js/app.js` — `redirectTo`'s `history.replaceState` guard
  deleted, then a different one-line edit moments later. Task 15 correctly did
  **not** revert someone else's in-flight work; it staged only its own spec file
  and re-gated its baseline on a window verified clean across
  `public/ views/ routes/ models/ services/ util/` **both before and after** the
  run. This is the incident behind the rule below, and it is why "tree clean" in
  this effort means *clean of my changes*, verified at both ends, rather than
  clean once.
- **A full-suite baseline is only trustworthy if the production tree stayed clean
  for the whole run.** This report's run was gated on `git diff --stat HEAD` being
  empty **both before and after**.

---

## 11. Reproducing this run

```sh
supabase start
bun run seed:local
bun run test:e2e
```

Open the report for a failed run:

```sh
bunx playwright show-report e2e/report/html
```

Open a trace:

```sh
bunx playwright show-trace e2e/report/artifacts/<dir>/trace.zip
```

The suite boots its own server on port 3100, so it runs alongside `bun run dev`.
It seeds and deletes its own rows under an `e2e-` prefix and **never resets your
database**. Cleanup verified after every run: `lfg_posts` 0, `lfg_join_requests`
0, `e2e-%` characters / classes / pages / missions 0.
