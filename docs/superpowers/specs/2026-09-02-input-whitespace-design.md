# Input Whitespace Normalization — Design

**Date:** 2026-09-02

## Problem

Leading and trailing whitespace on user-entered text reaches the database and
silently breaks name-keyed lookups. Measured against a 2026-09-02 production
copy:

| | |
|---|---|
| Scalar text values with leading/trailing whitespace | 230, across 20 columns |
| `classes.abilities[].name` / `classes.gear[].name` | 7 |
| JSONB item descriptions | 5 |
| **Character rows already rendering wrong because of it** | **43** |

The 43 are the live cost and nobody has reported them, because the failure is
invisible: `Shonen`'s gear is stored as `Gi ` and `Training Weights ` in
`classes.gear`, 24 character rows hold the trimmed spelling, and the read-side
merge at `services/character/repository.js:100-111` joins with
`a.name === ability.name` — untrimmed. The join misses, no description is
attached, and the sheet renders as though the item never had one. Same for
`Oddball`'s `Captain Obvious ` and `Head in the Clouds ` (18 rows) and
`Onmyōji`'s `Kuji-kiri {…} ` (1 row).

It also produces spurious mismatches in every name-keyed tool: `classes.name`
holds `Zoologist ` and `Onmyōji `, so a name lookup reports the row as absent —
which is how the pre-release import's loader nearly created a duplicate
Zoologist.

## Why it keeps coming back

The fix has been applied before, in one place only.
`services/character/input.js` already trims: `normalizeClassItems` (`:40-57`)
and `normalizeNamedJsonbList` (`:21-38`) both call `.trim()`. That is precisely
why `class_abilities.name` and `class_gear.name` have **zero** defects today.

Nothing else does. `services/class/input.js` (`:5-9`) only calls
`sanitizeUrlFields(data, ['image_url'])`. `services/mission/input.js` and
`services/lfg/input.js` normalize nothing textual. And several tables are
written from models with no input layer at all — `models/profile.js`,
`models/pages.js`, `models/rules.js`, `models/nav.js`,
`models/offscreen-mission.js`.

So the rule exists, is correct, and covers one of six write paths. The
recurrence is a coverage problem, not a logic problem.

## Approach

Normalization at the application input boundary, with no database constraint or
trigger. This is a deliberate choice by the project owner; the trade-off is
recorded here because it shapes the design: **coverage is the entire guard.**
Anything that writes outside a normalized path reintroduces the defect
silently, so the design optimizes for leaving no path unnormalized and for
making the remaining failure mode harmless.

### 1. One recursive helper, not a field list

`util/trim-input.js` exports `trimStrings(value, { exempt = [] })`, which walks
plain objects and arrays and trims every string it finds.

A per-field allowlist is what rotted last time: `classes.name` was never on
one, and a new column is added without anybody remembering to register it. A
blanket walk has no list to keep in sync — a new column is covered the day it
is added.

Trimming prose as well as identifiers is safe. Every one of the 230 values was
inspected: only four have leading whitespace at all, and the single value
beginning with four spaces (`missions.statement`) is stray indentation before a
blank line, not a Markdown code block. The `exempt` option exists for a field
that later proves to need it; it starts empty.

### 2. Applied at every write path

| Path | Change |
|---|---|
| `services/class/input.js` | `trimStrings` in `normalizeClassInput` — the actual bug |
| `services/mission/input.js` | `trimStrings` in `normalizeMissionInput` |
| `services/lfg/input.js` | `trimStrings` in `normalizeLfgInput` |
| `services/character/input.js` | `trimStrings` at the top of the pipeline; the existing per-item `.trim()` calls become redundant and are removed |
| `models/profile.js` | trim before update — no service input layer exists |
| `models/pages.js`, `models/rules.js`, `models/nav.js`, `models/offscreen-mission.js` | same |

`services/feedback/input.js` already normalizes thoroughly (`:34-42`) and is
left alone.

### 3. The read side stops caring

With no database guarantee, the merge that produced the 43 broken rows is made
whitespace-insensitive: `services/character/repository.js:57-67` and `:100-111`
compare trimmed names on both sides. The write-side map in
`models/class.js:480,491` already trims its keys; this makes the two ends agree.

This is the part that matters most under an app-only guard. Normalization stops
new defects; this makes a defect that slips through cosmetic rather than
silently destructive.

### 4. One-time cleanup

A migration trims the 242 existing values — all scalar text columns in `public`,
plus `name` and `description` inside the `classes.abilities` and `classes.gear`
arrays. Because `class_abilities.name`/`class_gear.name` are already clean,
trimming the class side alone repairs all 43 broken character rows.

## Non-Goals

- Database CHECK constraints or triggers. Considered and declined.
- Collapsing internal whitespace. Only leading and trailing are in scope.
- Case or diacritic normalization for lookups. Separate concern.

## Verification

A migration-time assertion re-runs the scan and reports zero remaining
untrimmed values, and an integration test pins that: it walks every text column
in `public` plus the JSONB item names and fails if any value differs from its
trimmed form. That test is the thing that will notice the seventh write path
nobody thought of.
