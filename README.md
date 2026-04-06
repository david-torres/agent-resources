# Agent Resources

Agent Resources is a web application for managing Enclave characters, finding
games, and more!

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Dependencies](#dependencies)
- [Enclave](#enclave)
- [License](#license)

## Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/david-torres/agent-resources.git
   cd agent-resources
   ```

2. Install the dependencies:
   ```sh
   npm install
   ```

3. Create a `.env` file based on `.env.dist` and fill in the required
   environment variables.

## Usage

To start the application in development mode:

```sh
npm run dev
```

To start the application in production mode:

```sh
npm run start
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
