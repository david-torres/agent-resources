# Conduit Credits — Profile Pool Design

## Background

The initial Conduit Credits revision (`docs/superpowers/specs/2026-05-25-conduit-credits-revision-design.md`, implemented on branch `v2-character-support`) modeled credits as a per-character integer counter (`characters.conduit_credits`). That mis-located the credit's owner.

In Enclave, a player takes on one of two roles per session: **Conduit** (runs the mission) or **Character** (plays in it). The Conduit role is a property of the *player*, not of any one character — when a player runs a mission, they earn a credit that they can later apply to any of their characters. The previous design surfaced credit balances on each character, which is wrong: a player's three characters don't each have their own credit pool.

This revision moves the credit pool from the character to the profile, derives the balance from data already in the database (no stored counter), enforces a 1:1 mapping between hosted missions and picker-linked offscreen-mission spends, and continues to allow free-text-source spends for missions not logged in the app.

## Goals

- A profile's credit balance reflects "missions you ran as Conduit minus picker-linked offscreen missions you've spent on your characters."
- Earning is automatic: hosting a mission (`missions.host_id = profileId`) grants one earning event implicitly.
- Each hosted mission can fund at most one picker-linked offscreen mission.
- Free-text-source spends remain available and don't consume from the derived balance.
- Bookkeeping on the target character (completed_missions, commissary_reward) is preserved across spend/edit/delete.

## Non-goals

- Auto-creating offscreen missions when a mission is hosted. Earning and spending stay distinct user actions.
- A per-character credit pool of any kind. Credits are profile-scoped only.
- A header / global UI badge for the balance. Balance lives on the profile page.
- Transferring credits between profiles or characters.

## Data model

### Drop

- `characters.conduit_credits` column.
- `spend_conduit_credit(p_character_id, p_merx)` Postgres function.
- `refund_conduit_credit(p_character_id, p_merx)` Postgres function.
- The `conduit_credits` number input in `views/partials/character-v2-fields.handlebars`.
- The per-character "Conduit Credits: N" tag display on the character page.

### Add

```sql
-- DB-level enforcement that any one hosted mission can fund at most one offscreen mission.
CREATE UNIQUE INDEX IF NOT EXISTS offscreen_missions_source_unique_idx
  ON offscreen_missions (source_mission_id)
  WHERE source_mission_id IS NOT NULL;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Bumps completed_missions +1 and commissary_reward + p_merx. Used by createOffscreenMission.
-- Replaces spend_conduit_credit (which also decremented the dropped characters.conduit_credits column).
CREATE OR REPLACE FUNCTION apply_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = completed_missions + 1,
         commissary_reward = commissary_reward + COALESCE(p_merx, 0)
   WHERE id = p_character_id;
$$;

-- SECURITY INVOKER (default): runs as the caller so characters_update RLS applies as defense in depth.
-- Reverses apply_offscreen_mission_progress, clamped at 0. Used by removeOffscreenMission.
-- Replaces refund_conduit_credit.
CREATE OR REPLACE FUNCTION revert_offscreen_mission_progress(p_character_id UUID, p_merx INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE characters
     SET completed_missions = GREATEST(completed_missions - 1, 0),
         commissary_reward = GREATEST(commissary_reward - COALESCE(p_merx, 0), 0)
   WHERE id = p_character_id;
$$;
```

### Keep

- `offscreen_missions` table — schema unchanged. `created_by` already carries the profile that spent the credit, which is exactly the field we need for derived-balance queries.
- `adjust_commissary_reward(p_character_id, p_delta)` function — still used by the update flow.
- `offscreen_missions_character_id_idx` composite index.
- All existing RLS policies on `offscreen_missions`.

## Balance computation

Profile balance is derived, not stored. One model function in `models/profile.js`:

```javascript
const getProfileConduitCredits = async (profileId, client = supabase) => {
  const { count: earned } = await client
    .from('missions')
    .select('*', { count: 'exact', head: true })
    .eq('host_id', profileId);

  const { count: spentLinked } = await client
    .from('offscreen_missions')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', profileId)
    .not('source_mission_id', 'is', null);

  return {
    data: {
      earned: earned || 0,
      spent_linked: spentLinked || 0,
      balance: (earned || 0) - (spentLinked || 0)
    },
    error: null
  };
};
```

Two cheap counts. Both queries pass through RLS using the caller's client, so a profile only sees their own activity.

## Earning

No code path. A mission row with `host_id = profileId` is the earn event. The profile's balance reflects it automatically on the next page load.

## Spending

### Source picker

The picker in `views/partials/offscreen-mission-form.handlebars` shows only missions where:

1. `host_id = current_user.profile_id`, AND
2. There is no `offscreen_missions` row with `source_mission_id = mission.id`.

Implemented by a new model method `getAvailableHostedMissionsForPicker({ profileId, supabase })` that does the join/anti-join and returns the eligible mission rows.

If the picker is empty, the form still allows a free-text source.

### Spend bookkeeping

- `createOffscreenMission`:
  - Pre-check (in the route): if the submitted source is picker (`source_mission_id` is set and not `__other__`), verify `profileBalance > 0`. If 0, return 400 "No Conduit Credits available." (Edge case prevented by the picker being empty in the form, but the route guards anyway.)
  - Insert the offscreen-mission row. The DB's partial unique index will reject any concurrent duplicate-source insert with a 23505 — the model returns that as the error to surface "That mission has already funded a credit."
  - Call `apply_offscreen_mission_progress(character_id, merx)`.
- The 2-step (insert then RPC) keeps the same non-atomic trade-off documented in the prior design. The comment in the model is updated to reflect the new RPC name.

### Free-text source

If the submitted source is free-text (`source_mission_id` is `__other__` or absent, plus `source_mission_name_other` + `source_mission_date_other` provided), no balance check. The row inserts with `source_mission_id = NULL`. The partial unique index doesn't apply.

### Update flow (unchanged behavior)

`updateOffscreenMission` still calls `adjust_commissary_reward` for the merx delta. Credit balance is untouched because it's derived from row counts that don't change on update.

If the user changes the source between picker and free-text (or vice versa, or to a different picker mission), the partial unique index enforces 1:1 on the new value. The model handles the 23505 error path.

### Delete (refund)

`removeOffscreenMission` now calls `revert_offscreen_mission_progress` instead of `refund_conduit_credit`. The deleted row's source_mission_id (if any) becomes available again for a future spend — automatic via the derived balance and the partial unique index.

## UI

### Profile page (`views/profile.handlebars`)

Add a "Conduit Credits" section near the top, visible only to the logged-in viewer (it's their own profile):

```
Conduit Credits
  Earned: N (missions hosted)
  Spent: M (offscreen missions with linked source)
  Available: K
```

If the viewer has never hosted a mission AND has never spent (i.e., N = M = 0), hide the section entirely.

### Character page (`views/character.handlebars`)

- Remove the per-character credit balance tag block.
- Spend button: visible to the character's creator unconditionally. Inside, the form handles the "no balance, free-text only" case by rendering the picker empty + a help text.

### Character edit form (`views/partials/character-v2-fields.handlebars`)

- Remove the `conduit_credits` number input (and its surrounding `<div class="field">` and the trailing `<hr/>`).

### Offscreen-mission form (`views/partials/offscreen-mission-form.handlebars`)

- The picker now uses `availableHostedMissions` (filtered by the model) instead of `hostedMissions`.
- If `availableHostedMissions` is empty, the picker's `<select>` shows only the "Other / not in the system" option, and a help text appears: "You have no available Conduit Credits to spend. To create an offscreen mission anyway, use 'Other' below."

## Routes

### Modified

`routes/characters.js`:

- `GET /:id/offscreen-missions/new`: fetch `availableHostedMissions` (via the new picker method) + `profileCredits` (via `getProfileConduitCredits`). Pass both to the form view. Remove the existing `if (!character.conduit_credits || character.conduit_credits <= 0)` guard (the gate is now in the form/POST handler).
- `POST /:id/offscreen-missions`: if picker source, verify balance > 0 against the profile (compute via `getProfileConduitCredits`). If free-text, skip the balance check. Map the 23505 unique-constraint error to a clean 400 "That mission has already funded a credit."
- `GET /:id/offscreen-missions/:omId/edit`: same as new — fetch `availableHostedMissions` (which now also includes the currently-linked source mission so it stays in the picker if already selected) and pass it down. Implementation note: the model method needs a `currentSourceId` parameter that, when provided, adds that mission back into the result even though it's "used."
- `POST /:id/offscreen-missions/:omId`: same balance/duplicate-source handling as POST create when the source changes.

`routes/profile.js`:

- `GET /profile` (the logged-in user's own page): fetch `profileCredits` and pass to the view.

### Unchanged

- `POST /:id/offscreen-missions/:omId/delete` — model handles the bookkeeping reversal via the new RPC.
- All five route URLs stay the same.

## Model

### New

In `models/offscreen-mission.js`:

- `getAvailableHostedMissionsForPicker({ profileId, currentSourceId, supabase })` — returns missions where `host_id = profileId` AND `id NOT IN (SELECT source_mission_id FROM offscreen_missions WHERE source_mission_id IS NOT NULL)`. If `currentSourceId` is supplied, add that mission's row back into the result (for the edit form). Returns `{ data, error }`.

In `models/profile.js` (or a re-export):

- `getProfileConduitCredits({ profileId, supabase })` — returns `{ data: { earned, spent_linked, balance }, error }`.

### Modified

In `models/offscreen-mission.js`:

- `createOffscreenMission`:
  - Drop the `spend_conduit_credit` RPC call.
  - Insert the row first (this is now the synchronous point — the partial unique index enforces 1:1; a duplicate fails the insert).
  - If insert returns a 23505 PostgresError, surface it as `{ error: { code: '23505', message: 'duplicate_source_mission' } }` so the route can map it.
  - On insert success, call `apply_offscreen_mission_progress` and return its error if any.
  - The 2-step is now "insert then progress" instead of "RPC then insert" — flipped because the partial unique index makes the insert the integrity point. Comment updated.
- `updateOffscreenMission`: unchanged except for the unique-index error handling on `source_mission_id` change.
- `removeOffscreenMission`: swap the RPC name from `refund_conduit_credit` to `revert_offscreen_mission_progress`.
- The `listHostedMissionsForPicker` name was already renamed to `getHostedMissions` in `models/mission.js` (Task 3 of the prior revision); we now add the new picker method `getAvailableHostedMissionsForPicker` alongside it in `models/offscreen-mission.js`. `getHostedMissions` remains for any future use but is no longer wired to the form.

### Removed

- No model methods removed — `createOffscreenMission` etc. retain their names, just changed internals.

## Tests

### New

- `getAvailableHostedMissionsForPicker` returns the right exclusion set.
- `getAvailableHostedMissionsForPicker` with `currentSourceId` includes that mission even when it's used.
- `getProfileConduitCredits` returns `{ earned, spent_linked, balance }`.
- `createOffscreenMission` surfaces the 23505 unique-constraint error as a duplicate-source error.

### Modified

- All existing `createOffscreenMission` tests update to reflect the new order: insert first (now the integrity point), `apply_offscreen_mission_progress` second.
- All existing `removeOffscreenMission` tests update to assert the new RPC name `revert_offscreen_mission_progress`.

### Removed

- Any test asserting `spend_conduit_credit` or `refund_conduit_credit` RPC calls.

## Migration

A second migration file `supabase/migrations/20260526000001_conduit_credits_profile_pool.sql` performs the following, in order:

1. Drop the `spend_conduit_credit` and `refund_conduit_credit` functions.
2. Drop the `characters.conduit_credits` column (`ALTER TABLE characters DROP COLUMN IF EXISTS conduit_credits;`).
3. Create the partial unique index `offscreen_missions_source_unique_idx`.
4. Create the new functions `apply_offscreen_mission_progress` and `revert_offscreen_mission_progress`.

Mirror into `schema.sql` (drop the old column and functions from the canonical mirror; add the new ones).

The v2-character-support branch was never merged to main, so dropping the column is non-destructive against production. Local installations that already applied the prior migration will lose any manually-entered credit values — acceptable since the data has no real meaning under the new model.

## Open questions

None at this time.
