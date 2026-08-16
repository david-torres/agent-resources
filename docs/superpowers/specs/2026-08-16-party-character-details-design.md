# Party Character Details — Design

**Date:** 2026-08-16
**Status:** Approved, awaiting implementation plan
**Builds on:** `2026-08-06-virtual-party-tool-design.md`

## Problem

The `/party` roster shows member chips and a stat summary, but nothing about
who a member actually *is*. The feature it was ported from does more:
`views/lfg-post.handlebars:100-158` gives every approved LFG member a Details
toggle revealing stats, abilities, gear (with markdown tooltip descriptions),
and personality. `/party` — which should be growing into a VTT-style tool for
Enclave — has no equivalent.

Porting the LFG panel as-is would also port its two defects:

**The LFG panel is not unlock-gated.** `routes/lfg.js` never redacts
descriptions, and the RLS policies on `class_gear`/`class_abilities`
(`supabase/migrations/20240101000000_baseline_schema.sql:976-989,1019-1032`)
let any viewer — signed out included — read every row belonging to a public
character. So the LFG Details panel shows full ability and gear descriptions
of paid classes to everyone. The rule that descriptions require a class unlock
exists only on the character detail page, as ~80 lines of inline route code
(`routes/characters.js:863-939`) with zero test coverage.

**The display markup is duplicated.** The tooltip-tag pattern (visible name +
hidden markdown div + `data-tooltip-markdown`) exists twice already —
`views/character.handlebars:236-281` and `views/lfg-post.handlebars:121-150`
— and `/party` would make three.

## Goal

Each `/party` roster member gets an expandable Details view with **full
character-sheet scope**: stats, class abilities, signature gear, personality,
v1 perks and additional gear, common items, and v2 quirks, accessories, and
ability perks. Descriptions of class abilities and gear are shown in full only
when the viewer has that class family unlocked.

The rendering, the data assembly, and the unlock gate each live in exactly one
place, shared by `/party`, the LFG post page, and the character detail page.
The LFG post page adopts the shared, gated details — fixing its ungated
description leak — and its inline copy is deleted.

## Non-goals

- **No editing.** Details are read-only. The VTT direction may add state later
  (HP tracking, conditions); this design deliberately stops at display.
- **No change to the unlock model.** `class_unlocks`, version families
  (`util/class-family.js`), and `getUnlockedClassIdsForUser` are used exactly
  as they are.
- **No change to /party membership mechanics.** `?c=` parsing, the 8-member
  cap, the `#party-csv` source of truth, and the panel swap pattern from the
  2026-08-06 design are untouched.
- **No RLS changes.** Row visibility stays as it is; this design gates the
  *description column* at render time, which SQL policies cannot do (RLS is
  row-level only).
- **No gating of character-authored content.** Quirks, accessories, ability
  perk text, common items, and personality traits are the player's own words,
  not class IP. They render whenever the character itself is visible. Only
  ability/gear `description` fields — and only those with a `class_id` — are
  gated, exactly matching current character-page behavior.

## Decisions

Settled during brainstorming.

**Gate by class unlocks, and fix LFG in the same change.** Names are always
shown; full descriptions require the viewer to have the item's class family
unlocked (signed-out viewers see names only). The LFG post page adopts the
same gate rather than keeping its everyone-sees-everything behavior. This is
a user-visible reduction on LFG for signed-out viewers — intended, and worth
a release note.

**The LFG-host exception is preserved.** A host viewing an approved
applicant's details on their own post sees full descriptions regardless of
unlocks — the existing `?lfg=` behavior of the character page
(`routes/characters.js:866-879`), now honored wherever the gate runs.

**Expandable rows, lazy-loaded.** Each roster/member row has a Details toggle
(the LFG Alpine pattern) whose content is fetched on first expand from a
shared fragment endpoint. Chosen over eager per-member fetching (~4 queries ×
8 members and eight sheets of HTML on *every* add/remove panel swap) and over
a widened PostgREST nested select (which would re-implement `getCharacter`'s
assembly — catalog merge, perk sentinels, effective version — in a second,
divergent path; the LFG nested select's missing catalog merge is exactly that
divergence today).

**One fragment endpoint serves both pages.** `/party` and `/lfg` load the
same `GET /characters/:id/details` fragment. The alternative — a party-local
route — would leave LFG needing its own, and the whole point is one gate, one
template, one data path.

**Tooltip element ids gain the character id.** Today's ids
(`#ability-<class_id>-<name>`) collide when two same-class characters appear
on one page — a real case in an 8-member party (two Mages both have every
Mage ability). The shared partial uses `#detail-<character_id>-ability-<name>`
and `#detail-<character_id>-gear-<name>`.

**Expanded state is disposable.** When the party panel swaps on add/remove,
rows re-render collapsed and `hx-trigger="click once"` re-arms, so details
re-fetch on next expand. Membership changed; stale open panels are not worth
preserving. Same reasoning as the existing tooltip re-init on
`htmx:afterSwap` (`public/js/app.js:873-888`).

## Architecture

Three new units, each testable without the ones above it:

```
services/character/description-gate.js
        applyDescriptionGate({ character, profile, lfgPostId, client })
        extracted from routes/characters.js:863-939, behavior-preserving
        ^
        |
routes/characters.js: GET /characters/:id/details        (authOptional)
        getCharacter + class record + gate -> fragment
        ^
        |
views/partials/character-details.handlebars
        full-sheet display partial; loaded lazily by /party and /lfg,
        composed from the same sub-partial the character page uses
```

### `services/character/description-gate.js`

One exported function:

```js
applyDescriptionGate({ character, profile, lfgPostId = null, client })
```

Mutates `character.abilities[].description` and `character.gear[].description`
in place (matching the current inline code) and returns the character.
Behavior is a straight extraction of `routes/characters.js:863-939`:

- No `profile` → every ability/gear description blanked.
- `profile` and `lfgPostId` → fetch the post via `getLfgPost(lfgPostId,
  client)`; if `post.host_id === profile.id` and this character has an
  approved join request on that post, all descriptions stay.
- Otherwise → `getUnlockedClassIdsForUser(userId)` (admin-backed on purpose —
  the shared anon client carries no JWT, so RLS on `class_unlocks` would
  return zero rows); blank the description of any ability/gear whose
  `class_id` is not in the unlocked family set. Items without a `class_id`
  keep their descriptions, as today.
- Any error at any step fails closed: blank everything, never throw.

`routes/characters.js` calls this helper and its inline block is deleted.

### `GET /characters/:id/details`

In `routes/characters.js`, `authOptional`, mounted before the greedy
`/:id/:name?` route. Optional query param `lfg=<postId>`.

1. `getCharacter(id, res.locals.supabase)` — RLS-scoped, so a character the
   viewer cannot see does not come back; respond `404` with a one-line
   fragment ("Character not found").
2. Fetch the class record (as the detail page does at
   `routes/characters.js:841-853`) and derive `effectiveVersion` from
   `rules_version` (`:941`).
3. `applyDescriptionGate({ character, profile, lfgPostId: req.query.lfg,
   client: res.locals.supabase })`.
4. `res.render('partials/character-details', { layout: false, character,
   effectiveVersion, statList })`.

No `HX-Push-Url` — expanding details is not navigation, and per the
load-bearing comment at `views/lfg-post.handlebars:89-99`, no
`hx-history`/`hx-push-url` attributes may appear on or near the toggles.

This route exposes exactly what the character detail page already exposes,
under the same RLS and the same gate: no new surface.

### `views/partials/character-details.handlebars`

The full-sheet display, sections in this order, each omitted entirely when
empty:

| Section | Source | Condition |
|---|---|---|
| Stats | `statList` + `stat-blocks-readonly` | always |
| Class Abilities | `character.abilities` | non-empty |
| Signature Gear | `character.gear` | non-empty |
| Personality | `character.traits` | non-empty |
| Ability Perks (v1) | `character.perks` (markdown) | v1 and present |
| Common Items | `character.common_items` | non-empty |
| Quirks | `character.quirks` | v2 and non-empty |
| Accessories | `character.accessories` | v2 and non-empty |
| Ability Perks (v2) | `character.ability_perks` via `perksForAbility` | v2 and non-empty |
| Additional Gear | `character.additional_gear` | v1 and present, with the Deprecated tag |

Markup mirrors `views/character.handlebars:210-355`, laid out for a fragment
(single column of compact sections rather than page-width boxes).

Abilities and gear render through a new sub-partial:

```
views/partials/character-detail-tags.handlebars
    params: items, idPrefix (e.g. "detail-<character_id>-ability"), tagClass
```

If `description` is truthy: tag + `data-tooltip-markdown="#<idPrefix>-<dashcase
name>"` + hidden markdown div. Else: plain tag. This sub-partial replaces the
inline copies in `views/character.handlebars:236-252` and `:265-281`, so the
tooltip markup exists once. (The character page keeps its own page layout and
its own `#ability-…` id prefix; only the repeated tag/tooltip unit is shared.)

The existing tooltip machinery is untouched: tippy init on load and on
`htmx:afterSwap` (`public/js/app.js:763-801,873-888`) already covers
fragments arriving via htmx.

### `/party` page changes

`views/partials/party-roster.handlebars` grows from chips into member rows:

- Header: name linked to `/characters/<id>`, class and level, the existing
  lock (private) and skull (deceased) markers, the existing Remove button.
- A **Details** button: Alpine `x-data="{ open: false }"`,
  `@click="open = !open"`, plus `hx-get="/characters/<id>/details"`,
  `hx-trigger="click once"`, `hx-target` an empty container div inside the
  row, `hx-swap="innerHTML"`. First click loads; later clicks toggle
  `x-show`. No `hx-include`, no push-url — this request does not touch
  membership.

`getPartyCharacters` (`models/character.js:319-334`) adds `level` to its
select so the header can show it. Nothing else in the /party data path
changes; the panel swap payload stays as light as it is today.

### LFG post page changes

- `views/lfg-post.handlebars:108-157` — the inline stats/abilities/gear/
  personality panel — is **deleted**, replaced by the same lazy container
  pattern, with `?lfg={{post.id}}` on the fragment URL so the host exception
  applies. The Details button keeps its Alpine toggle and the `:89-99`
  comment stays.
- `models/lfg.js:119-137` — the nested `personality:traits`,
  `abilities:class_abilities`, and `gear:class_gear` selects are dropped; the
  panel was their only consumer. Stats stay (the party summary needs them).

Net user-visible changes on the LFG post page, both intended: Details gains
the full-sheet scope, and descriptions become unlock-gated for non-host
viewers.

## Changes to existing code

| File | Change |
|---|---|
| `routes/characters.js` | Add `GET /:id/details` (before `/:id/:name?`). Replace the inline gate block `:863-939` with a call to `applyDescriptionGate`. |
| `services/character/description-gate.js` | New. The extracted gate. |
| `views/partials/character-details.handlebars` | New. Full-sheet fragment. |
| `views/partials/character-detail-tags.handlebars` | New. Shared tag/tooltip unit. |
| `views/character.handlebars:236-252,265-281` | Replace inline ability/gear markup with `character-detail-tags`. |
| `views/lfg-post.handlebars:108-157` | Delete inline panel; lazy-load the fragment with `?lfg=`. |
| `models/lfg.js:119-137` | Drop nested traits/abilities/gear selects. |
| `views/partials/party-roster.handlebars` | Chips → rows with Details toggle + lazy container. |
| `models/character.js:319-334` | Add `level` to `getPartyCharacters`' select. |

No migration. No RLS change. No new nav entry (`/party` already has one).

## Testing

Repo tiers per `scripts/run-tests.mjs` (new http-tier files must be added to
its `httpFiles` set).

**`services/character/description-gate.test.js`** (unit) — the gate carries
the security behavior, so it gets the densest coverage:

- Signed out: every ability and gear description blanked.
- Signed in, class family unlocked: descriptions intact.
- Signed in, class family locked: blanked; items with no `class_id` intact.
- Host of the referenced post with the character approved: all intact.
- Host of the post but character not approved (or pending): gated normally.
- `lfgPostId` for a post the viewer does not host: gated normally.
- `getLfgPost` or `getUnlockedClassIdsForUser` throwing: everything blanked,
  no throw (fail closed).

**`routes/characters` http tests** (extend existing file):

- `GET /characters/:id/details` for a visible character returns the fragment
  with `layout: false` (no `<nav>`).
- Invisible character (RLS empty) → 404.
- Signed out: a locked class's description text absent from the HTML, name
  present.
- `?lfg=` with the viewer as host of an approved applicant: description
  present. This closes the existing zero-coverage gap on the gate,
  now via the extracted helper.

**`views/partials/character-details.test.js`** (render, matching the
existing bare-Handlebars pattern):

- Each section renders when populated; absent from the HTML when empty.
- v1 shows perks/additional-gear sections; v2 shows quirks/accessories/
  ability-perks; never both.
- Tooltip ids contain the character id — regression guard for the same-class
  collision fix.
- Gated item (empty description) renders a plain tag with no
  `data-tooltip-markdown`.

**`views/lfg-post.test.js`** — re-point the details assertions: the inline
abilities/gear markup is gone; the Details button and the fragment URL with
`?lfg=` are present.

**E2E:**

- `17-virtual-party.spec.js`: add a member, click Details, assert ability
  names appear and the URL did not change.
- `14-lfg-controls.spec.js`: update the `[id^="character-details-"]` count
  for the lazy pattern; the history-snapshot regression (`:700-730`) must
  stay green — it is the guard for the `:89-99` comment.

## Risks

**LFG loses visible content for signed-out users.** Descriptions they can
read today disappear behind sign-in + unlock. Intended (it closes a paid-
content leak), but it is a product change on a page nobody asked to change —
release-note it.

**Expand latency.** First expand costs one round-trip and `getCharacter`'s
~4-5 queries. Acceptable for a click; the lazy design exists so this cost is
never multiplied by 8 on a panel swap.

**Route ordering.** `/characters/:id/details` must be mounted before the
greedy `/characters/:id/:name?` route or it will be swallowed as
`name="details"`. The http test asserting the fragment (no `<nav>`) catches
a mis-ordering.

**Extraction fidelity.** The gate is security-relevant inline code being
moved. Mitigation: the extraction is behavior-preserving by construction, and
the unit tests above encode the old behavior — including the fail-closed
paths — before anything depends on the helper.
