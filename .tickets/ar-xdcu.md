---
id: ar-xdcu
status: closed
deps: [ar-k4qi, ar-3hsi]
links: []
created: 2026-07-10T21:28:56Z
type: task
priority: 0
assignee: David Torres
tags: [integration, ci, database]
---
# Make local Supabase integration reproducible and enforce it for database changes

Integration workflow is manual-only and does not initialize/reset a local Supabase project or explicitly apply migrations/seeds. Database/RPC/RLS changes can merge without a reliable integration gate.

## Acceptance Criteria

Fresh checkout can provision/reset local Supabase reproducibly; migration/RPC/RLS integration suite runs in automation; PR policy enforces it for relevant changes.

