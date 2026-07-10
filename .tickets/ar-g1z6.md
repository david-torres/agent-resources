---
id: ar-g1z6
status: closed
deps: []
links: []
created: 2026-07-10T21:28:56Z
type: task
priority: 1
assignee: David Torres
tags: [architecture, testing]
---
# Extract application construction from server startup

index.js loads env, constructs Express, installs all routes, installs process handlers, and listens as import side effects. Tests must recreate partial app configurations.

## Acceptance Criteria

A createApp composition function is exported and accepts dependencies where useful; startup/listening and process handlers live in a thin entrypoint; existing behavior and routes remain intact.

