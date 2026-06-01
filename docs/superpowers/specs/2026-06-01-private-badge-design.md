# "Private" Badge for Non-Public Items — Design

**Date:** 2026-06-01
**Status:** Approved (pending spec review)

## Problem

When a user owns a character, mission, class, profile, or LFG post that is not
public (`is_public = false`), nothing in the UI signals that the item is hidden
from other users. Owners can't tell at a glance which of their items are private.

## Goal

Show a user-facing **"Private"** badge (lock icon + "Private" text) wherever a
non-public item is displayed — on its detail page and in list views — so owners
immediately see which items are private.

## Non-Goals

- No backend, query, schema, or RLS changes. Every affected view already loads
  the entity's `is_public` flag.
- No toggle/control to change visibility from the badge. Display only.
- No badge on inherently-public-only listings (e.g. another user's "Public
  Characters" section, which by definition contains only public items).

## Design

### Component: shared partial `views/partials/private-badge.handlebars`

One reusable partial owns the badge markup, text, and styling (DRY — avoids
copy-pasting into ~10 templates). It renders nothing when the item is public:

```handlebars
{{#unless isPublic}}<span class="tag is-warning is-light" title="Only you can see this"><span class="icon is-small"><i class="fas fa-lock"></i></span><span>Private</span></span>{{/unless}}
```

- Bulma `tag is-warning is-light` matches the app's existing tag convention
  (e.g. the `release/beta/alpha` and library `is-active` tags).
- Font Awesome 7 (`fas fa-lock`) is already loaded in `partials/head.handlebars`
  and already used elsewhere (`character.handlebars`).
- Invoked with a hash argument naming the flag, e.g.
  `{{> private-badge isPublic=character.is_public}}`.

### Visibility logic

Rule: **`is_public === false` → render the badge; otherwise render nothing.**

No owner/admin gating is required. RLS already guarantees that only the owner
(or an admin) can load a private item or see it within a list, so any rendered
non-public item belongs to someone allowed to know it is private. The
`{{#unless isPublic}}` guard lives entirely inside the partial.

### Placement

Badge sits inline next to the item's title (detail pages) or row label (lists).

**Detail pages (next to the `<h1>`/header title):**
- `views/character.handlebars` — uses `{{> private-badge isPublic=character.is_public}}`
- `views/mission.handlebars` — `isPublic=mission.is_public`
- `views/class-view.handlebars` — `isPublic=class.is_public` (the existing
  "Public: Yes/No" text **stays**; the badge is added in the header in addition)
- `views/profile-view.handlebars` — `isPublic=viewProfile.is_public`
- `views/lfg-post.handlebars` — `isPublic=post.is_public`

**List / index views (per row, where a private item can appear):**
- `views/character-list.handlebars` — `isPublic=this.is_public`
- `views/mission-list.handlebars` — `isPublic=this.is_public`
- `views/my-classes.handlebars` — `isPublic=this.is_public`
- LFG post lists where the viewer's own (potentially private) posts appear:
  `views/partials/lfg-my-posts.handlebars`, and any other LFG list partial that
  can render a non-public post (`lfg-public-posts`, `lfg-joined-posts`) — the
  partial self-guards, so adding the call is harmless on lists that only ever
  contain public posts.

Exact insertion points (line-level) are determined per-file during planning;
each call passes the `is_public` flag already in that template's scope.

### Data flow

No new data. Each template already has its entity (and `is_public`) in scope;
the partial reads the flag passed to it. The render pipeline is unchanged.

## Testing

Pure template work — no JS logic to unit test (per project TDD guidance,
templates are exempt). Verification is a render smoke test:

1. Start the server.
2. Load a private item the test user owns (character/mission/class) → badge with
   lock icon + "Private" appears next to the title.
3. Load a public item → no badge.
4. Confirm the badge also appears in the corresponding list view for the private
   item and is absent for public ones.

## Open Questions

None. Confirmed: lock icon + "Private" text; keep the classes "Public: Yes/No"
text and also add the header badge; badge everywhere a private item can appear.
