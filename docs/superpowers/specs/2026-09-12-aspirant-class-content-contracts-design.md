# Aspirant V1: class-content contracts

Status: approved design, not yet planned.
Branch: `aspirant-v1-classes-and-characters`, stacked on `144-character-wizard-aspirant-and-aspiring`.

## Place in the stack

ENCLAVE: Aspirant V1 is an expansion that supersedes parts of Advent and builds on
the rest. The work divides into five slices, each with its own spec, plan and
implementation cycle:

1. **Class-content contracts** — this document
2. Aspiring persistence
3. V1 ingestion
4. Character economy (enchantments, mods, Merx)
5. Stat caps and traits

Slices 3–5 all write into contracts defined here, and slice 2 needs the
`class_abilities.type` column this slice introduces. Nothing in the stack can
land before this slice does.

Out of scope for the whole stack, by decision: Glance Grades, the Keyword
glossary, Loadout, Companions, Flavor and Scarring.

## Problem

Aspirant changes the shape of a class. A V1 class carries three Core Abilities
and three **Advanced Abilities**; every ability ships **two Sample Perks**, one
of which has a **Compounded** variant; and every one of its twelve Signature
Items carries a **Default Enchantment**. None of that has anywhere to go.

`classes.advanced_abilities` exists as a nullable jsonb column added by
`20260817000000_classes_advanced_abilities.sql`, but it holds no content, has no
authoring path, and is absent from `util/class-import.js`, `util/class-export.js`,
the `FIELDS` allowlist in `scripts/load-prerelease-classes.mjs`, the admin write
handlers in `routes/classes.js`, and the `dup_class` RPC. Sample Perks and
Default Enchantments have no representation at all.

## Approach

Class-side content stays in the jsonb columns on the `classes` row, which is how
every other piece of class content is already stored. The three new pieces nest
inside the contracts that exist.

### Contract changes

```
classes.gear[i].default_enchantment    := { name, description, dedication } | null
classes.abilities[i].sample_perks      := [ { name, text, dedication, compound_text } ]
classes.advanced_abilities[i]          := same shape as classes.abilities[i]
```

`default_enchantment` is always present as a key and is `null` on any item that
has none — which is every gear item on all fifty live Advent classes. This
matches how `meters` and `notes` were added to the gear contract: normalization
fills the key in on save rather than leaving items with divergent shapes. It
does mean the jsonb key census in `util/class-gear.js:158-160` stops being true
and must be updated along with the contract.

`dedication` carries the "In Honor of …" line the book prints under some
enchantment and perk names (`Smokey Bandit / In Honor of Cowboy Will`,
`Hexbuster Shot / In Honor of Crow`), `null` where there is none.

`sample_perks` is always an array, empty for every Advent ability. Each entry's
`compound_text` holds the full text of the Compounded variant, or `null` on the
perk that has none. The book prints the compounded form as a complete restatement
rather than a delta, so it is stored that way — a delta would have to be
recombined at render time, and the book's own wording is the thing being quoted.

`advanced_abilities` reuses the ability contract exactly, including the
conditional `pronunciation` key, so `normalizeAbilities` serves both columns
without a second normalizer. The column is tightened to `NOT NULL DEFAULT '[]'`
to match `examples` and `stat_spread`; no other class-content column is nullable.

### Item counts

`util/class-import.js` caps gear at six items and its schema describes "ideally
six" gear and "ideally three" abilities. An Aspirant class has twelve
signatures, three core abilities and three advanced. Those limits become
edition-aware rather than fixed: an `advent` class keeps six and three, an
`aspirant` class allows twelve, three and three.

### Wiring

Every path that already knows about `gear` and `abilities` learns the new keys:

| Path | File | Change |
| --- | --- | --- |
| Admin form normalization | `util/class-gear.js`, `util/class-abilities.js` | new keys; `normalizeAbilities` reused for advanced |
| Admin write handlers | `routes/classes.js` | accept and persist `advanced_abilities` |
| Admin form view | `views/class-form.handlebars` | repeaters for enchantment, sample perks, advanced abilities |
| Class page | `views/class-view.handlebars` | render the three new pieces |
| AI import | `util/class-import.js` | zod schema; edition-aware item caps |
| Export | `util/class-export.js` | markdown and JSON emit the new keys |
| Prerelease loader | `scripts/load-prerelease-classes.mjs:44-46` | add `advanced_abilities` to `FIELDS` |
| Seeding | `util/seed-classes.js:64-67` | `buildRow` emits the new keys |
| Fork/duplicate | new migration replacing `dup_class` | see below |

### dup_class repair

`dup_class`'s explicit column list
(`20260904000002_drop_class_description.sql:87-118`) omits both
`advanced_abilities` and `free_play_access`, so forking or duplicating a class
silently drops them today. Both are added. This is a pre-existing bug rather
than new work, but the fork path is about to start carrying content that matters
and fixing it anywhere else would mean shipping a known-lossy fork in between.

### Agent contract

`docs/custom-gpt-openapi.json` needs no new top-level property:
`advanced_abilities` was declared by `1194a26`, and `models/class-agent.test.js:152`
compares top-level key names only, which the nested additions do not change. The
`advanced_abilities` items schema is tightened from bare `object` to the ability
shape, for the benefit of the Custom GPT reading it — not because a test demands
it.

## Dead code removed

`scripts/seed-test-advanced-abilities.js` writes placeholder abilities named
`"Test: <Verb> <Noun>"` and `scripts/backfill-class-advanced-abilities.js` reads
`classAdvancedAbilityList`, which is `{}` — a guaranteed no-op. Both exist only
because there was no authoring path. This slice builds the authoring path, so
both scripts and the `seed:test:advanced-abilities` entry in `package.json` are
deleted here rather than left as a second, divergent way to populate the column.

`util/enclave-consts.js:170-176` exports the empty `classAdvancedAbilityList`.
It is deleted with its only consumer.

## Testing

TDD throughout, via the `tdd-red` / `tdd-green` / `tdd-refactor` agents.

New coverage: enchantment and sample-perk normalization, including blank-row
dropping and the nested `children` rule already established for notes; the
advanced-ability column round-tripping through form save, import, export and
fork; edition-aware item caps; `dup_class` preserving `advanced_abilities` and
`free_play_access`.

Existing tests that must move because the contracts widen:
`util/class-gear.test.js`, `util/class-abilities.test.js`,
`util/class-export.test.js`, `routes/classes-structured-fields.test.js`, and the
integration tests `util/class-form-round-trip` and `util/class-structured-columns`.
This is the widest blast radius in the stack — the item contracts are asserted
by exact key set in several places by design.

`bun run test:unit` for the loop. Integration tests need a local Supabase; the
checked-in `.env` points at the production project, so migrations and loader
runs target local only. `scripts/load-prerelease-classes.mjs:208` already
refuses a non-local target without `--force`, which will not be passed.

## Success criteria

- A V1 Aspirant class with twelve enchanted signatures, three core and three
  advanced abilities, each ability carrying two sample perks, survives a full
  round trip: import → admin save → export → fork, byte-identical.
- An Advent class round-trips unchanged apart from picking up
  `default_enchantment: null` and `sample_perks: []`.
- `classes.advanced_abilities` is `NOT NULL DEFAULT '[]'` with no null rows.
- No script can write advanced abilities except the authoring and ingestion
  paths.

## Deliberately not in this slice

Gear `column` and `position` — the four-column Signature layout and the
backwards-compatibility rule that reads column 1 as the Default Roster and
column 2 as the Elective Roster. It is a class-content contract and could
plausibly live here, but it only has meaning once twelve-signature classes
exist, and it forces a change to `gearCategory`'s positional default and to how
`views/class-view.handlebars` splits its columns. It stays with V1 ingestion in
slice 3, as scoped.
