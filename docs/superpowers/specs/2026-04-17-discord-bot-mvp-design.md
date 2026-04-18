# Discord Bot Integration — MVP Design (Lookups)

**Status:** Draft
**Date:** 2026-04-17
**Scope:** First-release MVP. LFG and Enclave Day integrations are explicitly out of scope and will be separate specs.

## Overview

Add a Discord bot that lets Enclave server members look up characters and class information from within Discord, backed by the existing `agent-resources` web application. The bot runs as a separate Node process in a separate repository and talks to the web app over HTTPS using the existing `/api/agent/*` token-authenticated API.

The MVP proves out two things: (1) a clean account-linking flow between Discord and `agent-resources`, and (2) the agent API as the right surface for external integrations. Once linking and lookups feel good, LFG integration and Enclave Day events become focused follow-up specs.

## Goals

- A Discord user can link their Discord account to their `agent-resources` profile via a device-code flow.
- A Discord user can look up any public character (or their own private characters) by name, with autocomplete.
- A Discord user can look up any class, including its abilities and gear, respecting the existing release/unlock rules.
- A Discord user can look up a single ability by class and name.
- The bot performs no business logic; every authorization decision is made by the web app.

## Non-goals

- LFG browsing, posting, joining, or role pings from Discord.
- Enclave Day event listing, signup, or reminders.
- Mission display or editing.
- Writes to character sheets or classes.
- OAuth-based Discord-to-Supabase identity federation.

## Architecture

Two processes, two repositories.

- **`agent-resources`** (existing) continues to own all data. It exposes new endpoints for bot linking and character lookups under the existing `/api/agent/*` authorization model. No Discord-specific logic lives here — the new endpoints are generic.
- **`agent-resources-discord-bot`** (new repo) runs a Node process using `discord.js`. It holds no business state and never touches Supabase. Every read and every ownership check goes through an agent token.

The bot has exactly one job: translate Discord interactions into agent-API calls and render results. If we ever want a second client (CLI, web extension, another bot), the same API serves it with no changes.

### Components added to `agent-resources`

- **`pending_bot_links` table.** Fields: `code` (PK, 8-char alphanumeric, formatted `XXXX-XXXX` when shown), `discord_user_id`, `created_at`, `expires_at`, `consumed_at`, `agent_token_id` (nullable, set when the web-side confirmation mints a token).
- **`POST /api/agent/bot-link/start`.** Unauthenticated. Body: `{ discord_user_id }`. Returns `{ code, expires_at }`. Rate-limited: max 3 pending codes per `discord_user_id` per 10 minutes.
- **`GET /link/bot` and `POST /link/bot/confirm`.** Authenticated web pages (existing Supabase session). User pastes the code and confirms "Authorize the Discord bot for my account." Server mints a new agent token named `Discord bot (<discord_user_id>)` via the existing `createAgentToken` path, sets `agent_token_id` on the pending row, and shows "You're linked. You can close this tab."
- **`POST /api/agent/bot-link/claim`.** Unauthenticated. Body: `{ code, discord_user_id }`. Returns the raw token exactly once while the pending row is confirmed and unconsumed. Status codes: `200` with `{ token, profile: { id, name }, agent_token_id }`; `202` if the pending row exists but the user has not confirmed yet; `404` if no such row; `410` if expired or consumed; `409` on `discord_user_id` mismatch.
- **`GET /api/agent/characters/search?q=<name>`.** New endpoint. Returns up to 10 characters matched by `ilike '%<q>%'` on `name`, applying the same visibility rules as `models/character.js` (public characters globally + the caller's own private characters when the token is present). Returns an empty array when there are no matches. Each result includes `id`, `name`, `class`, `level`, `is_public`, `is_deceased`, `owner_profile_id`, `owner_name`.
- **`GET /api/agent/characters/:id`.** New endpoint. Full character detail (stats, abilities, gear, personality traits) with the same visibility rules. Returns `404` both when the character does not exist and when the caller cannot see it — existence of private characters is not leaked.
- **Cleanup.** Pending rows older than 1 hour are deleted lazily at the top of `start` and `claim` handlers. No cron required for MVP.

### Components in the bot repo

- `discord.js` client with five slash commands registered on startup: `/link`, `/unlink`, `/whois`, `/class`, `/ability`.
- Local SQLite (`better-sqlite3`) with one table: `links(discord_user_id PRIMARY KEY, agent_token_encrypted, agent_token_id, linked_at)`. AES-256-GCM; key from `BOT_TOKEN_ENCRYPTION_KEY`. Losing or rotating the key means all users must re-link; there is no other data to lose.
- Thin HTTP client around `/api/agent/*`. Attaches `X-Agent-Token` per command when the invoker is linked. Uses a service-account agent token (from env) for class autocomplete so unlinked users still get suggestions.
- Class-list cache. Refreshed on startup and every 5 minutes using the service token. Populates autocomplete for `/class` and `/ability`. User-specific unlock state is still resolved per request using the invoker's own token.

## Commands and UX

All responses are **ephemeral** by default. Each command accepts an optional `share: true` to post publicly.

### `/link`

Starts the device-code flow.

1. Bot calls `POST /api/agent/bot-link/start` with the invoker's Discord user ID.
2. Bot replies (ephemeral): "Visit `<app>/link/bot` and enter code `A3F7-9K2P`. Code expires in 10 minutes."
3. Bot polls `POST /api/agent/bot-link/claim` every 3 seconds (exponential backoff up to 5s, total budget 10 min). `202` means keep polling; `200` ends the wait.
4. On `200`, bot encrypts the raw token, upserts into SQLite with `agent_token_id`, and edits the original reply to "Linked as **<profile name>**."
5. On timeout, reply "Code expired. Run `/link` again." If the user runs `/link` again mid-wait, the prior poller is cancelled.

### `/unlink`

Revokes and forgets.

1. Bot calls `DELETE /profile/agent-tokens/:id` using the stored `agent_token_id`, authenticated with the token itself.
2. Bot deletes the local SQLite row.
3. Replies "Unlinked."

### `/whois <name>`

Character lookup.

- `name` uses autocomplete that calls `GET /api/agent/characters/search?q=…` as the user types (debounced client-side, 10-result cap server-side). Autocomplete choices are formatted `"<name> — <class> L<level>"` with the character UUID as the value.
- When autocomplete provides a UUID, the command handler calls `GET /api/agent/characters/:id` and renders a single embed with the character sheet.
- When a user free-types a name and multiple matches exist, the handler shows an embed listing up to 10 matches (name, class/level, owner) and a note to pick from autocomplete next time.
- Unlinked users: the bot makes the call with no token; webapp returns public-only results. `/whois` still works for public characters.
- Empty autocomplete query: for linked users, return the caller's own characters ordered by `updated_at desc` (top 10) as a helpful default.

### `/class <name>`

Rich embed for a class.

- Autocomplete uses the bot's cached class list.
- Response embed: name, image (if present), teaser or description, ability list (name + one-line summary, bulleted), gear list (name + one-line summary, bulleted).
- If the agent API returns `access_level: 'teaser_only'`, the embed shows the teaser and a note "Unlock this class in the library to see abilities and gear."

### `/ability <class> <name>`

Single-ability lookup.

- Both args use autocomplete. The `name` autocomplete waits until a `class` is selected, then lists abilities of that class from the cached class detail (fetched on first autocomplete, cached briefly per-user).
- Response embed: ability name, owning class, full description.
- Teaser-gate applies the same way as `/class`.

## Data flow

### Link flow

```
Discord user                Bot                         Web app
     |                       |                             |
     |---- /link ----------->|                             |
     |                       |--- POST bot-link/start ---->|
     |                       |<--- { code, expires_at }----|
     |<- "visit URL, code X" |                             |
     |                       |                             |
     |  (user opens /link/bot in browser, pastes code, confirms)
     |                       |                             |
     |                       |  (web mints agent token,    |
     |                       |   sets agent_token_id on    |
     |                       |   pending row)              |
     |                       |                             |
     |                       |--- POST bot-link/claim ---->|
     |                       |<--- { token, profile, id }--|
     |                       |  (encrypt + store in SQLite)|
     |<- "Linked as Alice" --|                             |
```

### Lookup flow (`/whois` example)

1. User types `/whois ab`; Discord fires an autocomplete interaction.
2. Bot looks up the invoker's link in SQLite (if any), decrypts the token, calls `GET /api/agent/characters/search?q=ab` with `X-Agent-Token`.
3. Webapp returns up to 10 matches honoring visibility rules.
4. Bot maps them to autocomplete choices.
5. User picks a choice; Discord fires the command interaction with `value = <character_id>`.
6. Bot calls `GET /api/agent/characters/:id`, renders the embed, replies ephemerally.

### Token lifecycle

- The agent token created during linking appears in `/profile/agent-tokens` in the web UI named `Discord bot (<discord_user_id>)`.
- User can revoke it from the web UI at any time. On the next bot API call, the bot receives `401`, deletes its local row, and prompts the user to re-link.
- `/unlink` in Discord calls the existing revoke endpoint, so revocation from either side is symmetric.

## Error handling

### Web app

- `POST /api/agent/bot-link/start`: validate `discord_user_id` is a numeric snowflake string; reject `400` on malformed input. Rate-limit per `discord_user_id` (max 3 per 10 min); `429` when exceeded.
- `GET /link/bot` and `POST /link/bot/confirm`: CSRF-protected (matches existing forms), require authenticated Supabase session. Failure cases: invalid code, expired code, already-consumed code, and mismatched Discord ID ("this code was generated by a different Discord user; run `/link` again"). All render inline errors on the form.
- `POST /api/agent/bot-link/claim`: status codes `200` / `202` / `404` / `409` / `410` as specified above. Token is returned exactly once; subsequent `claim` calls for a consumed row return `410`.
- `GET /api/agent/characters/search` and `/:id`: reuse `models/character.js` visibility logic. Search capped at 10 rows. `/:id` returns `404` for both "does not exist" and "caller cannot see it."

### Bot

- A single HTTP helper maps status codes to user-facing strings: `200` → render; `401` → delete local row, prompt re-link; `403` → "You don't have access to that."; `404` → "Not found."; `429` → "Slow down — try again in a few seconds."; `5xx` or network error → "Couldn't reach agent-resources right now — try again in a minute." No status codes or stack traces are shown to users.
- Autocomplete handlers return an empty list on any error (Discord's 3-second deadline is too tight to surface errors). Upstream requests are aborted at ~2s.
- `/link` poller uses exponential backoff 2s → 5s, total budget 10 min; cancelled if the user runs `/link` again.
- Graceful shutdown on `SIGTERM`: let in-flight interactions finish (Discord's interaction token is valid for 15 min), close SQLite, exit.

### Edge cases

- **Token revoked on the web side.** Next bot call returns `401`; bot deletes local row and prompts re-link. Subsequent `/whois` runs as unlinked (public data only).
- **Double `/link`.** The second run supersedes the first: old pending code is ignored, old poller is cancelled.
- **Two users paste the same code.** Only the Discord user whose ID matches the pending row succeeds; the other sees the mismatch error.
- **Character renamed between autocomplete and fire.** The resolved UUID still hits the right row; the embed reflects the new name.
- **Empty `q` on autocomplete.** Linked users see their own characters sorted by `updated_at desc`. Unlinked users see an empty list (we don't want a random popular-characters leaderboard).

## Security considerations

- The bot never holds privileged credentials. Every user-scoped call uses that user's own agent token; the service token is scoped to a dedicated, non-admin account used only for class-list caching.
- Raw agent tokens are returned by `claim` once and then only stored encrypted in the bot's SQLite. They are never logged.
- `pending_bot_links` rows have a 10-minute TTL; lazy cleanup removes rows older than 1 hour. Codes are 8 random alphanumeric characters, giving ~36^8 ≈ 2.8×10^12 combinations, and are valid only for the specific Discord ID that initiated the `start` call, so brute-force claiming is not viable.
- Rate limits on `start` prevent a malicious Discord ID from spamming pending rows. The web-side confirmation page is CSRF-protected and authenticated.
- The `characters/:id` endpoint returns `404` uniformly for "does not exist" and "not visible," avoiding enumeration.

## Testing

### Web app

- Unit tests for the new `bot-link` model functions: code generation is unique; claim returns a token exactly once; claim rejects expired, consumed, and mismatched rows.
- Route tests for `/api/agent/bot-link/start` and `/claim`: each of the five status codes above.
- Route tests for `/api/agent/characters/search` and `/:id`: visibility matrix (unauthed sees only public; authed sees public + own private; authed does not see other users' private).
- Route tests for `/link/bot` / `/link/bot/confirm`: happy path; expired code; mismatched Discord ID.

### Bot

- API client (fetch mocked): status-code mapping, token attach behavior, `401` triggers local delete.
- SQLite layer: encrypt/decrypt round-trip, upsert, delete.
- Command handlers with a mocked interaction object: `/whois` linked vs unlinked, `/class` teaser-only rendering, `/ability` teaser gate, `/link` poll completion and timeout.
- Optional end-to-end smoke: run the bot against a local web app, run the link flow, run `/whois` against a seeded character.

### Out of scope for MVP testing

- Load testing.
- Real Discord sandbox server coverage beyond manual verification.
- Supabase-level tests for behavior that already has existing coverage.

## Follow-up specs (explicitly not in this MVP)

- **LFG integration.** Browse LFG posts from Discord, post / join via DMs or a channel-scoped surface, tie role pings (`@Players`, `@Conduits`) to the dedicated LFG channel.
- **Enclave Day events.** Currently managed via Google Form. Needs a data model in `agent-resources` first (events, signups, roster). Once that exists, the bot exposes listing, signup, and reminders.
- **Device-code UX polish.** Shortening the poll window, push-style completion via a webhook back to the bot, or OAuth-based Discord identity linking.
