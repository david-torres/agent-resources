---
id: ar-ee08
status: open
deps: []
links: []
created: 2026-07-10T21:28:57Z
type: task
priority: 2
assignee: David Torres
tags: [tooling, contributor-experience]
---
# Add enforceable code-quality tooling and runtime policy

bun run check only performs JavaScript syntax checks. Runtime version is not pinned and both Bun and npm lockfiles are tracked.

## Acceptance Criteria

Formatting/linting/static checks are documented and run in CI; Bun version is pinned for contributors and CI; package-manager/lockfile policy is singular and enforced.

