# Aspirant V1: V1 ingestion

Status: approved design, not yet planned.
Branch: `aspirant-v1-classes-and-characters`.

## Place in the stack

Slice 3 of the five-slice ENCLAVE: Aspirant V1 stack described in
`docs/superpowers/specs/2026-09-12-aspirant-class-content-contracts-design.md:6-20`:

1. Class-content contracts — landed
2. Aspiring persistence — landed
3. **V1 ingestion** — this document
4. Character economy (enchantments, mods, Merx)
5. Stat caps and traits

Slice 1 built the class-content contracts and slice 2 the character-side
columns. Neither put any content in them. `ENCLAVE___Aspirant_V1.pdf` — 172
pages, twelve classes — is the content, and this slice is how it gets in.

Slice 1 also deferred one contract into this slice: gear `column` and
`position`, the four-column Signature layout
(`docs/superpowers/specs/2026-09-12-aspirant-class-content-contracts-design.md:162-170`).
It lands here because the book is what gives it meaning.

## Problem

Nothing in the repo holds V1 content. The only checked-in class data is
`docs/data/prerelease-classes-2026-08.json`, whose six `ASPIRANT CLASSES`
records carry six gear items and three abilities each — the Advent shape — with
no `advanced_abilities`, `sample_perks` or `default_enchantment` keys. The
loader says so itself at `scripts/load-prerelease-classes.mjs:102-108`.

Four things block ingestion.

**`rules_edition` answers two questions at once.** It records both *which book
grants this class* and, by assumption, *what shape its content is*. For every
class so far those answers coincided. The six pre-release Aspirant classes are
the first rows where they diverge: `20260818000000_retag_aspirant_classes.sql`
deliberately tagged them `aspirant` so the unlock resolver and the family
firewall would reach them, but their content is Advent-shaped. V1 makes that
divergence permanent — the book contains both an Aspirant Gunslinger and a
twelve-signature Berserker, and the catalog has no way to say which rows are
which shape.

**The loader cannot fork and would destroy content if run.** Its `abilities` and
`gear` payloads are whole-column replacements copied verbatim from the artifact
and applied with a plain `.update()` (`scripts/load-prerelease-classes.mjs:354-355`),
so running it against a class carrying sample perks or enchantments strips them.
It never writes `rules_edition` — the field is excluded from `FIELDS`, so a new
row lands on the column default `'advent'`, which is precisely the defect the
retag migration had to repair by hardcoded UUID. And nothing in the pipeline
ever sets `base_class_id`; `test/load-prerelease-classes.test.js:31` asserts it
is absent from every payload. The original design ruled forks out in as many
words: *"Overwrite in place. All 15 classes that already exist are updated on
their current rows; no `dup_class` forks, no new `rules_version`."*

**The extractor cannot read this book.** See "The extractor" below; the
differences are structural, not parametric.

**The verifier does not run at all.** `CHARLATAN` was appended to the artifact by
hand in `e55f998` with no `page_range` key, and `sectionPages` computes
`Math.max(...rows.map(row => row.page_range[1]))`, so
`scripts/verify-prerelease-extract.mjs` throws before verifying anything. Stage 2
has been dead since that commit and Charlatan was never gated by it.

## What the book contains

Twelve classes, six pages each, contiguous, no interstitial pages. PDF page =
printed page + 5.

| offset | page | contract field |
| --- | --- | --- |
| +0 | Cover — stat line, quote, three prose paragraphs, Examples, Quick Tips, Challenge Level | `stat_line`, `quote`, `overview`, `conduit_notes`, `grounding`, `examples`, `tips`, `challenge_level` |
| +1 | Core Abilities ×3 | `abilities` |
| +2 | Signature spread, left — columns 1–2 | `gear[0..5]` |
| +3 | Signature spread, right — columns 3–4 | `gear[6..11]` |
| +4 | Advanced Abilities ×3 | `advanced_abilities` |
| +5 | Expanded Tips — Player / Conduit | `expanded_tips` (new) |

The roster is the Advent base six (Gunslinger, Illusionist, Librarian, Thane,
Thunderbird, Wanderer) followed by the six pre-release Aspirant classes
(Berserker, Freerunner, Infiltrator, Samaritan, Vessel, Witchfinder). The book
spells it **Witchfinder**; the string `Witchhunter`, which
`scripts/load-prerelease-classes.mjs:44` aliases to, does not occur.

Structural marker counts confirm the shape with no exceptions: 144
`Default Enchantment` headings (12 × 12 signatures), 72 `Paired Action:` labels
and 72 `(Compounded)` blocks (12 × 6 abilities), 53 `In Honor of` dedications.
Slice 1's contract was designed correctly against this book.

**The upgrade is additive.** For Berserker all three pre-release ability names
survive as Core Abilities in the same order, all six gear names survive in
columns 1 and 2 in the same order, and the book states the mapping normatively
on printed p. 2:

> Treat the first column on the first page of Signatures as the Class's Default
> Roster. Treat the second column on the first page of Signatures as the Class's
> Elective Roster.

So the four-column contract is the book's own backwards-compatibility rule, and
`gearCategory`'s positional `default`/`elective` split is column 1 versus
column 2.

Ability and perk prose was edited even where names match, so name survival does
not imply text equality.

## Approach

### Split the edition axis

`rules_edition` keeps exactly one job: which book grants this class. It stays as
it is on all fifty existing rows, so `util/book-classes.js`, `CORE_CLASS_UNLOCKS`
and `20260818000000_retag_aspirant_classes.sql` remain correct and untouched.

A new column answers the other question:

```
classes.content_format text NOT NULL DEFAULT 'advent'
  CHECK (content_format IN ('advent','aspirant'))
```

`advent` is six signatures and three abilities. `aspirant` is twelve signatures,
three core and three advanced abilities, enchantments and sample perks.
Everything shape-sensitive keys off `content_format` rather than inferring shape
from edition: the gear cap at `util/class-import.js:226`, the blank-row count at
`views/class-form.handlebars:735`, the four-column Signature layout, and the
character wizard's advanced-ability read.

The three cases then state themselves:

| row | `rules_edition` | `content_format` | `rules_version` |
| --- | --- | --- | --- |
| Gunslinger (Advent) | advent | advent | v1 → v2 |
| Berserker (pre-release) | aspirant | advent | v1 |
| Berserker (V1) | aspirant | aspirant | v1 |
| Gunslinger (Aspirant V1) | aspirant | aspirant | v1 |

`rules_version` is left alone. It is `CHECK (rules_version IN ('v1','v2'))`
(`supabase/migrations/20240101000000_baseline_schema.sql:132`) and means Advent's
v1/v2 character rules. Forking within `rules_edition = 'aspirant'` would
otherwise have to call V1 content `'v2'`, which inverts the meaning of both
values.

The default is `'advent'`, so every existing row is correct without a backfill.
Only the twelve rows this slice creates carry `'aspirant'`.

### A format fork starts a new family

`sameEditionEdge` (`util/class-family.js:7`) becomes: parent and child share
`rules_edition` **and** share `content_format`.

One rule then covers all three upgrade shapes. Advent Gunslinger → Aspirant
Gunslinger differs on both and starts a new family. Pre-release Berserker → V1
Berserker differs on format and starts a new family. Gunslinger v1 → v2 differs
on neither and stays one family.

This is the rule the product wants: a different rules shape means a different
family, which means moving to it is a deliberate player decision rather than
something that happens underneath an existing character. It also keeps the
library's version collapse (`util/class-list-grouping.js:42`) from folding a
pre-release stub and its V1 successor into one entry.

Four consumers change behavior and must each be covered: unlock expansion
(`models/class.js:147`), a character's own-class visibility
(`services/character/service.js:296`), cross-family name collisions
(`services/class/item-uniqueness.js:12`), and library grouping
(`util/class-list-grouping.js:42`).

**Unlock consequence.** `CORE_CLASS_UNLOCKS.aspirant`
(`util/starter-content.js`) names the six pre-release ids and reaches nothing
else once expansion stops crossing the format boundary. The roster gains the six
V1 Aspirant-class ids alongside the existing six, so nobody loses access to a
class they already have characters on. `util/core-roster.integration.test.js`
pins this map against real rows and moves with it.

### The twelve rows are forks

All twelve V1 classes are created as new rows with `base_class_id` pointing at
the row they descend from:

- The six Aspirant-only classes fork their pre-release row. Same
  `rules_edition`, `content_format` advent → aspirant.
- The six Advent base classes fork their `rules_version = 'v1'` row.
  `rules_edition` advent → aspirant, `content_format` advent → aspirant.

Forking the v1 rather than the v2 row of an Advent class is deliberate: v2 is
itself a fork of v1, and the V1 Aspirant class is a sibling of both rather than a
descendant of either. Its family is new regardless, so the parent pointer records
provenance rather than membership.

No existing row is updated. The 40 characters on the pre-release Aspirant classes
and the 201 on the Advent base six keep their `class_id`, their 350-plus child
rows, and the class content those rows name.

### Contract additions

```
classes.gear[i].column    := 1 | 2 | 3 | 4
classes.gear[i].position  := 1 | 2 | 3
classes.expanded_tips     := { player: [note], conduit: [note] }
```

`column` and `position` are derived from the book's geometry — there is no
printed column index — and are the contract slice 1 deferred. They are always
present, filled by `normalizeGear` on save the way `default_enchantment` and
`meters` already are. An Advent-format class's six items occupy columns 1 and 2
at positions 1–3; an Aspirant-format class's twelve fill all four.

`category` stays derived rather than being replaced, and the rule is restated in
terms of the column: **column 1 is `default`, columns 2–4 are `elective`.** With
three items to a column that is arithmetically identical to
`gearCategory`'s existing `index < BASE_GEAR_COUNT` test
(`util/class-gear.js:115-120`), so every one of the fifty live six-item classes
keeps the category it has today, and the rule extends to twelve items without a
second branch. It also matches the book's backwards-compatibility reading, which
assigns roster meaning to columns 1 and 2 only: under V1 the Default/Elective
split no longer governs play, and `category` survives as the compatibility view
of a four-column roster rather than as a fact about it.

`expanded_tips` is `jsonb NOT NULL DEFAULT '{"player":[],"conduit":[]}'`, matching
the non-nullable treatment slice 1 gave `advanced_abilities`. Each list is a note
tree of the same shape gear and ability notes already use, so `buildNoteTree` and
the existing note normalizers serve it. It is a separate section from the cover's
`Quick Tips`, which continues to fill `tips`; the Expanded Tips page is a second,
GM-and-player-facing section present on all twelve classes, and folding it into
`tips` would lose the Player/Conduit distinction.

The jsonb key censuses at `util/class-gear.js:174-180` and
`routes/classes-structured-fields.test.js:985-994` both describe a pre-Aspirant
catalog and go stale the moment V1 lands. Both are restated.

### Power Ratings are marked up

The book prints Power Ratings as superscripts, mid-sentence, attached to a word:

> their strength, toughness, and speed are Boosted <sup>L–H</sup> and their
> Stamina Costs are greatly reduced <sup>M–H+</sup>

Stored flat they become `Boosted L–H`, where the rating is indistinguishable
from a word. They are stored as `<sup>…</sup>` instead.

`<sup>` is already in `sanitize-html`'s default allowed tags, so
`util/markdown.js#renderMarkdown` passes it through while stripping `<script>`
and event-handler attributes. No sanitizer change is needed.

**A rendering change is needed, and it has a security dimension.** Only
`description` currently goes through `{{{markdown …}}}`
(`views/class-view.handlebars:147,255,275,298,322`). Power Ratings also appear in
`paired_action`, notes, `sample_perks[].text`, `compound_text` and enchantment
descriptions, all of which render with `{{ }}` and would display a literal tag.
Those fields move to `{{{markdown …}}}`.

Class content is writable by any signed-in user through `POST /classes/import`
(`routes/classes.js:227`, `isAuthenticated` only) and the admin form, so this
change starts *interpreting* stored content that is inert today. The sanitizer is
what makes that safe, and the change is therefore covered by an explicit test
that a hostile string in each newly-rendered field is neutralized, not merely by
the existing markdown tests.

`util/class-export.js`, the agent serializer at `models/class.js:382-421`, and
the character-sheet render paths carry the same strings and are checked for the
same literal-tag problem.

### The extractor

`scripts/extract-aspirant-v1-classes.mjs` is a new script rather than a
parameterization of `scripts/extract-prerelease-classes.mjs`. The differences are
structural:

- **There are no bullet glyphs.** The book contains no `❖`, no `➢`, and no bullet
  character of any kind — they are vector art. `isBullet`, `isNoteBlock`,
  `bulletParts`, `stripBullet` and `buildNoteTree`'s glyph handling have nothing
  to match. Note depth comes from x-indent (~19.2pt per level) and note
  boundaries from y-leading, since a wrapped line shares its bullet's `xMin`.
- **Margins mirror recto to verso.** Every column differs by ~11.5pt between
  odd and even PDF pages, so `NAME_COLUMN_MAX_X`, `METER_GUTTER_X`,
  `DESCRIPTION_COLUMN_RANGE` and `BODY_COLUMN_X` are each wrong on half the book.
  Bands are derived per page, per side.
- **Signature pages hold two independent columns.** Six entries per page, three
  per column, with columns that do not share baselines, so sorting by position
  interleaves them. Partition by x-band first, then find entry boundaries within
  a column.
- **The class name is not text on the cover page.** It is outlined art. It comes
  from the running header of offset +1.
- **There are no section headings to key on.** No `Abilities`, `Signatures`,
  `Default` or `Elective` headings exist. A class block is found by the fixed
  six-page cadence, anchored on a cover page: a stat-line-shaped centered string
  near the top and a `Challenge Level:` near the bottom.
- **Core versus Advanced is positional only.** Offset +1 is core, offset +4
  advanced. Nothing on either page says so.
- **Superscripts detach.** `pdftotext` sometimes hoists a Power Rating into its
  own block, dropping it out of its sentence and leaving a stray one-character
  cell that pollutes name-column clustering. The extractor re-threads them by
  baseline and x proximity, which is what makes the marked-up representation
  possible at all.

What survives and is reused: the bbox XHTML parsing, `parseStatLine` unchanged
(the book prints `++Skill, +Sensory`, and the existing splitter already accepts
`,` as well as `/`), `clusterBands`, and the shape of the per-class page walk.

Shared helpers move to `util/aspirant-extract.js` alongside the existing
`util/prerelease-extract.js` rather than into it, so a change made for this book
cannot silently alter the artifact the other book already produced.

Output: `docs/data/aspirant-v1-classes-2026-09.json`.

### The verifier

`scripts/verify-aspirant-v1-extract.mjs` keeps the design that makes the existing
verifier worth having: it re-reads the PDF in a different `pdftotext` mode from
the extractor so the two cannot share a segmentation bug, and it compares
bidirectional token multisets against an exact declared allowance list, so an
allowance that is declared but never observed fails as loudly as an unexpected
token.

`scripts/verify-prerelease-extract.mjs`'s `page_range` crash is fixed first, in
its own commit. This slice depends on that verifier's design being sound, and
shipping a second copy of a gate that has been dead for weeks without fixing the
first would be building on an unverified claim.

### The loader

`scripts/load-prerelease-classes.mjs` gains a fork path rather than a second
loader. Its safety machinery — ambiguity aborts, the character-orphan check, the
non-local `--force` gate, idempotency by structural diff — is the reason to
extend it rather than start again.

Changes:

- `planLoad` currently collapses a match to a single `row` and everything
  downstream branches on its truthiness (`:264-265,:275,:353,:387`). A plan gains
  an explicit disposition — create, update, or fork — rather than an implied one.
- A fork's payload carries `base_class_id`, `rules_edition` and `content_format`.
  `FIELDS` (`:50-53`) and the allowlist test's `FORBIDDEN` list
  (`test/load-prerelease-classes.test.js:31`) both move; `base_class_id` stops
  being forbidden for fork plans specifically.
- `scripts/lib/character-impact.mjs#projectImport` (`:52-61`) models exactly two
  post-import shapes, updated and created. A fork is neither: the base row
  survives unchanged and keeps its item names while the fork adds new ones. The
  projection gains the fork shape, which is what keeps the orphan check honest —
  without it the check would be trivially satisfied, since forking orphans
  nothing by construction.
- `rowByName` (`:387-388`) maps payload name to row for the publish step and goes
  ambiguous once a base and its fork share a name. Publishing keys on the plan,
  not the name.

The artifact and remap paths are module constants (`:37-39`) repeated as literals
across five files with no shared constant. They become a per-book descriptor so
the second book does not add a sixth copy.

### Re-tagging `class_abilities`

Ruling 23 from slice 2's ledger. `class_abilities.type` was added with a
corrective backfill keyed on `classes.advanced_abilities`, which matched zero
rows because no class had any. All 916 rows read `core` today, so the core/advanced
distinction — and with it the 4-Perk economy slice 4 depends on — is not
recoverable from the database.

The backfill re-runs as its own migration once V1 content is loaded. It is
keyed the same way, on a name match against the row's class's
`advanced_abilities`, so it is correct for all three creator modes rather than
correct for one.

It only tags rows on classes that have advanced abilities, so it is a no-op for
every character on an Advent-format class. Characters created against a V1 class
between the load and this migration are the rows it exists to correct.

### Wiring

| Path | File | Change |
| --- | --- | --- |
| Format column | new migration | `content_format`, CHECK, default `'advent'` |
| Expanded tips column | new migration | `expanded_tips` jsonb NOT NULL |
| Admin fork/duplicate | new migration replacing `dup_class` | both new columns in the column list and the SELECT; distinct from the loader's fork creation, which inserts directly |
| Family firewall | `util/class-family.js:7` | edge requires matching `content_format` |
| Unlock roster | `util/starter-content.js` | six V1 ids added to `CORE_CLASS_UNLOCKS.aspirant` |
| Gear normalization | `util/class-gear.js` | `column`, `position`; census restated |
| Tips normalization | new `util/class-expanded-tips.js` | Player/Conduit note trees |
| Admin write handlers | `routes/classes.js:662,729` | accept and persist `expanded_tips`, `content_format` |
| Admin form | `views/class-form.handlebars` | format select; gear rows follow format; expanded-tips repeaters |
| Class page | `views/class-view.handlebars` | four-column Signature layout; expanded tips; markdown on the newly-rendered fields |
| Partials | `views/partials/class-sample-perks.handlebars`, `class-enchantment.handlebars` | `{{{markdown …}}}` |
| AI import | `util/class-import.js:173-174,226` | caps key on `content_format`; `expanded_tips` in the schema |
| Export | `util/class-export.js` | markdown and JSON emit the new keys |
| Agent serializer | `models/class.js:382-421` | `expanded_tips`, `content_format` |
| Extractor | new `scripts/extract-aspirant-v1-classes.mjs`, new `util/aspirant-extract.js` | |
| Verifier | new `scripts/verify-aspirant-v1-extract.mjs`; fix `scripts/verify-prerelease-extract.mjs` | |
| Loader | `scripts/load-prerelease-classes.mjs`, `scripts/lib/character-impact.mjs` | fork disposition; per-book descriptor |
| Ability re-tag | new migration | re-run the `advanced_abilities` name match |

## Testing

TDD throughout, via the `tdd-red` / `tdd-green` / `tdd-refactor` agents.

Establish the red baseline before changing anything. Nine failures are known to
predate this slice — one http (`routes/open-graph.test.js`), two integration
(`character-content-integrity`, `image-crop-integrity`), six e2e
(`22-classes-crud` ×5, `18-book-class-unlocks` ×1) — and must not be mistaken for
new breakage.

**The extractor and verifier are currently untestable where they live.**
`scripts/run-tests.mjs:54` scans only `models, routes, services, test, util,
views`, so a test file under `scripts/` would silently never run, and neither
script exports anything. The existing extractor's correctness is asserted only by
the verifier at run time, and the verifier's by nothing at all. Extraction logic
therefore lands in `util/aspirant-extract.js` with the scripts reduced to thin
CLI wrappers, which is what makes the TDD mandate satisfiable here.

New coverage:

- every `util/aspirant-extract.js` helper: glyphless note nesting by indent and
  leading, per-side band derivation, two-column partitioning, superscript
  re-threading, four-column `column`/`position` assignment
- `content_format` round-tripping through form save, import, export and fork
- the firewall: a format fork starts a new family, in all four consumers
- gear `column`/`position` normalization, and `category` still deriving from
  column 1 versus 2 for an Advent-format class
- `expanded_tips` normalization, including blank-row dropping and the nested
  `children` rule
- each newly-rendered field neutralizing a hostile string
- the loader's fork disposition, and `projectImport`'s fork shape
- the re-tag migration tagging a V1 character's advanced picks and leaving an
  Advent character's alone
- an e2e pass over a V1 class page: twelve signatures in four columns, six
  abilities in two sections, enchantments and sample perks rendered

Existing tests that move because the contracts widen: `util/class-gear.test.js`,
`util/class-abilities.test.js`, `util/class-export.test.js`,
`routes/classes-structured-fields.test.js`, `util/class-form-round-trip.integration.test.js`,
`util/class-structured-columns.integration.test.js`,
`util/core-roster.integration.test.js`, and every count-bearing assertion in
`test/load-prerelease-classes.test.js` — the pre-load catalog name list, the
create/update split, the section counts, the pronunciation count and the remap
size are all pinned to the one artifact.

**Migrations and loader runs target local Supabase only.** The checked-in `.env`
is hand-switched between the local stack and the live project; read
`SUPABASE_URL` before anything that writes, and prefer deriving credentials from
`supabase status -o env`. `bun run test:unit` scrubs it. Apply migrations with
`supabase migration up`. **Never run `supabase db reset`** — the local database
holds a restored production copy, not seed data.

## Success criteria

- Twelve V1 classes exist as forks, each with twelve signatures across four
  columns, three core and three advanced abilities, every ability carrying two
  sample perks of which one has a Compounded variant, and every signature a
  Default Enchantment.
- No existing class row is modified by the load, and every character on a
  pre-release Aspirant or Advent base class keeps its class, its picks and its
  rendered content.
- The verifier passes token-for-token against the PDF for all twelve classes, and
  passes again for the pre-release artifact it has not been able to read since
  `e55f998`.
- A second `--apply` is a no-op.
- `content_format` is `NOT NULL` with every pre-existing row `'advent'` and
  exactly the twelve new rows `'aspirant'`.
- A format fork is in a different version family from its parent, in all four
  consumers.
- `class_abilities.type` reads `'advanced'` for every pick drawn from a class's
  advanced list, and `'core'` otherwise.
- Power Ratings render as superscripts everywhere they appear, and a hostile
  string in a newly-rendered field is neutralized.

## Deliberately not in this slice

- **Upgrading a character to an Aspirant class.** Moving a character between
  families is a player decision with rules consequences — stat caps, the Merx and
  Perk economies — and none of that lands before slices 4 and 5. This slice makes
  the destination exist; it does not build the road.
- **Server-side Merx and Perk budgets.** Still client-side, still slice 4.
- **Glance Grades, the Keyword glossary, Loadout, Companions, Flavor and
  Scarring**, out of scope for the whole stack by the decision recorded at
  `docs/superpowers/specs/2026-09-12-aspirant-class-content-contracts-design.md:22-23`.
  Glance Grades are art with no text layer and Keywords are distinguished only by
  color, so neither is extractable from the PDF in any case.
- **Retiring the pre-release rows.** They stay public and playable. Whether an
  Aspirant-format class should supersede its pre-release row in the library is a
  product decision that only has to be made once players can move between them.
