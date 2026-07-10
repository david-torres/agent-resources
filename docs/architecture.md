# Architecture overview

The application is an Express server using CommonJS modules and Supabase for
persistence. Routes translate HTTP requests into model/service calls and keep
the established page and API response contracts.

`models/` owns Supabase queries and persistence adapters. Domain services own
application rules and orchestration. `services/character/` is the reference
boundary: pure input normalization lives alongside a `CharacterService`, while
`models/character.js` supplies the current Supabase adapter for compatibility.

Tests are tiered:

- `bun run test`: isolated unit and model tests; no database or HTTP listener.
- `bun run test:http`: route tests that bind localhost only.
- `bun run test:integration`: opt-in tests against local Supabase only.

Schema changes belong exclusively in `supabase/migrations/`. Each migration
must be independently reviewable and have a local-Supabase verification path.
