# Agent Resources

Agent Resources is a web application for managing Enclave characters, finding
games, and more!

## Table of Contents

- [Installation](#installation)
  - [Quick start (one-call setup)](#quick-start-one-call-setup)
    - [Path A — Free Supabase cloud project](#path-a--free-supabase-cloud-project-supabasecom)
    - [Path B — Local Supabase with the CLI](#path-b--local-supabase-with-the-cli)
  - [Manual installation](#manual-installation)
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

### Quick start (one-call setup)

The first step differs depending on where your database will live. Pick the
path that matches your setup and follow it through the remaining steps.

#### Path A — Free Supabase cloud project (supabase.com)

The easiest path: a free-tier project on supabase.com, no Docker required,
and `bun run setup` handles the full DB bootstrap.

1. Sign up at <https://supabase.com> and create a new project. Wait for it
   to finish provisioning (~2 min).

2. Create a `.env` from the template and fill in your project's credentials
   from **Project Settings → API** and **Project Settings → Database**:
   ```sh
   cp .env.example .env
   $EDITOR .env
   ```
   Required keys:
   - `SUPABASE_URL` — Project URL, e.g. `https://abcdefgh.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` — the `anon` / publishable key
   - `SUPABASE_SECRET_KEY` — the `service_role` / secret key
   - `SUPABASE_DB_PASS` — the database password you set at project creation
   - `SUPABASE_DB_REGION` — pooler region in `aws-0-<region>` form, from
     **Project Settings → General**. Only needed if your project is not in
     `us-east-1`. `bun run scripts/probe-region.mjs` detects it.

   Optional: `OPENAI_API_KEY` and any `SYSTEM_MESSAGE_*` settings.

3. Run the setup script. It installs dependencies, applies all migrations
   in `supabase/migrations/`, and seeds the navigation table — safe to
   re-run:
   ```sh
   bun run setup
   ```

4. Start the app:
   ```sh
   bun run dev
   ```

#### Path B — Local Supabase with the CLI

Runs the entire Supabase stack in Docker on your machine — useful for
offline development, frequent DB resets, or working against a throwaway
environment.

Prerequisites: [Docker](https://docs.docker.com/get-docker/) and the
[Supabase CLI](https://github.com/supabase/cli#install-the-cli) (`brew
install supabase/tap/supabase`, or `npm i -D supabase`, or the install
script).

1. Start the local stack (Postgres, GoTrue, PostgREST, etc.). The repository
   includes `supabase/config.toml`, migrations, and seed data, so no separate
   initialization step is needed:
   ```sh
   supabase start
   ```
   The first run pulls Docker images and may take a few minutes. When it
   finishes, copy the printed `API URL`, `anon key`, and `service_role key`
   — you'll need them in a moment.

2. Create a `.env` from the template. The local stack uses fixed defaults
   — the DB password is always `postgres`:
   ```sh
   cp .env.example .env
   $EDITOR .env
   ```
   Required keys for local dev:
   - `SUPABASE_URL=http://127.0.0.1:54321`
   - `SUPABASE_PUBLISHABLE_KEY=<anon key from `supabase status`>`
   - `SUPABASE_SECRET_KEY=<service_role key from `supabase status`>`
   - `SUPABASE_DB_PASS=postgres`

3. Apply migrations and seeds via the Supabase CLI. (The bundled `bun run
   setup` script targets the Supabase cloud pooler and won't work against a
   local stack — `supabase db reset` is the local equivalent: it runs every
   file in `supabase/migrations/` plus `supabase/seed.sql`):
   ```sh
   supabase db reset
   ```

4. Seed the local app data (admin user, classes, and badges). `db reset`
   only loads `nav_items`; this one idempotent command fills in the rest in
   the right order and is safe to re-run (each step is skipped when its table
   is already populated):
   ```sh
   bun run seed:local
   ```
   It seeds a `dummy@testing.com` / `dummypassword` admin, the class
   definitions, and the badge catalog. Badge art is pulled from the public
   prod storage bucket on first run (no credentials needed); override the
   source with `BADGE_ART_SOURCE_URL`.

5. Start the app:
   ```sh
   bun run dev
   ```

---

Useful flags on `bun run setup` (Path A only):

| Flag | Effect |
| --- | --- |
| `--with-admin` | Also seed a `dummy@testing.com` admin user (interactive confirmation by default; auto-confirmed with `--yes`). |
| `--with-classes` | Also seed the class definitions. |
| `--skip-install` | Skip `bun install` even if `node_modules` is missing. |
| `--skip-seed` | Skip applying `supabase/seed.sql`. |
| `--yes` | Non-interactive mode (auto-confirm prompts, assume "yes"). |
| `--dry-run` | Print what would happen without making any changes. |

If you don't have a real Supabase project and Docker is unavailable, sign
up for the free tier on supabase.com — it's the simplest path with no
infrastructure to manage.

If you prefer to do each step by hand, see [Manual installation](#manual-installation) below.

### Manual installation

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
storage and auth. The full schema is reconstructed by applying every file
in `supabase/migrations/` in filename order. `bun run setup` does this
automatically; you can also use the Supabase CLI directly once your
project is linked.

### Schema layout

```
supabase/
├── migrations/
│   ├── 20240101000000_baseline_schema.sql   ← full schema for a fresh DB
│   ├── 20241213_collaborative_missions.sql
│   ├── …
│   └── 20260609000100_nav_items.sql         ← dynamic-navigation table
└── seed.sql                                  ← default nav_items rows
```

New schema changes go in a new timestamped file under `supabase/migrations/`
using the standard Supabase CLI convention (`<14-digit-timestamp>_<name>.sql`).
The migrations *are* the canonical schema.

### Using the Supabase CLI against a linked cloud project

An alternative to `bun run setup` for Path A, if you have the
[Supabase CLI](https://github.com/supabase/cli) installed.

1. Link the local checkout to your cloud project. Your project ref is the
   subdomain of `SUPABASE_URL` — for `https://abcdefgh.supabase.co` it is
   `abcdefgh`. You only need to do this once per checkout:
   ```sh
   supabase link --project-ref=<project-ref>
   ```

2. Apply the migrations:
   ```sh
   supabase db push
   ```

`db push` applies every file in `supabase/migrations/` and tracks them in
the `supabase_migrations.schema_migrations` table, just like the bundled
script. **It does not apply `supabase/seed.sql`** (the CLI reserves seed
files for `supabase db reset`); for nav items seeding either run `bun run
setup` once or apply `supabase/seed.sql` manually.

### Seeding app data (admin, classes, badges)

For a local stack, `bun run seed:local` seeds everything `supabase db reset`
doesn't — an admin user, class definitions, and the badge catalog — in
dependency order and idempotently. It's the recommended one-command path.

The individual seeds can also be run directly:

```sh
bun run seed:admin      # dummy@testing.com / dummypassword admin (dev only)
bun run seed:classes    # class definitions — requires an admin profile first
bun run fetch:badges    # download badge art from the public prod bucket
bun run seed:badges     # upload art to the badges bucket + upsert catalog rows
```

`seed:classes` sets each class's `created_by` to the admin profile, so
`seed:admin` (or an existing admin) must run first. `seed:badges` reads art
from `public/img/badges/`, which `fetch:badges` populates.

### Checking the schema and tables

You can see a visual representation of the database schema on the Supabase
dashboard for your project under Database > Schema Visualizser.

You can check the rows of your table from the Supabase dashboard for your
project under Table Editor. If you ran `seed:admin` and `seed:classes` above,
you should see them in your database.

### Backups

`scripts/db-backup.sh` runs `pg_dump` against your project's Supabase pooler
and writes a compressed dump to `backups/`. It derives the host and user from
`SUPABASE_URL`, `SUPABASE_DB_REGION`, and `SUPABASE_DB_PASS` in `.env`:

```sh
bun run db:backup
```

## Usage

To start the application in development mode (auto-reload on file changes):

```sh
bun run dev
```

To start the application in production mode:

```sh
bun run start
```

### Tests

This project uses Bun for its test runner and module-mocking API, and Playwright
for the browser tier. There are four tiers:

| Command | Tier | Requires |
| --- | --- | --- |
| `bun run test` | Unit (jsdom, no DB) | nothing |
| `bun run test:http` | HTTP (Express + mocked models) | nothing |
| `bun run test:integration` | Integration (real Supabase, no browser) | `supabase start` |
| `bun run test:e2e` | End-to-end (Chromium) | `supabase start` + `bun run seed:local` |

`bun run test` is the default isolated, database-free suite. Route HTTP tests are
a separate tier because they bind a local ephemeral port.

The two database integration suites are intentionally excluded from the default
run. To run them, start local Supabase and reset it with the repository
migrations, configure your `.env` with the local credentials from
`supabase status`, then run:

```sh
supabase start
supabase db reset
bun run test:integration
```

`test:integration` rejects a non-local `SUPABASE_URL`, so it cannot write to a
cloud project by accident.

#### End-to-end browser tests

The E2E tier drives a real Chromium against a real server and a real database.
It covers behavior the other three tiers structurally cannot reach: htmx swaps,
Alpine's settle phase, boosted navigation, and the back button.

```sh
supabase start
bun run seed:local
bun run test:e2e
```

It boots its own server on port 3100, so it runs alongside `bun run dev`. It
applies the same non-local `SUPABASE_URL` guard as the integration tier, seeds
and deletes its own rows under an `e2e-` prefix, and **never resets your
database**.

Open the report for a failed run with:

```sh
bunx playwright show-report e2e/report/html
```

> **The suite currently fails by design.** Nine tests are deliberate
> characterizations of defects found on this branch and are expected to be red;
> `bun run test:e2e` therefore exits non-zero even when nothing is wrong. See
> [`docs/superpowers/reports/2026-08-03-e2e-findings.md`](docs/superpowers/reports/2026-08-03-e2e-findings.md)
> for what each one records and which are refactor regressions rather than
> pre-existing bugs.

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
