---
id: ar-ezes
status: open
deps: []
links: []
created: 2026-07-10T21:28:57Z
type: task
priority: 1
assignee: David Torres
tags: [security, architecture, database]
---
# Consolidate service-role access behind repositories

Routes and models directly import/use supabaseAdmin. Authorization is distributed across callers while RLS is bypassed, making reviews and future changes risky.

## Acceptance Criteria

No route imports the service-role client; repositories/adapters encapsulate privileged persistence; services receive actor context and use capability-oriented methods; authorization tests cover each privileged command.

