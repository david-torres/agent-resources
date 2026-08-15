# Homepage Dashboard

## Problem

The homepage serves two audiences and commits to neither. Signed-out visitors
get a hero and a video. Signed-in players get a greeting, a get-started callout
that disappears once they own a character, and a FullCalendar widget showing
every LFG post on the site.

The calendar does not earn its place there. There are too few games in LFG to
fill a month grid, it pulls a CDN script on every homepage visit, and it renders
only when a player htmx-navigates to `/` from another page — a cold load of the
homepage leaves the container empty (`public/js/app.js:745-749` is the sole
caller of `renderCalendar`).

The result is that a returning player lands on a page that tells them nothing
about their own work, nothing about their upcoming games, and nothing about what
anyone else has been doing.

## Goals

Rebuild `/` as a dashboard for returning signed-in players, whose first job is
getting them back into their own work. Give signed-out visitors the existing
pitch plus enough real community content to prove the site is alive. Move the
calendar somewhere it fits instead of deleting it.

## Non-goals

Notifications, activity streams beyond the four sections below, a full blog
engine separate from the existing `pages` CMS, and any redesign of the LFG,
character, or mission pages beyond what these sections require.

## Page structure

### Signed in

1. **Greeting** — unchanged, one line.
2. **Get-started callout** — unchanged, still gated on `hasCharacters === false`.
   It is the empty state for everything below it.
3. **Pick up where you left off** — one merged list, 6 rows, sorted by
   `updated_at` descending across characters, mission logs, and classes. Each row
   carries a type chip, the name, a one-line meta (character → class and level;
   mission → outcome and session date; class → status and edition), and a
   relative timestamp. Footer links to the three full lists.

   Merged rather than three columns: most players have many characters, some
   mission logs, and zero classes, so a three-column layout is permanently
   ragged. A merged list lets classes appear only for the players who write them,
   and it answers "what was I last doing" literally.
4. **Your upcoming games** — the next 3 LFG posts the player hosts or has joined
   with a future date. Each row shows the date and time in the player's profile
   timezone (`profiles.timezone` with `moment-timezone`, both already present),
   the title, a Host/Player badge, and the character they signed up with. Hosts
   with pending join requests get a count badge linking to the post.
5. **News** — the latest 2 published news posts: title, date, excerpt, link to
   the existing `/pages/:slug`. The section is omitted entirely when empty.
6. **Recent from the community** — 6 rows total, merged across recent public
   characters and mission logs from other players. The viewer's own rows are
   excluded, as are characters with `hide_from_search` set.

### Signed out

Hero, video, and Kickstarter link unchanged, followed by News and Recent from the
community using the same partials. No personalized queries run.

This works without a signed-in client: `characters_public_select` and
`missions_public_select` are plain `is_public = true` with no role check
(`supabase/migrations/20240101000000_baseline_schema.sql:872,1103`), so the anon
client reads them.

Item counts target roughly a screen and a half and are expected to be tuned once
the page carries real data.

## Schema

One migration, `supabase/migrations/20260815000001_home_recency.sql`.

### Timestamps on characters and missions

Neither table has `created_at` or `updated_at` today
(`20240101000000_baseline_schema.sql:38,80`). Both get
`timestamptz NOT NULL DEFAULT now()` columns. The default stamps existing rows at
migration time; the backfill then corrects what it can.

Missions take both values from their own `date` column.

Characters derive theirs from `mission_characters` joined to `missions`:
`created_at` from the earliest linked mission date, `updated_at` from the latest.
Characters with no linked missions keep `now()`.

Two guards on the backfill:

- `missions.date` can be in the future, since a session can be scheduled ahead.
  Both derived values are clamped with `LEAST(..., now())`, applying the same
  not-in-the-future rule the edit form enforces.
- `updated_at` takes a `GREATEST(created_at, ...)` so it can never precede
  creation.

Both tables then get `BEFORE UPDATE` triggers using the existing
`update_updated_at_column()`. A trigger rather than application-level writes
because character writes go through the `save_character_atomic` and
`level_up_character_atomic` RPCs, which application code does not intercept.

**Accepted consequence:** `increment_missions_count`
(`20240101000000_baseline_schema.sql:230`) updates `characters.completed_missions`,
so completing a four-player mission bumps all four characters to the top of the
recency feeds. This is the honest reading of "updated" — a character finishing a
mission is recent activity. The alternative, a column-scoped trigger, is fragile
for little gain.

### News flag on pages

`pages` gets `is_news boolean NOT NULL DEFAULT false`. Everything else news needs
already exists on that table: markdown content, `is_published`, `access_level`,
timestamps, the admin editor, slug routing, and RLS.

The feed orders by `created_at`. Consequence: a post drafted on the 1st and
published on the 10th is dated the 1st. If drafting ahead becomes routine, a
`published_at` column set on the publish transition is a small follow-up; it is
not built now.

### Indexes

- `characters(updated_at DESC) WHERE is_public AND NOT hide_from_search`
- `missions(updated_at DESC) WHERE is_public`
- `characters(creator_id, updated_at DESC)`
- `missions(creator_id, updated_at DESC)`

At current data volume these are close to decorative. They are cheap and they
document the access patterns.

### Editable created_at on characters

The backfill is a guess, and characters — unlike missions, which have a
user-editable `date` — have no other date a player could correct it with. So
characters get an editable `created_at` and missions do not. `classes` keeps
system-owned timestamps.

`updated_at` stays trigger-owned everywhere. If both dates were editable, neither
would mean anything and a row could be pinned to the top of a feed permanently.

A date input on the character form. Validation lives in the character service,
not the template, so the agent API path is covered too:

- must parse as a valid date
- must not be in the future

No lower bound.

In `save_character_atomic`, `created_at` joins the explicit column lists in both
the insert and update branches, read from the existing `p_character jsonb`
argument — the function signature does not change
(`20260710000000_atomic_character_writes.sql:7`). On update it is read through a
`COALESCE` so omitting it never nulls an existing value.
`level_up_character_atomic` needs no change; the trigger covers it.

## Code structure

### Route

`routes/home.js` stays the composition point. The `/` handler fires the section
queries with `Promise.allSettled` and passes the successful results to the
template. A section that errors logs and renders as absent rather than taking the
whole page down — with six independent feeds on a landing page, all-or-nothing
failure is the wrong trade.

### Models

New functions on existing modules, each taking the caller's client so RLS
performs the access control — the pattern documented in the header comment of
`models/pages.js`:

| Module | Functions |
| --- | --- |
| `models/character.js` | `getRecentByCreator`, `getRecentPublic` |
| `models/mission.js` | `getRecentByCreator`, `getRecentPublic` |
| `models/class.js` | `getRecentByCreator` (keys off `created_by`) |
| `models/pages.js` | `getRecentNews` |
| `models/lfg.js` | `getUpcomingForProfile` |

`getUpcomingForProfile` composes the existing `getLfgPostsByCreator` and
`getLfgJoinedPosts` with a future-date filter and a merge rather than
introducing new SQL.

`getRecentPublic` takes the viewer's profile id so it can exclude their own rows,
and on characters it filters `hide_from_search` in addition to the `is_public`
that RLS already enforces. Signed-out callers pass no profile id and exclude
nothing.

### Pure merge module

`services/home/recent-feed.js` normalizes a character, mission, or class into a
common `{ type, id, name, href, meta, updated_at }` shape, then merges, sorts,
and truncates. Both the "mine" feed and the community feed run through it.

It touches no database and no request context, so its tests are fast and
exhaustive, and the merge rules live in one place instead of being duplicated
across two templates.

### Views

`home.handlebars` becomes thin composition over four new section partials —
`home-recent-mine`, `home-upcoming-games`, `home-news`, `home-community` — plus a
shared `home-feed-item` row partial. Both feed sections render the same
normalized shape, so one row partial serves both.

### Helper

`util/handlebars.js` has only absolute formatting via `date_tz` (line 18). Add
`time_ago`, built on moment's `fromNow()`, and register it in `app.js`.

## Calendar relocation

The calendar moves to a fourth tab on the LFG page rather than being deleted.
`/lfg` and its three existing tab routes are all `isAuthenticated`, matching
`/lfg/events/all`, so no auth or policy change is needed.

- `views/partials/lfg-calendar.handlebars` — new, holds the `#calendar` div.
- `GET /lfg/tab/calendar` — new, `isAuthenticated`, renders that partial.
- A fourth tab link in `views/lfg.handlebars:14-20`.
- The trigger in `public/js/app.js:745-749` retargets from
  `finalRequestPath === '/'` to `'/lfg/tab/calendar'`.

Retargeting also fixes the cold-load bug: the tab click *is* an htmx request, so
the calendar always renders when asked for, and the FullCalendar CDN script loads
only when someone opens the tab.

`/lfg/events/all`, `renderCalendar`, `_loadFullCalendar`, and the `x-calendar`
branch at `routes/lfg.js:99` all stay. The event click-through to `/lfg/:id`
works unchanged from the tab.

### Deletions

Only the `#calendar` block at `views/home.handlebars:51-53`.

The `calendar-link` npm dependency stays — it backs the "add to your calendar"
buttons at `views/lfg-post.handlebars:38-42`, a separate feature.

## Testing

Colocated `*.test.js`, per existing convention:

- `services/home/recent-feed.test.js` — per-type normalization, sort order,
  truncation, ties, missing fields.
- `util/handlebars.test.js` — new file, covering `time_ago`.
- Extensions to `models/character.test.js`, `mission.test.js`, `class.test.js`,
  `pages.test.js`, and `lfg.test.js` for the new query functions.
- `routes/home.test.js` — new. The load-bearing case is degradation: one feed
  rejecting still returns 200 with the remaining sections intact.
- `views/home.test.js` — new. Both auth branches and every section's empty state.
- Character `created_at` validation in the service (invalid rejected, future
  rejected), plus a round-trip through `save_character_atomic` added to
  `models/character-atomic.integration.test.js`.

The migration is rehearsed with `bun run rehearse:migrations` against a copy of
the real database, verifying three things specifically:

1. Characters with no linked missions land on `now()`.
2. Characters linked to future-dated missions are clamped, not dated forward.
3. No row ends with `updated_at < created_at`.

## Sequencing

Five independently shippable steps:

1. Migration and backfill — rehearsed, verified, merged alone.
2. Model query functions, `services/home/recent-feed.js`, and `time_ago`, with
   tests. No UI.
3. Homepage sections and partials, both auth branches.
4. Editable `created_at` on the character form, including the RPC column lists.
5. Calendar relocation to the LFG tab.

Step 1 ships by itself so timestamps begin accumulating real signal while the
rest is built. The longer it is in place before the feeds go live, the less the
day-one backfill guess matters.

`bun run seed:local` produces no news posts and no public activity, so steps 3
and 4 will look emptier locally than in production. `util/starter-content.js`
gains a couple of seeded news pages to compensate.
