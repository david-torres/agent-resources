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

3. Make a copy of the `.env.example` file and fill in the values.
[Database Setup](#database-setup) will help you fill in the Supabase values.

   ```sh
   cp .env.example .env
   ```

4. Set up the database — see [Database Setup](#database-setup) below.

### Database Setup

This project uses [Supabase](https://supabase.com/) (hosted Postgres) for
storage and auth. Point `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` in `.env` at your Supabase project before applying
any SQL.

#### 1. Create a Supabase project

To create a Superbase project for development, you can either deploy locally
or deploy to a new project on the Superbase Platform. Since using a hosted
Superbase project does not require Docker, this guild will walk you through
that. You can find a guide for local deploment
[here](https://supabase.com/docs/guides/local-development) if you prefer local
development.

1. Go to <https://www.supabase.com>
2. Create a new project. The free tier is enough for development and testing.
3. Copy the `anon` and `service_role` keys into `.env`. You'll find them under
project Settings > API Keys > Legacy anon, service_role API keys.

#### 2. Apply the base schema

`schema.sql` at the repo root contains the full baseline schema (profiles,
characters, classes, missions, conduits, pages, etc.). Apply the schema by
either:

   1. Open the SQL editor for your project in the Superbase dashboard, paste
      the contents of `schema.sql`, and run it.
   2. Or via `psql`:

  ```sh
  psql "$SUPABASE_DB_URL" -f schema.sql
  ```

#### 3. Apply incremental migrations

Migrations in `supabase/migrations/` are applied in filename order on top of
the baseline schema. Run each one you haven't already applied against your
database. You can apply these changes in the dashboard SQL editor
or from the command line using Supabase's CLI.

```sh
# Install the Supabase CLI
brew install supabase/tap/supabase

# Log in and connect to Supabase
supabase login

# Navigate to the root directory of this repository.
cd $AGENT_RESOURCES_REPO_ROOT

# Link your project. Get project-ref from your Supabase dashboard URL:
# https://supabase.com/dashboard/project/{project-ref}
supabase link --project-ref $SUPABASE_PROJECT_ID

supabase db push
```

The two top-level files `migration_nav_items.sql` and `seed_nav_items.sql`
set up the dynamic navigation table and seed its default entries — run the
migration first, then the seed.

TODO: these migrations may not be necessary anymore. Check to see if they
can be removed.

```sh
cd $AGENT_RESOURCES_REPO_ROOT
supabase db push ./migration_nav_items.sql
supabase db push ./seed_nav_items.sql
```

#### 4. (Optional) Seed class data

To (re)load class definitions from the seed util:

```sh
# If you haven't populated an admin user, populate one now:
bun run seed:admin

# Seed classes
bun run seed:classes
```

#### 5. (Optional) Check schema and tables

You can see a visual representation of the database schema on the Supabase
dashboard for your project under Database > Schema Visualizser.

You can check the rows of your table from the Supabase dashboard for your
project under Table Editor. If you ran `seed:admin` and `seed:classes` above,
you should see them in your database.

#### Backups

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

Server-side agent routes should use `SUPABASE_SERVICE_ROLE_KEY` so token-authenticated requests can evaluate ownership and unlock state without a Supabase browser session.

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
