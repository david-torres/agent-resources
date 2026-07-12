# Agent Resources

Agent Resources is a web application for managing Enclave characters, finding
games, and more!

## Table of Contents

- [Installation](#installation)
- [Database Setup](#database-setup)
- [Usage](#usage)
- [Dependencies](#dependencies)
- [Enclave](#enclave)
- [License](#license)

## Installation

This project uses [Bun](https://bun.sh/) as its runtime and package manager.
Install Bun first if you don't already have it:

```sh
curl -fsSL https://bun.sh/install | bash
```

Then:

1. Clone the repository:
   ```sh
   git clone https://github.com/david-torres/agent-resources.git
   cd agent-resources
   ```

2. Install the dependencies:
   ```sh
   bun install
   ```

3. Create a `.env` file based on `.env.dist` and fill in the required
   environment variables (Supabase credentials, OpenAI API key, and optional
   system message settings).

4. Set up the database — see [Database Setup](#database-setup) below.

## Database Setup

This project uses [Supabase](https://supabase.com/) (hosted Postgres) for
storage and auth. Point `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
`SUPABASE_SECRET_KEY` in `.env` at your Supabase project before applying
any SQL.

### 1. Apply the base schema

`schema.sql` at the repo root contains the full baseline schema (profiles,
characters, classes, missions, conduits, pages, etc.). Apply it once against
a fresh database:

- In the Supabase dashboard: open the SQL editor, paste the contents of
  `schema.sql`, and run it.
- Or via `psql`:
  ```sh
  psql "$SUPABASE_DB_URL" -f schema.sql
  ```

### 2. Apply incremental migrations

Migrations in `supabase/migrations/` are applied in filename order on top of
the baseline schema. Run each one you haven't already applied against your
database (dashboard SQL editor or `psql -f`).

The two top-level files `migration_nav_items.sql` and `seed_nav_items.sql`
set up the dynamic navigation table and seed its default entries — run the
migration first, then the seed.

### 3. (Optional) Seed class data

To (re)load class definitions from the seed util:

```sh
bun run seed:classes
```

### Backups

`scripts/db-backup.sh` runs `pg_dump` against the configured Supabase pooler
and writes a compressed dump to `backups/`. It reads `SUPABASE_DB_PASS` from
`.env`:

```sh
bun run db:backup
```

Note: the host and user in `scripts/db-backup.sh` are hardcoded to the
project's Supabase instance — edit the script if you're pointing at your
own project.

## Usage

To start the application in development mode (auto-reload on file changes):

```sh
bun run dev
```

To start the application in production mode:

```sh
bun run start
```

To run the test suite:

```sh
bun test
```

## Agent Tokens

Long-lived personal access tokens can be created per user for agent integrations.

- `POST /profile/agent-tokens` with `{ "name": "My agent" }` creates a token and returns the raw token once.
- `GET /profile/agent-tokens` lists active tokens for the signed-in user.
- `DELETE /profile/agent-tokens/:id` revokes a token.
- `GET /api/agent/me` verifies a token sent via `X-Agent-Token` or `Authorization: Bearer ...`.
- `GET /api/agent/classes` returns the class list visible to that user.
- `GET /api/agent/classes/:id` returns full details or teaser-only details based on the same release/unlock rules as the web app.

Server-side agent routes should use `SUPABASE_SECRET_KEY` so token-authenticated requests can evaluate ownership and unlock state without a Supabase browser session.

## Dependencies

This project is built using:

- [Express](https://github.com/expressjs/express)
- [Handlebars](https://github.com/handlebars-lang/handlebars.js)
- [Supabase](https://github.com/supabase/supabase)
- [Htmx](https://github.com/bigskysoftware/htmx)
- [Bulma](https://github.com/jgthms/bulma)

## Enclave

New to the Enclave? Watch the video:

[![Watch the video](https://img.youtube.com/vi/aBVeIi6s6rE/0.jpg)](https://www.youtube.com/watch?v=aBVeIi6s6rE)

[Learn more about the Enclave](https://www.kickstarter.com/projects/757240159/enclave-a-tableless-roleplaying-game)


## License

This project is licensed under the MIT License.
