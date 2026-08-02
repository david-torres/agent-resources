---
id: ar-c5nx
status: open
deps: [ar-w9d2, ar-7v3k]
links: []
created: 2026-08-02T02:35:10Z
type: bug
priority: 3
assignee: David Torres
tags: [character-wizard, error-handling, local-dev]
---
# Character wizard throws a cryptic TypeError when its class pool is empty

`public/js/character-wizard.js:1675` picks an initial class with a three-step fallback — saved state, then the preselected class, then a random pick:

```js
: DATA.classes[Math.floor(Math.random() * DATA.classes.length)].id);
```

With an empty `DATA.classes`, `Math.random() * 0` is `0`, `DATA.classes[0]` is `undefined`, and the wizard dies on:

```
Uncaught TypeError: can't access property "id", DATA.classes[Math.floor(...)] is undefined
```

The class pool is built by `filterClassDataForUser(user)` (`routes/characters.js:191`), which filters by unlock — so any user with zero unlocked classes gets a blank page and an error that says nothing about the actual cause.

ar-w9d2 fixed the reason the pool was empty locally (starter-unlock ids could never match seeded class ids). This ticket is the defence-in-depth half: the *next* time the pool is empty for any reason, the failure should name itself instead of surfacing as an undefined property access.

## Why this is not fixed already

Deferred deliberately. The fix is client-side JS, and at the time ar-w9d2 was written `complete-character-service` had no way to test client JS — `jsdom` and `test/helpers/alpine-dom.js` were added by the Alpine adoption branch (ar-7v3k) and had not merged. The route path is no easier: `routes/characters.test.js` is in the `httpFiles` set and needs a live Supabase, so it is not unit-runnable.

Writing the guard untested would have broken the TDD discipline; duplicating the harness would have conflicted with the ar-7v3k PR. Hence the `deps`.

## Do this after ar-7v3k merges

The harness arrives with it, and the guard can then be written test-first like anything else.

## Acceptance Criteria

An empty class pool produces a clear, actionable message naming the cause rather than a TypeError, and the wizard does not attempt to select a class it does not have. The behavior is covered by a test that fails without the guard. Consider whether the server should refuse to render the wizard at all in that state — a redirect with a message may serve the user better than an empty wizard shell.
