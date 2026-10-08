# Stat Scaling Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every per-character stat on the site explains itself with the book's Stat Scaling Table text, and every stat being chosen shows what each plus buys (#178).

**Architecture:** The printed table lives as static data in `util/stat-scaling.js` behind two lookups. Two Handlebars helpers expose the lookups to views. A `stat-value` partial wraps a displayed stat in the site's existing tippy tooltip (`data-tooltip-markdown=""` plus a hidden `.tooltip-markdown` sibling, initialised by `public/js/app.js#_initTooltips`). A `stat-scaling-row` partial gives editors' stat names the whole row.

**Tech Stack:** Express, express-handlebars, handlebars-helpers, tippy.js (already loaded on demand by `public/js/app.js`), Bulma, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-08-game-tables-design.md` — section "1. Stat Scaling reference". This plan is sub-project 1 of 5.

## Global Constraints

- Source text: *ENCLAVE Advent V2* pp. 35–36 (Baseline through `+++++`) and *ENCLAVE Aspirant V1* p. 4 (`+++ +++`, `+++ + +++`, `++++ ++++`). The text in Task 1 is transcribed verbatim from those pages, including curly apostrophes (’). Do not paraphrase it.
- A stat value is a plus count: `0` is Baseline, `1` is `+`, and so on up to `8`. Any other value (9+, negative, non-integer, null) has no entry and renders with no tooltip.
- No edition parameter anywhere. Advent caps a Stat at 5, so values above 5 only occur under Aspirant.
- Party **totals** never get a tooltip. Only per-character values do.
- Stat keys are `util/enclave-consts.js#statList`: `vitality, might, resilience, spirit, arcane, will, sensory, reflex, vigor, skill, intelligence, luck`.
- Tooltips use the existing mechanism only. Do not add a tooltip library or a new init path.
- Run tests with `bun test <file>` for one file and `bun run test:unit` for the tier. `test:unit` scrubs `SUPABASE_URL`; never point tests at production. Check the known-red baseline in auto-memory before treating a red as a regression.
- Commit only the files you touched (`git add <paths>`, never `git commit -a`). Other sessions commit to this checkout.

## Review Focus

1. **A value above 5 on an Advent-format sheet** (stored data predating caps): it must still render, with the Aspirant row text if 6–8 and with no tooltip at 9+. It must never error. *Pinned in Task 2 (`9 renders plain`).*
2. **A null stat** (a legacy row, or a guest in sub-project 2): it must render as today, with no tooltip and no `undefined` text. *Pinned in Task 2.*
3. **A tooltip in a party breakdown cell after an htmx swap** (the /party roster re-renders through `/party/panel`): `_initTooltips(swapRoot)` already runs on `htmx:afterSwap` (`public/js/app.js:1105`), so this works only if the trigger and its `.tooltip-markdown` sibling are adjacent. *Pinned in Task 2 by asserting the sibling markup.*
4. **The wizard re-rendering its stat grid on every click and hover** (`renderStatGrid`): tooltips must be destroyed before `innerHTML` replaces the grid, or tippy poppers are orphaned on `document.body`. *Task 3, Step 7, plus a manual check.*
5. **Keyboard and touch access**: triggers carry `tabindex="0"`. Tippy's default triggers (`mouseenter focus`) cover focus, and tippy shows on tap on touch devices. *Asserted in Task 2's markup test.*

---

### Task 1: Stat Scaling data and lookups

**Files:**
- Create: `util/stat-scaling.js`
- Test: `util/stat-scaling.test.js`

**Interfaces:**
- Produces:
  - `statScaling(stat: string, value: number) → Entry | null`
  - `statScalingRow(stat: string) → Entry[]`, which is Baseline through `+++++` (6 entries) and `[]` for an unknown stat.
  - `Entry = { stat: string, statLabel: string, note: string | null, pluses: number, label: string, lines: Array<{ term: string | null, text: string }> }`
  - `PLUS_LABELS: string[]` (9 labels).

- [ ] **Step 1: Write the failing tests**

```js
// util/stat-scaling.test.js
// The Stat Scaling Table (Advent pp. 35–36, Aspirant p. 4) as the lookups
// every stat tooltip reads.
const { test, expect } = require('bun:test');
const { statScaling, statScalingRow, PLUS_LABELS } = require('./stat-scaling');
const { statList } = require('./enclave-consts');

test('a plus count returns that cell of the printed table', () => {
  expect(statScaling('might', 1)).toEqual({
    stat: 'might',
    statLabel: 'Might',
    note: null,
    pluses: 1,
    label: '+',
    lines: [{ term: null, text: 'Crush an apple one-handed.' }],
  });
});

test('a two-part cell keeps its mechanic term', () => {
  expect(statScaling('will', 0).lines).toEqual([
    { term: 'Essence', text: 'Drop a Threshold after two Mid Costs.' },
    { term: 'Defiance', text: 'Skydive despite being scared to do so.' },
  ]);
});

test('six to eight pluses read the Aspirant expanded table', () => {
  expect(statScaling('might', 6).label).toBe('+++ +++');
  expect(statScaling('might', 6).lines[0].text).toBe('Stop a speeding car in its tracks.');
  expect(statScaling('will', 8).lines[0].text).toBe('Drop a Threshold after a High amount of Low Costs.');
});

test('anything outside Baseline to eight pluses has no entry', () => {
  for (const value of [9, -1, 1.5, null, undefined, '2']) {
    expect(statScaling('might', value)).toBeNull();
  }
  expect(statScaling('charisma', 1)).toBeNull();
});

test('every stat has all nine cells transcribed', () => {
  for (const stat of statList) {
    for (let pluses = 0; pluses <= 8; pluses++) {
      const entry = statScaling(stat, pluses);
      expect(entry).not.toBeNull();
      expect(entry.label).toBe(PLUS_LABELS[pluses]);
      expect(entry.lines.length).toBeGreaterThan(0);
      for (const line of entry.lines) expect(line.text.trim()).not.toBe('');
    }
  }
});

test('a row is the Advent table, Baseline through five pluses', () => {
  const row = statScalingRow('arcane');
  expect(row.map(e => e.label)).toEqual(['Baseline', '+', '++', '+++', '++++', '+++++']);
  expect(row[0].note).toBe('Without Sacrifice');
  expect(statScalingRow('charisma')).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test util/stat-scaling.test.js`
Expected: FAIL, `Cannot find module './stat-scaling'`.

- [ ] **Step 3: Write the module**

```js
// util/stat-scaling.js
// The Stat Scaling Table: what a character can do at each plus count of each
// Stat. Baseline through +++++ is ENCLAVE Advent V2 pp. 35–36; the three
// columns beyond are Aspirant V1 p. 4's Expanded Stat Scaling. Text is
// verbatim from the books.
//
// No edition parameter: Advent caps a Stat at +++++, so only Aspirant
// characters ever have a value the expanded columns describe.

const PLUS_LABELS = ['Baseline', '+', '++', '+++', '++++', '+++++', '+++ +++', '+++ + +++', '++++ ++++'];
const ADVENT_MAX = 5;

const line = (text) => ({ term: null, text });
const term = (t, text) => ({ term: t, text });

const TABLE = {
  might: {
    label: 'Might',
    cells: [
      [line('Lift your own bodyweight.')],
      [line('Crush an apple one-handed.')],
      [line('Rip a college textbook in half.')],
      [line('Lift one end of a car.')],
      [line('Overhead press an entire car.')],
      [line('Throw a car a dozen yards.')],
      [line('Stop a speeding car in its tracks.')],
      [line('Lift one end of an empty freight train boxcar.')],
      [line('Overhead press an empty freight train boxcar.')],
    ],
  },
  reflex: {
    label: 'Reflex',
    cells: [
      [line('Climb a rope.')],
      [line('Slowly cross a tightrope.')],
      [line('Backflip on a tightrope.')],
      [line('Quickly cram yourself into a square box a third your height.')],
      [line('Comfortably land a 3-story drop unscathed.')],
      [line('Walk in someone’s shadow, matching every movement, without being noticed.')],
      [line('Dodge a bullet that you see being fired at you.')],
      [term('Inconspicuous', 'Walk through an occupied checkpoint unnoticed.')],
      [line('Stand atop still water.')],
    ],
  },
  resilience: {
    label: 'Resilience',
    cells: [
      [line('Survive several minutes of severe bleeding.')],
      [line('Pop a dislocated shoulder back in without flinching.')],
      [line('Endure full-body immolation for over a minute.')],
      [line('Take a baseball bat straight to the chest with barely a bruise.')],
      [line('Survive a pistol shot to the skull without losing consciousness.')],
      [line('Grab a swinging sword without it even breaking skin.')],
      [line('Endure a point-blank grenade explosion with only moderate injuries and disorientation.')],
      [line('Get rammed by a speeding car with barely a bruise.')],
      [line('Take a high-caliber rifle shot to the skull without it even breaking the skin.')],
    ],
  },
  sensory: {
    label: 'Sensory',
    cells: [
      [line('20/20 vision.')],
      [line('Detect a subtle change in wind speed/direction.')],
      [line('Smell poison in a drink.')],
      [line('Hear someone’s breathing through a solid wall.')],
      [line('Count the number of people in a small crowd at a glance.')],
      [line('Pick out the heartbeat of someone buried alive.')],
      [line('Quickly locate a lone four-leaf clover within a large field.')],
      [line('Follow a person’s trail for miles from the scent of a single garment.')],
      [line('Echolocate with a bat-like precision, tracing even miniscule moving objects.')],
    ],
  },
  skill: {
    label: 'Skill',
    cells: [
      [line('Catch a thrown object one-handed.'), term('Expertise — Piano', 'Play a simple, two-handed piece.')],
      [line('Safely toss a knife to yourself without looking.'), term('Expertise — Wrestling', 'Armbar an untrained person who’s larger than you.')],
      [line('Balance a pyramid of filled wine glasses at a brisk walk.'), term('Expertise — Driving', 'Powerslide into a perfect parallel park.')],
      [line('Effortlessly hit a bullseye.'), term('Expertise — Painting', 'Produce a photorealistic portrait in minutes.')],
      [line('Catch a fly between two fingers without killing it.'), term('Expertise — Surgery', 'Perform an open-heart operation solo.')],
      [line('Cut a bullet mid-flight.'), term('Expertise — Lockpicking', 'Open a tumbler lock in seconds without any tools.')],
      [line('Beat a rhythm game on the first try with a perfect score.'), term('Expertise — Guitar', 'Finger-pick six different parts simultaneously across two different instruments.')],
      [line('Cut a flying grain of sand in half.'), term('Expertise — Tennis', 'Slice with enough spin to curve the ball in any direction like a frisbee.')],
      [line('Balance two needles, stacked point-to-point, on the tip of your finger.'), term('Expertise — Cardistry', 'Shuffle and stack four marked decks simultaneously, two per hand.')],
    ],
  },
  vigor: {
    label: 'Vigor',
    cells: [
      [line('Run up a three story staircase in under 20 seconds.'), term('Stamina', 'Drop a Threshold after a pilates session.')],
      [line('Keep pace with a casual cyclist.'), term('Stamina', 'Drop a Threshold after sprinting a mile.')],
      [line('Throw 60 full-power punches in a minute.'), term('Stamina', 'Drop a Threshold after jogging a marathon.')],
      [line('Keep pace with a horse.'), term('Stamina', 'Drop a Threshold after 10 minutes of max-intensity combat.')],
      [line('With a running start, leap clean across a four-lane street.'), term('Stamina', 'Drop a Threshold after sprinting a marathon.')],
      [line('Keep pace with a car on the highway.'), term('Stamina', 'Drop a Threshold after summiting a mountain at top speed.')],
      [line('Mop a gymnasium floor by hand in under a minute.'), term('Stamina', 'Drop a threshold after sprinting a marathon having not slept for a week.')],
      [line('Run across still water for several seconds.'), term('Stamina', 'Drop a threshold after sprinting a marathon while on the brink of starvation.')],
      [line('Keep pace with a speedboat while swimming.'), term('Stamina', 'Drop a threshold after completing an entire special forces boot camp in a single day.')],
    ],
  },
  arcane: {
    label: 'Arcane',
    note: 'Without Sacrifice',
    cells: [
      [term('Manifestation', 'Light a cigarette with a snap of the fingers.')],
      [term('Manifestation', 'Glow brightly.')],
      [term('Manifestation', 'Dictate to a pen while it autonomously transcribes your words.')],
      [term('Manifestation', 'Hurl a head-sized fireball.')],
      [term('Manifestation', 'Animate a suit of armor to briefly fight at your side.')],
      [term('Manifestation', 'Drain a target’s life through prolonged touch.')],
      [term('Manifestation', 'Enchant a sword to become temporarily indestructible.')],
      [term('Manifestation', 'Raise an entire graveyard as Shamblers.')],
      [term('Manifestation', 'Teleport between two deep shadows.')],
    ],
  },
  intelligence: {
    label: 'Intelligence',
    cells: [
      [term('Deduction', 'Confirm that a clean knife was recently used.'), term('Expertise — A Local Language', 'Know the name of that language and a basic greeting.')],
      [term('Deduction', 'Confirm that a fleeing suspect has doubled back when the trail goes cold.'), term('Expertise — Cartography', 'Decipher a strange map.')],
      [term('Deduction', 'Confirm a secret passage’s presence based on an untraceable breeze.'), term('Expertise — Computers', 'Hack a mainframe first try.')],
      [term('Deduction', 'Confirm that someone is a dentist by the way they hold a pen.'), term('Expertise — Entomology', 'Recite any fact about any local species of ant.')],
      [term('Deduction', 'Confirm a villain’s master plan based on the password to his computer.'), term('Expertise — Chemistry', 'Create a potent explosive out of pantry ingredients.')],
      [term('Deduction', 'Confirm the precise time and cause of a death from a single drop of blood.'), term('Expertise — Stock Trading', 'Quadruple an investment in minutes.')],
      [term('Deduction', 'Confirm a hidden enemy’s exact position and threat level based on the time of day.'), term('Expertise — Ballistics', 'Calculate a projectile’s precise firing arc, point of impact, and likely damage with a single glance.')],
      [term('Deduction', 'Confirm a missing person’s current location based on where they were last seen a month ago.'), term('Expertise — Anthropology', 'Learn the history of an isolated culture with no written records.')],
      [term('Deduction', 'Confirm the location, timing, and objective of a surprise attack based on a minor cultural artifact from the enemy’s homeland.'), term('Expertise — Board Games', 'Beat a modern supercomputer fair and square at any board game.')],
    ],
  },
  luck: {
    label: 'Luck',
    cells: [
      [term('Happenstance', 'Find an inconsequential object.')],
      [term('Happenstance', 'A harmful strike becomes a glancing blow.')],
      [term('Happenstance', 'Find a useful object convenient to hand.')],
      [term('Happenstance', 'An enemy improbably misses an easy killing blow.')],
      [term('Happenstance', 'A critical item happens to be left unattended in your presence.')],
      [term('Happenstance', 'Clean out a poker table without once needing to bluff.')],
      [term('Happenstance', 'An unassuming local you were kind to earlier bails you out when you need it most.')],
      [term('Happenstance', 'A 20-man firing squad with modern weapons all happen to miss, and none check to make sure you are actually dead.')],
      [term('Happenstance', 'A devastating nearby explosion happens to spare you alone out of everything in sight.')],
    ],
  },
  spirit: {
    label: 'Spirit',
    cells: [
      [line('See through a clumsy lie.'), term('Intuition', 'Confirm that someone is being sarcastic.')],
      [line('See fear in someone’s eyes.'), term('Intuition', 'Confirm that a mysterious stranger is a friend.')],
      [line('Pick out unspoken tension between two people in a group.'), term('Intuition', 'Confirm that great danger is imminent.')],
      [line('See past a carefully crafted facade.'), term('Intuition', 'Confirm the nature of an unknown magic.')],
      [line('Determine the sentimental value of an object.'), term('Intuition', 'Confirm a condemned man’s innocence despite all evidence to the contrary.')],
      [line('Get a sense of what recently happened in a room you enter.'), term('Intuition', 'Confirm a secret that not a single other soul knows.')],
      [term('Empathy', 'Get the gist of what a sleeping person is dreaming about.'), term('Intuition', 'Confirm when, where, and how someone will unexpectedly die.')],
      [term('Empathy', 'Decipher precisely what a daydreaming person is reminiscing about.'), term('Intuition', 'Confirm the presence and nature of a supernatural entity, force, god, or similar.')],
      [term('Empathy', 'Learn the full details of a past interaction without anyone involved ever mentioning it.'), term('Intuition', 'Confirm the presence, capacities, and intent of a completely unknown enemy.')],
    ],
  },
  vitality: {
    label: 'Vitality',
    cells: [
      [line('Get someone’s attention in a busy room.'), term('Heartening', 'Clear up a bruise.')],
      [line('Nonverbally hold someone’s interest.'), term('Heartening', 'Restore a Mid Cost’s worth of Stamina or Essence.')],
      [line('Draw focus of a crowd away from a scuffle.'), term('Heartening', 'Close up a deep cut.')],
      [line('Keep someone talking even as they try to kill you.'), term('Heartening', 'Knit a broken bone.')],
      [line('Tempt a bloodthirsty monster away from helpless prey.'), term('Heartening', 'Restore a full Threshold of Stamina or Essence.')],
      [line('Distract a regiment of trained soldiers from a battle at hand.'), term('Heartening', 'Reattach a severed limb (with imperfect recovery of function).')],
      [line('Render a modern surveillance system unable to identify anyone’s face but your own.'), term('Heartening', 'Staunch a terminal bleed and magically restore much of the lost blood.')],
      [line('Hold a permanent place in someone’s memory until the day they die.'), term('Heartening', 'Cure a terminal illness on the death bed.')],
      [line('Draw the attention of a god without necessarily doing anything to earn it.'), term('Heartening', 'Perfectly repair a traumatic brain injury with no loss of mental function.')],
    ],
  },
  will: {
    label: 'Will',
    cells: [
      [term('Essence', 'Drop a Threshold after two Mid Costs.'), term('Defiance', 'Skydive despite being scared to do so.')],
      [term('Essence', 'Drop a Threshold after seven Low Costs.'), term('Defiance', 'Become fully lucid for a few moments during Red Essence Exhaustion.')],
      [term('Essence', 'Drop a Threshold after three Mid Costs.'), term('Defiance', 'Briefly ignore the pain of a broken limb.')],
      [term('Essence', 'Drop a Threshold after two High Costs.'), term('Defiance', 'Remain conscious even after several minutes without air.')],
      [term('Essence', 'Drop a Threshold after five Mid Costs.'), term('Defiance', 'Lock eyes with a gorgon without turning to stone.')],
      [term('Essence', 'Drop a Threshold after three High Costs.'), term('Defiance', 'Safely handle a cursed artifact known to kill anyone who touches it.')],
      [term('Essence', 'Drop a Threshold after four High Costs.'), term('Defiance', 'Safely bathe in the corrosive blood of a hydra.')],
      [term('Essence', 'Drop a Threshold after a Low amount of Mid Costs.'), term('Defiance', 'Ignore the direct command of a mighty god.')],
      [term('Essence', 'Drop a Threshold after a High amount of Low Costs.'), term('Defiance', 'Refuse to die for a Low Duration.')],
    ],
  },
};

const entryFor = (stat, row, pluses) => ({
  stat,
  statLabel: row.label,
  note: row.note || null,
  pluses,
  label: PLUS_LABELS[pluses],
  lines: row.cells[pluses],
});

const statScaling = (stat, value) => {
  const row = TABLE[stat];
  if (!row || !Number.isInteger(value) || value < 0 || value >= row.cells.length) return null;
  return entryFor(stat, row, value);
};

const statScalingRow = (stat) => {
  const row = TABLE[stat];
  if (!row) return [];
  return row.cells.slice(0, ADVENT_MAX + 1).map((_, pluses) => entryFor(stat, row, pluses));
};

module.exports = { statScaling, statScalingRow, PLUS_LABELS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test util/stat-scaling.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Spot-check the transcription against the book**

Open `~/Documents/Enclave/ENCLAVE Advent V2.pdf` at PDF pages 40–41 (printed 35–36) and `ENCLAVE Aspirant V1.pdf` at PDF page 9 (printed 4). Compare three random cells per page against `TABLE`. Fix any mismatch in the data, not in the tests.

- [ ] **Step 6: Commit**

```bash
git add util/stat-scaling.js util/stat-scaling.test.js
git commit -m "feat: Stat Scaling Table as data (#178)"
```

---

### Task 2: `stat-value` tooltip on per-character stats

**Files:**
- Modify: `util/handlebars.js` (require `./stat-scaling`; add `statScaling` and `statScalingRow` to `module.exports`)
- Create: `views/partials/stat-scaling-entry.handlebars`
- Create: `views/partials/stat-value.handlebars`
- Create: `views/partials/stat-value.test.js`
- Modify: `views/partials/party-summary.handlebars` (breakdown `<td>` only)
- Modify: `views/partials/party-summary.test.js`
- Modify: `views/character.handlebars:238-245` (the `statsReadOnly` rows)
- Modify: `views/partials/character-details.handlebars:10-23`
- Modify: `views/partials/character-details.test.js` (register the new partials)
- Modify: `views/lfg-post.test.js` (register the new partials if it renders `party-summary`)
- Modify: `public/css/styles.css`

**Interfaces:**
- Consumes: `statScaling`, `statScalingRow` and `Entry` from Task 1.
- Produces:
  - Helpers `statScaling` and `statScalingRow` on the express-handlebars engine. `app.js` spreads `util/handlebars` wholesale, so there's no `app.js` change.
  - Partial `stat-value` with params:
    - `stat`: a stat key
    - `value`: the plus count
    - `blocks` (optional, boolean): render `stat-blocks-readonly` with `max=5` and the over-5 "N points" note instead of the bare number
  - Partial `stat-scaling-entry`: renders one `Entry` from its context.

- [ ] **Step 1: Write the failing partial test**

```js
// views/partials/stat-value.test.js
// The stat tooltip every per-character stat renders through. The trigger and
// its .tooltip-markdown sibling must stay adjacent: public/js/app.js's
// _initTooltips finds the content as the trigger's next element sibling,
// including after htmx swaps.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const rangeHelper = require('handlebars-helper-range');
const customHelpers = require('../../util/handlebars');

const partial = (name) => fs.readFileSync(path.join(__dirname, `${name}.handlebars`), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerHelper('range', rangeHelper);
  for (const name of ['stat-blocks-readonly', 'stat-scaling-entry']) hb.registerPartial(name, partial(name));
  return hb.compile(partial('stat-value'))(context).replace(/\s+/g, ' ');
};

test('a stat is a focusable trigger followed by its Stat Scaling text', () => {
  const html = render({ stat: 'might', value: 1 });
  expect(html).toMatch(/<span class="stat-value" tabindex="0" data-tooltip-markdown="">\s?1\s?<\/span>\s?<div class="tooltip-markdown is-hidden">/);
  expect(html).toContain('<strong>+ Might</strong>');
  expect(html).toContain('Crush an apple one-handed.');
});

test('a mechanic line is labelled with its term', () => {
  const html = render({ stat: 'will', value: 0 });
  expect(html).toContain('<strong>Essence</strong>: Drop a Threshold after two Mid Costs.');
});

test('a value the table does not cover renders plain, with no tooltip', () => {
  for (const value of [9, null]) {
    const html = render({ stat: 'might', value });
    expect(html).not.toContain('data-tooltip-markdown');
    expect(html).not.toContain('tooltip-markdown');
    expect(html).not.toContain('undefined');
  }
});

test('block mode wraps the blocks and keeps the over-cap note', () => {
  const html = render({ stat: 'might', value: 6, blocks: true });
  expect(html).toContain('stat-blocks is-readonly');
  expect(html).toContain('6 points');
  expect(html).toContain('Stop a speeding car in its tracks.');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test views/partials/stat-value.test.js`
Expected: FAIL, `ENOENT` for `stat-value.handlebars`.

- [ ] **Step 3: Register the helpers**

In `util/handlebars.js`, add near the other requires:

```js
const { statScaling, statScalingRow } = require('./stat-scaling');
```

and add `statScaling,` and `statScalingRow,` to the `module.exports` object.

- [ ] **Step 4: Write the two partials**

`views/partials/stat-scaling-entry.handlebars`:

```handlebars
{{!-- One cell of the Stat Scaling Table (util/stat-scaling.js Entry) as
      tooltip content. Book text only -- nothing user-authored passes
      through here. --}}
<p class="mb-1"><strong>{{label}} {{statLabel}}</strong>{{#if note}} <em>({{note}})</em>{{/if}}</p>
{{#each lines}}
<p class="mb-1">{{#if term}}<strong>{{term}}</strong>: {{/if}}{{text}}</p>
{{/each}}
```

`views/partials/stat-value.handlebars`:

```handlebars
{{!-- A character's stat, with what that many pluses can do (the Stat Scaling
      Table, util/stat-scaling.js) in a tooltip. For per-character values
      only -- a party total is not a capacity anyone has.

      Params:
        stat    the stat key ("might")
        value   the plus count
        blocks  render read-only blocks (and the over-5 "N points" note)
                instead of the bare number

      The tooltip div must stay the trigger's next sibling: _initTooltips in
      public/js/app.js reads it from there when data-tooltip-markdown is
      empty. A value the table does not cover renders with no tooltip. --}}
{{#if (statScaling stat value)}}<span class="stat-value" tabindex="0" data-tooltip-markdown="">{{else}}<span class="stat-value">{{/if}}
{{#if blocks}}
{{> stat-blocks-readonly value=value max=5}}
{{#if (gt value 5)}}<span class="stat-blocks-over">{{value}} points</span>{{/if}}
{{else}}
{{value}}
{{/if}}
</span>
{{#with (statScaling stat value)}}<div class="tooltip-markdown is-hidden">{{> stat-scaling-entry}}</div>{{/with}}
```

- [ ] **Step 5: Run the partial test to verify it passes**

Run: `bun test views/partials/stat-value.test.js`
Expected: PASS, 4 tests. If the first test's regex trips on whitespace only, loosen the regex's whitespace, not the markup order.

- [ ] **Step 6: Write the failing party-summary assertion**

Add to `views/partials/party-summary.test.js`. Register the two new partials in its `render` (alongside the existing `stat-blocks-readonly` registration), then add:

```js
test('member stats explain themselves; totals do not', () => {
  const html = render(summarizeParty([member('Rionnal', { might: 1 }), member('Ash', { might: 2 })]));
  const [body, foot] = html.split('<tfoot>');
  expect(body).toContain('Crush an apple one-handed.');
  expect(body).toContain('Rip a college textbook in half.');
  expect(foot).not.toContain('data-tooltip-markdown');
});
```

`member(name, stats)` already exists in that file. Adapt the call if its signature differs, but keep the assertion.

Run: `bun test views/partials/party-summary.test.js`
Expected: FAIL on the new test, because the body doesn't contain the text yet.

- [ ] **Step 7: Use the partial at the three per-character sites**

`views/partials/party-summary.handlebars`, in the breakdown `<tbody>` (totals and `<tfoot>` stay unchanged):

```handlebars
          {{#each this.stats}}<td>{{> stat-value stat=@key value=this}}</td>{{/each}}
```

`views/character.handlebars`, inside `#statsReadOnly`. Replace the `stat-blocks-readonly` line and the `{{#if (gt …)}}…points…{{/if}}` block with:

```handlebars
          {{> stat-value stat=this value=(lookup ../character this) blocks=true}}
```

`views/partials/character-details.handlebars`: make the same replacement for its `stat-blocks-readonly` line and the over-5 block. Keep the explanatory comment, retargeted to say `stat-value` renders the blocks and the over-cap note.

- [ ] **Step 8: Style the trigger**

Append to `public/css/styles.css`:

```css
/* A stat with Stat Scaling text behind it. Bare numbers get the dotted
   underline; block rows are already visibly interactive enough. */
.stat-value[data-tooltip-markdown] { cursor: help; }
td > .stat-value[data-tooltip-markdown] { text-decoration: underline dotted; }
```

- [ ] **Step 9: Run the affected tests**

Run: `bun test views/partials/party-summary.test.js views/partials/character-details.test.js views/lfg-post.test.js views/character.test.js views/partials/stat-value.test.js`
Expected: PASS. Any `The partial stat-value could not be found` or `Missing helper: "statScaling"` failure is a test harness that registers partials or helpers by hand: register `stat-value` and `stat-scaling-entry` (and `customHelpers` if missing) in that file's `render`.

- [ ] **Step 10: Run the unit tier**

Run: `bun run test:unit`
Expected: no new failures against the known-red baseline.

- [ ] **Step 11: Commit**

```bash
git add util/handlebars.js views/partials/stat-scaling-entry.handlebars views/partials/stat-value.handlebars views/partials/stat-value.test.js views/partials/party-summary.handlebars views/partials/party-summary.test.js views/character.handlebars views/partials/character-details.handlebars views/partials/character-details.test.js public/css/styles.css
# plus any other test file Step 9 required touching
git commit -m "feat: explain each character stat with the Stat Scaling Table (#178)"
```

---

### Task 3: Whole-row tooltip where stats are chosen

**Files:**
- Create: `views/partials/stat-scaling-row.handlebars`
- Create: `views/partials/stat-scaling-row.test.js`
- Modify: `views/partials/character-stats-editor.handlebars:8`
- Modify: `views/partials/character-level-up.handlebars:62`
- Modify: `views/character-form.handlebars:325`
- Modify: `views/character-wizard.handlebars` (after `#statGrid`, ~line 264)
- Modify: `public/js/character-wizard.js:1280-1328` (`renderStatGrid`)
- Modify: any `*.test.js` that renders the three server-side editors with hand-registered partials (`character-stats-editor.test.js`, `character-level-up.test.js`, `character-form.test.js`, `character-wizard.test.js`): register `stat-scaling-row` and `stat-scaling-entry`.

**Interfaces:**
- Consumes: the `statScalingRow` helper and the `stat-scaling-entry` partial from Task 2. `App.initTooltips(root)` and `App.destroyTooltips(root)` from `public/js/app.js:1658-1665`.
- Produces: partial `stat-scaling-row` with params:
  - `stat`: a stat key
  - `id` (optional): with an id, the wizard points at it by `#id`; without one, the trigger reads it as its next sibling.

- [ ] **Step 1: Write the failing partial test**

```js
// views/partials/stat-scaling-row.test.js
// What each plus of a stat buys, shown on the stat's name wherever a stat is
// being chosen.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../util/handlebars');

const partial = (name) => fs.readFileSync(path.join(__dirname, `${name}.handlebars`), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('stat-scaling-entry', partial('stat-scaling-entry'));
  return hb.compile(partial('stat-scaling-row'))(context);
};

test('the row lists Baseline through five pluses, in order', () => {
  const html = render({ stat: 'might' });
  const order = ['Lift your own bodyweight.', 'Crush an apple one-handed.', 'Rip a college textbook in half.',
    'Lift one end of a car.', 'Overhead press an entire car.', 'Throw a car a dozen yards.'];
  const positions = order.map(text => html.indexOf(text));
  expect(positions.every(p => p >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(html).not.toContain('Stop a speeding car');
});

test('an id makes the row addressable for client-rendered triggers', () => {
  expect(render({ stat: 'luck', id: 'stat-scaling-row-luck' })).toContain('id="stat-scaling-row-luck"');
  expect(render({ stat: 'luck' })).not.toContain('id=');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test views/partials/stat-scaling-row.test.js`
Expected: FAIL, `ENOENT` for `stat-scaling-row.handlebars`.

- [ ] **Step 3: Write the partial**

`views/partials/stat-scaling-row.handlebars`:

```handlebars
{{!-- The whole Baseline–+++++ row of the Stat Scaling Table for one stat,
      as tooltip content for that stat's name wherever stats are chosen.

      Params:
        stat  the stat key
        id    optional; given one, a trigger anywhere can point at it with
              data-tooltip-markdown="#id" (the wizard renders its triggers
              client-side). Without one, place it straight after a trigger
              with data-tooltip-markdown="". --}}
<div {{#if id}}id="{{id}}" {{/if}}class="tooltip-markdown is-hidden">
  {{#each (statScalingRow stat)}}{{> stat-scaling-entry}}{{/each}}
</div>
```

- [ ] **Step 4: Run the partial test to verify it passes**

Run: `bun test views/partials/stat-scaling-row.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Attach it to the three server-rendered editors**

`views/partials/character-stats-editor.handlebars:8` and `views/partials/character-level-up.handlebars:62`. Replace the name line with:

```handlebars
      <div class="wizard-stat-name" tabindex="0" data-tooltip-markdown="">{{capitalize this}}</div>
      {{> stat-scaling-row stat=this}}
```

`views/character-form.handlebars:325`:

```handlebars
          <div class="label" tabindex="0" data-tooltip-markdown="">{{capitalize this}}</div>
          {{> stat-scaling-row stat=this}}
```

In all three the name element must stay immediately before the row partial's div.

- [ ] **Step 6: Render the wizard's rows once, server-side**

In `views/character-wizard.handlebars`, directly after the closing `</div>` of `#statGrid`:

```handlebars
    {{!-- Tooltip content for the stat names character-wizard.js renders into
          #statGrid; they point here by id because the grid is rebuilt
          client-side. --}}
    {{#each statList}}{{> stat-scaling-row stat=this id=(concat "stat-scaling-row-" this)}}{{/each}}
```

`statList` is already in the wizard's render locals (`routes/characters.js`, `res.render('character-wizard', { … statList … })`).

- [ ] **Step 7: Point the wizard's names at them, and re-init tooltips per render**

In `public/js/character-wizard.js#renderStatGrid`, destroy tooltips before the grid is replaced:

```js
    if (typeof App !== 'undefined') App.destroyTooltips(statGrid);
    statGrid.innerHTML = DATA.statList.map((stat) => {
```

Change the name line inside the row template:

```js
        +   '<div class="wizard-stat-name" tabindex="0" data-tooltip-markdown="#stat-scaling-row-' + stat + '">' + capitalize(stat) + '</div>'
```

After the `.join('');` that closes the `innerHTML` assignment, still inside `renderStatGrid`:

```js
    if (typeof App !== 'undefined') App.initTooltips(statGrid);
```

- [ ] **Step 8: Run the affected tests**

Run: `bun test views/partials/stat-scaling-row.test.js views/partials/character-stats-editor.test.js views/partials/character-level-up.test.js views/character-form.test.js views/character-wizard.test.js`
Expected: PASS. Register `stat-scaling-row` and `stat-scaling-entry` (and `customHelpers`) in any harness that reports a missing partial or helper.

- [ ] **Step 9: Run the unit tier**

Run: `bun run test:unit`
Expected: no new failures against the known-red baseline.

- [ ] **Step 10: Check it in the browser**

Use the `run` skill to start the app locally, then confirm each item:

- **Wizard step 2:**
  - Hovering or focusing a stat name shows its six rows.
  - Clicking blocks repeatedly leaves no orphaned tooltip on screen.
- **Character page:** hovering a stat's blocks shows that value's cell.
- **/party with two characters:**
  - A breakdown number shows its cell, and a total shows nothing.
  - After adding a third member (an htmx swap), the new row's tooltips work.
- **Phone width (375px):** tapping a breakdown number opens its tooltip.

- [ ] **Step 11: Commit**

```bash
git add views/partials/stat-scaling-row.handlebars views/partials/stat-scaling-row.test.js views/partials/character-stats-editor.handlebars views/partials/character-level-up.handlebars views/character-form.handlebars views/character-wizard.handlebars public/js/character-wizard.js
# plus any test harness Step 8 required touching
git commit -m "feat: show what each plus buys wherever a stat is chosen (#178)"
```
