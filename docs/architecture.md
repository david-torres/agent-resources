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

The in-app bug reporter is the one route that talks to a third party.
`services/feedback/` keeps that split explicit: `input.js` and `body.js` are
pure (normalization and Markdown), `github.js` owns the token and the REST
call, and `repository.js` is the storage adapter for the public
`bug-screenshots` bucket. `routes/feedback.js` authenticates, rate-limits, and
hands the multipart submission to `FeedbackService`. The widget is rendered
from the main layout only for a signed-in user on a server that is configured
to file issues.
