# Profile Badges — Design

**Date:** 2026-06-06
**Status:** Approved (pending spec review)

## Problem

There is no recognition system for participation on AR. Players who appear on
many missions, conduits who host them, and attendees of community events
(Enclave Day, Big 12) have nothing on their profile that reflects it.

## Goal

Exclusive profile badges, earned two ways:

1. **Milestone badges** — awarded automatically when a profile's mission
   counters cross defined thresholds, retroactively applied to all existing
   accounts, and permanent once earned.
2. **Admin-granted badges** — event and personal badges granted (and revocable)
   by admins.

Badges display on the public profile view and the owner's profile page.

## Non-Goals

- No badge marketplace, trading, or user-selectable display order.
- No notification system for newly earned badges (future work).
- No per-character badges — badges belong to the profile.
- Offscreen missions do not count toward any counter.
- Historical `awarded_at` reconstruction: backfilled badges carry the backfill
  date, not the date the threshold was historically crossed.

## Counters

All counters are per-profile and deduplicate by mission: a profile can only
ever count a given mission once per counter, regardless of how many of their
characters appeared on it. Every row in `missions` counts (public or private).

| Counter | Definition |
|---|---|
| **newcomer** | `COUNT(DISTINCT mission_id)` over (missions with ≥1 of your characters) ∪ (missions where `host_id` = you) |
| **player** | `COUNT(DISTINCT mission_id)` from `mission_characters` joined to characters with `creator_id` = you |
| **conduit** | `COUNT(*)` of missions where `host_id` = you |

## Badge Catalog

| Track / group | Category | Slugs | Thresholds (counter) |
|---|---|---|---|
| Newcomer | milestone | `newcomer-1`…`newcomer-12`, `newcomer-final` | 1–12, 13 (newcomer) |
| Veteran Player | milestone | `veteran-player-1`…`-12` | 23, 25, 28, 32, 37, 43, 50, 58, 67, 77, 88, 100 (player) |
| Veteran Conduit | milestone | `veteran-conduit-1`…`-12` | 5, 7, 10, 14, 19, 25, 32, 40, 49, 59, 70, 82 (conduit) |
| Enclave Day | event | `enclave-day-1`…`-15` | — |
| Big 12 | event | `big-12-1` | — |
| Personal | personal | `personal-dippy`, `-julian`, `-meeks`, `-robby`, `-tomas` | — |

Both veteran ladders follow the same increment pattern (+2, +3, … +12) so the
player track lands Rank 12 at an even 100 missions and the conduit track starts
much lower (5) per design intent.

`AR Badge Veteran Base.png` is not an earnable badge: it is the locked/
placeholder art shown (greyed) on a user's own profile for a veteran track they
have not started.

## Data Model

One migration in `supabase/migrations/`, mirrored into `schema.sql`:

```sql
CREATE TABLE badges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,            -- 'newcomer-3', 'veteran-player-12'
    name text NOT NULL,                   -- 'Newcomer III', 'Enclave Day 7'
    description text,
    category text NOT NULL CHECK (category IN ('milestone', 'event', 'personal')),
    track text CHECK (track IN ('newcomer', 'veteran_player', 'veteran_conduit')),
    rank int,                             -- 1..13 within a track
    threshold int,                        -- counter value that earns it (milestone only)
    image_path text NOT NULL,             -- path within the 'badges' storage bucket
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profile_badges (
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    badge_id uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    awarded_at timestamptz NOT NULL DEFAULT now(),
    granted_by uuid REFERENCES profiles(id),   -- NULL = earned automatically
    PRIMARY KEY (profile_id, badge_id)
);
```

Both tables get RLS enabled (same pattern as `rules_pdfs`); all writes go
through the service-role client in the model layer.

## Assets

Badge art is uploaded to a **public Supabase storage bucket `badges`**;
catalog rows store the bucket path in `image_path` and views build the public
URL from it. A one-shot **seed script** (`scripts/seed-badges.js`) uploads the
PNGs currently in `public/img/badges/` and upserts catalog rows keyed on slug
(re-runnable). `AR Badge Veteran Base.png` is uploaded to the bucket too (the
UI needs it as placeholder art) but gets no catalog row. After seeding succeeds
in production, `public/img/badges/` is deleted from the working tree.

## Awarding Logic

New model `models/badge.js` (+ `models/badge.test.js`):

- `getMissionCounters(profileId)` — the three counts above.
- `recalculateMilestoneBadges(profileId)` — fetch counters, select all active
  milestone badges with `threshold <= counter` for their track, upsert-ignore
  into `profile_badges`. **Insert-only**: never deletes, so permanence holds by
  construction (a deleted mission can never demote anyone).
- `getProfileBadges(profileId)` — display query: highest earned rank per
  milestone track + all event/personal badges + next-rank progress data
  (`{ track, count, nextThreshold }`).
- `grantBadge(profileId, badgeSlug, grantedById)` /
  `revokeBadge(profileId, badgeSlug)` — admin operations; milestone slugs are
  rejected at the model level (milestones are automatic-only).

### Trigger points

After any mission mutation that changes who is on a mission — create, update
(characters or host changed), delete, and the existing mission merge flow —
collect affected profile IDs (host + creators of all attached characters,
both **before and after** the change) and call `recalculateMilestoneBadges`
for each. Mission mutations funnel through `models/mission.js` (web routes and
agent API both), so the call sites are contained in one file.

Recalc runs after the mission save succeeds and is **non-blocking**: failures
are logged (with profile/mission IDs) but never fail the mission request. A
missed or failed recalc self-heals on the next recalc or backfill run.

### Retroactivity

`scripts/backfill-badges.js` iterates every profile and calls the same
`recalculateMilestoneBadges`. Run once post-deploy to award everything
historically earned; idempotent and safe to re-run. Per-profile failures are
collected and reported at the end rather than aborting the run.

## UI

### Badge shelf (shared partial `views/partials/badge-shelf.handlebars`)

- **Public profile** (`/profile/view/:name`): badge row near the top — highest
  earned badge per milestone track + all event/personal badges. Art with
  name/description tooltip. Tracks at zero render nothing; the section is
  hidden entirely when the profile has no badges.
- **Own profile** (`/profile`): same shelf plus per-track progress (e.g.
  "Newcomer VII — next rank at 8 missions") and the greyed Veteran Base art as
  placeholder for an unstarted veteran track.

Badge data rides into the existing profile renders via `getProfileBadges`; if
it errors, the page renders without badges (same tolerance pattern as
`conduitCredits` in `routes/profile.js`).

### Admin management (new `routes/badges.js`)

- `GET /badges/manage` (`isAuthenticated, requireAdmin`): renders
  `badges-manage.handlebars` — catalog grouped by category, profile search
  (existing `searchProfiles` util) to pick a user, grant/revoke buttons per
  event/personal badge, and a read-only view of the user's milestone badges
  (labeled "automatic").
- `POST /badges/grant`, `POST /badges/revoke` (admin-only): thin handlers over
  the model functions; milestone slugs → 400. Revoking a badge the user does
  not hold is a no-op success.
- Linked in the nav for admins alongside the existing manage pages.

## Error Handling

- Recalc: log-and-continue, never blocks mission logging.
- Badge shelf: render-without on failure.
- Seed/backfill scripts: idempotent, re-runnable, report failures at the end.
- Grant/revoke: validate slug exists, is active, and is not a milestone.

## Testing (TDD, matching `models/*.test.js` style)

- **`models/badge.test.js`**: counter dedupe (two of your characters on one
  mission = 1; host+player on same mission = 1 for newcomer), threshold
  boundaries (exactly at, between, zero), insert-only permanence (recalc after
  a count drops removes nothing), grant/revoke incl. milestone rejection,
  highest-per-track display query, next-rank progress math.
- **Route tests**: admin gating (401/403) on manage/grant/revoke, happy paths.
- **Hook test**: logging a mission triggers recalc for host + character
  creators.

## Rollout

1. Apply migration (tables + RLS).
2. Create `badges` bucket; run `scripts/seed-badges.js`.
3. Deploy code (recalc hooks, UI, admin routes).
4. Run `scripts/backfill-badges.js` (retroactive awards).
5. Remove `public/img/badges/` from the working tree.
