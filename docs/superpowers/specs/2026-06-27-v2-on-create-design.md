# v2 Character Authoring on the Expert Create Form

**Date:** 2026-06-27
**Status:** Approved

## Problem

The Expert create form (`GET /characters/new/expert`) cannot author a complete
v2 character. To get a working v2 character today you must either create it and
then edit it, or create a v1 character and run the one-way class upgrade. The
"start at v2 directly" path is broken.

Three root causes:

1. **The form is v1-pinned at load.** The route hardcodes
   `effectiveVersion: 'v1'` (`routes/characters.js:358`). `effectiveVersion`
   only gets recomputed server-side, so the initial render always shows the v1
   layout: the free-text "Ability Perks" textarea
   (`character-form.handlebars:262-269`) and an empty `#v2-fields-container`
   (`:257`).

2. **Selecting a v2 class only does a partial, destructive swap.** Changing the
   class fires `GET /characters/version-fields` (`routes/characters.js:947`),
   which swaps structured v2 editors into `#v2-fields-container`. It does **not**
   hide the v1-only blocks (free-text Perks textarea, deprecated Additional
   Gear), so the form ends up showing both v1 and v2 perk inputs at once. The
   swap is also destructive (replaces innerHTML), so it can't preserve
   in-progress field values across a version switch.

3. **Structured perks can't be linked to abilities before a save exists.** The
   v2 Ability Perks editor groups perks per ability and links each perk to an
   ability by **database row id** via the hidden input
   `ability_perk_class_ability_id[]` (`character-ability-perk.handlebars`,
   `character-v2-fields.handlebars:37`). On create those ids don't exist yet, and
   the `version-fields` swap renders the editor with an empty `abilities` array
   — so it shows "Add at least one Class Ability above before authoring perks"
   and the user can never actually author perks at create time.

## Goals

- From the Expert create form, selecting a v2 class produces a fully functional
  v2 form: Quirks, Accessories, and structured per-ability Ability Perks, all
  authorable and persisted on first save.
- Selecting a v1 class shows the v1 layout (free-text Perks, etc.).
- Switching the selected class between a v1 and a v2 class mid-create **hides**
  the non-matching version's fields but **preserves** their values (so an
  accidental switch loses nothing); only the fields matching the saved class's
  version are persisted.
- Keep the existing Edit-form behavior **completely unchanged** — it already
  renders the correct version server-side and uses `/version-fields` for class
  changes. This work is scoped to the create form.
- Core linkage logic as pure, unit-testable functions; TDD throughout.

## Non-Goals

- The creation **wizard** flow is unchanged. This is Expert-mode only.
- **The Edit form is out of scope.** It keeps its current mechanism
  (`/version-fields` + server-rendered perk groups + id-based linkage). The edit
  form's own (pre-existing) inability to author perks for a *newly-added* ability
  before saving, and its v1→v2 class-switch behavior, are not addressed here.
- No new client framework. A single focused vanilla-JS module, consistent with
  the codebase's existing HTMX-plus-small-inline-JS style.
- No duplicate-ability support beyond what exists today — `diffChildRows`
  collapses abilities by `class_id:name`, so an ability name is unique per
  character, and name-based perk linkage is safe.

## Approach

Chosen: **client-side reactive form (A1) + name-based perk linkage (B1).**

A1 is the only option that satisfies the "hide, preserve hidden" requirement —
CSS show/hide keeps field values in the DOM, whereas a destructive HTMX swap
loses them. B1 reuses the existing edit-path remap pattern
(`util/ability-perks.js: remapPerkAbilityIds`, which matches by `name +
class_id`) instead of inventing client-generated temp ids for a duplicate-name
case the data model already rules out.

## Design

### Frontend

1. **Tag class options with version.** Add `data-version="v1|v2"` to each
   `<option>` in the class `<select>` (`character-form.handlebars:33-87`). The
   route already separates the class lists by version, so each `{{#each}}` group
   knows its version.

2. **Render both field sets up-front on create.** Today the create form renders
   only the v1 layout (the empty `#v2-fields-container` has no scaffolding). For
   the toggle to work, the create form (`isNew`) renders **both** the v1-only
   blocks and the full v2 scaffolding (the `character-v2-fields` partial with an
   empty character), with the non-matching set initially hidden based on the
   default-selected class's version. This replaces the create form's reliance on
   the hardcoded `effectiveVersion: 'v1'` to pick a single layout.

3. **New module `public/js/character-form-version.js`.** Loaded by the create
   form. Responsibilities:
   - **Version toggle.** On `#char-class-id` change, read the selected option's
     `data-version` and show/hide via a CSS `hidden` class (values preserved):
     - v1-only blocks: free-text "Ability Perks" textarea, deprecated Additional
       Gear block.
     - v2 block: `#v2-fields-container` (Quirks, Accessories, structured Ability
       Perks).
   - **Perk-group sync.** Watch the Class Abilities selects (`abilities[]`). For
     each currently-selected ability, ensure a structured-perk group exists in
     the Ability Perks editor, keyed by ability **name**; remove groups for
     deselected/removed abilities (dropping their perk rows). The per-ability
     "Add Perk" button continues to fetch the existing
     `GET /characters/ability-perk` partial, parameterized by the ability name on
     create.
   - **Create form only.** The module is loaded and active when `isNew`. The edit
     form keeps its existing server-rendered + `/version-fields` mechanism.

4. **`character-ability-perk` partial carries the linkage key.** On create the
   hidden `ability_perk_class_ability_id[]` carries the ability **name**; on edit
   it still carries the DB row id (unchanged). The value is opaque to the
   `/characters/ability-perk` route — it just echoes the identifier into the
   hidden input — so passing a name (create) or id (edit) needs no route change.

5. **Gate the class-select wiring by `isNew`, keep `/version-fields`.** On the
   create form, drop the `hx-get="/characters/version-fields"` wiring on the
   class `<select>` (`character-form.handlebars:28-32`) so the client module
   drives it instead. On the edit form, keep that wiring and the endpoint
   (`routes/characters.js:947`) exactly as-is — it remains a live consumer, so
   nothing is removed.

### Backend (`models/character.js → createCharacter`)

6. **Name-based perk remap on create.** After `setCharacterAbilities` inserts the
   ability rows (returning rows with `name` + `id`), remap each submitted perk's
   `class_ability_id` from name → new ability id, dropping perks whose ability
   name has no row. New pure helper `remapPerkAbilityIdsByName(perks,
   newAbilities)` in `util/ability-perks.js`, sibling to the existing
   `remapPerkAbilityIds`.

7. **v2-only field strip for a v1 class — already present.** `createCharacter`
   already strips `['quirks', 'accessories', 'ability_perks']` when the linked
   class is not v2 (`models/character.js`, top of `createCharacter`; covered by
   the existing test "createCharacter drops v2-only fields when linked class is
   v1"). The "preserve hidden" approach relies on this existing behavior — no new
   code needed. Listed here only to confirm the hidden-field case is handled.

### Data flow (create, v2 class)

1. User picks a v2 class → module hides v1 blocks, shows the v2 block.
2. User adds Class Abilities → module adds a perk group per ability (by name).
3. User authors perks → hidden `ability_perk_class_ability_id[]` = ability name.
4. Submit → `POST /characters` → `createCharacter`:
   - inserts the character row (v2 fields normalized),
   - `setCharacterAbilities` inserts ability rows, returns them with ids,
   - `remapPerkAbilityIdsByName` rewrites perk references name → id,
   - `setCharacterPerks` persists the perks.

### Edge cases

- **v1 ↔ v2 mid-switch:** non-matching blocks hidden, values preserved; save
  gates on the saved class's version (step 6).
- **Remove an ability:** its perk group and perk rows are removed client-side;
  nothing references a missing ability at submit.
- **Duplicate ability selection:** collapses to one row (existing
  `diffChildRows` behavior); name linkage stays valid.
- **Ability with zero perks:** allowed; no perk rows emitted for it.
- **v2 class but no abilities:** the editor shows the existing "add a Class
  Ability first" hint; no perks persisted.

## Testing (TDD, `bun test`)

- **`util/ability-perks.test.js`:** `remapPerkAbilityIdsByName` — maps by name,
  drops orphans, doesn't mutate inputs, handles empty/missing.
- **`models/character.test.js`:** creating a v2 character with name-linked perks
  persists perks against the correct ability ids; creating a v1 character with
  stray v2 fields submitted strips them (nothing v2 persisted).
- **`views/partials/character-ability-perk.test.js`:** the perk row emits the
  ability **name** in the hidden input when given a name (create), the id when
  given an id (edit).
- **Client module:** verified manually via the `run`/`verify` skill (pick a v2
  class, add abilities, author perks, save, confirm the rendered character). A
  light DOM-level test is added if the existing harness makes it practical.

## Affected files

- `routes/characters.js` — `/new/expert` (wire `data-version` source / load the
  module). `/version-fields` and `/ability-perk` unchanged. Edit routes
  untouched.
- `views/character-form.handlebars` — `data-version` on options; gate the
  class-select's `version-fields` HTMX wiring with `{{#if isNew}}` (create uses
  the module, edit keeps the endpoint); mark v1-only/v2 blocks for toggling; load
  the module when `isNew`.
- `views/partials/character-ability-perk.handlebars` — name-or-id linkage key.
- `views/partials/character-v2-fields.handlebars` — perk-group scaffolding the
  module can sync against.
- `public/js/character-form-version.js` — new module.
- `models/character.js` — `createCharacter` remap + v2-field strip.
- `util/ability-perks.js` — `remapPerkAbilityIdsByName`.
