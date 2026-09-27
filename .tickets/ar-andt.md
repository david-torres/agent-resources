---
id: ar-andt
status: closed
deps: []
links: []
created: 2026-09-27T22:15:12Z
type: bug
priority: 1
assignee: David Torres
tags: [aspirant, release-review]
---
# Fix hosted migration runner project-reference parsing

Found in final review of aspirant-v1-classes-and-characters at e0c439e.

scripts/apply-migrations.mjs:52 removes the db. prefix but leaves the .supabase.co suffix in projectRef. The hosted connection then uses postgres.<ref>.supabase.co instead of postgres.<ref>, preventing the migration runner from authenticating to the project pooler.

Reproduction: evaluate the connection configuration with SUPABASE_URL=https://exampleproject.supabase.co. The resulting user is postgres.exampleproject.supabase.co. Expected: postgres.exampleproject. The same suffix problem applies to db.exampleproject.supabase.co.

Verified by an isolated configuration reproduction without contacting a database.

## Design

Restore hosted project-reference suffix removal while preserving the new local direct-connection behavior. Test configuration construction independently of credentials and database access.

## Acceptance Criteria

Hosted API and db-prefixed Supabase URLs produce postgres.<project-ref> usernames without domain suffixes.
Local URLs retain the direct localhost/LAN connection behavior.
Regression coverage exercises hosted and local connection configuration without connecting to production.
