---
id: ar-3hsi
status: closed
deps: [ar-k4qi]
links: []
created: 2026-07-10T21:28:56Z
type: bug
priority: 0
assignee: David Torres
tags: [testing, ci]
---
# Stabilize HTTP test server lifecycle and run HTTP tests in CI

Route test suites call app.listen(0) and immediately read server.address().port, which can be null before the listening event. The HTTP tier is not run in CI.

## Acceptance Criteria

Shared async server helper awaits listening and closes cleanly; all route HTTP suites use it; bun run test:http is deterministic; PR CI runs it.

