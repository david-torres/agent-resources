# Conduit Credits Revision — Design

## Background

Conduit Credits are currently modeled as a plain integer counter (`characters.conduit_credits`) that the user edits via a number input on the character edit form, with display as a single `<p>Conduit Credits: N</p>` line on the character page.

The rulebook describes a richer concept:

> Whenever a Conduit hosts a mission, they may progress any one of their own characters as though that character had been on the mission as well. This counts towards both leveling and Merx gain and is treated as a success for the Conduit's character regardless of how the original mission went. Conduit credits may be saved indefinitely.
>
> Spending a Conduit credit on a character requires adding an Offscreen Mission to that character's Mission Log. This entry should include the offscreen mission's name, a 2–3 sentence summary, and the name and date of the original mission the Conduit hosted to earn the credit. Offscreen missions are entirely made up by the Conduit, unconnected to the original mission that sourced them — they are an in-world explanation of how your character is progressing despite not having been played.

The current implementation captures the *balance* but misses the actual workflow: spending should create an Offscreen Mission entry in the character's mission log, bump completed-missions and Merx, and record the source mission's name and date.

This spec revises Conduit Credits to capture that workflow while keeping the counter-based earning model.

## Goals

- Spending a credit produces a real Offscreen Mission log entry with name, summary, and source mission name+date.
- Spending automatically advances the character: −1 credit, +1 completed mission, +merx gained.
- Offscreen mission entries display in the character's mission log alongside real missions, visually distinguished.
- Edits and deletions reverse the same bookkeeping symmetrically.

## Non-goals

- Auto-granting credits from `missions.host_id` matches. Earning remains the existing manual number input.
- A separate "grant credit from this mission" button on hosted mission pages.
- Profile-level credit pools or transfers between characters.
- Public/social features around offscreen missions (search, listing across characters, etc.).

## Data model

`characters.conduit_credits INTEGER NOT NULL DEFAULT 0` stays as the per-character balance.

New table:

```sql
CREATE TABLE offscreen_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                          -- the offscreen mission's name (made up)
  summary TEXT NOT NULL,                       -- 2–3 sentence narrative
  merx_gained INTEGER NOT NULL DEFAULT 0,
  source_mission_id UUID NULL REFERENCES missions(id) ON DELETE SET NULL,
  source_mission_name TEXT NOT NULL,           -- denormalized; auto-filled from picked mission
  source_mission_date DATE NOT NULL,           -- denormalized; auto-filled from picked mission
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX offscreen_missions_character_id_idx
  ON offscreen_missions (character_id, source_mission_date DESC);
```

`source_mission_name` and `source_mission_date` are always populated, even when `source_mission_id` is set. Rationale: the rules require the *original* mission's name and date in the log entry, and we don't want a later mission rename, date edit, or `SET NULL` cascade to silently rewrite history. The picker fills these fields on save; afterward they're frozen against *indirect* mutations (no triggers update them, no FK cascade rewrites them), but the character's creator can deliberately edit them via the offscreen-mission edit form — e.g., to fix a mis-picked source.

### RLS

- `SELECT`: anyone who can `SELECT` the parent `characters` row can `SELECT` the offscreen mission. (Use a subquery against `characters` policies, same shape as existing per-character tables in this schema.)
- `INSERT`/`UPDATE`/`DELETE`: only the character's creator, or admins.

## Earning credits

No change. The existing `conduit_credits` number input on the character edit form (`views/partials/character-v2-fields.handlebars`) remains the way users add credits — they bump the counter manually as they host sessions.

## Spending — UI

**Entry point.** On the character page, when the viewer is the character's creator:

- If `conduit_credits > 0`: show a "Spend Conduit Credit" button near the Mission Log box.
- If `conduit_credits === 0`: hide the button.

The Conduit Credits balance display moves to sit next to the Spend button so the two read together (replacing the standalone `<p>` line at `views/character.handlebars:275`).

**Spend form** (route: `GET /characters/:id/offscreen-missions/new`):

| Field | Type | Required | Notes |
|---|---|---|---|
| Offscreen mission name | text | yes | The made-up mission's name |
| Summary | textarea | yes | Help text: "2–3 sentences." |
| Merx gained | integer ≥ 0 | yes (default 0) | Added to `commissary_reward` |
| Source mission | select + conditional inputs | yes | Default: dropdown of missions where `host_id = current user`, ordered by `date DESC`, label `"{name} — {date}"`. Last option: "Other / not in the system" — reveals free-text Name (required) and Date (required) inputs. |

When a hosted mission is picked, the form holds onto the `source_mission_id` plus its name/date for denormalization at submit time. When "Other" is picked, only the free-text fields populate `source_mission_name` and `source_mission_date`; `source_mission_id` stays NULL.

**Edit form** is identical to the spend form except: no Spend semantics — submitting only updates the offscreen mission row and applies the merx delta (see "Edits & deletes" below). Route: `GET /characters/:id/offscreen-missions/:omId/edit`.

## Spending — server action

`POST /characters/:id/offscreen-missions` (character creator only):

Validation:
- Re-check `conduit_credits > 0` for the character (guard against double-submit / stale page).
- Form fields per the table above.
- If source mission picker is set to a `mission_id`, verify that mission exists and `host_id = req.profile.id` (defense in depth; a hostile client could submit any UUID).

Atomic operation (Postgres function, similar to existing `increment_missions_count`):

1. `UPDATE characters SET conduit_credits = conduit_credits − 1, completed_missions = completed_missions + 1, commissary_reward = commissary_reward + :merx_gained WHERE id = :character_id AND conduit_credits > 0` — returns 0 rows if credits ran out, in which case the transaction aborts with a clear error.
2. `INSERT INTO offscreen_missions (...)` with `source_mission_name` and `source_mission_date` denormalized from the picked mission (or free-text inputs).

On success: redirect to the character page with a success flash.

On failure (credits depleted between render and submit, invalid form, server error): redisplay the form with values preserved and an inline error.

## Edits & deletes

**Edit** (`POST /characters/:id/offscreen-missions/:omId`, character creator only):

- The offscreen mission's name, summary, and source fields can be edited.
- `merx_gained` can change. Inside a transaction: apply the delta `(new − old)` to `commissary_reward`.
- `completed_missions` and `conduit_credits` are *not* touched on edit.
- `source_mission_name` and `source_mission_date` are mutable through this form (the user picked the wrong source mission, fix it), but in the edit form, "what's currently saved" is shown so the freeze-on-insert invariant is preserved against schema/cascade events — only deliberate edits change them.

**Delete** (`POST /characters/:id/offscreen-missions/:omId/delete`, character creator only, confirm dialog):

Reverses bookkeeping symmetrically, atomically:

1. `UPDATE characters SET conduit_credits = conduit_credits + 1, completed_missions = GREATEST(completed_missions − 1, 0), commissary_reward = GREATEST(commissary_reward − :merx_gained, 0) WHERE id = :character_id`.
2. `DELETE FROM offscreen_missions WHERE id = :om_id`.

`GREATEST(... , 0)` guards against the user having manually edited `completed_missions` or `commissary_reward` down between spend and delete; we never underflow.

## Display

**Character page — Recent Missions box** (`views/character.handlebars`, currently around lines 76–100):

- Merge offscreen missions into the same list as real missions.
- Sort by date descending, where offscreen entries sort by `source_mission_date`.
- Distinguish each offscreen entry with a small "Offscreen" tag next to the name.
- Offscreen entries are not links to `/missions/:id` (no such page exists for them). They expand inline within the list, or — equivalent and simpler — render their full body inline always (name, "Offscreen" tag, date, summary, source footnote, merx).

**All-missions page** (`/missions/character/:id`, the "View all missions →" link): same treatment. Combined list, "Offscreen" tag, sorted by date.

**Offscreen entry rendering** (new partial `views/partials/offscreen-mission-entry.handlebars`):

- Title: `{name}` with `<span class="tag is-info is-light">Offscreen</span>`.
- Date: `{source_mission_date}` formatted per the user's timezone (matching how real mission dates are formatted in the same view).
- Body: `{summary}`.
- Footnote: "Sourced from *{source_mission_name}* on {source_mission_date}". If `source_mission_id` is set and the viewer can SELECT that mission, the source name is a link to `/missions/{source_mission_id}`; otherwise plain text.
- Merx earned shown as `+{merx_gained} Merx` if `merx_gained > 0`.
- For the character's creator viewing their own character: small Edit / Delete buttons.

**Conduit Credits balance display** on the character page is co-located with the Spend button (replacing the existing `<p>Conduit Credits: N</p>` block).

## Code layout

### Schema migration

Append to `schema.sql`:

- `CREATE TABLE offscreen_missions` (as above).
- `CREATE INDEX offscreen_missions_character_id_idx`.
- RLS policies for the four CRUD operations.
- A Postgres function `spend_conduit_credit(character_id UUID, merx INT)` returning the updated character row, that atomically performs the UPDATE described in "Spending — server action" step 1 and raises an error if 0 rows are affected.
- A Postgres function `refund_conduit_credit(character_id UUID, merx INT)` that performs the reverse UPDATE described in "Delete" step 1.

Apply via Supabase the same way other schema changes in this repo are applied.

### Model

New `models/offscreen-mission.js`:

- `list({ characterId, supabase })` → array of offscreen missions for the character.
- `listForCharacters({ characterIds, supabase })` → keyed by character id, for batch fetching (used by views that show multiple characters' logs).
- `getById({ id, supabase })` → single row.
- `create({ characterId, payload, supabase, profileId })` → inserts the row, calls `spend_conduit_credit` RPC, returns the new row. Validates source mission ownership if `source_mission_id` is set.
- `update({ id, payload, supabase })` → updates the row, applies the merx delta to `commissary_reward` inside a transaction.
- `remove({ id, supabase })` → deletes the row, calls `refund_conduit_credit` RPC.

Export from `models/offscreen-mission.js`. Tests in `models/offscreen-mission.test.js` following the existing `models/character.test.js` style.

### Routes

Extend `routes/characters.js`:

- `GET /characters/:id/offscreen-missions/new` — render the spend form. Fetches hosted-missions list for the picker.
- `POST /characters/:id/offscreen-missions` — create. Redirects to the character page on success.
- `GET /characters/:id/offscreen-missions/:omId/edit` — render edit form.
- `POST /characters/:id/offscreen-missions/:omId` — update.
- `POST /characters/:id/offscreen-missions/:omId/delete` — delete.

All five routes require the authenticated user to be the character's creator (or admin); 403 otherwise.

The character page render (`GET /characters/:id`) is updated to also fetch offscreen missions for the character and merge them into the existing `recentMissions` data passed to the view (sorted, with a discriminator field).

The all-missions render is updated similarly.

### Views

- New partial `views/partials/offscreen-mission-form.handlebars` (shared by new/edit, takes a `mode` and optional `offscreenMission` prop).
- New partial `views/partials/offscreen-mission-entry.handlebars` (display).
- Edit `views/character.handlebars`:
  - Replace the standalone Conduit Credits `<p>` with a co-located display + Spend button.
  - Update the Recent Missions list to render a mix of real-mission `<li>` and offscreen-mission-entry partials based on a discriminator.
- Edit `views/character-missions.handlebars` (or wherever `/missions/character/:id` renders) similarly.

The edit form for the character (`views/partials/character-v2-fields.handlebars`) is **unchanged** — the `conduit_credits` number input remains as the earning channel.

## Tests

New `models/offscreen-mission.test.js` covering:

- Create succeeds: decrements `conduit_credits`, increments `completed_missions` by 1, adds `merx_gained` to `commissary_reward`, inserts the row.
- Create fails when `conduit_credits === 0` — no row inserted, no counter changes.
- Source name/date denormalize correctly when a hosted mission is picked.
- Source free-text path stores `source_mission_id = NULL` and the given name/date.
- `source_mission_name` and `source_mission_date` are not mutated when the linked mission is renamed or its date edited afterwards.
- Update with changed `merx_gained` adjusts `commissary_reward` by the delta only; does not touch credits or completed_missions.
- Delete reverses bookkeeping symmetrically; underflows are clamped at 0.
- Non-creator cannot create/update/delete (RLS / route auth).

Route-level tests for the five new routes covering happy paths and the auth/403 cases, following the existing pattern in `routes/characters.js` tests if one exists; otherwise model tests are sufficient.

## Open questions

None at this time.
