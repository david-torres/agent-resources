# Rules-PDF Class Unlocks — Design

**Date:** 2026-08-07
**Status:** Approved
**Base:** `virtual-party-tool`

## Problem

Owning a rulebook grants no classes. `rules_pdf_unlocks` and `class_unlocks`
are independent systems: `canViewRulesPdf` (`models/rules.js`) gates PDF
viewing, `isClassUnlocked` / `getUnlockedClassIdsForUser` (`models/class.js`)
gate class access, and neither consults the other. A user granted
"Enclave: Advent" gets the PDF and nothing else, even for the core classes
printed in that book.

Two structural gaps stand in the way of closing this:

- **`rules_pdfs` has no ruleset.** Its columns are `title` and `edition`, and
  `edition` holds the *version* (v1/v2), not the ruleset. Which ruleset a book
  covers exists only inside the title string. Meanwhile `classes.rules_edition`
  is the real ruleset enum (`advent` | `aspirant`).
- **There are no Aspirant classes.** `buildRow` in `util/seed-classes.js`
  stamps `rules_edition: 'advent'` on every seeded row, including
  `aspirantPreviewClassList`. Those six classes are Advent rows with
  DB-generated ids.

## Decision

A valid rules-PDF unlock grants the **core class roster of that book's
ruleset**, computed on read.

- Scope: the core roster only — not every class in the ruleset, and not
  player-created classes.
- Roster source: the existing starter set becomes the Advent core roster; a
  parallel list is added for Aspirant.
- Ruleset source: a new `rules_edition` column on `rules_pdfs`.
- Derived access is never materialized. Revoking or expiring the book revokes
  the classes; roster changes apply retroactively.
- Version scope: granted core ids run through the existing same-edition family
  expansion (`util/class-family.js`), so a core grant covers a class's v1 and
  v2 forks exactly as a direct class unlock already does. It never crosses
  advent ↔ aspirant.

## Architecture

### Schema

One migration:

```sql
ALTER TABLE rules_pdfs
    ADD COLUMN rules_edition text NOT NULL
        CHECK (rules_edition IN ('advent', 'aspirant'))
        DEFAULT 'advent';
```

Existing rows backfill from title (`'Enclave: Aspirant'` → `aspirant`, else
`advent`). The `advent` default keeps the insert paths in `models/rules.js`
and `util/seed-rules-pdfs.js` valid unchanged; the admin PDF form gains a
ruleset select so new books are set deliberately rather than defaulted.

### Pure core (no DB, unit-testable)

`util/starter-content.js` — `STARTER_CLASS_UNLOCKS` is replaced by:

```js
const CORE_CLASS_UNLOCKS = {
  advent:   { Gunslinger: '…', Illusionist: '…', Librarian: '…',
              Thane: '…', Thunderbird: '…', Wanderer: '…' },   // existing ids
  aspirant: { Berserker: '…', Freerunner: '…', Infiltrator: '…',
              Samaritan: '…', Vessel: '…', Witchhunter: '…' },  // newly minted
};
```

The Advent ids are the current starter ids, unchanged. The Aspirant ids are
six UUIDs minted once at implementation time and recorded here; they become
the seed ids for those rows (see *Seed*).

`util/book-classes.js`:

- `coreClassIdsForEditions(editions)` → `Set<id>`
  Union of the rosters for the given rulesets. An unknown ruleset contributes
  nothing rather than throwing.

### Integration (`models/class.js`)

`services/rules/repository.js` gains:

- `fetchActiveBooksForUser(userId, nowIso)` → `{ rules_edition, title }` rows
  reachable through the user's non-expired `rules_pdf_unlocks` rows, via the
  admin client. `is_active` is deliberately not filtered: a retired edition of
  a book still identifies the ruleset the user owns. The title comes back
  because the badge needs it; where a user holds several versions of a book,
  the titles are identical by construction (`rules_pdfs` versions share a
  title), so any row for that ruleset serves.

`models/class.js` gains one resolver that all unlock reads route through:

- `getEffectiveClassUnlocks(userId)` → `{ ids: Set<id>, sourceById: Map }`
  1. Fetch direct unlock ids (existing query) and the user's books.
  2. Map rulesets through `coreClassIdsForEditions`.
  3. Union both sets, then expand through `expandIdsToFamilies`.
  4. Tag each id: `direct` for ids in the direct set, otherwise
     `{ source: 'book', title }` carrying the granting book's title.

The three existing entry points become thin consumers:

- `isClassUnlocked(userId, classId)` — resolve the class's version family,
  return whether it intersects `ids`. Replaces the targeted `.in()` query; at
  these table sizes the extra fetch is irrelevant.
- `getUnlockedClassIdsForUser(userId)` — return `ids`.
- `getUnlockedClasses(userId)` — hydrate rows for `ids` and attach the source
  tag.

Callers pick the change up with no edits: the character-form class dropdown
(`filterClassDataForUser`), class-view teaser gating, `canViewClassPdf`, and
agent access (`resolveClassAgentAccess`).

### Display

`getUnlockedClasses` now returns derived classes alongside direct ones, so the
profile / my-classes view renders a badge for `book`-sourced entries —
"Included with Enclave: Advent". Direct unlocks render as they do today. This
reverses the version-family design's decision to leave the profile page
showing direct grants only: with a book conferring classes, a list of direct
grants no longer matches what the user can play.

A second display change follows from routing `getUnlockedClasses` through the
shared resolver: `ids` is family-expanded, so a direct v1 unlock now also lists
the class's v2 fork, which the profile page previously hid. That is correct —
the user can already play it — but it is a visible change beyond book-derived
classes, and reviewers should expect it.

### Starter grant

`grantStarterUnlocks` (`models/profile.js`) grants only the Advent v1 PDF. The
`grant_starter_class_unlocks` RPC call, the `STARTER_CLASS_IDS` constant, and
the SQL function itself are deleted — the six classes now derive from the PDF
grant, with the same 30-day expiry, so behaviour is unchanged. This also
removes the FK-violation footgun documented at the top of
`util/starter-content.js`, since the grant no longer references class ids.

### Seed

`buildRow` takes the ruleset as a parameter. `aspirantPreviewClassList` seeds
as `rules_edition: 'aspirant'` with the fixed ids from
`CORE_CLASS_UNLOCKS.aspirant`, mirroring how the Advent six already resolve
their ids from the constant. `util/seed-rules-pdfs.js` sets
`rules_edition: 'advent'` on the seeded "Enclave: Advent" row explicitly.

## Semantics

- **Expiry:** a book grants its roster while some `rules_pdf_unlocks` row for
  that ruleset is unexpired. Derived access lapses with it; an independent
  direct unlock on the same class survives.
- **Revocation:** deleting the PDF unlock removes derived class access on the
  next read. No cleanup step.
- **Cross-ruleset:** an Advent book grants nothing Aspirant, and vice versa.
- **Roster changes:** editing `CORE_CLASS_UNLOCKS` changes what every existing
  book holder has access to, immediately and retroactively.
- **Player-created classes** are unaffected; they remain individually gated.

## Error handling

Log and degrade, matching the codebase idiom — never throw into the request
path:

- Book-editions query fails → effective unlocks fall back to direct ids only.
  The user loses derived access for that request rather than seeing an error.
- Class projection fails → family expansion is skipped, as today.

## Testing (TDD)

Pure core:

- `coreClassIdsForEditions([])` → empty; `['advent']` → the six Advent ids;
  `['advent','aspirant']` → all twelve; unknown ruleset → empty.
- Union and tagging: an id in both direct and book sets tags `direct`; a
  book-only id tags `book` with its title.

Model level (stubbed repository):

- A user with only an Advent book unlock passes `isClassUnlocked` for a core
  Advent class.
- An expired book unlock does not.
- An Advent book does not unlock an Aspirant core class.
- A direct unlock still resolves when the user holds no book.
- A book grant covers the v2 fork of a core class.
- `getUnlockedClasses` returns book-derived classes tagged with the book title
  and direct unlocks tagged `direct`.
- Book query failure degrades to direct-only rather than erroring.

## Deployment

The Aspirant ids in `CORE_CLASS_UNLOCKS` must match the Aspirant class rows in
production if any already exist there. Before deploying, query production for
classes named in `aspirantPreviewClassList` and reconcile: adopt the existing
ids into the constant if the rows are present, otherwise seed them with the
minted ids.

## Amendment (2026-08-08): `book_type`

Found in whole-branch review, before merge. The *Schema* section above lets
`rules_edition` do double duty: name the ruleset a book belongs to, and imply
the book confers that ruleset's six core classes. Those are different facts.
A supplement, GM screen, or adventure module for Advent is legitimately
`rules_edition: 'advent'` and must grant nothing — but the migration above
defaults every existing row to `'advent'`, so on deploy every such PDF would
have started conferring six classes.

`rules_edition` keeps its meaning for every book. A second migration adds:

```sql
ALTER TABLE rules_pdfs
    ADD COLUMN IF NOT EXISTS book_type text NOT NULL
        CHECK (book_type IN ('core', 'supplement'))
        DEFAULT 'supplement';
```

The `'supplement'` default is load-bearing: a book grants nothing until
someone marks it core, so the migration cannot hand out classes by accident.
Only the two known core rulebooks are promoted, by exact title.

Consequences elsewhere:

- `fetchActiveBooksForUser` returns only `book_type = 'core'` books. The
  filter targets the embedded `rules_pdfs` resource, so it is qualified with
  the embed alias and the embed is `!inner`.
- The admin library form gains a Type select on both the create and edit
  forms, and both write handlers validate/persist it the way they already do
  `rules_edition`. Unset or unrecognised is a 400, never a default.
- `util/seed-rules-pdfs.js` marks the seeded "Enclave: Advent" row core
  explicitly.

*Deployment* above is unchanged but gains a second reconciliation: confirm
which production `rules_pdfs` rows are core rulebooks and that the title
match promoted them. A missed title leaves the book a supplement, which
grants nothing — the same as production behaves today, so the failure
direction is safe.

## Out of scope

- Selling or granting books per-ruleset in the UI beyond the admin form's new
  ruleset select
- Making class unlocks confer PDF access (the reverse direction)
- Moving the core roster into the database
- RLS changes
