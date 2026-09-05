# Pre-Release Class Import — Design

**Date:** 2026-09-02
**Source document:** `Current_Pre-Release_Classes__Aug__2026_.pdf` (80 pages, "Last Updated: August 30th, 2026")

## Problem

The August 2026 pre-release bundle carries editing and balance updates for
every ENCLAVE pre-release class, plus one class the app has never published
(Drachentöter). The app's `classes` table stores class content as three
free-text markdown blobs (`description`, `teaser`, `tips`) plus two JSONB
arrays whose elements are only `{ name, description }`. The document carries
substantially more structure than that shape can hold, so importing it as
markdown would throw away most of what it says.

## Hard constraint

**The document's text is copied verbatim. No word of it is edited, rephrased,
summarized, corrected, or reordered.** Structure may be *added* (which field a
run of text lands in, which label pairs with which value); the text itself is
transcribed exactly, including its typography — curly quotes, en dashes in
`Low–High`, `ō`/`ö`, `❖`/`➢` bullet glyphs.

This constraint is enforced mechanically, not by care: see "Verification"
below. Nothing is written to a database until the token diff is empty.

## What the document contains

19 classes in three sections:

| Section | Count | Classes |
|---|---|---|
| PCCs | 10 | Beastmaster, Bogatyr, Brainiac, Drachentöter, Greybeard, Lithomancer, Oddball, Raubritter, Shōnen, Zoologist |
| Exclusives | 3 | Ardent, Offdriver, Squire |
| Aspirant Classes | 6 | Berserker, Freerunner, Infiltrator, Samaritan, Vessel, Witchfinder |

Every class has an identical skeleton, verified across all 19:

- A stat line, in one of four printed forms: `+A, +B, +C*` (10 classes),
  `++A, +B` (3), `++A/+B` (6, the Aspirant section), `++A*` (1, Brainiac).
- A `*` footnote explaining personality-trait selection. Brainiac's differs
  from the other nine.
- An epigraph and its attribution.
- Three body paragraphs: identity ("You are a…"), Conduit guidance
  ("Conduits designing a mission for you…"), and grounding ("Grounded in…").
- An examples list under a per-class heading — **19 distinct phrasings**
  ("Examples from history and pop culture include:", "Examples from faith,
  folklore, & pop culture include:", …). The heading is class data, not
  boilerplate.
- A tips list under either "Quick Tips" (17) or "Tips on Playing a/an X" (2:
  Raubritter, Ardent).
- `Challenge Level: Low | Mid | High`.
- A designer credit ("Design by …") on the 13 PCC and Exclusive classes; the
  six Aspirant classes have none.
- Exactly 3 abilities and exactly 6 signatures (3 Default, 3 Elective).

Per ability (57 total) and per signature (114 total):

- A name and a description.
- A stat table: ordered label/value pairs. **49 distinct labels** appear
  across the document — Essence Cost (56 occurrences), Cooldown (53),
  Duration, Max Duration, Range, Delay, Quantity, Uses, Ammunition, Wealth
  Cost, Stamina Cost, Weapon Quality, Nimbleness, and ~25 distinct `X Boost`
  variants. Values come from a closed vocabulary: `Low`, `Mid`, `High`,
  `Low–Mid`, `Mid–High`, `Low–High`, and counts (`1x`–`5x`).
- Abilities only: a `Paired Action:` line. Exactly 57 of them, one per
  ability, no exceptions.
- Bullets nesting exactly two levels (❖ → ➢). 476 top-level, 114 nested,
  zero third-level.

The 49-label count is the reason stat tables are modelled as an ordered array
of `{ label, value }` and not as fixed columns: fixed columns could not hold
them without renaming labels, which the hard constraint forbids.

## Data model

### New columns on `classes`

| Column | Type | Source |
|---|---|---|
| `challenge_level` | `text`, `CHECK IN ('Low','Mid','High')` | "Challenge Level: Mid" |
| `stat_line` | `text` | the printed `+Stat` line, verbatim |
| `stat_note` | `text` | the `*` footnote |
| `quote` | `text` | the epigraph |
| `quote_source` | `text` | its attribution |
| `overview` | `text` | body paragraph 1 |
| `conduit_notes` | `text` | body paragraph 2 |
| `grounding` | `text` | body paragraph 3 |
| `examples_heading` | `text` | the per-class list heading |
| `examples` | `jsonb` array of strings | the ❖ list |
| `tips_heading` | `text` | "Quick Tips" / "Tips on Playing an Ardent" |
| `designer` | `text` | "Design by …", null for the Aspirant six |
| `prerelease_section` | `text`, `CHECK IN ('pcc','exclusive','aspirant')` | the section the class sits in |

`tips` (existing) holds the tips bullets. `stat_spread` (existing) holds the
parsed form of `stat_line`.

### `description` is dropped

The prose it held is now `quote`/`quote_source`/`overview`/`conduit_notes`/
`grounding`/`examples`, which are the real fields. Keeping an assembled copy
alongside them would be duplicate state that drifts the moment an admin edits
one and not the other. Every reader is migrated to the parts.

Production `description` values also carry a `## Class Overview` block with
Combat/Social/Utility ★ ratings that does not appear in the new document.
`challenge_level` is the difficulty signal the document actually provides, and
the ★ block is not carried forward.

### Ability and signature elements

Extended additively inside the existing `abilities` / `gear` JSONB columns, so
`name` and `description` keep working for every current reader:

```json
{
  "name": "Sic 'Em!",
  "description": "Prompt one or more beasts under your control to fearlessly attack a target, dashing a Low distance at incredible speed to do so.",
  "paired_action": "Indicate your target and give a signal to strike.",
  "meters": [
    { "label": "Essence Cost", "value": "Low" },
    { "label": "Cooldown", "value": "Low" }
  ],
  "notes": [
    { "text": "If the target remains undefeated after a Low Duration, this Ability's Cooldown is prolonged to Mid, and affected beasts become demoralized while this Ability is on Cooldown.", "children": [] },
    { "text": "May target a single beast not under the user's control to compel it to abruptly lash out at whoever is nearest to it (without dashing), whether an ally to it or not.", "children": [] }
  ]
}
```

Signature elements are the same shape minus `paired_action`, plus
`"category": "default" | "elective"`.

`meters` is ordered as printed. `notes[].children` is the ➢ level; it is
always present and always an array (empty when there are no sub-bullets), so
templates never branch on undefined.

`category` retires the positional first-3/last-3 convention currently relied
on by `views/class-view.handlebars:183,200` and `util/class-export.js:88-90`.
Array order is still preserved as printed, but display no longer infers
meaning from index.

### Dead columns

`class_abilities` (the per-character copies) has `essence_cost`, `cooldown`,
and `duration` columns that **no application code reads or writes** — a grep
for `essence_cost` across `routes/ models/ services/ util/ views/ public/`
returns nothing. They are removed; the class-level `meters` array is where
this data now lives, and it carries all 49 labels rather than three.

## Import decisions

- **Overwrite in place.** All 15 classes that already exist are updated on
  their current rows; no `dup_class` forks, no new `rules_version`. Existing
  characters see the revised text immediately. The prior state is recoverable
  only from the pre-import backup, which is taken first.
- **The Aspirant six are overwritten on their existing rows**, and
  **Witchhunter is renamed to Witchfinder**. Those rows keep
  `rules_edition = 'aspirant'` and their UUIDs, which are hardcoded in
  `util/starter-content.js` `CORE_CLASS_UNLOCKS` as the Aspirant book roster —
  renaming is UUID-safe for grants. Two name-keyed systems must be updated in
  the same change: `util/enclave-consts.js` `aspirantPreviewClassList` /
  `classStatSpread`, and `util/starter-content.js`'s roster key.
- **Four classes need rows created or published:** Ardent, Offdriver and
  Squire do not exist; Drachentöter exists with `is_public = false` and stub
  content. All four are created/filled with `is_public` left as-is for the
  owner to flip deliberately.
- **`teaser` is not touched.** The document contains no teaser text, and the
  existing hand-written teasers are the class-list copy.
- **The other ~28 production class rows are not touched.** They do not appear
  in the document.

## Extraction

`pdftotext -bbox-layout` emits per-word coordinates. Column bands on the
ability/signature pages are unambiguous and were confirmed by spiking page 4:

| Band (`xMin`) | Meaning |
|---|---|
| ≈ 75.8 | ❖ top-level bullet |
| ≈ 102.8 | ➢ nested bullet |
| ≈ 92.3 | "Paired Action:" label |
| ≈ 168.8 | paired action text |
| 99–168 (narrow) | ability / signature name |
| ≈ 198 | description column |
| ≈ 421.5 | meter label |
| 491–503 | meter value |

Bands are derived per page by clustering observed `xMin` values rather than
hardcoded, so a page whose table is laid out slightly differently still
resolves. Rows within a table pair label to value by matching `yMin`.

Because every string is lifted from the PDF's own word stream, no text is ever
retyped.

## Verification

A harness runs before any database write and gates it:

1. Normalize the raw `pdftotext` output for a class's page range into a token
   stream (whitespace collapsed, bullet glyphs and page furniture stripped).
2. Normalize every extracted field for that class into a second token stream.
3. Assert the two are equal as multisets, and report any token appearing in
   one and not the other.

An empty diff for all 19 classes is the precondition for loading. The harness
also emits a per-class human-readable review file for eyeballing against the
PDF pages.

## Rollout

Local Supabase stack first — load, render, eyeball — then production. A
`bun run db:backup` of production is taken before either run. The loader is
idempotent, keyed on class id (or name for the four new rows), and has a
`--dry-run` mode that prints a per-field diff and writes nothing.

## Character-side impact

Editing a class touches no character row: nothing in `routes/classes.js` or
`models/class.js` reaches `class_abilities` or `class_gear`. The exposure is
latent and fires on the affected character's **next save**.

`save_character_atomic`
(`supabase/migrations/20260815000002_character_created_at_editable.sql:108-120`)
deletes and reinserts every `class_abilities`/`class_gear` row for the
character. Before that, `services/character/service.js:284-302` resolves each
submitted item name through `buildClassContentLookupMaps`
(`models/class.js:457-504`), a global name-only map over every public class. A
name in no class raises `Missing class_id for ability "X"` and the save fails
outright. The edit form re-offers the stale name
(`routes/characters.js:382-393`), so the user submits it in good faith.

Measured against a 2026-09-02 production copy restored locally:

| | |
|---|---|
| Item names vanishing from the whole catalogue | 14 |
| Character rows carrying one | 53 (20 ability, 33 gear) |
| Characters made unsaveable | 43 of 314 holding class content |
| Ability perks attached to a vanishing ability row | 2 |

The names: `Furor`, `Great Axe` (Berserker); `Derive`, `Sportwear`,
`Action Camera` (Freerunner); `Drink the Ichor:`, `Flask of Mead`
(Drachentöter); `Disassemblinator` (Brainiac); `Orbuclum` (Greybeard);
`Animal Crackers` (Beastmaster); `Toolbox` (Bogatyr); `Alter Lights` (Vessel);
`A Good Cause` (Samaritan); `Unverwüstlich (OON - fer - VOOST - leek)`
(Raubritter).

Renames whose name survives elsewhere in the catalogue are benign: the row
still renders (it is the source of truth for `name`), losing only the
description merge at `services/character/repository.js:100-111`.

Remediation is a name remap applied in the same run as the class load, from an
owner-confirmed `docs/data/prerelease-name-remap.json`. Row ids are preserved,
so the two attached perks survive. The underlying resolution bug is specified
separately in `2026-09-02-class-item-resolution-design.md`.

## Out of scope

- The ~28 production classes absent from the document.
- Class artwork; the document's images are not imported.
- Flipping `is_public` on the four unpublished classes.
