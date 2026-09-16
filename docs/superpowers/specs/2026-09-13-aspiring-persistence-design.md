# Aspirant V1: Aspiring persistence

Status: approved design, not yet planned.
Branch: `aspirant-v1-classes-and-characters`.

## Place in the stack

Slice 2 of the five-slice ENCLAVE: Aspirant V1 stack described in
`docs/superpowers/specs/2026-09-12-aspirant-class-content-contracts-design.md:6-20`:

1. Class-content contracts — landed
2. **Aspiring persistence** — this document
3. V1 ingestion
4. Character economy (enchantments, mods, Merx)
5. Stat caps and traits

Slice 1's design claimed to introduce `class_abilities.type` and slice 2 was
written to depend on it, but slice 1's contract changes were all class-side jsonb
and neither of its migrations adds the column. This slice adds it.

## Problem

Aspiring is the class-less creator mode: the player invents a one-off
pseudo-class and assembles it from six borrowed slots — three gear picks from
three distinct classes, and three ability picks (two core, one advanced) from
three distinct classes. The rules live at `public/js/character-wizard.js:1489-1510`.

**An aspiring submit cannot currently produce a row.** `characters.class` is
`TEXT NOT NULL` (`supabase/migrations/20240101000000_baseline_schema.sql:46`) with
no default. Aspiring sends `class_id: null` and no `class`, and
`resolveCharacterClassReference` (`models/character.js:24-45`) only fills `class`
*from* a `class_id`, so both stay null and the insert fails. Nothing catches this:
there is no test or e2e coverage of the aspiring submit path.

Two further things the wizard collects have nowhere to go:

- **The pseudo-class identity.** `serializePayload` emits
  `pseudo_class: { name, tagline, description }` (`public/js/character-wizard.js:3143-3243`).
  The key appears nowhere in `routes/`, `services/`, `models/`, `util/` or
  `supabase/`. It rides through `normalizeWizardPayload`
  (`services/character/input.js:162-188`, which passes `body` through with no
  allowlist) into `jsonb_populate_record`
  (`supabase/migrations/20260905000001_reconcile_character_child_rows.sql:33-49`),
  which silently ignores keys that are not columns. No error, no data. The comment
  at `public/js/character-wizard.js:3148-3156` describes a server that was never built.
- **The core/advanced tag.** The wizard sends `type` on every ability
  (`public/js/character-wizard.js:3225,3228`) and `normalizeAbilityItems` preserves
  it, but all three write paths project it away. A saved aspiring character's
  abilities are indistinguishable from any other character's, so the distinction —
  and with it the 4-Perk economy — is unrecoverable from the database.

## Approach

### Storage

The pseudo-class lives on the character, not in the `classes` table.

A real player-created `classes` row was considered and rejected. The schema
supports it — `classes.is_player_created`
(`supabase/migrations/20240101000000_baseline_schema.sql:130`) and a matching RLS
insert policy at `:558-568` that lets a non-admin insert only their own
`is_player_created` class — and the wizard comment assumes it. But it would put
one-off character-scoped rows into the class catalog, requiring every `classes`
query (kiosk, library, unlocks, version families) to be audited for an exclusion
filter, and it raises an orphan-cleanup question on character delete. That
machinery stays dormant.

```
characters.class                      := the pseudo-class name
characters.pseudo_class_tagline       := text | null
characters.pseudo_class_description   := text | null
characters.class_id                   := null
class_abilities.type                  := 'core' | 'advanced'
```

`characters.class` carries the pseudo-class name because it is already the
denormalized display name every render path reads, and already `NOT NULL`.
Filling it satisfies the blocker and leaves the character sheet, export, party
view and markdown working with no aspiring branch. A separate
`pseudo_class_name` column would be a second copy of the same string.

`class_id` stays null, which is honest: the character belongs to no catalog
class. `class_gear.class_id` and `class_abilities.class_id` remain `NOT NULL` and
point at the class each slot borrowed from, so pick provenance is already
persisted and needs no new storage.

The two new character columns are nullable and null for every advent and
aspirant character. That nullability is the signal; `creator_mode` already
records the mode.

### `class_abilities.type`

`text NOT NULL DEFAULT 'core' CHECK (type IN ('core','advanced'))`.

`type` is not an aspiring-only concern. Aspirant-mode characters draw their
abilities from the class's `advanced_abilities`, so a blanket `DEFAULT 'core'`
backfill would leave every existing aspirant character silently mislabeled. The
migration instead backfills `'advanced'` where the row's `name` matches an entry
in its class's `advanced_abilities` jsonb and `'core'` otherwise — correct across
all three modes rather than correct for one and quietly wrong for another. This
is the only irreversible step in the slice and is covered by its own test.

`type` is an attribute, not part of a row's identity: one class cannot offer the
same ability name as both core and advanced. The diff key stays `(class_id, name,
occ)` in the RPC and `` `${row.class_id}:${row.name}` `` in `diffChildRows`, and
`type` updates in place the way `description` does.

### The economy is derived, not stored

No column records the 10-Merx or 4-Perk spend. Once `type` is persisted the Perk
spend is recomputable from the picks (core 1, advanced 2) and the Merx spend from
the gear rows. Storing totals alongside the picks they derive from would create a
second source of truth that can drift. The budgets remain creation-time gates
enforced by the wizard.

### Validation

Structural invariants only, rejected before the insert:

- exactly three gear items and three abilities
- exactly two `core` and one `advanced`
- non-empty pseudo-class name

The CHECK constraint backstops `type` at the database. Budget arithmetic and shop
pricing stay in the wizard; mirroring the full rules engine server-side would
reintroduce the drift the derived-economy decision avoids.

### Wiring

| Path | File | Change |
| --- | --- | --- |
| Character columns | new migration `20260913000000` | `pseudo_class_tagline`, `pseudo_class_description` |
| Ability tag | new migration `20260913000001` | `type` column, CHECK, corrective backfill |
| Atomic RPC | new migration `20260913000002` | `type` in the insert column list and the `updated` CTE |
| Input normalization | `services/character/input.js:83-144` | map `pseudo_class` onto `class` + the two columns, delete the nested object |
| Structural validation | `services/character/input.js` | the three invariants above |
| Atomic create | `services/character/service.js:328-331` | carry `type` through `resolveClassItem`'s result |
| Reconcile (edit) | `services/character/service.js:411-425` | `type` in `desired.push` and `rowFields` |

`normalizeCharacterInput` already deletes `trait0/1/2`, `ability_perks`, `gear`
and `abilities` after mapping them; `pseudo_class` joins that list rather than
being passed through to be discarded downstream.

## Wizard fixes

**Trait selects are dead in aspiring.** `statOptionsFor`
(`public/js/character-wizard.js:851-862`) feeds trait slots 0 and 1 from
`getClassSpreadStats()`, which returns `[]` when there is no selected class
(`:708-712`); `fillStatSelect` then disables an empty select (`:892`). Aspiring
players cannot set two of their three traits. The aspiring branch offers the
union of the three borrowed classes' stat spreads — derivable from the builder
picks, and it preserves the rule that a character's class shapes its traits.

**The summary panel never shows the pseudo-class.**
`public/js/character-wizard.js:439-441` falls back to "Step 1: pick a class to
begin." for aspiring, so the running summary stays empty for the whole wizard. It
renders the pseudo-class name and tagline once step 1 validates.

**The draft-restore modal cannot name an aspiring draft.**
`views/character-new-selector.handlebars:80` prints "class not yet chosen" for
every aspiring draft by construction, making multiple saved drafts
indistinguishable. The draft payload carries the pseudo-class name.

**Copy fix.** The aspiring step-1 blurb at `views/character-wizard.handlebars:59`
opens "Aspirant is class-less…", naming the wrong mode.

## Dead code removed

- `refreshStep3Perk = () => {}` — an empty stub at `public/js/character-wizard.js:1482-1487`.
- The `useAdvanced` branch at `public/js/character-wizard.js:1414`, which sits
  after the `if (DATA.mode === 'aspiring') return;` at `:1364` and is therefore
  always false.
- The stale "still used for the 3 ability slots for now" comment at
  `public/js/character-wizard.js:2195`.

## Testing

TDD throughout, via the `tdd-red` / `tdd-green` / `tdd-refactor` agents.

Establish the red baseline before changing anything. Slice 1's plan was bitten by
a pre-existing failure being mistaken for new breakage; this slice widens the
`characters` column set and the `class_abilities` contract, both of which are
asserted by exact key set in places.

New coverage:

- `pseudo_class` mapping onto `class` and the two new columns
- each structural-validation rejection
- `type` surviving `normalizeAbilityItems` and both write paths
- the aspiring submit through `POST /characters/wizard` — the case that cannot
  work today. New file added to `httpFiles` in `scripts/run-tests.mjs`.
- an aspiring character round-tripping through the atomic and reconcile paths
  with `type` intact
- the backfill correctly tagging an existing aspirant character `'advanced'` and
  an advent character `'core'`
- an e2e aspiring happy path, of which there is none today

**Migrations and integration runs target local Supabase only.** The checked-in
`.env` points at the production project. `bun run test:unit` scrubs it; migrations
are applied with `supabase migration up`. Never `supabase db reset` — the local
database holds a restored production copy, not seed data.

## Success criteria

- An aspiring character survives create → edit → reload with its pseudo-class
  identity and core/advanced tags intact.
- The Perk and Merx spends are recomputable from the persisted picks.
- Advent and aspirant characters round-trip unchanged apart from picking up a
  correct `type`.
- No aspiring submit can write a malformed row.
- `class_abilities.type` is `NOT NULL` with no row mislabeled by the backfill.

## Open question

`getClassPoints()` (`public/js/character-wizard.js:738-747`) contributes zero
class stat points in aspiring mode, because it reads the selected class's spread
and there is none. This may be correct by design — no class, no class points — or
it may be a second hole of the same kind as the trait selects. It is a rules
question rather than a defect readable from the code, and it is not settled here.

## Deliberately not in this slice

- Server-side enforcement of the Merx and Perk budgets. The constants remain
  client-side at `public/js/character-wizard.js:1504-1510`; `util/character-derived.js`
  stays unaware of aspiring. This lands with slice 4, where the character economy
  is designed as a whole.
- Editing a pseudo-class after creation. The columns are written by the wizard;
  no edit-form surface is added for them.
- Player-created `classes` rows. The dormant `is_player_created` machinery is
  left dormant.
