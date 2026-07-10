---
id: ar-k4qi
status: closed
deps: []
links: []
created: 2026-07-10T21:28:56Z
type: bug
priority: 0
assignee: David Torres
tags: [testing, ci]
---
# Make unit tests hermetic without Supabase credentials

The documented database-free unit suite imports models/_base.js, which throws when SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY are absent. CI supplies none, so bun run test fails in a clean environment.

## Acceptance Criteria

bun run test passes with no .env or Supabase credentials; production startup still fails clearly for missing required credentials; CI validates this path.

