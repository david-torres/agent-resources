# Party Character Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `/party` roster member an expandable full-sheet Details view (stats, abilities, gear, personality, perks, items, quirks, accessories) whose class-gated descriptions require an unlock — served by one shared fragment that the LFG post page adopts too, fixing its ungated description leak.

**Architecture:** A `description-gate` helper extracted from inline route code, a new `GET /characters/:id/details` fragment route, and a shared `character-details` partial lazy-loaded (`hx-trigger="click once"` + Alpine visibility) by both `/party` and `/lfg`. LFG's duplicated inline detail markup and nested gear/ability selects are deleted.

**Tech Stack:** Express + express-handlebars, htmx + Alpine, Supabase (RLS-scoped request client), Bun test (unit/http tiers via `scripts/run-tests.mjs`), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-08-16-party-character-details-design.md`. One refinement over the spec: the shared tooltip unit is a per-item partial `character-detail-tag` (not a list-level `character-detail-tags`), and its element ids embed `class_id` — which makes the character page's historical ids (`ability-<class_id>-<name>`) reproducible exactly while the fragment prefixes the character id.

## Global Constraints

- **Never** add `hx-history="false"` or `hx-push-url` (any value) on or near the Details toggles — the comment at `views/lfg-post.handlebars:89-99` explains why their mere presence breaks htmx history snapshots document-wide. Keep that comment in place.
- The LFG details container **must keep** the id `character-details-{{this.character.id}}` — `e2e/specs/14-lfg-controls.spec.js` counts `[id^="character-details-"]` as its fixture-integrity probe.
- The party roster **must keep** `data-member-id="<id>"` on the member element and `data-remove-character="<id>"` on the remove button — `e2e/specs/17-virtual-party.spec.js` selects on them.
- Only ability/gear `description` fields carrying a `class_id` are ever gated. Quirks, accessories, perk text, common items, traits are character-authored and never redacted. No RLS/migration changes anywhere.
- Visibility is RLS's job: the fragment route does **no** `is_public` check in JS; an invisible character simply doesn't come back from `getCharacter`.
- The fragment route must be mounted **before** `router.get('/:id/:name?')` in `routes/characters.js` or the greedy route swallows it as `name="details"`.
- New http-tier test files must be added to the `httpFiles` set in `scripts/run-tests.mjs` (a file not listed there runs in the unit tier and will fail).
- Test files set their own `process.env.SUPABASE_*` placeholder defaults at the top (copy the existing pattern) so `bun test <file>` works directly.
- Run tiers: `bun test <file>` for one file; `bun scripts/run-tests.mjs unit` / `http` for a tier. E2E: `bunx playwright test <spec>` (needs local Supabase running — `supabase start`).

---

### Task 1: Extract the description gate into a tested helper

**Files:**
- Create: `services/character/description-gate.js`
- Test: `services/character/description-gate.test.js`

**Interfaces:**
- Consumes: `getLfgPost(id, client)` from `models/lfg` (returns `{ data: post, error }`, post has `host_id` and `join_requests[]` of `{ status, character: { id } }`); `getUnlockedClassIdsForUser(userId)` from `models/class` (returns `{ data: Set<classId>, error }`).
- Produces: `applyDescriptionGate({ character, profile, userId = null, lfgPostId = null, client })` → Promise resolving to the same (mutated) `character`. Tasks 2 and 5 call it.

The behavior is a straight extraction of `routes/characters.js:863-939`. Two nuances the tests must encode exactly:
- `getLfgPost` throwing only cancels the host exception (inner catch) — normal unlock gating still runs; it does NOT blank-all.
- `getUnlockedClassIdsForUser` throwing leaves the unlocked set empty, so class-gated items blank but class-less items keep their descriptions.

- [ ] **Step 1: Write the failing tests**

Create `services/character/description-gate.test.js`:

```js
// The render-time gate for class ability/gear descriptions, extracted from
// the inline block at routes/characters.js:863-939. These tests encode the
// old inline behavior — including both fail-closed paths — before anything
// else depends on the helper.
const { test, expect, mock, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Mutable per-test state consulted by the module mocks. mock.module is
// process-global, but scripts/run-tests.mjs runs one file per Bun process.
const state = {};

mock.module('../../models/lfg', () => ({
  getLfgPost: async () => {
    if (state.lfgThrows) throw new Error('lfg boom');
    return { data: state.lfgPost, error: null };
  },
}));

mock.module('../../models/class', () => ({
  getUnlockedClassIdsForUser: async () => {
    if (state.unlocksThrow) throw new Error('unlocks boom');
    return { data: state.unlockedIds, error: null };
  },
}));

const { applyDescriptionGate } = require('./description-gate');

beforeEach(() => {
  state.lfgPost = null;
  state.lfgThrows = false;
  state.unlockedIds = new Set();
  state.unlocksThrow = false;
});

const makeCharacter = () => ({
  id: 'char-1',
  abilities: [
    { name: 'Fireball', description: 'ability secret', class_id: 'class-a' },
    { name: 'Improvise', description: 'classless text', class_id: null },
  ],
  gear: [
    { name: 'Staff', description: 'gear secret', class_id: 'class-a' },
  ],
});

const descriptions = (character) => ({
  abilities: character.abilities.map(a => a.description),
  gear: character.gear.map(g => g.description),
});

test('signed out, every description is blanked — class-gated or not', async () => {
  const character = makeCharacter();
  await applyDescriptionGate({ character, profile: null, client: {} });
  expect(descriptions(character)).toEqual({ abilities: ['', ''], gear: [''] });
});

test('an unlocked class family keeps its descriptions', async () => {
  state.unlockedIds = new Set(['class-a']);
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {},
  });
  expect(descriptions(character)).toEqual({
    abilities: ['ability secret', 'classless text'],
    gear: ['gear secret'],
  });
});

test('a locked class blanks its items but spares class-less ones', async () => {
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {},
  });
  expect(descriptions(character)).toEqual({
    abilities: ['', 'classless text'],
    gear: [''],
  });
});

test('the host of the post sees an approved applicant in full, unlocks or not', async () => {
  state.lfgPost = {
    host_id: 'p1',
    join_requests: [{ status: 'approved', character: { id: 'char-1' } }],
  };
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1',
    lfgPostId: 'post-1', client: {},
  });
  expect(descriptions(character).abilities[0]).toBe('ability secret');
  expect(descriptions(character).gear[0]).toBe('gear secret');
});

test('a pending applicant does not trigger the host exception', async () => {
  state.lfgPost = {
    host_id: 'p1',
    join_requests: [{ status: 'pending', character: { id: 'char-1' } }],
  };
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1',
    lfgPostId: 'post-1', client: {},
  });
  expect(descriptions(character).abilities[0]).toBe('');
});

test('a viewer who is not the host gets normal gating despite ?lfg', async () => {
  state.lfgPost = {
    host_id: 'someone-else',
    join_requests: [{ status: 'approved', character: { id: 'char-1' } }],
  };
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1',
    lfgPostId: 'post-1', client: {},
  });
  expect(descriptions(character).abilities[0]).toBe('');
});

test('a failing lfg lookup only cancels the host exception, not the unlocks', async () => {
  // Mirrors the inline code's inner try/catch: hostingViaLfg stays false and
  // the viewer's real unlocks still apply.
  state.lfgThrows = true;
  state.unlockedIds = new Set(['class-a']);
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1',
    lfgPostId: 'post-1', client: {},
  });
  expect(descriptions(character).abilities[0]).toBe('ability secret');
});

test('a failing unlock lookup fails closed on class-gated items', async () => {
  state.unlocksThrow = true;
  const character = makeCharacter();
  await applyDescriptionGate({
    character, profile: { id: 'p1', user_id: 'u1' }, userId: 'u1', client: {},
  });
  expect(descriptions(character)).toEqual({
    abilities: ['', 'classless text'],
    gear: [''],
  });
});

test('returns the same character object it mutated', async () => {
  const character = makeCharacter();
  const result = await applyDescriptionGate({ character, profile: null, client: {} });
  expect(result).toBe(character);
});

test('a character with no abilities or gear arrays passes through untouched', async () => {
  const character = { id: 'char-1' };
  const result = await applyDescriptionGate({ character, profile: null, client: {} });
  expect(result).toBe(character);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test services/character/description-gate.test.js`
Expected: FAIL — `Cannot find module './description-gate'`.

- [ ] **Step 3: Write the helper**

Create `services/character/description-gate.js`:

```js
// Render-time gating for class ability/gear descriptions. Extracted from the
// inline block that lived at routes/characters.js:863-939 so /characters/:id,
// the /characters/:id/details fragment, and (through it) /party and /lfg all
// enforce the same rule: names are always visible, descriptions require the
// item's class family to be unlocked for the viewer.
const { getLfgPost } = require('../../models/lfg');
const { getUnlockedClassIdsForUser } = require('../../models/class');

const blankAll = (character) => {
  try {
    if (Array.isArray(character.abilities)) {
      for (const ability of character.abilities) {
        if (ability) ability.description = '';
      }
    }
    if (Array.isArray(character.gear)) {
      for (const gear of character.gear) {
        if (gear) gear.description = '';
      }
    }
  } catch (_) { /* ignore */ }
};

// Mutates character.abilities[].description and character.gear[].description
// in place and returns the character. Fails closed: any unexpected error
// blanks every description rather than throwing.
const applyDescriptionGate = async ({ character, profile, userId = null, lfgPostId = null, client }) => {
  try {
    let hostingViaLfg = false;

    // If an LFG context is provided and the viewer hosts that post with this
    // character approved on it, allow full descriptions regardless of unlocks.
    if (profile && lfgPostId) {
      try {
        const { data: lfgPost } = await getLfgPost(lfgPostId, client);
        if (lfgPost && lfgPost.host_id === profile.id) {
          hostingViaLfg = Array.isArray(lfgPost.join_requests) && lfgPost.join_requests.some(r =>
            r && r.status === 'approved' && r.character && r.character.id === character.id
          );
        }
      } catch (_) { /* ignore; hostingViaLfg remains false */ }
    }

    if (!profile) {
      blankAll(character);
    } else if (!hostingViaLfg) {
      let unlockedClassIds = new Set();
      try {
        // Admin-backed lookup on purpose: the shared anon client no longer
        // carries the user's JWT, so RLS on class_unlocks would return zero
        // rows and wipe every description.
        const { data: ids } = await getUnlockedClassIdsForUser(userId || (profile && profile.user_id) || null);
        if (ids instanceof Set) unlockedClassIds = ids;
      } catch (_) {
        unlockedClassIds = new Set();
      }

      if (Array.isArray(character.abilities)) {
        for (const ability of character.abilities) {
          if (ability && ability.class_id && !unlockedClassIds.has(ability.class_id)) {
            ability.description = '';
          }
        }
      }
      if (Array.isArray(character.gear)) {
        for (const gear of character.gear) {
          if (gear && gear.class_id && !unlockedClassIds.has(gear.class_id)) {
            gear.description = '';
          }
        }
      }
    }
  } catch (_) {
    blankAll(character);
  }
  return character;
};

module.exports = { applyDescriptionGate };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test services/character/description-gate.test.js`
Expected: 10 pass.

- [ ] **Step 5: Commit**

```bash
git add services/character/description-gate.js services/character/description-gate.test.js
git commit -m "feat: extract the class-description gate into a tested helper"
```

---

### Task 2: Route the character page through the helper

**Files:**
- Modify: `routes/characters.js` (imports at `:29-30`, gate block at `:863-939`)

**Interfaces:**
- Consumes: `applyDescriptionGate` from Task 1.
- Produces: `routes/characters.js` no longer contains the inline gate; the `getLfgPost` import is gone (the helper owns it). Task 5 adds its route to this same file.

- [ ] **Step 1: Replace the inline block**

In `routes/characters.js`, delete everything from the comment `// compute tooltip availability and description maps (never block render)` (line 863) through the closing brace of its outer `catch` (line 939 — the `}` right before `const effectiveVersion = ...`). Replace with:

```js
      await applyDescriptionGate({
        character,
        profile,
        userId: (profile && profile.user_id) || (res.locals.user && res.locals.user.id) || null,
        lfgPostId: req.query.lfg,
        client: res.locals.supabase
      });
```

- [ ] **Step 2: Fix the imports**

Delete line 30 (`const { getLfgPost } = require('../models/lfg');` — the gate block was its only consumer; verify with `grep -n getLfgPost routes/characters.js`). Add below the `characterRepository` require:

```js
const { applyDescriptionGate } = require('../services/character/description-gate');
```

Leave `getUnlockedClassIdsForUser` in the `models/class` import — `filterClassDataForUser` still uses it.

- [ ] **Step 3: Run the http and unit tiers to verify behavior is preserved**

Run: `bun scripts/run-tests.mjs http && bun scripts/run-tests.mjs unit`
Expected: all pass, no changes to any assertion.

- [ ] **Step 4: Commit**

```bash
git add routes/characters.js
git commit -m "refactor: route the character page through the description gate helper"
```

---

### Task 3: Shared `character-detail-tag` partial, adopted by the character page

**Files:**
- Create: `views/partials/character-detail-tag.handlebars`
- Modify: `views/character.handlebars:236-252` (Class Abilities) and `:265-281` (Signature Gear)
- Test: `views/partials/character-detail-tag.test.js`

**Interfaces:**
- Consumes: helpers `dashcase`/`capitalize` (handlebars-helpers), `markdown` (registered from `util/markdown`'s `renderMarkdown`).
- Produces: partial `character-detail-tag` with params `item` (`{ name, description, class_id }`), `idPrefix` (string), `className` (string). Element id is `<idPrefix>-<dashcase class_id>-<dashcase name>`. The character page passes `idPrefix="ability"` / `"gear"` so its historical ids are byte-identical; Task 4 passes `detail-<character id>-ability` / `-gear`.

- [ ] **Step 1: Write the failing tests**

Create `views/partials/character-detail-tag.test.js`:

```js
// The single tooltip-tag unit shared by the character page and the
// character-details fragment — one place for the "visible name + hidden
// markdown + data-tooltip-markdown hook" pattern that used to be duplicated.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const { renderMarkdown } = require('../../util/markdown');

const TAG_SRC = fs.readFileSync(path.join(__dirname, 'character-detail-tag.handlebars'), 'utf8');
const CHARACTER_PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'character.handlebars'), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper('markdown', renderMarkdown);
  return hb.compile(TAG_SRC)(context);
};

test('an item with a description renders a tooltip tag plus hidden markdown', () => {
  const html = render({
    item: { name: 'Fireball', description: 'Big **boom**', class_id: 'class-a' },
    idPrefix: 'detail-char-1-ability',
    className: 'tag is-primary is-medium',
  });
  expect(html).toContain('data-tooltip-markdown="#detail-char-1-ability-class-a-fireball"');
  expect(html).toContain('id="detail-char-1-ability-class-a-fireball"');
  expect(html).toContain('<strong>boom</strong>');
  expect(html).toContain('tag is-primary is-medium');
});

test('a blanked description renders a plain tag with no tooltip hook', () => {
  // This is what a gated item looks like: the gate emptied description, the
  // name still shows, nothing invites a tooltip that would come up empty.
  const html = render({
    item: { name: 'Fireball', description: '', class_id: 'class-a' },
    idPrefix: 'detail-char-1-ability',
    className: 'tag is-primary is-medium',
  });
  expect(html).toContain('Fireball');
  expect(html).not.toContain('data-tooltip-markdown');
});

test('the character page renders abilities and gear through this partial', () => {
  const uses = CHARACTER_PAGE_SRC.match(/\{\{>\s*character-detail-tag/g) || [];
  expect(uses.length).toBeGreaterThanOrEqual(2);
  // The inline copies it replaces must be gone, not lingering beside it.
  expect(CHARACTER_PAGE_SRC).not.toContain('data-tooltip-markdown="#ability-');
  expect(CHARACTER_PAGE_SRC).not.toContain('data-tooltip-markdown="#gear-');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/partials/character-detail-tag.test.js`
Expected: FAIL — partial file missing (ENOENT).

- [ ] **Step 3: Create the partial**

Create `views/partials/character-detail-tag.handlebars`:

```handlebars
{{!-- One ability/gear name with its tooltip description. Shared by the
      character page and the character-details fragment so the tooltip markup
      exists exactly once. The element id is "<idPrefix>-<class_id>-<name>":
      the character page passes idPrefix "ability"/"gear" (reproducing its
      historical ids exactly), the fragment passes
      "detail-<character id>-ability" so two same-class party members on one
      page cannot collide. An item whose description was blanked by
      services/character/description-gate.js renders as a plain tag. --}}
{{#if item.description}}
<span class="{{className}}" data-tooltip-markdown="#{{idPrefix}}-{{dashcase item.class_id}}-{{dashcase item.name}}">{{capitalize item.name}}</span>
<div id="{{idPrefix}}-{{dashcase item.class_id}}-{{dashcase item.name}}" class="is-hidden">
  {{{markdown item.description}}}
</div>
{{else}}
<span class="{{className}}">{{capitalize item.name}}</span>
{{/if}}
```

- [ ] **Step 4: Adopt it on the character page**

In `views/character.handlebars`, replace the Class Abilities `{{#each}}` body (lines 238-250, the `<div class="columns is-multiline">...</div>` inside the Class Abilities box) with:

```handlebars
      <div class="columns is-multiline">
        {{#each character.abilities}}
        <div class="column is-one-third">
          {{> character-detail-tag item=this idPrefix="ability" className="is-size-5"}}
        </div>
        {{/each}}
      </div>
```

Replace the Signature Gear `{{#each}}` body (lines 267-280) with:

```handlebars
      <div class="columns is-multiline">
        {{#each character.gear}}
        <div class="column is-one-third">
          {{> character-detail-tag item=this idPrefix="gear" className="is-size-5"}}
        </div>
        {{/each}}
      </div>
```

(One deliberate rendering nit: the old no-description branch used `<div class="is-size-5">`; the partial uses `<span>` in both branches. Inside a column wrapper the two render the same.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test views/partials/character-detail-tag.test.js && bun scripts/run-tests.mjs http`
Expected: new tests pass; the `routes/characters.test.js` http tests (which render through the real partials dir) stay green.

- [ ] **Step 6: Commit**

```bash
git add views/partials/character-detail-tag.handlebars views/partials/character-detail-tag.test.js views/character.handlebars
git commit -m "refactor: share the ability/gear tooltip markup via character-detail-tag"
```

---

### Task 4: The `character-details` fragment partial

**Files:**
- Create: `views/partials/character-details.handlebars`
- Test: `views/partials/character-details.test.js`

**Interfaces:**
- Consumes: partial `character-detail-tag` (Task 3), partial `stat-blocks-readonly`, helpers `perksForAbility`/`concat` (`util/handlebars`), `markdown`, `eq`/`and`/`capitalize`/`lookup` (handlebars-helpers).
- Produces: partial `character-details` taking context `{ character, effectiveVersion, statList }` where `character` is `getCharacter`'s shape: stat columns, `traits` (string[]), `abilities`/`gear` (`{ id?, name, description, class_id }[]`), `perks` (markdown string, v1), `common_items` (string[]), `quirks`/`accessories` (`{ name, description }[]`, v2), `ability_perks` (`{ class_ability_id, text, position, compounds_with }[]`, v2), `additional_gear` (markdown string, v1). Task 5's route renders it.

- [ ] **Step 1: Write the failing tests**

Create `views/partials/character-details.test.js`:

```js
// The full-sheet details fragment served by GET /characters/:id/details and
// lazy-loaded into the /party roster and the LFG post page. These tests are
// the contract for what an expanded member shows on both pages.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../../util/handlebars');
const { renderMarkdown } = require('../../util/markdown');
const { statList } = require('../../util/enclave-consts');

const DETAILS_SRC = fs.readFileSync(path.join(__dirname, 'character-details.handlebars'), 'utf8');
const TAG_SRC = fs.readFileSync(path.join(__dirname, 'character-detail-tag.handlebars'), 'utf8');
const READONLY_SRC = fs.readFileSync(path.join(__dirname, 'stat-blocks-readonly.handlebars'), 'utf8');

const render = (character, effectiveVersion = 'v1') => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  hb.registerHelper('markdown', renderMarkdown);
  hb.registerPartial('character-detail-tag', TAG_SRC);
  hb.registerPartial('stat-blocks-readonly', READONLY_SRC);
  return hb.compile(DETAILS_SRC)({ character, effectiveVersion, statList });
};

const makeCharacter = (overrides = {}) => ({
  id: 'char-1',
  name: 'Ash',
  ...Object.fromEntries(statList.map(stat => [stat, 2])),
  traits: ['brave'],
  abilities: [{ id: 'ab-1', name: 'Fireball', description: 'Big boom', class_id: 'class-a' }],
  gear: [{ name: 'Staff', description: 'Pointy', class_id: 'class-a' }],
  ability_perks: [],
  quirks: [],
  accessories: [],
  common_items: [],
  perks: '',
  additional_gear: '',
  ...overrides,
});

const count = (html, needle) => (html.match(new RegExp(needle, 'g')) || []).length;

test('stats always render, one block row per stat', () => {
  const html = render(makeCharacter());
  expect(html).toContain('Stats');
  expect(count(html, 'stat-blocks')).toBe(statList.length);
});

test('tooltip ids carry the character id so same-class members cannot collide', () => {
  const html = render(makeCharacter());
  expect(html).toContain('detail-char-1-ability-class-a-fireball');
  expect(html).toContain('detail-char-1-gear-class-a-staff');
});

test('empty sections are omitted, not rendered blank', () => {
  const html = render(makeCharacter({ abilities: [], gear: [], traits: [], common_items: [] }));
  expect(html).not.toContain('Class Abilities');
  expect(html).not.toContain('Signature Gear');
  expect(html).not.toContain('Personality');
  expect(html).not.toContain('Common Items');
});

test('v1 shows the markdown perks and never the v2 sections', () => {
  const html = render(makeCharacter({
    perks: 'V1 PERK TEXT',
    quirks: [{ name: 'Jumpy', description: 'twitchy' }],
  }), 'v1');
  expect(html).toContain('V1 PERK TEXT');
  expect(html).not.toContain('Quirks');
  expect(html).not.toContain('Jumpy');
});

test('v2 shows quirks, accessories and per-ability perks and never the v1 perks', () => {
  const html = render(makeCharacter({
    perks: 'V1 PERK TEXT',
    additional_gear: 'OLD GEAR TEXT',
    quirks: [{ name: 'Jumpy', description: 'twitchy' }],
    accessories: [{ name: 'Charm' }],
    ability_perks: [{ class_ability_id: 'ab-1', text: 'Perk one', position: 0, compounds_with: null }],
  }), 'v2');
  expect(html).toContain('Jumpy');
  expect(html).toContain('twitchy');
  expect(html).toContain('Charm');
  expect(html).toContain('Perk one');
  expect(html).not.toContain('V1 PERK TEXT');
  expect(html).not.toContain('OLD GEAR TEXT');
});

test('v1 deprecated additional gear renders with its warning tag', () => {
  const html = render(makeCharacter({ additional_gear: 'OLD GEAR TEXT' }), 'v1');
  expect(html).toContain('OLD GEAR TEXT');
  expect(html).toContain('Deprecated');
});

test('a gated item shows its name but offers no tooltip', () => {
  const html = render(makeCharacter({
    abilities: [{ id: 'ab-1', name: 'Fireball', description: '', class_id: 'class-a' }],
    gear: [],
  }));
  expect(html).toContain('Fireball');
  expect(html).not.toContain('data-tooltip-markdown');
});

test('common items render as a markdown list', () => {
  const html = render(makeCharacter({ common_items: ['**Rope**, 50ft'] }));
  expect(html).toContain('Common Items');
  expect(html).toContain('<strong>Rope</strong>');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test views/partials/character-details.test.js`
Expected: FAIL — `character-details.handlebars` missing (ENOENT).

- [ ] **Step 3: Create the partial**

Create `views/partials/character-details.handlebars`:

```handlebars
{{!-- Full-sheet character details fragment. Rendered by
      GET /characters/:id/details with { character, effectiveVersion,
      statList } and lazy-loaded into the /party roster and the LFG post
      page. Descriptions arrive already gated by
      services/character/description-gate.js — a gated item has a blank
      description and renders as a plain tag (see character-detail-tag). --}}
<div class="character-details">
  <h4 class="title is-5">Stats</h4>
  <div class="columns is-multiline is-mobile">
    {{#each statList}}
    <div class="column is-half-mobile is-one-third-tablet">
      <p class="mb-1"><strong>{{capitalize this}}</strong></p>
      {{> stat-blocks-readonly value=(lookup ../character this) max=5}}
    </div>
    {{/each}}
  </div>

  {{#if character.abilities.length}}
  <h4 class="title is-5">Class Abilities</h4>
  <div class="tags">
    {{#each character.abilities}}
    {{> character-detail-tag item=this idPrefix=(concat "detail-" ../character.id "-ability") className="tag is-primary is-medium"}}
    {{/each}}
  </div>
  {{/if}}

  {{#if character.gear.length}}
  <h4 class="title is-5">Signature Gear</h4>
  <div class="tags">
    {{#each character.gear}}
    {{> character-detail-tag item=this idPrefix=(concat "detail-" ../character.id "-gear") className="tag is-gray is-medium"}}
    {{/each}}
  </div>
  {{/if}}

  {{#if character.traits.length}}
  <h4 class="title is-5">Personality</h4>
  <div class="tags">
    {{#each character.traits}}
    <span class="tag is-primary is-medium">{{capitalize this}}</span>
    {{/each}}
  </div>
  {{/if}}

  {{#if (eq effectiveVersion 'v1')}}
  {{#if character.perks}}
  <h4 class="title is-5">Ability Perks</h4>
  <div class="content">{{{markdown character.perks}}}</div>
  {{/if}}
  {{/if}}

  {{#if character.common_items.length}}
  <h4 class="title is-5">Common Items</h4>
  <div class="content">
    <ul>
      {{#each character.common_items}}
      <li>{{{markdown this}}}</li>
      {{/each}}
    </ul>
  </div>
  {{/if}}

  {{#if (eq effectiveVersion 'v2')}}
    {{#if character.quirks.length}}
    <h4 class="title is-5">Quirks</h4>
    <ul>
      {{#each character.quirks}}
      <li><strong>{{this.name}}</strong>{{#if this.description}} — {{this.description}}{{/if}}</li>
      {{/each}}
    </ul>
    {{/if}}

    {{#if character.accessories.length}}
    <h4 class="title is-5">Accessories</h4>
    <ul>
      {{#each character.accessories}}
      <li><strong>{{this.name}}</strong>{{#if this.description}} — {{this.description}}{{/if}}</li>
      {{/each}}
    </ul>
    {{/if}}

    {{#if character.ability_perks.length}}
    <h4 class="title is-5">Ability Perks</h4>
    {{#each character.abilities}}
      {{#with (perksForAbility ../character.ability_perks this.id) as |perks|}}
        {{#if perks.length}}
        <h5 class="title is-6">{{capitalize ../this.name}}</h5>
        <ol>
          {{#each perks}}
          <li>
            {{this.text}}
            {{#if this.compounds_with}}<span class="tag is-info is-light ml-2">compounding</span>{{/if}}
          </li>
          {{/each}}
        </ol>
        {{/if}}
      {{/with}}
    {{/each}}
    {{/if}}
  {{/if}}

  {{#if (and (eq effectiveVersion 'v1') character.additional_gear)}}
  <h4 class="title is-5">
    Additional Gear
    <span class="tag is-warning is-light ml-2">Deprecated</span>
  </h4>
  <div class="content">{{{markdown character.additional_gear}}}</div>
  {{/if}}
</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test views/partials/character-details.test.js`
Expected: 8 pass.

- [ ] **Step 5: Commit**

```bash
git add views/partials/character-details.handlebars views/partials/character-details.test.js
git commit -m "feat: add the character-details fragment partial"
```

---

### Task 5: `GET /characters/:id/details` fragment route

**Files:**
- Modify: `routes/characters.js` (new route immediately above `router.get('/:id/:name?', ...)` at `:814`)
- Modify: `scripts/run-tests.mjs:14-26` (add the new test file to `httpFiles`)
- Test: Create `routes/character-details.test.js`

**Interfaces:**
- Consumes: `getCharacter(id, client)` (`models/character`), `getClass(id, client)` (`models/class`), `applyDescriptionGate` (Task 1), partial `character-details` (Task 4), `statList` (`util/enclave-consts` — already imported in this file).
- Produces: `GET /characters/:id/details?lfg=<postId>` → 200 layoutless fragment, or 404 with a one-line body. Tasks 6 and 7 point their `hx-get`s at it.

- [ ] **Step 1: Write the failing tests**

Create `routes/character-details.test.js`:

```js
// Tests for GET /characters/:id/details — the shared, description-gated
// character details fragment lazy-loaded by /party and the LFG post page.
//
// Harness mirrors routes/characters.test.js: mock the data layer, boot a
// real Express app with the full Handlebars engine (helpers + partials),
// hit the live server with fetch.
const { test, expect, mock, beforeAll, afterAll, beforeEach } = require('bun:test');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

// Capture real modules so afterAll can restore them — bun's mock.module is
// process-global and would otherwise leak into other test files.
const realBase = require('../models/_base');
const realAuth = require('../models/auth');
const realProfile = require('../models/profile');
const realCharacter = require('../models/character');
const realClass = require('../models/class');
const realSystemMessage = require('../util/system-message');
const realLfg = require('../models/lfg');
const realNavLoader = require('../util/nav-loader');
const realOffscreen = require('../models/offscreen-mission');

const { statList } = require('../util/enclave-consts');

const CHAR_ID = '11111111-1111-4111-8111-111111111111';

// Mutable per-test state consulted by the module mocks, reset in beforeEach.
const state = {};

const makeCharacter = () => ({
  id: CHAR_ID,
  name: 'Ash',
  class: 'Mage',
  class_id: 'class-a',
  creator_id: 'profile-owner',
  is_public: true,
  ...Object.fromEntries(statList.map(stat => [stat, 2])),
  traits: ['brave'],
  abilities: [{ id: 'ab-1', name: 'Fireball', description: 'SECRET ABILITY TEXT', class_id: 'class-a' }],
  gear: [{ name: 'Staff', description: 'SECRET GEAR TEXT', class_id: 'class-a' }],
  ability_perks: [],
  quirks: [],
  accessories: [],
  common_items: [],
  perks: '',
  additional_gear: '',
});

const makeClient = () => ({
  from() {
    const chain = {
      select() { return chain; }, eq() { return chain; }, order() { return chain; },
      limit() { return chain; }, in() { return chain; },
      single() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(onF, onR) { return Promise.resolve({ data: [], error: null }).then(onF, onR); },
    };
    return chain;
  },
});

mock.module('../models/_base', () => ({
  supabase: makeClient(),
  supabaseAdmin: makeClient(),
  createUserClient: () => makeClient(),
  anonKey: 'test-anon-key',
}));

// Route + description gate both consult these; state drives each test.
mock.module('../models/character', () => ({
  getCharacter: async () => state.character
    ? { data: state.character, error: null }
    : { data: null, error: { code: 'PGRST116', message: 'not found' } },
}));
mock.module('../models/class', () => ({
  getClass: async () => ({ data: { id: 'class-a', rules_version: state.rulesVersion }, error: null }),
  getUnlockedClassIdsForUser: async () => ({ data: state.unlockedIds, error: null }),
}));
mock.module('../models/lfg', () => ({
  getPendingJoinRequestCount: async () => ({ count: 0 }),
  getLfgPost: async () => ({ data: state.lfgPost, error: null }),
}));

// A bearer token routes authOptional down its signed-in branch; without one
// it short-circuits and never consults these.
mock.module('../models/auth', () => ({
  getUserFromToken: async (token) => (token ? { id: 'user-1' } : false),
}));
mock.module('../models/profile', () => ({
  getProfile: async () => state.profile,
}));
mock.module('../util/system-message', () => ({ getSystemMessage: () => null }));
mock.module('../util/nav-loader', () => ({
  populateNavItems: async () => {},
  loadNavItems: (req, res, next) => next(),
}));
mock.module('../models/offscreen-mission', () => ({
  listOffscreenMissions: async () => ({ data: [], error: null }),
  getAvailableHostedMissionsForPicker: async () => ({ data: [], error: null }),
  getOffscreenMissionById: async () => ({ data: null, error: null }),
}));

const express = require('express');
const exphbs = require('express-handlebars');
const hbsHelpers = require('handlebars-helpers')();
const range = require('handlebars-helper-range');
const path = require('path');
const {
  times, date_tz, calendar_link, getTotalV1MissionsNeeded, getTotalV2MissionsNeeded,
  setVariable, encodeURIComponentH, dump, videoEmbed, isSupportedVideoUrl,
  substring, concat, effectiveRulesVersion, wordCount, perksForAbility, nextPerkPosition, json
} = require('../util/handlebars');
const { renderMarkdown } = require('../util/markdown');
const { startHttpServer, stopHttpServer } = require('../test/helpers/http-server');

let server;
let baseUrl;

beforeAll(async () => {
  delete require.cache[require.resolve('./characters')];
  delete require.cache[require.resolve('../services/character/description-gate')];

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.engine('handlebars', exphbs.engine({
    layoutsDir: path.join(__dirname, '..', 'views', 'layouts'),
    partialsDir: path.join(__dirname, '..', 'views', 'partials'),
    defaultLayout: 'main',
    helpers: {
      ...hbsHelpers, times, range, date_tz, calendar_link, encodeURIComponentH,
      getTotalV1MissionsNeeded, getTotalV2MissionsNeeded, setVariable, dump,
      videoEmbed, isSupportedVideoUrl, substring, concat, effectiveRulesVersion,
      wordCount, perksForAbility, nextPerkPosition, json, markdown: renderMarkdown,
    },
  }));
  app.set('view engine', 'handlebars');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use((req, res, next) => {
    res.locals.supabaseUrl = process.env.SUPABASE_URL;
    res.locals.supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    next();
  });

  app.use('/characters', require('./characters'));
  ({ server, baseUrl } = await startHttpServer(app));
});

afterAll(async () => {
  await stopHttpServer(server);
  mock.module('../models/_base', () => realBase);
  mock.module('../models/auth', () => realAuth);
  mock.module('../models/profile', () => realProfile);
  mock.module('../models/character', () => realCharacter);
  mock.module('../models/class', () => realClass);
  mock.module('../util/system-message', () => realSystemMessage);
  mock.module('../models/lfg', () => realLfg);
  mock.module('../util/nav-loader', () => realNavLoader);
  mock.module('../models/offscreen-mission', () => realOffscreen);
  delete require.cache[require.resolve('./characters')];
  delete require.cache[require.resolve('../services/character/description-gate')];
});

beforeEach(() => {
  state.character = makeCharacter();
  state.profile = null;
  state.unlockedIds = new Set();
  state.lfgPost = null;
  state.rulesVersion = 'v1';
});

const get = (url, signedIn = false) => fetch(`${baseUrl}${url}`, {
  headers: { Accept: 'text/html', ...(signedIn ? { Authorization: 'Bearer test-token' } : {}) },
});

test('a visible character renders the fragment without the site layout', async () => {
  // No <nav also proves route ordering: if /:id/:name? swallowed this as
  // name="details", the full page would render with the layout.
  const res = await get(`/characters/${CHAR_ID}/details`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('Stats');
  expect(html).toContain('Fireball');
  expect(html).not.toContain('<nav');
});

test('a character RLS will not return is a 404', async () => {
  state.character = null;
  const res = await get(`/characters/${CHAR_ID}/details`);
  expect(res.status).toBe(404);
});

test('signed out, names show and descriptions do not', async () => {
  const res = await get(`/characters/${CHAR_ID}/details`);
  const html = await res.text();
  expect(html).toContain('Fireball');
  expect(html).toContain('Staff');
  expect(html).not.toContain('SECRET ABILITY TEXT');
  expect(html).not.toContain('SECRET GEAR TEXT');
});

test('signed in with the class unlocked, descriptions show in full', async () => {
  state.profile = { id: 'profile-1', user_id: 'user-1' };
  state.unlockedIds = new Set(['class-a']);
  const res = await get(`/characters/${CHAR_ID}/details`, true);
  const html = await res.text();
  expect(html).toContain('SECRET ABILITY TEXT');
  expect(html).toContain('SECRET GEAR TEXT');
});

test('signed in with the class locked, descriptions stay hidden', async () => {
  state.profile = { id: 'profile-1', user_id: 'user-1' };
  const res = await get(`/characters/${CHAR_ID}/details`, true);
  const html = await res.text();
  expect(html).toContain('Fireball');
  expect(html).not.toContain('SECRET ABILITY TEXT');
});

test('?lfg lets the hosting Conduit read an approved applicant in full', async () => {
  state.profile = { id: 'host-1', user_id: 'user-1' };
  state.lfgPost = {
    host_id: 'host-1',
    join_requests: [{ status: 'approved', character: { id: CHAR_ID } }],
  };
  const res = await get(`/characters/${CHAR_ID}/details?lfg=post-1`, true);
  const html = await res.text();
  expect(html).toContain('SECRET ABILITY TEXT');
  expect(html).toContain('SECRET GEAR TEXT');
});
```

- [ ] **Step 2: Register the file as http-tier, then run it to verify it fails**

In `scripts/run-tests.mjs`, add to the `httpFiles` set (alphabetical position):

```js
  'routes/character-details.test.js',
```

Run: `bun test routes/character-details.test.js`
Expected: FAIL — requests return 200 full pages or 404s from the `/:id/:name?` route (no fragment route exists yet).

- [ ] **Step 3: Add the route**

In `routes/characters.js`, directly **above** `router.get('/:id/:name?', authOptional, ...)` (line 814), insert:

```js
// Full-sheet details fragment, lazy-loaded by the /party roster and the LFG
// post page (which passes ?lfg=<postId> so a hosting Conduit sees approved
// applicants ungated). Visibility is RLS's: a character the viewer cannot
// see never comes back from getCharacter. Must stay mounted before
// /:id/:name? or that greedy route swallows it as name="details".
router.get('/:id/details', authOptional, async (req, res) => {
  const { profile } = res.locals;
  const { data: character, error } = await getCharacter(req.params.id, res.locals.supabase);
  if (error || !character) {
    return res.status(404).send('<p class="has-text-grey">Character not found.</p>');
  }

  // fetch class record for the effective rules version (non-fatal on failure)
  let characterClass = null;
  try {
    if (character.class_id) {
      const { data: cls } = await getClass(character.class_id, res.locals.supabase);
      if (cls) characterClass = cls;
    }
  } catch (_) {
    // ignore; render as v1 without class details
  }
  const effectiveVersion = (characterClass && characterClass.rules_version === 'v2') ? 'v2' : 'v1';

  await applyDescriptionGate({
    character,
    profile,
    userId: (profile && profile.user_id) || (res.locals.user && res.locals.user.id) || null,
    lfgPostId: req.query.lfg,
    client: res.locals.supabase
  });

  res.render('partials/character-details', {
    layout: false,
    character,
    effectiveVersion,
    statList
  });
});
```

(`getCharacter`, `getClass`, `applyDescriptionGate`, and `statList` are already imported at the top of the file after Task 2.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test routes/character-details.test.js && bun scripts/run-tests.mjs http`
Expected: 6 new tests pass; the rest of the http tier stays green.

- [ ] **Step 5: Commit**

```bash
git add routes/characters.js routes/character-details.test.js scripts/run-tests.mjs
git commit -m "feat: serve gated character details as an htmx fragment"
```

---

### Task 6: Party roster rows with lazy details

**Files:**
- Modify: `views/partials/party-roster.handlebars` (full rewrite of the members branch)
- Modify: `models/character.js:326` (add `level` to `getPartyCharacters`' select)
- Test: Modify `routes/party.test.js` (fixture + one new test)

**Interfaces:**
- Consumes: `GET /characters/:id/details` (Task 5); member rows carry `{ id, name, class, level, is_public, is_deceased }` from `getPartyCharacters`.
- Produces: each member row exposes `data-member-id` (row), `data-remove-character` (button), and a Details toggle targeting `#member-details-<id>`. Task 8's e2e clicks these.

- [ ] **Step 1: Extend the http test (failing first)**

In `routes/party.test.js`:
1. In the `characterRow` factory, add `level: 3,` after `class_id: uuid(99),`.
2. Add after the existing member-ordering test:

```js
test('each member row lazy-loads the shared details fragment', async () => {
  const res = await get(`/party?c=${ID[0]}`);
  const html = await res.text();
  // "click once": the fragment loads on first expand only; Alpine's x-show
  // handles every toggle after that. A panel swap re-renders the row
  // collapsed and re-arms the trigger, which is correct — membership
  // changed, the details re-fetch on next expand.
  expect(html).toContain(`hx-get="/characters/${ID[0]}/details"`);
  expect(html).toContain('hx-trigger="click once"');
  expect(html).toContain(`id="member-details-${ID[0]}"`);
  expect(html).toContain('Level 3');
});
```

Run: `bun test routes/party.test.js`
Expected: the new test FAILS (roster renders chips, no details affordance); all existing tests still pass.

- [ ] **Step 2: Add `level` to the party select**

In `models/character.js` line 326, change the select to:

```js
    .select(`id, name, image_url, class, class_id, level, is_deceased, is_public, ${statList.join(', ')}`)
```

- [ ] **Step 3: Rewrite the roster partial**

Replace the whole of `views/partials/party-roster.handlebars` with:

```handlebars
{{!-- Member rows for the current party. Remove sends only this member's id
      and hx-includes #party-csv for the rest — see the note in
      views/partials/party-panel.handlebars. Details lazy-loads the shared
      character-details fragment on first expand ("click once") into the
      row's container; Alpine's open flag handles visibility from then on.
      A panel swap re-renders rows collapsed and re-arms the trigger, so
      details simply re-fetch on the next expand. No hx-push-url anywhere
      here: expanding details is not navigation. --}}
{{#if members.length}}
<div class="party-roster">
  {{#each members}}
  <div class="box p-3 mb-2" data-member-id="{{this.id}}" x-data="{ open: false }">
    <div class="level is-mobile mb-0">
      <div class="level-left">
        <div class="level-item">
          <div>
            <a href="/characters/{{this.id}}/{{encodeURIComponentH this.name}}"><strong>{{this.name}}</strong></a>
            {{#unless this.is_public}}
            <span class="icon is-small" title="Private"><i class="fas fa-lock"></i></span>
            {{/unless}}
            {{#if this.is_deceased}}
            <span class="icon is-small" title="Deceased"><i class="fas fa-skull"></i></span>
            {{/if}}
            <p class="help mb-0">{{this.class}}{{#if this.level}} · Level {{this.level}}{{/if}}</p>
          </div>
        </div>
      </div>
      <div class="level-right">
        <div class="level-item">
          <button type="button" class="button is-small is-info"
            @click="open = !open"
            hx-get="/characters/{{this.id}}/details"
            hx-trigger="click once"
            hx-target="#member-details-{{this.id}}"
            hx-swap="innerHTML">
            Details
          </button>
        </div>
        <div class="level-item">
          <button type="button" class="delete"
            data-remove-character="{{this.id}}"
            aria-label="Remove {{this.name}} from the party"
            hx-get="/party/panel"
            hx-vals='{"remove": "{{this.id}}"}'
            hx-include="#party-csv"
            hx-target="#party-panel"
            hx-swap="outerHTML"></button>
        </div>
      </div>
    </div>
    <div id="member-details-{{this.id}}" x-show="open" x-cloak class="mt-3"></div>
  </div>
  {{/each}}
</div>
{{else}}
<p class="has-text-grey">No members yet. Add characters from the left to build a party.</p>
{{/if}}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test routes/party.test.js && bun scripts/run-tests.mjs unit`
Expected: all pass (`models/party-characters.test.js` is unaffected — it only guards the empty-list short-circuit).

- [ ] **Step 5: Commit**

```bash
git add views/partials/party-roster.handlebars models/character.js routes/party.test.js
git commit -m "feat: expand party roster rows with lazy character details"
```

---

### Task 7: LFG post page adopts the shared gated details

**Files:**
- Modify: `views/lfg-post.handlebars:100-158` (Details button + inline panel)
- Modify: `models/lfg.js:124-135` (trim the nested select)
- Test: Modify `views/lfg-post.test.js`

**Interfaces:**
- Consumes: `GET /characters/:id/details?lfg=<postId>` (Task 5).
- Produces: the LFG Details panel is the shared fragment; `post.join_requests[].character` no longer carries `personality`/`abilities`/`gear` (only Task 7 consumers existed — `routes/lfg.js`'s summary uses the stats, which stay).

- [ ] **Step 1: Update the view test (failing first)**

In `views/lfg-post.test.js`, replace the test `'lfg-post renders blocks and no longer prints plus characters'` (lines 61-66) with:

```js
test('member details lazy-load the shared fragment with the lfg host context', () => {
  // The inline stats/abilities/gear/personality panel is gone; the Details
  // button fetches the shared character-details fragment once, carrying the
  // post id so the description gate can apply the host exception.
  expect(LFG_SRC).toContain('hx-get="/characters/{{this.character.id}}/details?lfg={{../post.id}}"');
  expect(LFG_SRC).toContain('hx-trigger="click once"');
  expect(LFG_SRC).not.toContain('lfg-ability-');
  expect(LFG_SRC).not.toContain('lfg-gear-');
});

test('the empty details container keeps its id prefix for the history probe', () => {
  // e2e/specs/14-lfg-controls.spec.js counts [id^="character-details-"] as
  // its fixture-integrity check before the history-snapshot regression.
  expect(LFG_SRC).toContain('id="character-details-{{this.character.id}}"');
});
```

Run: `bun test views/lfg-post.test.js`
Expected: the two new tests FAIL; the others pass.

- [ ] **Step 2: Replace the Details button and delete the inline panel**

In `views/lfg-post.handlebars`, keep the comment at lines 89-99 exactly as it is, and replace the button (lines 100-103) with:

```handlebars
              <button class="button is-small is-info"
                @click="open = !open"
                hx-get="/characters/{{this.character.id}}/details?lfg={{../post.id}}"
                hx-trigger="click once"
                hx-target="#character-details-{{this.character.id}}"
                hx-swap="innerHTML">
                Details
              </button>
```

Replace the details row (lines 106-160: the second `<tr>` whose `<td colspan="5">` holds the `#character-details-…` box with stats/abilities/gear/personality) with:

```handlebars
          <tr>
            <td colspan="5">
              <div id="character-details-{{this.character.id}}" class="box" x-show="open" x-cloak></div>
            </td>
          </tr>
```

The `<tbody x-data="{ open: false }">` wrapper stays.

- [ ] **Step 3: Trim the nested select**

In `models/lfg.js`, replace the `character:character_id (...)` block (lines 124-135) with:

```js
      character:character_id (
        id,
        name,
        class,
        level,
        is_public,
        is_deceased,
        ${statList.join(',')}
      )
```

(The deleted `personality`/`abilities`/`gear` nestings fed only the inline panel; the party summary in `routes/lfg.js` reads the stat columns, which remain. If `models/lfg.test.js` pins the old select string, update its expectation to this trimmed shape.)

- [ ] **Step 4: Run the tests to verify everything passes**

Run: `bun test views/lfg-post.test.js && bun scripts/run-tests.mjs unit && bun scripts/run-tests.mjs http`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add views/lfg-post.handlebars models/lfg.js views/lfg-post.test.js
git commit -m "feat: adopt gated lazy details on the LFG post page"
```

---

### Task 8: End-to-end coverage

**Files:**
- Modify: `e2e/specs/17-virtual-party.spec.js` (one new test)
- Verify (no edit expected): `e2e/specs/14-lfg-controls.spec.js`

**Interfaces:**
- Consumes: the roster row markup from Task 6 (`data-member-id`, Details button, `#member-details-<id>`); fixtures `seedClass`/`seedCharacter` already used by this spec (alpha has `might: 3`).

**Precondition:** local Supabase running (`supabase start`) — the e2e suite drives the real app via Playwright's config.

- [ ] **Step 1: Add the details-expansion test**

Append to `e2e/specs/17-virtual-party.spec.js`:

```js
test('a member row expands to show the lazy details fragment', async ({ page }) => {
  await page.goto(`/party?c=${alpha.id}`);

  const row = page.locator(`#party-panel [data-member-id="${alpha.id}"]`);
  await row.locator('button:has-text("Details")').click();

  // The fragment arrives over htmx after the click; toContainText retries
  // until it lands. alpha's might: 3 proves real stats rendered, not just
  // the section scaffold.
  const details = page.locator(`#member-details-${alpha.id}`);
  await expect(details).toContainText('Stats');
  await expect(details).toContainText('Might');

  // Expanding details is not navigation: the URL must not change.
  await expect(page).toHaveURL(new RegExp(`/party\\?c=${alpha.id}`));
});
```

- [ ] **Step 2: Run both affected specs**

Run: `bunx playwright test e2e/specs/17-virtual-party.spec.js e2e/specs/14-lfg-controls.spec.js`
Expected: all pass. 17's new test proves the fragment loads in a real browser; 14 staying green proves the lazy Details button did not reintroduce the history-snapshot regression (its fixture-integrity probe still finds `[id^="character-details-"]` because the empty container is server-rendered).

- [ ] **Step 3: Run the full local tiers one last time**

Run: `bun scripts/run-tests.mjs unit && bun scripts/run-tests.mjs http`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/17-virtual-party.spec.js
git commit -m "test: cover party details expansion end-to-end"
```

---

## Release note (for the deploy that ships this)

The LFG post page's Details panel now shows the full character sheet but gates class ability/gear descriptions behind sign-in + class unlock (hosts still see approved applicants in full). Signed-out viewers lose descriptions they could previously read there — intended; it closes a paid-content leak.
