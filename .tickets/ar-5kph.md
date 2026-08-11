---
id: ar-5kph
status: closed
deps: [ar-g1z6]
links: []
created: 2026-07-10T21:28:56Z
type: task
priority: 1
assignee: David Torres
tags: [architecture, dependencies]
---
# Remove util/supabase global model barrel

util/supabase.js eagerly imports and re-exports almost every model, creating hidden domain dependencies, fragile export coupling, and oversized test mocks.

## Acceptance Criteria

Routes/services import explicit domain interfaces; application wiring is centralized; barrel is removed or reduced to a non-domain compatibility shim with an elimination plan.


## Notes

**2026-07-10T23:52:16Z**

Barrel removed: all 11 consumers import explicit models/* modules; util/supabase.js deleted; suite green; grep gate clean.
