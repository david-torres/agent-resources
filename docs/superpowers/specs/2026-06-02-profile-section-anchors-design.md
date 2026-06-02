# Profile Section Anchors with Copy-Link Icons

**Date:** 2026-06-02
**Status:** Approved

## Goal

On the public profile page (`/profile/view/:name`), give each titled section a stable
URL anchor. When the user hovers a section title, show a small "copy link" icon that
copies a deep link to that section to the clipboard and confirms with a toast.

## Scope

In scope — the three titled sections on `views/profile-view.handlebars`:

- **Conduit Briefing** (`h3`, already has `id="conduit-briefing"`)
- **Public Characters** (`h2`, slug `public-characters`)
- **Public Classes** (`h2`, slug `public-classes`)

The Bio block has no heading and is out of scope.

The heading is built as a **reusable partial** so other detail pages
(characters, classes, missions) can adopt it later.

## Approach

Reusable Handlebars partial + a single delegated click handler in `app.js`.
Delegation (rather than a per-element `_initX` pass) keeps the feature immune to
htmx `hx-boost` page swaps with no re-init wiring.

## Components

### `views/partials/section-heading.handlebars` (new)

```handlebars
<{{tag}} id="{{id}}" class="{{class}} anchor-heading">{{title}}<a class="anchor-link" href="#{{id}}" data-anchor-copy aria-label="Copy link to “{{title}}”" title="Copy link to this section"><i class="fas fa-link" aria-hidden="true"></i></a></{{tag}}>
```

Hash arguments:

- `tag` — heading element, e.g. `h2` / `h3`.
- `class` — heading classes, default `title is-4`.
- `id` — the anchor slug.
- `title` — visible heading text.

The icon is a **real `<a href="#id">`**: with JS disabled it still jumps to the
anchor (progressive enhancement); JS upgrades the click to copy-the-URL.

### `views/profile-view.handlebars` (edit)

Replace the three hard-coded headings with partial calls:

- `{{> section-heading tag="h3" id="conduit-briefing" title="Conduit Briefing"}}`
- `{{> section-heading tag="h2" id="public-characters" title="Public Characters"}}`
- `{{> section-heading tag="h2" id="public-classes" title="Public Classes"}}`

### `public/css/styles.css` (edit)

- `.anchor-link` hidden by default (`opacity: 0`).
- Revealed on `.anchor-heading:hover`, `.anchor-heading:focus-within`, and when the
  link itself is focused (keyboard accessibility).
- Small left margin, muted color, smooth opacity transition.

### `public/js/app.js` (edit)

A single delegated listener: `document.addEventListener('click', …)` matching
`event.target.closest('[data-anchor-copy]')`:

1. `preventDefault()`.
2. Resolve the id from the link's `href` hash (or the closest `[id]` heading).
3. Build `location.origin + location.pathname + '#' + id`.
4. Copy via `navigator.clipboard.writeText`, with a `textarea + execCommand('copy')`
   fallback for insecure / unsupported contexts.
5. Reflect the anchor in the address bar via `history.replaceState` (no scroll jump).
6. Confirm with the existing `_displayNotification('success', 'Link copied to clipboard')`.

## Error handling

Clipboard failure → fall back to `execCommand`. If that also fails, still update the
hash and show `_displayNotification('warning', 'Could not copy — copy the link from the address bar')`.

## Testing

- `bun test`: render the `section-heading` partial through express-handlebars and assert
  the output contains the correct `id`, `href="#<id>"`, the `data-anchor-copy` hook, and
  the title text.
- Clipboard / hover / DOM behavior is browser-only and verified manually.

## Out of scope

- Adopting the partial on other detail pages (characters/classes/missions) — enabled by
  this work but done separately.
- Anchoring the Bio block.
