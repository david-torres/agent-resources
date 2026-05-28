# Character auto-calculate — design

## Summary

Add an optional **Auto-calculate from mission log** checkbox to the character edit form. When checked, the character's **Level**, **Completed Missions**, and **Commissary Reward** are derived from the character's mission history (real + offscreen) and item lists, instead of being typed manually. The three inputs render disabled-and-filled while the box is checked; the values are recomputed server-side on save and persisted to the row. The flag itself is persisted on the character so the next edit starts in the same state.

## Goals

- Reduce manual bookkeeping for players whose mission log already reflects reality.
- Keep merx math honest: failed missions don't pay, item purchases subtract.
- Single source of truth — derivation logic lives in one pure module used both by render and save.
- Future-proof for tiered merx awards in upcoming editions.

## Non-goals

- Auto-calc on the **create** form (new characters have no mission log).
- Live client-side recompute as items are added/removed; users save to see the new totals.
- Backfilling existing characters or auto-enabling the flag.

## Derivation rules

Given a character, its real mission rows, and its offscreen mission rows:

### `completed_missions`

```
completed_missions = (real missions with outcome ∈ {success, failure})
                   + (all offscreen missions for this character)
```

`pending` real missions are excluded. Offscreen missions count regardless of whether they are linked to a source mission (i.e., whether they consumed a conduit credit).

### `commissary_reward` (merx)

```
earned = MERX_PER_MISSION_SUCCESS × (count of successful real missions)
       + Σ offscreen.merx_gained

on_class_count = signature gear where gear.class_id = character.class_id
off_class_count = signature gear where gear.class_id ≠ character.class_id
charged_on_class = max(0, on_class_count − STARTING_ON_CLASS_GEAR_ALLOTMENT)

spend = 1 × common_items.length
      + 2 × charged_on_class
      + 3 × off_class_count

commissary_reward = max(0, earned − spend)
```

- `MERX_PER_MISSION_SUCCESS = 1` for current editions. Defined as a constant in `util/enclave-consts.js` with a comment noting future editions will make this tiered.
- `STARTING_ON_CLASS_GEAR_ALLOTMENT = 4`. The first 4 on-class signature gear items are granted free at character creation; only on-class gear beyond that count costs merx. Off-class gear has no allotment.
- The first STARTING_ON_CLASS_GEAR_ALLOTMENT (=4) on-class signature gear items
  are granted free at character creation; only on-class gear beyond that count
  costs merx. Off-class gear has no allotment.
- Quirks, accessories, and (legacy) `additional_gear` cost 0.
- Missing `class_id` on the character or on a gear row classifies that gear as **off-class** (safer default — costs 3 rather than 2).

### `level`

```
level = max L ∈ [1, 10] such that getTotalVnMissionsNeeded(L) ≤ completed_missions
```

where `Vn` is `V1` or `V2` per the character's class `rules_version` (defaulting to `V1` if the character has no class). Clamped to 10.

## Data model

### Migration

Add to `characters`:

```sql
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS auto_calculate BOOLEAN NOT NULL DEFAULT FALSE;
```

New file: `supabase/migrations/<YYYYMMDDHHMMSS>_character_auto_calculate.sql`.

### Constant

In `util/enclave-consts.js`:

```js
// Merx awarded per successful mission. Current editions are flat; future
// editions will tier this by character level or mission difficulty.
const MERX_PER_MISSION_SUCCESS = 1;
```

Exported alongside the existing constants.

## Derivation module — `util/character-derived.js`

Pure functions, no I/O:

- `deriveCompletedMissions(realMissions, offscreenMissions) → number`
- `deriveMerx({ realMissions, offscreenMissions, gear, commonItems, characterClassId }) → number`
- `deriveLevel(completedMissions, rulesVersion) → number`
- `deriveCharacterTotals({ character, realMissions, offscreenMissions, rulesVersion }) → { completed_missions, commissary_reward, merx_deficit, level }` — the function callers use. Reads `character.gear`, `character.common_items`, `character.class_id` (which may be the in-flight form values when called during save). `merx_deficit` is `max(0, spend − earned)` so callers can render an over-budget warning even though `commissary_reward` itself is floored at 0.

All functions accept the array shapes the existing code already produces (`getCharacterAllMissions`, `listOffscreenMissions`, character form payload).

## Model changes — `models/character.js`

- `getCharacterRealMissionsForDerivation(characterId, client)` — returns `[{ id, outcome }]` for all real missions linked to this character via `mission_characters`. Used at save and form-render time.
- `applyAutoCalculateIfEnabled(payload, character, supabase)` — internal helper used by `updateCharacter`. When `payload.auto_calculate` is true, fetches fresh mission and offscreen data, calls `deriveCharacterTotals`, and overwrites `payload.level`, `payload.completed_missions`, `payload.commissary_reward` before the row write. Otherwise no-op.
- `updateCharacter` persists the `auto_calculate` field alongside the other columns.

The submitted form values for `class_id`, `gear`, `common_items`, etc. are used when computing — this lets a user change gear and class on the same save that flips the flag.

## Routes — `routes/characters.js`

### `GET /:id/edit`

After loading the character, also load real and offscreen missions and compute `derived`:

```js
const { data: realMissions } = await getCharacterRealMissionsForDerivation(id, res.locals.supabase);
const { data: offscreenMissions } = await listOffscreenMissions({ characterId: id, supabase: res.locals.supabase });
const derived = deriveCharacterTotals({
  character,
  realMissions: realMissions || [],
  offscreenMissions: offscreenMissions || [],
  rulesVersion: effectiveVersion,
});
```

Pass `derived` and `character.auto_calculate` to the template.

### `GET /:id/auto-calc-fields` (new)

HTMX partial for the checkbox toggle. Query param `?on=1` (truthy) renders the locked-and-filled variant; otherwise renders the editable variant with the character's saved values.

- Auth: `isAuthenticated`; same ownership check as the edit GET.
- Loads the character + missions + offscreen, computes derived if `on`, renders the partial.
- Returns `views/partials/character-auto-calc-fields.handlebars` with `layout: false`.

### `PUT /:id` (existing)

- Accept new field `auto_calculate` from the form body (checkbox; treat absence as false).
- Path delegates to `updateCharacter`, which now calls `applyAutoCalculateIfEnabled` before writing.

### `GET /new` and `POST /` (create)

No auto-calc UI; flag defaults to false.

## Form template — `views/character-form.handlebars`

### Checkbox

On edit only (`{{#unless isNew}}`), above the existing Level/Completed/Merx columns row, render:

```handlebars
{{#unless isNew}}
<div class="field">
  <div class="control">
    <label class="checkbox">
      <input type="checkbox" name="auto_calculate" {{#if character.auto_calculate}}checked{{/if}}
             hx-get="/characters/{{character.id}}/auto-calc-fields"
             hx-trigger="change"
             hx-target="#auto-calc-fields"
             hx-swap="outerHTML"
             hx-vals='js:{on: event.target.checked ? 1 : 0}'>
      Auto-calculate from mission log
    </label>
  </div>
  <p class="help">Recomputes Level, Completed Missions, and Commissary Reward from your mission log and item costs when you save.</p>
</div>
{{/unless}}
```

### Locked/editable partial

Extract the existing `columns is-multiline` row that holds the three fields into `views/partials/character-auto-calc-fields.handlebars`, wrapped in `<div id="auto-calc-fields">`. Inputs receive `disabled` when `autoCalculate` is true, and use `derived.*` values; otherwise editable with `character.*`. The "Need X more missions" help text uses the same source (`derived` or `character`).

When locked, render a small note under the columns row: *"Values will be recomputed when you save."*

The partial is included on initial render from `character-form.handlebars`:

```handlebars
{{#unless isNew}}
{{> character-auto-calc-fields character=character derived=derived autoCalculate=character.auto_calculate effectiveVersion=effectiveVersion}}
{{else}}
<!-- existing inline columns row for new-character path -->
{{/unless}}
```

The HTMX endpoint renders the same partial with `layout: false`.

## Tests

### `util/character-derived.test.js`

- `completed_missions` counts success + failure real missions, excludes pending, includes all offscreen.
- `merx` sums `MERX_PER_MISSION_SUCCESS × success-count + Σ offscreen.merx_gained`.
- Item spend: 1 per common item, 2 per on-class gear, 3 per off-class gear.
- Gear with missing `class_id` is off-class; character with missing `class_id` makes all gear off-class.
- `merx` floored at 0 when spend > earned.
- `level` derived correctly for both v1 and v2 sequences; clamps to 10; defaults to v1 when no rulesVersion provided.
- Empty inputs → `{ level: 1, completed_missions: 0, commissary_reward: 0 }`.

### `models/character-update.test.js`

- `updateCharacter` with `auto_calculate: true` writes derived values regardless of submitted `level`/`completed_missions`/`commissary_reward`.
- `updateCharacter` with `auto_calculate: false` writes submitted values verbatim.
- The `auto_calculate` flag itself is persisted in both cases.

### Route test

- `GET /characters/:id/auto-calc-fields?on=1` returns HTML containing `disabled` inputs with derived values.
- Without `on`, returns editable inputs with the character's saved values.

## Edge cases

- **No class set on character:** level uses v1 sequence; all gear treated as off-class.
- **Deceased character:** auto-calc still works; no special path.
- **Zero history:** `{ level: 1, completed_missions: 0, commissary_reward: max(0, −itemSpend) = 0 }`.
- **Toggle race:** if the user unchecks the box just before submit, the submitted values win — that's the expected meaning of the checkbox state at submission.
- **Item edits while box stays checked:** the locked inputs show stale values until save; the help text *"Values will be recomputed when you save"* makes this explicit. Final saved values reflect the latest form payload.
- **Level cap exceeded:** clamped silently at 10. `completed_missions` and `commissary_reward` are not capped.

## Open questions

None at this time.
