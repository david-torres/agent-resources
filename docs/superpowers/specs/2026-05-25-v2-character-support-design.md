# v2 Character & Class Variant Support — Design

Reference: <https://agent-resources.vip/pages/changelog-advent-v1-v2>

## Goal

Support Advent v2 characters alongside existing v1 characters, with v2-aware
class variants. v1 characters and v1 classes remain fully functional and
unchanged.

## Decisions

| Topic | Decision |
| --- | --- |
| Scope | Full v1→v2 changelog coverage, gated to character-relevant pieces. |
| Coexistence | v1 and v2 live side-by-side; user picks per character. |
| Character version | Inherited from the linked class's `rules_version`. No new column on `characters`. |
| Storage of v2 fields | Mixed: typed columns where shape is firm, JSONB where list-shaped. |
| Class v2 authoring | Manual, via the existing `dup_class` RPC and class form. No seed script. |
| Ability Perks (character side) | Promoted to structured rows tied to character abilities, with optional `compounds_with` linkage. |
| v1 fields removed on v2 | `Additional Gear` block is hidden on v2 characters (already deprecated in v1). |
| v2 fields on v1 characters | Hidden entirely — form, view, and agent API omit them. |
| Inferences | Out of scope (Conduit-side, not on character). |
| Conduit Credits | On character (integer). |
| Wards | Free-text keyword inside gear description; no schema change. |
| Signature Exclusivity, 12-per-mission cap | Out of scope. |
| Limiters | Out of scope (not stored on character). |

## Effective Version

A character's effective rules version is the linked class's `rules_version`,
falling back to `'v1'` when no class is linked (defensive default). All
version-gated rendering — form, view, agent serializer, validation — branches
on this value. There is no `rules_version` column on `characters`.

Switching a character's class can cross a version boundary. The form shows an
inline notice when that happens: existing data on hidden fields is preserved
but not displayed.

## Schema

All changes are additive. No drops, no renames, no backfill.

### `characters` — new columns

```sql
ALTER TABLE characters
  ADD COLUMN conduit_credits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN quirks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN accessories JSONB NOT NULL DEFAULT '[]'::jsonb;
```

`quirks` and `accessories` hold arrays of `{ name: string, description?: string }`,
matching the shape of `common_items` and class `gear`/`abilities` JSONB.

v1 characters leave these at their defaults (`0` and `[]`); the v1 form and
view never read or write them.

### `character_perks` — new table

```sql
CREATE TABLE character_perks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  class_ability_id UUID NOT NULL REFERENCES class_abilities(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  compounds_with UUID REFERENCES character_perks(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_character_perks_character ON character_perks(character_id);
CREATE INDEX idx_character_perks_ability   ON character_perks(class_ability_id);

ALTER TABLE character_perks ENABLE ROW LEVEL SECURITY;
```

RLS policies mirror `class_abilities`: select when the owning character is
visible (public, owner, or admin); mutate when the requester owns the
character or is an admin.

`character.perks TEXT` (the v1 free-form textarea) is **kept as-is** for v1
characters. v2 characters do not write to it. When a v1 character later
links to a v2 class, its `perks` text renders as a read-only "Legacy perks
(v1)" block so nothing is lost.

### `classes` — no change

Classes today only store name + description per ability (no per-ability
perk list), so the "compounding" marker has nowhere to live on a class.
It lives entirely on the character's perk row via
`character_perks.compounds_with` (a self-reference to another perk on the
same character + same ability).

## Validation (v2 characters only)

Enforced server-side in the route layer, not as CHECK constraints:

- Each `character_perks.text` is ≤25 words (whitespace-split, trimmed).
- ≤5 perks per `class_ability_id` per character.
- `compounds_with` (if set) must reference another perk that belongs to the
  **same character** and **same `class_ability_id`**.

`util/validate.js` gains:

- `countWords(text)` — trims, splits on `/\s+/`, ignores empty tokens.
- `validateAbilityPerks(perks, { wordLimit: 25, perAbility: 5 })` →
  `{ ok: true }` or `{ ok: false, errors: [...] }`.

v1 characters skip all of this; v2 fields submitted on a v1 character are
silently dropped server-side (defense in depth — the form already gates
them).

## Model changes (`models/character.js`)

- `getCharacter`: also loads `character_perks` and attaches as
  `data.ability_perks`. Leaves `data.perks` (the v1 TEXT field) untouched.
- `createCharacter` / `updateCharacter`:
  - Accept `quirks[]`, `accessories[]`, `conduit_credits`, and
    `ability_perks[]` (`{ class_ability_id, text, compounds_with_id?, position }`).
  - Resolve effective version by looking up the linked class.
  - On v1, drop v2-only fields server-side.
  - On v2, run validation; write `character_perks` rows via a new
    `setCharacterPerks(characterId, perks)` helper that follows the
    delete-then-insert pattern used by `setCharacterGear` and
    `setCharacterAbilities`.
- `serializeCharacterForAgent`:
  - Adds `rules_version` (derived) to every payload.
  - On v2, adds `quirks`, `accessories`, `conduit_credits`, and
    `ability_perks`. On v1, omits them entirely so existing agent clients
    see no shape change.

## Model changes (`models/class.js`)

None. `dup_class` already forks v1 → v2.

## Route changes (`routes/characters.js`)

New htmx partial endpoints, paralleling existing `/characters/class-gear`,
`/characters/common-item`, `/characters/class-abilities`:

- `GET /characters/quirk` — renders one quirk row.
- `GET /characters/accessory` — renders one accessory row.
- `GET /characters/ability-perk?ability_id=…` — renders one perk row
  scoped to a class ability.
- `GET /characters/version-fields?class_id=…` — renders the
  v1-or-v2 fragment of the form. The class `<select>` triggers `hx-get`
  on change, swapping the container that holds all version-gated
  sections.

POST and PUT handlers accept the new fields and pass them through to the
model. No new auth surface — same `creator_id` checks as today.

## Route changes (`routes/agent.js`)

Picks up new fields automatically via the updated serializer. The OpenAPI
description in `docs/custom-gpt-openapi.json` is updated to document the
new shape.

## View changes

### `views/character-form.handlebars`

- Extract the v2-gated sections into partials so an htmx swap on class
  change can re-render them cheaply.
- New partials, rendered only when effective version is `'v2'`:
  - `character-quirks`
  - `character-accessories`
  - `character-conduit-credits` (single number input)
  - `character-ability-perks` — grouped by the character's selected
    class abilities; per group, up to 5 perks; per perk row, text input
    with live word-count (soft warning ≥25) and a "Compounds with…"
    dropdown listing the character's other perks on the same ability.
- v1-only treatment:
  - The flat `perks` textarea renders only on v1.
  - The `Additional Gear` block stays gated behind
    `{{#if character.additional_gear}}` on v1 and is suppressed on v2
    even when data exists (small "deprecated in v2" notice).
  - If a v2 character has legacy `perks` text, show it as a read-only
    "Legacy perks (v1)" block.
- Stat help text shows only the v1 line on v1 characters and only the v2
  line on v2 characters (instead of both, as today).

### `views/character.handlebars` (read view)

- Same version branching: v2-only sections render only for v2 characters;
  the v1 `perks` textarea renders as markdown only on v1.
- Header gains a small badge in the existing badge style:
  `Advent v2` (uses the linked class's edition + version).

### `views/class-form.handlebars`

No changes. Classes have no per-ability perk editor; the compounding
marker lives on the character's perk row, not the class.

### Stat-scaling hint copy (v2)

Replace the v2 help copy where v1 mentions specific scalings:

- Skill → Expertise
- Intelligence → Expertise (with Deduction)
- Spirit → Empathy (with Intuition)
- Will → Essence

v1 copy untouched.

## Tests

New tests sit next to existing model tests.

- `models/character.test.js`:
  - Create and update with v2 fields against a v2 class round-trips.
  - v2 fields submitted against a v1 class are silently dropped.
  - Perk validation: rejects >25 words, >5 perks per ability,
    `compounds_with_id` referencing a perk on a different ability or
    different character.

## Migrations and rollout

### Migration files

In `supabase/migrations/`, applied in order:

1. `20260525_v2_character_columns.sql` — adds `conduit_credits`,
   `quirks`, `accessories` to `characters`.
2. `20260525_character_perks_table.sql` — creates `character_perks`,
   indexes, RLS policies.

`schema.sql` is updated in lockstep so fresh databases get the new shape
without replaying migrations.

### Rollout order

1. Apply migrations to Supabase.
2. Merge backend (model + routes) with both v1 and v2 codepaths live.
   v1 behavior is unchanged; v2 fields are accepted but no v2 class
   exists yet, so users still see only v1 forms.
3. Admin forks selected v1 classes to v2 variants via the existing
   `dup_class` flow.
4. Public announcement / link to changelog page.

### Backwards compatibility

- v1 characters render exactly as before; no template path touches them
  differently.
- Existing agent-API clients see no shape change on v1 characters; new
  keys appear only when `rules_version === 'v2'`.
- A v1 character whose linked class is later edited to v2 starts
  rendering the v2 form on next edit; existing `perks` textarea content
  is preserved as a read-only legacy block.

## Out of scope

- 12-signature-items-per-mission cap.
- Signature Exclusivity enforcement.
- Wards as a typed field (stays as free-text keyword in gear).
- Inferences (Conduit-side, not on character).
- Reskin / common-item 5-word limit enforcement.
- Auto-seeding v2 class variants from the changelog.
- Pitches (mid-mission appearance/backstory) — a mission feature.
- Auto-migration of v1 characters to v2.
- Limiters on character.

## Risks

- **Class-change UX**: switching a character between v1 and v2 classes
  flips which fields are shown. Mitigated by an inline notice on the
  class `<select>` that explains the swap; hidden data is preserved, not
  deleted.
- **Dangling `compounds_with`**: a perk referenced by `compounds_with`
  can be deleted; `ON DELETE SET NULL` keeps the dependent perk alive
  with a null reference.
