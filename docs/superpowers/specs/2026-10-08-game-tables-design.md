# Game Tables — Design

**Date:** 2026-10-08
**Issues:** #168, #169, #176, #178
**Status:** Approved in conversation, awaiting spec review

## Problem

Agent Resources is where an Enclave character gets built, and then the table
leaves it. On game night groups track stats in Google Sheets (#176), read the
Stat Scaling Table out of the PDF (#178), run the session from memory and
loose notes (#168), and play off the printed character sheet (#169).

The four issues are one gap seen from four seats: there is no **game-night
surface**. Concretely:

- `/party` holds a roster only in its URL (`routes/party.js:13`, "there is no
  parties table"), so it cannot be a group's standing stat sheet, and it can
  only hold registered characters (`characters.creator_id NOT NULL`).
- No Stat Scaling Table data exists anywhere in the repo.
- Nothing tracks in-session state. The rules' in-session state is Stamina and
  Essence Thresholds, per-source use counts (Finite Uses and Limiter
  judgments), and Cooldowns.
- A Conduit has no per-game private space; `conduit_briefing` is a public
  profile field.

## Goal

A **game table**: a saved, shareable object that a group opens on game night.
It holds a roster of registered and unregistered characters, tracks every
member's Stamina, Essence, uses and cooldowns live across everyone's phones,
and offers two focused lenses on that same state — a Conduit run view and a
player play view. Stat numbers explain themselves everywhere via the Stat
Scaling Table.

The table replaces `/party`.

## Rules being modelled

Sources: *ENCLAVE Advent V2* pp. 11–13, 33–36; *ENCLAVE Aspirant V1* pp. 3–4.

- **Stamina & Essence** each sit in one of three Thresholds, Green → Yellow →
  Red; dropping below Red means unconsciousness at minimum. Every mission
  starts in the Green, and all capacities reset when the mission ends.
- **Essence budget.** At baseline Will a Threshold drops after six Low, two
  Mid, or one High Essence Cost. Counting in Low units (Low 1, Mid 3, High 6),
  the Will row of the Stat Scaling Table gives a per-Threshold budget of
  **6, 7, 9, 12, 15, 18** for Baseline through `+++++`, and Aspirant's expanded
  table gives **24** ("four High") at six pluses.
- **Stamina budget.** The book scales it by Vigor only narratively. The table
  uses the Essence curve keyed off Vigor, presented like every number here as
  an approximation.
- **Stamina Costs** are listed on a few sources; both pools also take
  unlisted, narrative spends (sprinting, improvised Energywork).
- **Recovery:** a full Threshold after a High duration of rest; Heartening
  (Vitality) restores a Mid Cost's worth up to a full Threshold.
- **Finite Uses:** exact counts below six; otherwise Low ≈ 10, Mid ≈ 25,
  High ≈ 50.
- **Cooldowns** are Power Ratings with no clock; they begin when a Duration
  expires.
- **Limiters** may be imposed by the Conduit on any supernatural capacity,
  "especially Storytelling Mechanics", with "used more than twice in rapid
  succession" as the rule of thumb.
- Every Power Rating is ultimately the Conduit's call, so every computed value
  here is a suggestion with an override beside it.
- There is no HP. Harm is narrative and is not modelled.

## Decomposition

Five sub-projects, each with its own plan, shipped and merged in this order:

1. **Stat Scaling reference** (#178)
2. **Tables core** (#176, replaces `/party`)
3. **Live trackers**
4. **Conduit run view** (#168)
5. **Player play view** (#169)

## 1. Stat Scaling reference

`util/stat-scaling.js` holds the printed Stat Scaling text as static data —
the Advent table (Baseline through `+++++`, pp. 35–36) and the Aspirant
expanded rows (`++++++` through `++++++++`, p. 4). It is fixed book content
that nobody edits in-app, so it is code, not a table.

A lookup takes a stat, a plus count, and an edition, and returns the entry or
nothing. Advent characters, guests, and party totals use the Advent table;
Aspirant characters fall through to the expanded rows above five pluses.

A `stat-value` partial wraps every displayed stat number: the party summary,
the per-member breakdown, the character page, and the character wizard. It
shows, for example, **"+ Might: Crush an apple one-handed."** on hover, and on
tap where there is no hover.

## 2. Data model

Four new tables.

### `game_tables`

| Column | Notes |
|---|---|
| `id` | uuid |
| `name` | text, required |
| `creator_id` | → `profiles`, required |
| `conduit_id` | → `profiles`, nullable |
| `lfg_post_id` | → `lfg_posts`, nullable, unique, `ON DELETE SET NULL` |
| `session_started_at` | timestamptz |
| `created_at`, `updated_at` | |

### `game_table_members`

| Column | Notes |
|---|---|
| `id` | uuid |
| `table_id` | → `game_tables`, `ON DELETE CASCADE` |
| `position` | integer |
| `character_id` | → `characters`, nullable, `ON DELETE CASCADE` |
| `guest_name` | text, nullable |
| `guest_class_label` | text, nullable |
| `guest_stats` | jsonb of the 12 `statList` keys, nullable |

A check constraint requires exactly one of a character or a guest: either
`character_id` is set and the guest columns are null, or `guest_name` and
`guest_stats` are set and `character_id` is null. A table holds at most 8
members, guests included (`PARTY_CAP`).

### `game_table_member_state`

One row per member, created with the member.

| Column | Notes |
|---|---|
| `member_id` | PK, → `game_table_members`, `ON DELETE CASCADE` |
| `table_id` | denormalized for the Realtime filter |
| `stamina_threshold`, `essence_threshold` | smallint: 0 Green, 1 Yellow, 2 Red, 3 Below Red |
| `stamina_spent`, `essence_spent` | smallint, Low units spent inside the current Threshold |
| `use_counts` | jsonb, source key → count this session |
| `cooldowns` | jsonb, source key → on |
| `imposed_limiters` | jsonb, source key → list of `{kind, rating}` |
| `undo` | jsonb, the state before the last action, or null |
| `version` | integer, incremented on every write |
| `updated_at`, `updated_by` | |

A **source key** names an ability (`class_abilities` row), a Signature
(`class_gear` row), or one of the fixed mechanics: Pitch, Inference,
Deduction, Intuition, Happenstance, Manifestation, Heartening, Defiance,
Turning Point, Energywork.

### `game_table_conduit_notes`

| Column | Notes |
|---|---|
| `table_id` | PK, → `game_tables`, `ON DELETE CASCADE` |
| `body` | text |
| `updated_at` | |

### Why four tables

Row-level security grants rows, not columns. A player may update their
member's state but not the roster, and notes must be invisible to everyone
but the Conduit. Splitting them makes each rule one policy and leaves
Realtime exactly one table to watch.

### Access

| Action | Who |
|---|---|
| View a table, its members and state | Anyone with the link, signed in or not |
| Seat one of your own characters (private included) | Any signed-in viewer |
| Seat public characters, add or edit guests, reorder, remove anyone | Creator or Conduit |
| Edit a registered member's state | The character's owner, or the Conduit |
| Edit a guest's state | Creator or Conduit |
| Start a new session | Creator or Conduit |
| Read or write notes | Conduit only |

Writes are enforced in RLS, then mirrored in the view so controls only appear
for those allowed to use them.

**Reads.** RLS SELECT on the four tables is granted to **participants only** —
the creator, the Conduit, and owners of seated characters (notes: Conduit
only). A link-holder read policy would let anyone holding the public anon key
list every table through PostgREST, so the link would stop being a
capability. Instead, a non-participant viewing by link is served by the
server, which reads that one table id — its members and state — with the
service-role client.

**Private characters.** Seating a private character is its owner's consent to
show its table-relevant data — stats, abilities, Signatures — to everyone at
that table. The server reads those fields with the service-role client, only
for characters seated at the table being rendered, and selects no other
columns.

## 3. Exertion arithmetic

`util/exertion.js` is a pure module and the only place rule arithmetic lives.

- **Cost units:** Low 1, Mid 3, High 6.
- **Budget per Threshold** by pluses in Will (Essence) or Vigor (Stamina):
  6, 7, 9, 12, 15, 18, 24, then +6 per plus beyond, flagged approximate.
- **`applyAction(state, action, stats)`** returns the next state. Actions:
  - `use` — increments the source's count; if the source lists an Essence or
    Stamina Cost, adds any Conduit-imposed cost of the same kind and spends
    the total; if the source has a Cooldown, switches it on. One action, one
    undo.
  - `spend` / `restore` — a Low, Mid, or High amount, or (restore only) a full
    Threshold, on one pool.
  - `set` — sets a pool's Threshold and spent amount directly.
  - `toggle_cooldown`, `impose`, `lift` — cooldowns and imposed Limiters.
  - `undo` — restores the snapshot.
- **Overflow auto-drops.** When spent reaches the budget, the pool drops a
  Threshold and the remainder carries into the next, repeating as needed and
  stopping at Below Red. Restore climbs the same way and stops at Green with
  nothing spent.
- A range cost (`Low–High`) is resolved by the user choosing a level before
  the action is sent; `applyAction` only ever sees one level.

The budget is always computed from the character's current stats.

## 4. Tables core

### Routes

| Route | Purpose |
|---|---|
| `GET /tables` | Tables you created, are Conduit of, or have a character seated at |
| `POST /tables` | Create, optionally seeded from `?c=` ids or an LFG post |
| `GET /tables/:id` | The table page: roster, party summary, member breakdown, trackers |
| `GET /tables/new?c=…` | An unsaved draft of the table page; works signed out; "Save table" when signed in |
| `/party?c=…` | 301 to the draft |
| Member endpoints | Seat, remove, add or edit guest, reorder — each returns the roster fragment |

`routes/party.js`, `views/party.handlebars`, and the party-only partials are
deleted. Shared partials move to `views/partials/table-*`. `summarizeParty`
is reused unchanged; a guest is one more stat object.

### Guest characters (#176)

"+ Add unregistered character" opens a form: name (required), class label
(optional), and the 12 stats with the character form's block steppers in
`statList` order. Each stat is 0–5. Validation failures re-render with field
errors, as the character form does. Guests have no abilities or Signatures,
so their tracker is the two pools and narrative spends.

### LFG link

The post's creator or approved Conduit sees **Open table** on the post. The
first click creates a linked table seeded with the approved roster and that
Conduit as `conduit_id`; later clicks open it.

While linked, approving a join request seats its character and withdrawing
or rejecting one unseats it, and a change of approved Conduit updates
`conduit_id`. The hook sits in `LfgService` beside `syncConduitHostId`. Guests are never touched by the sync. Deleting the post
clears `lfg_post_id`; the table survives.

## 5. Live trackers

Each member on the table page has a tracker:

- **Stamina and Essence rows** — a Threshold pip (tap to set) and a bar
  segmented into the member's budget; **Spend** (Low/Mid/High) and
  **Restore** (Low/Mid/High/full Threshold).
- **Sources** — every ability and Signature, then the mechanics row. Each
  shows **Use**, "Used ×N this session", Finite Uses remaining (exact, or the
  count against the rating's approximation), a Cooldown toggle, and its
  Limiters, printed and Conduit-imposed (marked as such).
- **Undo** beside the toast after every action.

### Write path

`POST /tables/:id/members/:memberId/actions` with one action. The route loads
the state row, calls `applyAction`, and writes through the per-request client
so RLS decides who may write, saving the prior state into `undo`.

Writes are conditional on `version`. On a conflict the server re-reads and
re-applies once. Undo is refused, with a toast naming who changed the row,
when the row's version has moved past the snapshot.

### Live updates

**Participants** — the creator, the Conduit, and owners of seated characters
— subscribe via Realtime to `game_table_member_state` changes filtered by
`table_id`. A change is only a ping: the page debounces it and re-fetches that
member's tracker fragment through htmx. Your own actions swap in from the
response. If Realtime disconnects, the page polls every 5 seconds until it
reconnects.

**Everyone else**, signed-out viewers included, polls every 5 seconds. They
have no RLS read access, so Realtime would deliver them nothing.

### New session

Creator or Conduit, behind a confirm. Resets every member to Green with
nothing spent, clears counts, cooldowns, imposed Limiters and undo, and
stamps `session_started_at`. Not undoable — the rules reset everything at
mission end.

## 6. Conduit run view (#168)

`GET /tables/:id/run`, for the table's `conduit_id` only; anyone else gets a
404. Phone-first.

- A compact card per member: name, class, both pips and bars, active
  cooldowns, and "Used ×N" for each source used this session, highlighted
  from ×3. Tapping expands the full tracker with Conduit controls — impose
  Limiters, override, edit guests — and stats with Stat Scaling tooltips.
- The party summary, collapsed by default.
- **Private notes**: one autosaving textarea (debounced `PUT`), persisting
  across sessions so prep carries over. RLS restricts
  `game_table_conduit_notes` to the Conduit, and no other view renders it.
- **New session**, and **Log this game** when the table is linked to a post
  and `canLogGame` allows it, handing off to the existing #166 draft flow.

## 7. Player play view (#169)

`GET /tables/:id/play` opens your seated character, with a picker if you have
more than one at the table.

- Large type, one-handed. Stamina and Essence pinned at the top with large
  Spend and Undo targets.
- Abilities and Signatures are the primary content: a card each with Use,
  cost, Cooldown, uses left, and its printed text collapsed to name and
  Limiters until tapped.
- Then the mechanics row, then a stats strip with tap-tooltips. Nothing else.

The character page gets **Play**: to the play view of the table the character
is seated at (or a picker across several), otherwise **Start a table**, which
creates a one-member table you own.

Success, per #169: players in a real session keep it open instead of the
PDF.

## Testing

Tests earn their place; TDD through the `tdd-*` agents.

- **Unit — `util/exertion.js`:** the budget curve and its extrapolation;
  overflow carrying across two Thresholds and stopping at Below Red; restore
  across Thresholds; imposed cost added to printed cost on `use`; undo.
- **Unit — Stat Scaling lookup:** edition selection and the Aspirant rows
  above five pluses.
- **RLS integration:** notes unreadable by anyone but the Conduit; state
  writable only by owner or Conduit (guests: creator or Conduit); the anon
  key reads no table rows at all; a private character's fields exposed only
  while seated.
- **Routes:** the `/party` redirect; the draft rendering signed out; a
  signed-out link viewer seeing a saved table read-only; LFG approval seating
  and unseating; the run view 404 for non-Conduits.
- **E2E (one):** create a table, add a guest, spend Essence through an
  auto-drop, and see the change in a second browser context.

## Rollout

Each sub-project merges independently, in the order above. Quote any
`*_atomic` function names in migrations (Supabase CLI splitter bug).
Production migrations are applied by the user with
`supabase db push --linked`.

## Non-goals

- HP or harm tracking
- Durations
- Adversaries, NPCs, encounters
- A session history log
- Analytics (#165 was deleted)
- Discord notifications (#167)
- Changing the Library's PDF link — that follows #169's verdict
