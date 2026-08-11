---
id: ar-h6rt
status: open
deps: []
links: []
created: 2026-08-02T02:35:10Z
type: bug
priority: 1
assignee: David Torres
tags: [auth, htmx, navigation, hx-boost]
---
# Auth redirect leaves the URL stale, trapping the user on the last protected page

Reproduced on an admin account: navigate to `/nav/manage`, then click anything. Every click runs an auth check and lands back on `/nav/manage`. The user cannot leave without editing the address bar.

Pre-existing — not introduced by ar-7v3k (Alpine adoption) or the seed fixes. `public/js/app.js`'s auth logic is byte-identical across all three branches; it was last touched by `15ab2f6` (security audit).

## Mechanism

`redirectTo()` (`public/js/app.js:955-965`) does not navigate. It performs an htmx body swap:

```js
function redirectTo(url) {
  const headers = { 'redirect-to': url };
  if (token && refresh) { headers['Authorization'] = …; headers['Refresh-Token'] = …; }
  htmx.ajax('GET', url, { target: 'body', swap: 'outerHTML', headers });
}
```

There is no `hx-push-url` and no `history.pushState`/`replaceState` anywhere near it — the only `history` call in the file is the unrelated anchor-copy helper at line 881. **So `window.location` never changes.** The body shows one page while the address bar shows another.

That matters because of the surrounding design. Auth tokens live in `localStorage` and are attached only to htmx requests via `htmx:configRequest`; a plain browser navigation carries no `Authorization` header. So `isAuthenticated` (`util/auth.js:33-46`) bounces every direct load of a protected route:

```
GET /nav/manage           (no Authorization header)
  → 302 /auth/check?r=%2Fnav%2Fmanage
      → renders auth-check, calls App.checkSessionNow()
          → INITIAL_SESSION fires with a session
              → getRedirectUrl() reads ?r= → redirectTo('/nav/manage')
                  → htmx swaps the body to /nav/manage
```

The page now *shows* `/nav/manage`, but `window.location` is still `/auth/check?r=%2Fnav%2Fmanage`.

`getRedirectUrl()` (`app.js:967-978`) reads `?r=` from `window.location`. Because that URL is frozen, **every later auth-state event re-reads the same stale `?r=` and swaps the body back to the same target** (`app.js:1000-1002` for `INITIAL_SESSION`, `1029-1031` for `SIGNED_IN`). Supabase fires these on token refresh, tab focus, and client re-init, so the bounce recurs indefinitely.

A second, related defect in the same function compounds it: on a non-auth page with no `?r=`, `INITIAL_SESSION` schedules `redirectTo(current)` on a **100 ms timer** (`app.js:1005-1010`), capturing the URL at event time. Under `hx-boost` the user can navigate within that window, and the timer then yanks them back to the captured page.

## Why `/nav/manage` in particular

Nothing about that route is special — it is simply a protected page reached from the Admin dropdown, so it is a natural place to land and then try to leave. Any `isAuthenticated` route reached by direct load can trap the same way.

## Fix direction

The body swap needs to be accompanied by a history update so the address bar matches what is rendered — either `history.replaceState` after the swap, or htmx's own push-url mechanism. Once the URL tracks the content, the stale `?r=` disappears and the loop cannot re-arm.

Take care: this is the code path `15ab2f6` hardened against open redirects. `getRedirectUrl()` deliberately rejects protocol-relative, absolute and backslash-prefixed values. Any change must preserve that, and must not start reflecting an attacker-supplied `?r=` into `history` — writing an unvalidated value into the address bar is strictly worse than swapping a body, because it persists and can be copied or reloaded.

**The client and server validators do not actually agree**, despite the comment at `app.js:970` claiming the client "mirrors the server-side isSameOriginPath check":

| input | server `isSameOriginPath` (`util/auth.js:9-14`) | client `getRedirectUrl` (`app.js:973`) |
|---|---|---|
| `//evil.com` | rejected | rejected |
| `/\evil.com` | **accepted** | rejected |

The client is stricter. `/\` is historically normalised like `//` by some browsers, which is why the client rejects it; the server's check only tests `startsWith('//')`. Any guard added for the history write must use the **stricter** rule. Whether the server check should be tightened to match is worth deciding separately — it feeds `redirect-to` header handling at `util/auth.js:36` and `:74`.

The 100 ms timer should also be reconsidered: capturing a URL and acting on it later is unsound under boosted navigation regardless of the history fix.

## Acceptance Criteria

After an auth-driven redirect the address bar matches the rendered page, so a reload or a copied link goes where the user actually is. Navigating away from a protected page succeeds and does not bounce back on a later auth event. The open-redirect protections on `?r=` remain intact, with a test covering the rejected forms. A boosted navigation during the post-auth window is not undone by a stale timer.
