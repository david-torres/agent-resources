---
id: ar-p0aq
status: closed
deps: []
links: []
created: 2026-09-27T22:15:12Z
type: bug
priority: 1
assignee: David Torres
tags: [aspirant, release-review]
---
# Gate default Enchantment text by character viewer book access

Found in final review of aspirant-v1-classes-and-characters at e0c439e.

views/partials/signature-entry.handlebars:24-26 renders item.default_enchantment when a character owns a default Enchantment. services/character/repository.js merges that class-authored content onto gear rows, but services/character/description-gate.js only blanks gear.description when access is denied. The default Enchantment description therefore remains visible to viewers without the book unlock.

Reproduction: give a public character a Signature from a locked class, enchantment={source:'default'}, and class-authored default_enchantment text. Apply the description gate as a signed-out viewer with no unlocks and render signature-entry. The Signature description is absent but the default Enchantment description remains in HTML.

The shared partial affects both the full character page and the details fragment used by party/LFG views. Verified with an isolated gate-plus-template reproduction.

## Design

Extend the shared description gate to cover class-authored default Enchantment content, including fail-closed handling. Preserve legitimate unlocked access and the existing approved LFG-host exception. Keep player-authored Custom Enchantments and Mods distinct from book-gated content.

## Acceptance Criteria

Signed-out and locked signed-in viewers receive no class-authored default Enchantment description in full character pages or details fragments.
Unlocked viewers and authorized LFG hosts retain the content under existing access rules.
Access lookup failures do not expose default Enchantment text.
Regression tests cover the gate and rendered output, including player-authored equipment behavior.
