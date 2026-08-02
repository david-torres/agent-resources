---
id: ar-t2mv
status: open
deps: []
links: [ar-w9d2]
created: 2026-08-02T02:35:10Z
type: bug
priority: 1
assignee: David Torres
tags: [seeding, local-dev, classes]
---
# Seeded classes have no gear or abilities

`util/seed-classes.js` builds each class row with `name`, `description`, `is_public`, `status`, `is_player_created`, `rules_edition`, `rules_version`, `stat_spread` and `created_by` — and never sets `gear` or `abilities`. Those columns default to `'[]'::jsonb` (`supabase/migrations/20240101000000_baseline_schema.sql:139-140`), so every seeded class lands with both empty:

```
[{"name":"Gunslinger","gear":[],"abilities":[]},
 {"name":"Illusionist","gear":[],"abilities":[]}]
```

The data exists and is complete. `util/enclave-consts.js` exports `classGearList` (line 31) and `classAbilityList` (line 170) covering **all 17** seeded classes — 6 gear items and 3 abilities for Gunslinger, none missing for any class. The seed imports `classStatSpread` from that same module but not these two.

## Consequence

The character wizard's steps 3 and 4 are built entirely from this data (`routes/characters.js` maps `c.gear` into `class_gear` with base/elective badging, and `c.abilities` into `abilities_html` for the step-3 primer). With both empty, a locally-seeded install gets a wizard with no abilities to read and no gear to spend Merx on — the class-selection and gear-shop steps render empty. Class detail pages are likewise bare.

Same root cause as ar-w9d2: the local seed produces classes that are not actually usable. Different symptom, and not fixed by that change — ar-w9d2 only aligned the six starter-class ids.

## Required shape

`gear` and `abilities` are JSONB arrays of `{ name, description }`, per the authoritative construction in `routes/classes.js:583-587` (abilities) and `:597-601` (gear):

```js
{ name: <string>, description: <string> }
```

The consts hold plain name strings, so the seed must map each to an object. An empty `description` matches what the seed already does for the class's own `description` field — the descriptive text is authored later through the UI.

Note `class_gear` and `class_abilities` are **different tables**, keyed by `character_id` — they are per-character instances, not the class template. This ticket concerns only the JSONB columns on `classes`.

## Acceptance Criteria

A freshly-seeded class carries its full gear and ability lists in the shape the app writes and reads, so the wizard's ability primer and gear shop are populated. The seed and the const data cannot silently diverge — a class gaining gear data in `enclave-consts.js` without the seed picking it up should fail a test.
