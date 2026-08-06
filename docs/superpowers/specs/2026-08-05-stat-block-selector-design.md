# Stat Block Selector — Design

**Date:** 2026-08-05
**Branch:** `stat-block-selector`, stacked on `fix-alpine-frozen-class-and-pages-rls`
**Status:** Approved, awaiting implementation plan

## Problem

Two things are wrong with how the app presents stats.

**Stats render as plus icons.** Commit `e13cbd3` ("feat: render wizard stat
boxes as square-plus icons") replaced the filled/bordered point squares in the
character wizard's stat grid with `fa-square-plus` glyphs, and recolored the
`.wizard-stat-box` states to drive the icon instead of the box border. The
blocks read better. `views/lfg-post.handlebars` independently renders stats as
literal `+` text characters, so the plus look is not confined to that commit.

**Editing a stat means typing a number.** Four surfaces present the 12 stats as
number inputs:

| Surface | Field |
|---|---|
| `views/partials/character-stats-editor.handlebars:10` | `input.stats-input`, 0–20, Alpine `x-model.number` |
| `views/partials/character-level-up.handlebars:59` | `input.level-up-stat`, 0–20, vanilla JS |
| `views/character-form.handlebars:196` | `input`, native form POST, `required` |
| `views/class-form.handlebars:105` | `input`, `stat_spread[x]`, 0–3 |

Typing "3" into a box is a poor fit for a value whose whole range is 0–5 and
which is already drawn as five blocks two inches away on the same page. The
character wizard already does the right thing — its grid is clickable blocks —
but it assigns one point per click, so even it does not read as "pick a
rating".

## Goal

Restore blocks everywhere, and make every stat-editing surface a star-rating
control: click the Nth block to set the stat to N, with the unset blocks
visible but dimmed. Remove the stat number inputs entirely.

## Non-goals

- Changing the stat range, the point budget formula (`getTotalPoints`:
  `6 + (level−1)×2`), or the per-stat cap (`getMaxAssignable`: 3 at level 1,
  5 above). The UI changes; the rules do not.
- Changing any route, payload shape, or server-side validation.
  `services/character/input.js:131` keeps clamping submitted stats exactly as
  it does today.
- Backfilling test coverage for `public/js/character-wizard.js` beyond the two
  functions this change touches. The module is otherwise untested and stays
  that way.
- Rewriting the wizard's step-2 state management.

## Decisions

Settled during brainstorming; recorded here because several are non-obvious.

**Five blocks per stat, 0–20 still saveable.** Five matches the wizard's
per-stat cap and the read-only grid on `views/character.handlebars:221`. A
value above 5 — which the current 0–20 editor permits — renders five filled
blocks plus a numeric badge, and is preserved on save. Nothing clamps a stat
down silently; a value only drops when the user clicks a block. `class-form`
renders 3 blocks, matching its existing 0–3 range.

**Clicking the active block drops to N−1.** At value 3, clicking the 3rd block
gives 2. This matches the wizard's existing behavior — clicking a
user-assigned box removes that point — so the two feel like one control. It
also means clicking the 1st block at value 1 is how you reach 0.

**The wizard adopts jump-to-N.** Clicking the 4th block from value 1 assigns 3
points at once if the budget covers it, and as many as remain if it does not.
Without this the wizard would be the one surface that clicks differently.

**Buttons plus a hidden input, not radios.** Each block is a focusable element
in a `role="radiogroup"` with roving tabindex; a hidden input carries the value
for native form POST. The alternative — six visually-hidden radios per stat,
72 per grid — gets native keyboard and POST for free but still needs JS for
the drop-to-N−1 rule, and triples the element count.

**Hover previews the value.** Hovering the 4th block lights blocks 1–4 in a
muted shade; leaving the row restores the committed value. Keyboard focus does
the same. Without it the control reads as five unrelated toggles.

## Architecture

One partial and one Alpine component serve the four text-box surfaces. The
wizard keeps its own imperative renderer and shares only the CSS and the
interaction rules.

```
views/partials/stat-blocks.handlebars     new — the control
public/js/alpine-components.js            new Alpine.data('statBlocks')
public/css/styles.css                     .wizard-stat-box states + .is-preview

  consumed by:
    views/partials/character-stats-editor.handlebars   x-model into characterStats
    views/partials/character-level-up.handlebars       stat-change → vanilla JS
    views/character-form.handlebars                    hidden input → native POST
    views/class-form.handlebars                        hidden input → native POST

  parallel implementation (own state, shared CSS):
    public/js/character-wizard.js          renderStatGrid + onStatBoxClick
```

The wizard is deliberately not folded into the shared component. Its grid is
re-rendered imperatively from a closure on every trait change, and its per-box
state is a function of class points, personality points, and remaining budget —
none of which the shared component knows. Bridging it to Alpine would be a
rewrite of wizard step 2, against a module with no unit tests.

## The control

`views/partials/stat-blocks.handlebars`, invoked as
`{{> stat-blocks stat=this name=this value=(lookup ../character this) max=5}}`:

```hbs
<div class="stat-blocks" role="radiogroup" aria-label="{{capitalize stat}}"
     x-data="statBlocks({{json value}}, {{max}})" x-modelable="value"
     @mouseleave="preview = null" @keydown="key($event)">
  <input type="hidden" name="{{name}}" :value="value"
         class="stat-blocks-value" data-stat="{{stat}}">
  <template x-for="i in max" :key="i">
    <span class="wizard-stat-box" role="radio"
          :class="boxClass(i)" :aria-checked="i === value"
          :tabindex="i === (value || 1) ? 0 : -1"
          :aria-label="`{{capitalize stat}}: ${i}`"
          @click="set(i)" @mouseenter="preview = i" @focus="preview = i"></span>
  </template>
  <span class="stat-blocks-over" x-show="value > max" x-text="value"></span>
</div>
```

`Alpine.data('statBlocks', (initial, max) => ...)`:

| Member | Behavior |
|---|---|
| `value` | current points; exposed via `x-modelable` for two-way parent binding |
| `preview` | hovered or focused index, or `null` |
| `set(i)` | `value = (i === value) ? i - 1 : i`, then dispatch `stat-change` |
| `previewValue` | what a click on `preview` would produce: `(preview === value) ? preview - 1 : preview` |
| `boxClass(i)` | while `preview` is set: `is-preview` when `i <= previewValue`, else `is-empty`. Otherwise `is-set` when `i <= value`, else `is-empty`. |
| `key(e)` | `←/↓` −1, `→/↑` +1, `Home` → 0, `End` → max, `Space`/`Enter` sets the focused block. Each `preventDefault`s so arrows don't scroll the page. |

**Preview runs in both directions and shows the real outcome.** At value 5,
hovering the 2nd block previews two blocks — the control tells you it is about
to drop the stat, not just that it could raise it. Hovering the *active* block
previews N−1, matching what the click will actually do rather than showing a
no-op.

**Roving tabindex** keeps each stat to one tab stop, so the grid costs 12 tab
stops — the same as the 12 number inputs it replaces.

**Two output paths, both always rendered.** The hidden input preserves the
`name` and POST body of the field it replaces, so `character-form` and
`class-form` need no server-side change. `x-modelable` lets Alpine surfaces
bind `value` into their own state. Surfaces driven by vanilla JS read the
hidden input and listen for the bubbling `stat-change` event — detail
`{ stat, value }` — because a programmatically-set hidden input fires no
native `input` event.

**CSS** reuses the states the revert restores: `.is-set` maps onto the filled
square, `.is-empty` onto the dimmed bordered one, plus one new `.is-preview`
shade. The wizard's existing `.is-class` / `.is-user` / `.is-assignable` /
`.is-locked` are untouched.

## Changes by surface

**Revert `e13cbd3`.** Applies cleanly onto HEAD (verified). Restores the
filled/bordered squares in `public/css/styles.css`, the gray ramp
(`--wizard-stat-class: #1a1a1a`, dropping `--wizard-stat-locked`), and removes
the `<i class="fa-square-plus">` from both `public/js/character-wizard.js:853`
and `views/character.handlebars:226,231`. Taken as a real `git revert` commit.

**`character-stats-editor.handlebars`** — the number input becomes the partial
with `x-model="stats.{{this}}"`. The `total` getter and the 0–20 save clamp in
`characterStats` are unchanged. `edit()` in
`public/js/alpine-components.js:96` focuses `.stats-input`, which will no
longer exist; it becomes the first block carrying `tabindex="0"`. That focus
behavior has e2e coverage and a load-bearing comment about `$el` scoping, so it
must keep working, not merely stop erroring.

**`character-level-up.handlebars`** — same swap.
`public/js/character-level-up.js` queries `.level-up-stat` for the live total
(:215) and the payload (:247) and reads `.value`; both keep working once the
hidden input carries that class. The live-total wiring changes from a
per-field `input` listener to one delegated `stat-change` listener on
`#levelUpStatGrid`.

**`character-form.handlebars`** — swap the 12 inputs for the partial. Native
form POST is carried by the hidden inputs; no route change. `required` is
dropped: a hidden input always has a value, and 0 is legitimate.

**`class-form.handlebars`** — same, with `max=3` and
`name="stat_spread[{{this}}]"`. The existing help text stays accurate.

**`lfg-post.handlebars`** — the two `{{#range}}`-of-`+` blocks (:113 per-character
details, :179 party stats) become read-only blocks: `min(value, 5)` filled,
dimmed out to 5, no buttons and no ARIA group. Party stats keep their `({{n}})`
numeral, since party totals routinely exceed 5.

The read-only grid on `views/character.handlebars:221` is **not** converted. It
already renders blocks via `.is-class` / `.is-locked`, and the revert restores
its correct appearance; re-expressing it in the new `.is-set` / `.is-empty`
classes would be churn with no visible change.

**`character-wizard.js`** — two functions change:

- `onStatBoxClick` (:905) — clicking slot `i` targets `i+1` rather than ±1.
  The user portion is `target − cp − pp`, floored at 0 and capped by the
  remaining budget, so clicking the 4th block with 2 points left assigns 2 and
  stops. Clicking the topmost user-assigned slot decrements.
- `renderStatGrid` (:818) — gains an `.is-preview` pass driven by delegated
  `mouseover`/`mouseleave` on the grid.

Class- and personality-assigned slots stay non-clickable, and `capUserStats`
(:665) and `getMaxAssignable` (:645) are untouched — jump-to-N feeds through
the same clamps, so no click can produce a state the existing logic would not.

## Testing

Per the repo's TDD practice, each behavior gets a failing test first.

**New — `views/partials/stat-blocks.test.js`** (jsdom, matching the existing
partial tests):

- renders `max` blocks; 1..N carry `is-set`, the rest `is-empty`
- click block N sets the value to N and updates the hidden input
- click the active block N drops to N−1; block 1 at value 1 gives 0
- hovering block N marks exactly blocks 1..N `is-preview` and the rest
  `is-empty`, both when N is above and below the set value; `mouseleave`
  restores the committed state
- hovering the active block N previews N−1, matching what the click does
- `←/→/↑/↓` adjust by 1 and clamp at 0 and max; `Home`/`End` jump
- exactly one block has `tabindex="0"`; `aria-checked` tracks the value
- a value above max renders max filled blocks plus the badge, and does not
  clamp until a block is clicked
- `set()` dispatches a bubbling `stat-change`

**Updated:**

- `views/partials/character-stats-editor.test.js` — the three `.stats-input`
  fixtures and the assertions that query them move to blocks; adds a test that
  `edit()` focuses the first block
- `views/partials/character-level-up.test.js` — the live total recomputes on
  `stat-change`; the payload build reads the hidden inputs
- `views/character-form.test.js` — the form POSTs all 12 stat names with
  block-set values
- New `views/class-form.test.js` — `stat_spread[x]` names survive the swap,
  `max=3`

**New — `public/js/character-wizard.test.js`**, scoped to the two changed
functions: jump-to-N respects the remaining budget, partial assignment when the
budget is short, clicking the top user slot decrements, class and personality
slots stay unclickable.

**E2E:** `e2e/specs/04-stats-editor.spec.js` and
`e2e/specs/05-level-up-modal.spec.js` drive number inputs today; their
selectors and `fill()` calls become block clicks. What they assert about
persistence is unchanged.

**Manual check before calling it done:** the four surfaces plus the wizard in a
real browser. Hover preview and focus rings are not things jsdom can confirm.

## Risks

- `character-wizard.js` has no existing unit tests and its stat step is the
  most stateful code in the change. Mitigated by adding tests for the two
  changed functions and by leaving the budget and cap logic alone.
- The stats editor's focus behavior is asserted in e2e and carries a comment
  explaining a past `$el`-scoping defect. Changing the focus target risks
  silently reintroducing a null-target no-op; the updated test asserts focus
  lands on the block, not merely that no error is thrown.
