# Temporary Unlock Status — Design

**Date:** 2026-08-18
**Status:** Approved
**Issue:** [#154](https://github.com/david-torres/agent-resources/issues/154) — Display status of temporary unlocks prominently

## Problem

An unlock row with a non-null `expires_at` grants time-limited access. The
main source is the 30-day starter grant every new user receives
(`models/profile.js:12`, `STARTER_UNLOCK_DAYS = 30`); admins can also grant
rules-PDF unlocks with an expiry (`routes/library.js:158`).

Today a user has almost no way to tell a temporary unlock from a permanent
one:

- **Profile → Unlocked Classes** (`views/profile.handlebars:35-75`) lists
  unlocked classes with no expiry at all. `getUnlockedClasses`
  (`models/class.js:143-153`) selects `expires_at` from the repository and
  then discards it in `data.map(entry => entry.class)`.
- **Class view** (`views/class-view.handlebars:120-135`) renders the Open
  Class PDF button when access exists, with no indication that access is
  time-limited.
- The only expiry date a normal user ever sees is on `/library` document
  cards (`views/library.handlebars:65-73`) and, transiently, in the
  onboarding checklist's "free trial" copy — which vanishes once onboarding
  is dismissed or complete (`services/home/onboarding.js:41`).

Access therefore lapses silently. The user's first signal is content they
could open yesterday being locked today.

## Decision

Surface expiry status **persistently and inline**, on the surfaces where a
user already sees their unlocked content. No site-wide banner and no new
page.

A site-wide expiry-warning banner was considered and deliberately deferred.
It is a larger change (per-request middleware, layout changes, dismissal
state) and its value depends on whether persistent inline status is enough
on its own. Ship the status first.

## Scope

**In scope:** class unlocks with an expiry, on the profile page and the
class view page.

**Out of scope:**

- The library index — `/library` cards already show "Access granted /
  Expires \<date\>" and "Access expired \<date\>". No changes.
- A site-wide banner or any proactive warning (deferred, see above).
- Expired unlocks on the profile page (see "Expired unlocks" below).
- Any change to how access is *granted*, checked, or revoked. This design is
  display-only; no access decision changes.

## Effective Expiry

An unlock applies to a class's whole same-edition version family
(`util/class-family.js`), and when a user holds several unlocks across one
family, the **least restrictive** one wins. The displayed expiry must follow
the same rule, or a user holding a permanent v1 unlock would see a bogus
"Expires" tag on v2.

Effective expiry for a class, given the user's **active** unlock rows in that
class's version family:

- Any row with `expires_at IS NULL` → **permanent**; display nothing.
- Otherwise → **temporary**, expiring at the **latest** `expires_at` across
  those rows.
- No rows → not unlocked; not displayed (these surfaces only render unlocked
  classes).

This mirrors the least-restrictive rule already used for rules PDFs in
`util/rules-family.js:14-18`.

## Implementation

### `services/class/repository.js` — `activeUnlockRows`

Drop the `.limit(1)`. The query already selects `class_id, expires_at`; the
limit exists only because its sole caller needed a boolean. Computing an
effective expiry needs every matching row. A version family is a handful of
rows, so the cost is negligible.

### `models/class.js` — new `getEffectiveClassUnlock(userId, classId)`

Returns `{ data: { unlocked, expiresAt }, error }`, where `expiresAt` is
`null` for both the permanent and the not-unlocked case (`unlocked`
disambiguates). Resolves the version family via the existing
`getVersionFamilyIds`, queries `activeUnlockRows`, and reduces per the
effective-expiry rule above. On a repository error it returns
`{ data: { unlocked: false, expiresAt: null }, error }` — the same
fail-closed shape `isClassUnlocked` returns today.

`isClassUnlocked` is rewritten to delegate to it and return just the boolean,
so the family-and-expiry logic lives in exactly one place. Its callers
(`canViewClassPdf` at `models/class.js:312`, and `routes/classes.js:406`)
are unaffected by that refactor.

### `models/class.js` — `getUnlockedClasses(userId)`

Currently returns bare class objects. It changes to return each class with
its effective expiry attached: `{ ...class, unlock_expires_at }`, where
`unlock_expires_at` is `null` for a permanent unlock.

It must compute this without one query per class: it already holds every
active unlock row for the user, so it loads the class-family projection once
(`classRepository.fetchClassFamilyRows`) and, for each listed class, reduces
over the user's own active rows whose `class_id` falls in that class's
family. If the family projection fails to load, `fetchClassFamilyRows`
returns `null` and we degrade to the row's own `expires_at` — the same
degradation path the access checks already take.

Callers of `getUnlockedClasses` other than the profile route keep working:
the returned objects are supersets of the current ones.

### `routes/classes.js` — class view

Replace the `isClassUnlocked` call at `:405-407` with
`getEffectiveClassUnlock`, keeping `unlocked` in the render context as today
and adding `unlockExpiresAt`.

### Views

**`views/profile.handlebars`** — Unlocked Classes table gains an **Access**
column, after Status:

```handlebars
<td>
  {{#if this.unlock_expires_at}}
  <span class="tag is-warning is-light">Expires {{date_tz this.unlock_expires_at}}</span>
  {{/if}}
</td>
```

A permanent unlock renders an empty cell — a class appearing in the list
already implies access, so a "Permanent" tag would be noise on the common
case and would bury the rows that need attention.

**`views/class-view.handlebars`** — inside the existing
`{{#if classPdfAccessible}}` branch of the Class PDF block, directly below
the Open Class PDF button:

```handlebars
{{#if unlockExpiresAt}}
<p class="mt-2"><span class="tag is-warning is-light">Access expires {{date_tz unlockExpiresAt}}</span></p>
{{/if}}
```

That block only renders when `class.pdf_storage_path` is set, so a class
with no PDF shows no tag on its view page. That is accepted: without a PDF
there is no gated artifact on the page for the expiry to qualify, and the
profile list still reports the expiry for every unlocked class.

Dates use the existing `date_tz` helper in its bare form — the helper
defaults to the `lll` format and the viewer's local timezone
(`util/handlebars.js:18-26`) — matching how `/library` cards render
`expires_at` (`views/library.handlebars:71`).

## Expired Unlocks

The profile list stays **active-only**, as today. Expired unlocks are
already filtered out at the query level (`unlockedClassRows`), and listing
dead rows adds clutter with no action attached to it — there is no
class-level "buy" or "renew" flow to link to. The library already handles
its own expired state per card. Revisit if users report confusion about
classes disappearing from the list.

## Testing

Follow the standard red-green-refactor cycle.

**Unit — `models/class.test.js`:**

- `getEffectiveClassUnlock` returns `{ unlocked: false, expiresAt: null }`
  with no active rows.
- A single temporary row returns that row's `expires_at`.
- A permanent row in the family beats a temporary one → `expiresAt: null`,
  `unlocked: true`.
- Two temporary rows in one family → the **later** `expires_at` wins.
- `getUnlockedClasses` attaches `unlock_expires_at` per class, `null` for
  permanent unlocks, and applies family resolution across the user's rows.
- `getUnlockedClasses` degrades to the row's own `expires_at` when
  `fetchClassFamilyRows` returns `null`.

**View — `views/class-view.test.js` (exists) and `views/profile.test.js`
(new, following the same render-and-assert pattern as the other view tests):**

- Profile table renders an `Expires <date>` tag for a class with
  `unlock_expires_at`, and an empty Access cell without one.
- Class view renders the `Access expires` tag when `unlockExpiresAt` is set
  and the PDF is accessible, and omits it otherwise.

**Regression:** the existing `models/class-unlock-family.test.js` covers the
family semantics `isClassUnlocked` relies on; it must stay green through the
`activeUnlockRows` and `isClassUnlocked` refactor.
