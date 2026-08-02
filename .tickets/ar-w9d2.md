---
id: ar-w9d2
status: open
deps: []
links: []
created: 2026-08-02T02:35:10Z
type: bug
priority: 1
assignee: David Torres
tags: [seeding, local-dev, character-wizard, starter-unlocks]
---
# Character wizard is unreachable on a freshly-seeded local database

`models/profile.js:9-18` hardcodes **production** UUIDs for the starter content granted to every new profile:

```js
const STARTER_RULES_PDF_ID = 'a10948ac-5f78-481f-9e53-c582b59926cd'; // Enclave: Advent v1
const STARTER_CLASS_IDS = [
  'b6ce893b-8207-4f89-abfc-a02ae0e9b65d', // Gunslinger
  ... // Illusionist, Librarian, Thane, Thunderbird, Wanderer
];
```

`util/seed-classes.js` does not set ids, so Postgres generates fresh ones — a locally-seeded Gunslinger is `37335ace-…`, not `b6ce893b-…`. Nothing seeds `rules_pdfs` at all. The starter grant therefore fails with foreign-key violations on every new profile:

```
Failed to grant starter class unlocks: {
  code: "23503",
  details: 'Key (class_id)=(b6ce893b-...) is not present in table "classes".'
}
Failed to grant starter rules unlock: {
  code: "23503",
  details: 'Key (rules_pdf_id)=(a10948ac-...) is not present in table "rules_pdfs".'
}
```

Those errors are logged and swallowed, so the profile is created with **zero unlocked classes**.

## Downstream symptom

`routes/characters.js:191` builds the wizard's class pool via `filterClassDataForUser(user)`, which filters by unlock. With no unlocks the pool is empty, and `public/js/character-wizard.js:1675` random-picks from it without a guard:

```js
: DATA.classes[Math.floor(Math.random() * DATA.classes.length)].id);
```

`Math.random() * 0` is `0`, `DATA.classes[0]` is `undefined`, and the wizard dies with an unhelpful:

```
Uncaught TypeError: can't access property "id", DATA.classes[Math.floor(...)] is undefined
```

Net effect: **the character wizard has never worked on a locally-seeded database**, and the failure presents as a cryptic TypeError rather than anything pointing at seeding. `scripts/seed-local.mjs` does not address starter unlocks either, so `bun run setup` / `seed:local` does not produce a working wizard.

Not caused by the Alpine adoption branch (ar-7v3k) — `character-wizard.js` and `character-wizard.handlebars` are byte-identical across it.

## Acceptance Criteria

A profile created against a freshly-seeded local database receives its starter unlocks without foreign-key errors, and the character wizard loads with a usable class pool. The seed and the starter-ID constants cannot silently drift apart again — that invariant is pinned by a test. Separately, an empty class pool produces a clear, actionable message rather than a TypeError, so the next seeding gap is self-diagnosing.
