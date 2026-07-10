---
id: ar-m8ai
status: open
deps: [ar-ezes]
links: []
created: 2026-07-10T21:28:57Z
type: epic
priority: 1
assignee: David Torres
tags: [architecture, character, transactions]
---
# Complete character mutation service boundary

CharacterService handles create/update but routes/characters.js still contains direct admin writes, authorization, validation, workflow logic, and multi-step perk persistence.

## Acceptance Criteria

All character mutations are implemented as named use cases/services with tested contracts and transaction boundaries; route handlers only translate HTTP and render responses.

