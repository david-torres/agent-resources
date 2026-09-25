# MCP OAuth via Supabase OAuth 2.1 Server — Design

## Goal

Let ChatGPT (and other MCP clients such as Claude) link a user's AgentResources
account to the MCP endpoint at `https://agent-resources.vip/api/mcp` through
OAuth, because ChatGPT cannot send static bearer headers. Existing `ar_pat_`
bearer tokens keep working on `/api/mcp`, and `/api/agent` REST is unchanged.

## Decisions

- **Authorization server:** Supabase Auth's OAuth 2.1 Server (beta). We host
  only the consent page. A local spike (gotrue v2.195.0) confirmed ChatGPT's
  flow works end to end: public DCR client, PKCE S256, `resource`,
  `offline_access`, code exchange, rotating refresh. Issue
  supabase/auth#2820 did not reproduce.
- **Auth trigger:** whole server. Every `/api/mcp` request without a valid
  token gets HTTP 401 — including `initialize` and `tools/list`.
- **Token binding:** verify the Supabase JWT and require a `client_id` claim.
  No access-token hook, no client allow-list.

## Known limitations (accepted)

- Supabase ignores `resource`; OAuth access tokens carry
  `aud: "authenticated"`. `/api/mcp` cannot check audience, only that the
  token came from an OAuth grant (`client_id` present).
- An OAuth access token is also a full Supabase session for that user
  (PostgREST/RLS, `/auth/v1/user`). A leaked MCP token grants the user's
  normal site access for up to its lifetime (1h).
- No CIMD support in Supabase, so ChatGPT registers through DCR, which creates
  one client per connection.
- No RFC 9207 `iss` on the authorize redirect, so ChatGPT uses its
  callback-ID-specific redirect URI (handled automatically via DCR).
- Magic-link login drops the `r` return path, so a user who signs in that
  way must reopen the connector link. Password and Discord logins keep it.

## 1. Supabase configuration

- `supabase/config.toml`, section `[auth.oauth_server]`:
  `enabled = true`, `allow_dynamic_registration = true`,
  `authorization_url_path = "/oauth/consent"`.
- Hosted project (manual, dashboard → Authentication → OAuth Server): enable
  the OAuth server and dynamic OAuth apps, authorization path
  `/oauth/consent`; confirm Site URL is `https://agent-resources.vip`.
- The browser loads `@supabase/supabase-js@2` unpinned from jsDelivr
  (`views/partials/head.handlebars`), which already includes
  `auth.oauth.getAuthorizationDetails / approveAuthorization /
  denyAuthorization`. The consent page must fail visibly if `auth.oauth` is
  missing. The server-side package is not used for consent and needs no
  upgrade.

## 2. Resource server: `/api/mcp`

### Protected resource metadata (RFC 9728)

Serve JSON at both `/.well-known/oauth-protected-resource/api/mcp` and
`/.well-known/oauth-protected-resource`:

```json
{
  "resource": "<SITE_URL>/api/mcp",
  "authorization_servers": ["<SUPABASE_URL>/auth/v1"],
  "scopes_supported": ["openid", "email", "profile"],
  "bearer_methods_supported": ["header"],
  "resource_name": "AgentResources"
}
```

`SITE_URL` comes from `resolveBaseUrl(req)` (`util/site-url.js`). Mount before
`loadNavItems` / `openGraphDefaults` in `app.js`, as the sitemap is, so these
JSON routes skip page middleware.

### Auth gate

Middleware in front of the MCP POST handler:

- No credentials → `401`,
  `WWW-Authenticate: Bearer resource_metadata="<SITE_URL>/.well-known/oauth-protected-resource/api/mcp"`,
  JSON-RPC error body.
- Invalid/expired credentials → same, plus `error="invalid_token"`.
- Credential verification throws (e.g. JWKS unreachable) → handled by the
  central error handler (500), never a 401.
- On success the resolved auth is attached for the tool handlers. The
  per-tool `unauthenticated` branch in `routes/mcp.js` is removed.
- `GET`/`DELETE` stay 405.

### `resolveMcpAuth(req)`

Returns the same shape as `resolveAgentAuth`:
`{ ok: true, auth: { user, profile, agentToken, supabase } }` or
`{ ok: false, error, reason: 'missing' | 'invalid' }`.

- Credentials are read from `Authorization: Bearer …` or `X-Agent-Token`.
- A token starting with `ar_pat_` delegates to `resolveAgentAuth`.
- Any other bearer value is treated as a Supabase JWT and verified with
  `jose`:
  - `createRemoteJWKSet(<SUPABASE_URL>/auth/v1/.well-known/jwks.json)`
    (cached by jose), `jwtVerify` with `issuer: <SUPABASE_URL>/auth/v1`
    and asymmetric algorithms only (`ES256`, `RS256`).
  - The payload must contain a non-empty string `client_id`, otherwise the
    token is invalid. This rejects ordinary website session JWTs.
  - `sub` → profile lookup by `user_id`, selecting the same columns as the
    agent-token path (`id, user_id, name, role, timezone`). No profile →
    invalid.
  - `agentToken` is `{ type: 'oauth', client_id }`. `getMe` returns it as
    `token`.
- The JWKS/issuer source is injectable so unit tests can use a locally
  generated ES256 key.

`/api/agent` keeps using `resolveAgentAuth` (`ar_pat_` only).

### Dependencies

Add `jose` (to both `bun.lock` and `package-lock.json`).

## 3. Consent page: `/oauth/consent?authorization_id=…`

- Server route is gated by the existing `isAuthenticated`, so a signed-out
  load goes through `/auth/check?r=<this URL>` and the site's normal
  sign-in-and-return flow, exactly like any other protected page. The page
  uses plain buttons (no forms), and the final cross-origin navigation is
  `window.location.assign`, so `hx-boost` never intercepts it.
- Client logic (Alpine component `oauthConsent` in
  `public/js/alpine-components.js`, calling `App.oauth.*`):
  1. Missing `authorization_id` → error message.
  2. `getAuthorizationDetails(id)`:
     - Response with `redirect_url` (already consented) → `location = redirect_url`.
     - Otherwise render client name, requested scopes (plain-language labels
       for `openid`, `email`, `profile`, `offline_access`), and the signed-in
       account's email, with **Approve** and **Deny** buttons.
     - Error → message ("This authorization request has expired or is
       invalid").
  3. Approve/Deny → `approveAuthorization` / `denyAuthorization` →
     `location = redirect_url`. Buttons are disabled while in flight.
- Visual style matches `views/bot-link.handlebars`.

## 4. Testing

TDD throughout.

- **Unit:** the JWT verifier — valid OAuth token accepted; token without
  `client_id` rejected; expired, wrong issuer, bad signature, and HS256
  tokens rejected; unknown `sub` rejected.
- **HTTP (mocked verifier/models):**
  - `POST /api/mcp` without a token → 401 with the exact `WWW-Authenticate`;
    invalid token → 401 with `error="invalid_token"`.
  - Both metadata URLs return the document above.
  - An OAuth-authenticated `getMe` returns `token: {type:'oauth', client_id}`.
  - `ar_pat_` tokens still work for every tool.
  - `/api/agent` REST characterization tests stay green unchanged.
  - Existing MCP tests are updated for the removed per-tool
    `unauthenticated` path; all other expectations are unchanged.
- **Integration (local stack, `util/require-local-supabase`):** the spike
  flow — DCR, authorize, consent approve via supabase-js, code exchange —
  then an MCP `tools/call getMe` with the resulting access token succeeds,
  and the same user's password-grant JWT is rejected with 401.
- **E2E (Playwright):** signed-in player opens the consent URL for a
  pending authorization, sees the client name, approves, and the browser
  navigates to the redirect URI with `code` and `state`.

## 5. Rollout

1. Deploy.
2. Enable the OAuth server + dynamic apps on the hosted project.
3. Confirm the hosted discovery document now lists `registration_endpoint`,
   and repeat the flow check against the hosted project with a throwaway
   account.
4. Add the connector in ChatGPT developer mode with
   `https://agent-resources.vip/api/mcp`.

README's MCP section is updated to document OAuth, the consent page, and the
retained `ar_pat_` bearer option.
