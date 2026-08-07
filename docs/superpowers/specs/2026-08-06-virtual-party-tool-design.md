# Virtual Party Tool — Design

**Date:** 2026-08-06
**Branch:** `virtual-party-tool`, stacked on `stat-block-selector`
**Status:** Approved, awaiting implementation plan

## Problem

The party stats summary only exists inside an LFG post, and only for a party
that already exists.

`routes/lfg.js:105-110` reduces the approved join requests' characters over
`statList`, and `views/lfg-post.handlebars:174-187` renders each of the 12
totals as a numeral plus `stat-blocks-readonly`. That is the entire feature —
no service, no shared partial, no unit test. The only assertion on it is a
string match in `views/lfg-post.test.js:68`.

Two limitations follow from where it lives:

**You cannot ask "what would this party look like?"** The summary appears only
after a post exists and members have been approved. There is no way to try a
roster before committing to it — the exact moment the numbers would be most
useful.

**It reports without interpreting.** Twelve totals in a row do not tell you
that nobody in the party has any Arcane. The reader has to scan for zeroes.

## Goal

A top-level `/party` tool where anyone can assemble a roster from public
characters — plus their own private ones when signed in — and see that party's
stat summary: totals, coverage gaps, and who contributes what. The party lives
in the URL, so it is shareable and bookmarkable without a database table.

The summary logic becomes one shared, tested unit that both `/party` and the
LFG post page render.

## Non-goals

- **No saved parties.** No table, no migration, no CRUD, no "my parties" list.
  The URL is the persistence mechanism. Revisit only if users ask.
- **No stat editing.** The tool reads characters; it never writes. There is no
  what-if slider on an individual character's stats.
- **No changes to the stats themselves** — `statList`, the 0–5 block
  vocabulary, and `stat-blocks-readonly` are used exactly as they are.
- **No change to LFG membership rules.** Who is in an LFG party, and how they
  get approved, is untouched. Only how that party is summarized changes.
- **No party composition advice** beyond mechanical coverage. The tool says
  "nobody has Arcane"; it does not say "you should recruit a Mage".

## Decisions

Settled during brainstorming; recorded here because several are non-obvious.

**Party membership lives in `?c=`, not the database.** `/party?c=id1,id2,id3`.
A shareable URL costs one query-string parser; saved parties cost a table, RLS
policies, ownership rules, CRUD routes, and a list page. The URL also survives
refresh, supports the back button, and works signed-out. If saved parties are
ever wanted, this design is what they would be built on top of.

**Capped at 8 members.** URL length stays sane, the per-character breakdown
table stays readable, and no party in play is larger. Ids past the eighth are
dropped with a notice, not silently truncated.

**Public access, `authOptional`.** `/characters/search` is already public
(`util/seed-nav.js:192`), and a shareable link that demands a login is not
shareable. Signing in adds your private characters; it is not required to use
the tool.

**RLS is the visibility gate, not application code.** `characters_public_select`
(`is_public = true`) OR'd with `characters_owner_admin_select` (you are the
creator, or you are an admin) at
`supabase/migrations/20240101000000_baseline_schema.sql:872-885` already
resolves exactly the set the tool needs. So the fetch is a bare `.in('id', ids)`
through the request-scoped client with **no** `is_public` filter in JS. An id
you may not see simply does not come back. Admins see private characters here
for the same reason they do everywhere else in the app — this introduces no new
exposure.

**Your own private characters are findable by browsing, not searching.**
`searchPublicCharacters` (`models/character.js:244`) hard-filters
`is_public = true` and `hide_from_search = false`, so name search will never
surface an unpublished PCC. Rather than add an `includeOwn` flag to a function
four other callers share, the party page lists **My Characters** up front via
the existing `getOwnCharacters` and puts the public search below it. Your own
stable is small enough to browse; everyone else's needs search.

**Sharing degrades visibly rather than silently.** A link containing a private
character's id renders in full for you and drops that member for everyone else
— RLS will not return the row. That is correct (nothing leaks) but lossy, so
both ends say so: the owner sees "3 members are private. Anyone you share this
link with will see a 5-member party", and the recipient sees "2 characters
could not be loaded". Neither side is left wondering why the totals look wrong.

**Deceased characters are allowed.** They appear in My Characters with the same
skull marker `character-search-results` already uses, and can be added. LFG
filters the deceased out because it is recruiting for a real game; a planning
tool has no reason to.

**LFG adopts the richer summary.** Rather than keep two renderings, the LFG
post page renders the same `party-summary` partial and gains gaps and the
breakdown. The inline reduce at `routes/lfg.js:105-110` is deleted, not left
alongside.

## Architecture

Four layers, each usable and testable without the one above it.

```
util/party-stats.js          pure: characters[] -> summary
       ^                     no I/O, no Handlebars, no Supabase
       |
models/character.js          getPartyCharacters(ids, client)
       ^                     RLS-scoped .in('id', ids)
       |
routes/party.js              parse ?c=, fetch, summarize, render
routes/lfg.js                (same summarize, existing fetch)
       ^
       |
views/partials/party-summary.handlebars
                             renders a summary object; used by both
```

### `util/party-stats.js`

```js
summarizeParty(characters) -> {
  totals:     { vitality: 7, might: 3, ... },   // every stat in statList, always present
  gaps:       ['arcane', 'luck'],               // total === 0
  strongest:  ['might', 'vigor', 'skill'],      // top 3 by total
  weakest:    ['spirit', 'will', 'sensory'],    // bottom 3, gaps excluded
  breakdown:  [{ id, name, is_public, stats: {...} }, ...],
  memberCount: 5
}
```

Pure. No I/O. Ties in `strongest`/`weakest` break by `statList` order, so the
output is deterministic. `weakest` excludes anything already in `gaps` — a
zero is called out once, as a gap, not twice. A party of fewer than 6 non-gap
stats yields shorter `strongest`/`weakest` arrays rather than padding. An empty
party yields all-zero totals, every stat in `gaps`, and empty
`strongest`/`weakest`.

### `models/character.js`

One new function:

```js
getPartyCharacters(ids, client = supabase)
```

Selects `id, name, image_url, class, class_id, is_deceased, is_public` plus the
12 stat columns, `.in('id', ids)`. No visibility filter — see the RLS decision
above. Callers pass `res.locals.supabase`.

### `routes/party.js`

Mounted at `/party` in `app.js` alongside the other route modules.
`authOptional` on both routes.

| Route | Purpose |
|---|---|
| `GET /party` | Full page. Parses `?c=`, renders search panel + party panel. |
| `GET /party/panel` | The party panel only, for htmx swaps. Takes `c` plus an optional `add` or `remove` id. |
| `GET /party/s` | Search results rows, for the public character search. |

`/party` and `/party/panel` share one helper that turns the request into a
resolved, ordered member list:

1. Start from `c`: split on comma, trim, drop anything that is not a UUID.
2. Apply `add` (append if not already present) or `remove` (drop it), if given.
3. Dedupe, preserving first-seen order.
4. Truncate to 8; remember whether anything was dropped.
5. `getPartyCharacters` the survivors.
6. Reorder the returned rows to match URL order (Supabase does not preserve
   `.in()` ordering).
7. Compare requested count to resolved count — the difference is the
   "could not be loaded" notice.

My Characters comes from `getOwnCharacters(profile, res.locals.supabase)` and
is omitted entirely when signed out. The public search needs its own results
route rather than reusing `/characters/s` because the rows carry an Add button
instead of a View Character link, and are laid out as dense rows rather than
`character-search-results`' 3-across image cards — you are adding up to eight
of them.

### Interaction

The party panel owns the current membership. It renders a hidden input:

```html
<input type="hidden" id="party-csv" name="c" value="id1,id2,id3">
```

Every Add and Remove reads that input rather than carrying membership in its
own URL:

```
hx-get="/party/panel"
hx-vals='{"add": "<character id>"}'      (or "remove")
hx-include="#party-csv"
hx-target="#party-panel"
hx-swap="outerHTML"
```

The server computes the new membership, renders the panel — including a
refreshed `#party-csv` — and sets `HX-Push-Url: /party?c=<new csv>` on the
response, the same header `routes/lfg.js:99` already uses.

**This indirection is load-bearing.** The obvious alternative is to bake the
resulting csv into each button's `hx-get` at render time. That breaks: the Add
buttons live in the *left* column, which does not re-render when the party
panel swaps, so every button would still carry the membership as it stood at
page load. Adding a second character would silently discard the first. Reading
the csv from the panel at request time is what keeps the two columns in sync.

The other rejected alternative was targeting `body` with
`hx-push-url="true"`, as `views/classes.handlebars:6` does. It sidesteps the
staleness problem by re-rendering everything, but it wipes your search results
on every add — exactly when you are working through them to add a fourth and
fifth member.

### Views

| File | Contents |
|---|---|
| `views/party.handlebars` | Page shell. Left: My Characters + public search. Right: `#party-panel`. |
| `views/partials/party-panel.handlebars` | Roster + `party-summary` + hidden csv input + share/privacy notices. |
| `views/partials/party-roster.handlebars` | Member chips, each with a Remove button and a lock marker when private. |
| `views/partials/party-summary.handlebars` | Totals, gaps, breakdown. Rendered by `/party` **and** `lfg-post`. |
| `views/partials/party-search-results.handlebars` | Dense result rows with Add buttons. |

`party-summary` renders three sections:

- **Totals** — the existing layout from `lfg-post.handlebars:177-184`: each
  stat's numeral plus `stat-blocks-readonly value=… max=5`. Unchanged
  visually.
- **Coverage** — gaps called out first ("No coverage: Arcane, Luck"), then
  strongest and weakest. Suppressed entirely for an empty party.
- **Breakdown** — a table, one row per member, one column per stat, with a
  totals row. Wrapped in Bulma's `.table-container` so it scrolls horizontally
  on narrow screens instead of breaking the layout.

### Navigation

A **Virtual Party** entry under Social in `util/seed-nav.js`, `requires_auth:
false`, pointing at `/party`. That seed only runs on a fresh install — it bails
when any nav row exists (`util/seed-nav.js:63-70`) — so existing deployments
need the entry added by an admin at `/nav/manage`. That is a deploy step, noted
here so it is not discovered in production.

## Changes to existing code

| File | Change |
|---|---|
| `routes/lfg.js:105-110` | Delete the inline reduce. Call `summarizeParty(party)` instead and pass the summary to the view. |
| `views/lfg-post.handlebars:174-187` | Replace the totals loop with `{{> party-summary summary=partySummary}}`. Add an "Open in party tool" link carrying the approved members' ids. |
| `views/lfg-post.test.js:68` | Re-point at the shared partial; the numeral assertion moves to the partial's own test. |
| `models/character.js` | Add `getPartyCharacters`; export it. |
| `app.js` | Mount `routes/party.js` at `/party`. |
| `util/seed-nav.js` | Add the Virtual Party nav item under Social. |

No migration. No change to `statList`, `stat-blocks-readonly`, or any existing
model function's signature.

## Testing

Following the repo's existing tiers.

**`util/party-stats.test.js`** (unit) — the pure core carries most of the
coverage:

- Empty party: all totals 0, every stat a gap, `strongest`/`weakest` empty.
- Single character: totals equal that character's stats.
- Multiple characters sum per stat.
- Missing/null stat values on a row count as 0, not `NaN`.
- `gaps` contains exactly the zero-total stats.
- `weakest` never includes a gap.
- Ties in `strongest` break by `statList` order (deterministic output).
- Fewer than 3 non-gap stats yields a shorter array, not padding.

**`routes/party.test.js`** (http):

- Bare `/party` renders an empty party without error.
- `?c=` with duplicate ids dedupes, preserving first-seen order.
- Non-UUID junk in `?c=` is dropped without a 500.
- More than 8 ids truncates to 8 and reports the drop.
- Ids that resolve to nothing produce the "could not be loaded" count.
- Resolved members are ordered by URL position, not by whatever Supabase
  returned.
- Signed out, the My Characters section is absent.
- `/party/panel?c=id1&add=id2` returns a panel containing **both** ids and
  pushes both in `HX-Push-Url` — the regression guard for the staleness trap
  described under Interaction.
- `add` with an id already present is a no-op, not a duplicate.
- `remove` of an id not present leaves membership unchanged.

**`views/partials/party-summary.test.js`** (render, jsdom, matching the
existing `views/*.test.js` pattern):

- Totals render a numeral and a `stat-blocks` row per stat.
- A total above 5 fills 5 blocks and still prints the real number — the
  behavior `stat-blocks-readonly`'s comment describes and
  `views/lfg-post.test.js:68` currently guards.
- Gaps section is absent for a party with full coverage.
- Breakdown has one row per member plus a totals row.

**`e2e/specs/`** — one spec: land on `/party`, add two characters from search,
assert the totals change and the URL gained both ids, remove one, assert the
URL and totals follow.

## Risks

**The LFG post page changes appearance.** It gains a coverage section and a
breakdown table it did not have. This is intended, but it is a visible change
to a page nobody asked to change. The mitigation is that the totals block —
the part people already read — renders identically.

**Shared links to parties containing private characters are lossy.** Covered
by the explicit notices on both ends, but it remains a genuine sharp edge: two
people can look at "the same" party URL and see different numbers. The
alternative — refusing to add private characters at all — was rejected as worse,
since planning with your own unpublished PCC is a real use case.

**Query-string length.** Eight UUIDs is roughly 300 characters. Well inside
every limit, but the cap is what keeps it there; raising the cap later means
revisiting this.

**`.in()` with a large id list.** Bounded at 8 by the cap, so not a practical
concern — noted only because the ordering fix in step 5 of the parse helper
exists precisely because `.in()` makes no ordering promise.
