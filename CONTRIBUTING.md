# Contributing

## Local workflow

Use Bun for the application and test commands. Install dependencies with
`bun install`, copy `.env.dist` to `.env`, then run `bun run setup`.

Run `bun run check`, `bun run test`, and `bun run test:http` before opening a
pull request. Database integration tests require a local Supabase stack:
`supabase start`, `supabase db reset`, then `bun run test:integration`.
The integration workflow runs automatically when database-facing code changes.

## Change checklist

- Keep route URLs, response shapes, and templates stable unless the change
  explicitly includes a product/API change.
- Add or update focused tests for changed behavior.
- Put schema changes in a new timestamped `supabase/migrations/` file. Do not
  edit an applied migration or add a parallel schema file.
- Run the relevant test tier. Run local integration tests for database writes.
- Document migrations, rollback considerations, and user-visible effects in
  the pull request.

## Ownership and review

Changes to `models/character.js`, `services/character/`, Supabase migrations,
authentication, or authorization need review from a maintainer familiar with
that domain. Keep cross-domain refactors incremental and independently
revertible.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).
