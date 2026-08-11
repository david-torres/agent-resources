# Remove util/supabase Model Barrel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `util/supabase.js` global model barrel with explicit per-domain `models/*` imports in every consumer, then delete the barrel.

**Architecture:** `util/supabase.js` spreads 147 exports from 12 models into one flat namespace. Each of the 11 production consumers is rewritten to `require` only the specific `models/<domain>` modules it uses; the 8 barrel-mocking test files are migrated to mock those specific modules. The barrel stays intact as the auth-function provider until the final task, so the full suite is green after every commit. Then `util/auth.js` is switched off it and the file is deleted.

**Tech Stack:** Node/CommonJS, Express, Bun test runner (`bun:test` + `scripts/run-tests.mjs`), Supabase model layer.

## Global Constraints

- **This is a refactor of already-tested code — no TDD red/green cycle.** Each task's "test" is that the existing suite stays green. Never write new behavioral tests; only migrate mock targets.
- **The barrel must remain functional until Task 11.** Do not delete or empty `util/supabase.js` before then; earlier tasks rely on it still exporting `getUserFromToken`/`getProfile` for the real `isAuthenticated` middleware.
- **Name→model mapping is authoritative and collision-free** (all 147 names are unique across models). Use exactly the model shown for each name; do not guess.
- **Green gate (run before every commit):** `bun run test:unit && bun run test:http`. Both must exit 0. (Integration tests are CI-gated — they need local Supabase — and are out of scope for per-task verification.)
- **Preserve existing unrelated mocks** (`../models/_base`, `../util/system-message`, `../util/nav-loader`, `../models/lfg`, etc.) and the `afterAll` real-module restore pattern already present in each test.
- **No dead code:** delete the dead `const supabase = require('../util/supabase')` line in `routes/missions.js` (Task 9) and the whole barrel file (Task 11). No shim, no re-export.

## File Structure

Production files modified (barrel import → explicit `models/*`):

| File | Imports after change |
| --- | --- |
| `util/redeem-code.js` | `models/class`, `models/rules` |
| `util/nav-loader.js` | `models/nav` |
| `routes/pages.js` | `models/pages` |
| `routes/profile.js` | `models/profile`, `models/character`, `models/class` |
| `routes/library.js` | `models/rules`, `models/pdf`, `models/profile` |
| `routes/nav.js` | `models/nav`, `models/pages` |
| `routes/lfg.js` | `models/lfg`, `models/character` |
| `routes/classes.js` | `models/class`, `models/rules`, `models/pdf`, `models/profile` |
| `routes/missions.js` | `models/mission`, `models/character`, `models/class`, `models/profile`, `models/offscreen-mission` |
| `routes/characters.js` | `models/character`, `models/mission`, `models/class`, `models/lfg`, `models/profile` |
| `util/auth.js` | `models/auth`, `models/profile` |

Test files migrated: `util/redeem-code.test.js`, `routes/classes-stat-spread.test.js`, `routes/missions.test.js`, `routes/characters.test.js`, `routes/character-wizard.test.js`, `routes/character-level-up.test.js`, `routes/badges.test.js`, `util/auth.test.js`.

Deleted: `util/supabase.js`.

---

### Task 1: `util/redeem-code.js` + its test

**Files:**
- Modify: `util/redeem-code.js:1`
- Test: `util/redeem-code.test.js:3,10,25`

**Interfaces:**
- Consumes: `redeemUnlockCode` from `models/class`, `redeemRulesPdfUnlockCode` from `models/rules` (existing signatures unchanged).
- Produces: nothing new; behavior identical.

- [ ] **Step 1: Replace the barrel import**

In `util/redeem-code.js`, replace line 1:

```js
const { redeemUnlockCode, redeemRulesPdfUnlockCode } = require('./supabase');
```

with:

```js
const { redeemUnlockCode } = require('../models/class');
const { redeemRulesPdfUnlockCode } = require('../models/rules');
```

- [ ] **Step 2: Migrate the test's mock target**

In `util/redeem-code.test.js`, the test currently captures `const realSupabase = require('./supabase');` and does `mock.module('./supabase', () => ({ redeemUnlockCode, redeemRulesPdfUnlockCode }))` plus an `afterAll` restore. Replace those three touch points so it mocks the two models instead. Change the capture (line ~3) to:

```js
const realClass = require('../models/class');
const realRules = require('../models/rules');
```

Change the mock setup (line ~10) to:

```js
mock.module('../models/class', () => ({ redeemUnlockCode: /* keep existing stub body */ }));
mock.module('../models/rules', () => ({ redeemRulesPdfUnlockCode: /* keep existing stub body */ }));
```

(Keep whatever stub bodies the test already used for `redeemUnlockCode`/`redeemRulesPdfUnlockCode`.) Change the `afterAll` restore (line ~25) to:

```js
mock.module('../models/class', () => realClass);
mock.module('../models/rules', () => realRules);
```

- [ ] **Step 3: Run the unit suite to verify green**

Run: `bun run test:unit`
Expected: PASS (all unit files, including `util/redeem-code.test.js`). If it fails on a missing export, confirm the stub function names match the file's usage (`redeemUnlockCode`, `redeemRulesPdfUnlockCode`).

- [ ] **Step 4: Green gate + commit**

```bash
bun run test:unit && bun run test:http
git add util/redeem-code.js util/redeem-code.test.js
git commit -m "refactor: import redeem-code deps from models, not barrel"
```

---

### Task 2: `util/nav-loader.js` (no dedicated test)

**Files:**
- Modify: `util/nav-loader.js:1`

**Interfaces:**
- Consumes: `getNavItems` from `models/nav`.

- [ ] **Step 1: Replace the barrel import**

In `util/nav-loader.js`, replace line 1:

```js
const { getNavItems } = require('./supabase');
```

with:

```js
const { getNavItems } = require('../models/nav');
```

- [ ] **Step 2: Green gate to verify no regression**

`nav-loader` is exercised indirectly (the `loadNavItems`/`populateNavItems` middleware). Run: `bun run test:unit && bun run test:http`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add util/nav-loader.js
git commit -m "refactor: import nav-loader dep from models/nav, not barrel"
```

---

### Task 3: `routes/pages.js` (no dedicated test)

**Files:**
- Modify: `routes/pages.js:6-14`

- [ ] **Step 1: Replace the barrel destructure**

Replace the block (currently `const { getPages, … } = require('../util/supabase');`) with:

```js
const {
    getPages,
    getPageBySlug,
    getPage,
    createPage,
    updatePage,
    deletePage,
    canViewPage
} = require('../models/pages');
```

- [ ] **Step 2: Green gate**

Run: `bun run test:unit && bun run test:http`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add routes/pages.js
git commit -m "refactor: import pages route deps from models/pages, not barrel"
```

---

### Task 4: `routes/profile.js` (no dedicated test)

**Files:**
- Modify: `routes/profile.js:5`

- [ ] **Step 1: Replace the barrel destructure**

Replace line 5 (the single-line `const { updateUser, … } = require('../util/supabase');`) with:

```js
const { updateUser, getProfileByName, setDiscordId, searchProfiles, getProfileConduitCredits } = require('../models/profile');
const { getPublicCharactersByCreator } = require('../models/character');
const { getClasses } = require('../models/class');
```

- [ ] **Step 2: Green gate**

Run: `bun run test:unit && bun run test:http`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add routes/profile.js
git commit -m "refactor: import profile route deps from models, not barrel"
```

---

### Task 5: `routes/library.js` (no dedicated test)

**Files:**
- Modify: `routes/library.js:9-27`

- [ ] **Step 1: Replace the barrel destructure**

Replace the block with:

```js
const {
    getRulesPdfs,
    getRulesPdf,
    createRulesPdf,
    updateRulesPdf,
    listRulesPdfUnlocks,
    listRulesPdfUnlocksForUser,
    upsertRulesPdfUnlock,
    deleteRulesPdfUnlock,
    createRulesPdfUnlockCodes,
    listRulesPdfUnlockCodes,
    canViewRulesPdf
} = require('../models/rules');
const { storeRulesPdf, deletePdfObject, getSignedPdfUrl, RULES_PDF_BUCKET } = require('../models/pdf');
const { getProfileByNameAdmin, getProfileByIdAdmin } = require('../models/profile');
```

- [ ] **Step 2: Green gate**

Run: `bun run test:unit && bun run test:http`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add routes/library.js
git commit -m "refactor: import library route deps from models, not barrel"
```

---

### Task 6: `routes/nav.js` (no dedicated test)

**Files:**
- Modify: `routes/nav.js:6-15`

- [ ] **Step 1: Replace both barrel destructures**

Replace the two lines/blocks (`const { getAllNavItems, … } = require('../util/supabase');` and `const { getPages } = require('../util/supabase');`) with:

```js
const {
    getAllNavItems,
    getNavItem,
    createNavItem,
    updateNavItem,
    deleteNavItem,
    reorderNavItems,
    getDropdownParents
} = require('../models/nav');
const { getPages } = require('../models/pages');
```

- [ ] **Step 2: Green gate**

Run: `bun run test:unit && bun run test:http`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add routes/nav.js
git commit -m "refactor: import nav route deps from models, not barrel"
```

---

### Task 7: `routes/lfg.js` (no dedicated test)

**Files:**
- Modify: `routes/lfg.js:5-21`

- [ ] **Step 1: Replace the barrel destructure**

Replace the block with (note the cross-domain `getOwnCharacters` moves to `models/character`):

```js
const {
    getLfgPosts,
    getLfgPostsByCreator,
    getLfgPostsByOthers,
    getLfgJoinedPosts,
    getLfgPost,
    createLfgPost,
    updateLfgPost,
    deleteLfgPost,
    joinLfgPost,
    getLfgJoinRequests,
    getLfgJoinRequestForUserAndPost,
    updateJoinRequest,
    deleteJoinRequest,
    syncConduitHostId
} = require('../models/lfg');
const { getOwnCharacters } = require('../models/character');
```

- [ ] **Step 2: Green gate**

Run: `bun run test:unit && bun run test:http`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add routes/lfg.js
git commit -m "refactor: import lfg route deps from models, not barrel"
```

---

### Task 8: `routes/classes.js` + `classes-stat-spread.test.js` (domain migration)

**Files:**
- Modify: `routes/classes.js:6-28`
- Test: `routes/classes-stat-spread.test.js` (the `mock.module('../util/supabase', …)` block, its `realSupabase` capture, and the `afterAll` restore)

**Interfaces:**
- Consumes: class functions from `models/class`, `getRulesPdf` from `models/rules`, pdf functions from `models/pdf`, `getProfileById` from `models/profile`.
- Note: `getUserFromToken`/`getProfile` stay mocked on the barrel in this test — `util/auth` still reads them from the barrel until Task 11.

- [ ] **Step 1: Replace the route's barrel destructure**

In `routes/classes.js`, replace the block (`const { getClasses, … CLASS_PDF_BUCKET } = require('../util/supabase');`) with:

```js
const {
    getClasses,
    getClass,
    createClass,
    updateClass,
    duplicateClass,
    getUnlockedClasses,
    unlockClass,
    isClassUnlocked,
    getVersionHistory,
    createUnlockCodes,
    listUnlockCodes,
    redeemUnlockCode,
    deleteClass,
    saveClassPdfMetadata,
    canViewClassPdf
} = require('../models/class');
const { getRulesPdf } = require('../models/rules');
const { storeClassPdf, getSignedPdfUrl, deletePdfObject, CLASS_PDF_BUCKET } = require('../models/pdf');
const { getProfileById } = require('../models/profile');
```

- [ ] **Step 2: Move the domain stubs in the test to the new model mocks**

In `routes/classes-stat-spread.test.js`, the current `mock.module('../util/supabase', () => ({ … }))` block mixes auth stubs (`getUserFromToken`, `getProfile`) with class/rules/pdf/profile domain stubs. Split it:

- **Keep** on the barrel mock only the auth pair:
  ```js
  mock.module('../util/supabase', () => ({
    getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
    getProfile: async () => ({ id: 'p1', user_id: 'u1', role: 'admin' }),
  }));
  ```
- **Move** the domain stubs into model-specific mocks. The route only reaches `createClass` on the tested path; the rest exist so destructuring doesn't yield surprises. Add:
  ```js
  mock.module('../models/class', () => ({
    createClass: async (payload) => { capturedCreate = payload; return { data: { id: 'new-class-id', name: payload.name }, error: null }; },
    // include any other class-domain stub the run reports as needed (see Step 3)
  }));
  ```
  Add `mock.module('../models/rules', …)`, `mock.module('../models/pdf', …)`, `mock.module('../models/profile', …)` **only if Step 3 shows they are needed** — do not pre-stub names the tested path never calls.
- Update captures/restores: keep `const realSupabase = require('../util/supabase');` and its `afterAll` restore (barrel still used). Add `const realClass = require('../models/class');` (plus rules/pdf/profile if mocked) and matching `afterAll` `mock.module('../models/class', () => realClass);` restores, mirroring the existing pattern.

- [ ] **Step 3: Run the test; add only the stubs the failures demand**

Run: `bun run test:http`
Expected: `classes-stat-spread.test.js` PASS. If it fails with an undefined-is-not-a-function on a specific model call, add that one function to the corresponding model mock and re-run. Stop as soon as it is green — do not add unused stubs.

- [ ] **Step 4: Green gate + commit**

```bash
bun run test:unit && bun run test:http
git add routes/classes.js routes/classes-stat-spread.test.js
git commit -m "refactor: import classes route deps from models; scope its test mocks"
```

---

### Task 9: `routes/missions.js` (+ delete dead line) + `missions.test.js`

**Files:**
- Modify: `routes/missions.js:5-36`
- Test: `routes/missions.test.js` (barrel mock block, `realSupabase` capture, `afterAll` restore)

**Interfaces:**
- Consumes: mission functions from `models/mission`, `getCharacter`/`getCharacterAllMissions`/`searchPublicCharacters` from `models/character`, `getClasses` from `models/class`, `searchProfiles` from `models/profile`, `listOffscreenMissions` from `models/offscreen-mission`.
- `getUserFromToken`/`getProfile` stay on the barrel mock until Task 11.

- [ ] **Step 1: Replace both barrel requires and delete the dead binding**

In `routes/missions.js`, replace the first destructure block (lines 5–31, `const { getMissions, … searchProfiles } = require('../util/supabase');`) and the second line (line 32, `const { getCharacter, … listOffscreenMissions } = require('../util/supabase');`) with:

```js
const {
  getMissions,
  getMission,
  createMission,
  updateMission,
  deleteMission,
  addCharacterToMission,
  removeCharacterFromMission,
  getMissionCharacters,
  setUnregisteredCharacterNames,
  searchPublicMissions,
  getRandomPublicMissions,
  getMissionEditors,
  addMissionEditor,
  removeMissionEditor,
  canEditMission,
  isCreator,
  getEditableMissions,
  searchSimilarMissions,
  mergeMissions,
  previewMergeMissions,
  getOwnMissions
} = require('../models/mission');
const { getCharacter, getCharacterAllMissions, searchPublicCharacters } = require('../models/character');
const { getClasses } = require('../models/class');
const { searchProfiles } = require('../models/profile');
const { listOffscreenMissions } = require('../models/offscreen-mission');
```

Then **delete** the dead line 36:

```js
const supabase = require('../util/supabase');
```

(Every runtime use in this file is `res.locals.supabase`, the request-scoped client — never this module binding. Confirm with `grep -n "\bsupabase\b" routes/missions.js` after editing: the only matches should be `res.locals.supabase`.)

- [ ] **Step 2: Migrate the test's domain mocks**

In `routes/missions.test.js`, split the `mock.module('../util/supabase', …)` block: keep only `getUserFromToken`/`getProfile` on the barrel mock, and move mission/character/class/profile/offscreen-mission domain stubs into `mock.module('../models/mission', …)`, `mock.module('../models/character', …)`, etc. Add matching `realX` captures and `afterAll` restores mirroring the existing `realSupabase` pattern. Add only the domain stubs the run needs (Step 3).

- [ ] **Step 3: Run the test; add only stubs the failures demand**

Run: `bun run test:http`
Expected: `missions.test.js` PASS. Add missing per-model stubs one at a time until green; add no unused stubs.

- [ ] **Step 4: Green gate + commit**

```bash
bun run test:unit && bun run test:http
git add routes/missions.js routes/missions.test.js
git commit -m "refactor: import missions route deps from models; drop dead barrel binding; scope its test mocks"
```

---

### Task 10: `routes/characters.js` + its three tests

**Files:**
- Modify: `routes/characters.js:5`
- Test: `routes/characters.test.js`, `routes/character-wizard.test.js`, `routes/character-level-up.test.js`

**Interfaces:**
- Consumes: character functions from `models/character`, `getMission`/`createMission`/`addCharacterToMission` from `models/mission`, `getClasses`/`getClass` from `models/class`, `getLfgPost` from `models/lfg`, `getProfileById` from `models/profile`.
- `getUserFromToken`/`getProfile` stay on the barrel mock in all three tests until Task 11.

- [ ] **Step 1: Replace the route's barrel destructure**

In `routes/characters.js`, replace line 5 with:

```js
const {
  getOwnCharacters,
  getCharacter,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  markCharacterDeceased,
  getCharacterRecentMissions,
  searchPublicCharacters,
  getRandomPublicCharacters,
  getCharacterRealMissionsForDerivation
} = require('../models/character');
const { getMission, createMission, addCharacterToMission } = require('../models/mission');
const { getClasses, getClass } = require('../models/class');
const { getLfgPost } = require('../models/lfg');
const { getProfileById } = require('../models/profile');
```

- [ ] **Step 2: Migrate domain mocks in all three tests**

For each of `characters.test.js`, `character-wizard.test.js`, `character-level-up.test.js`: split the `mock.module('../util/supabase', …)` block — keep `getUserFromToken`/`getProfile` on the barrel mock, move character/mission/class/lfg/profile domain stubs into the corresponding `mock.module('../models/<domain>', …)` blocks. Preserve the existing `../models/_base`, `../models/offscreen-mission`, and `../models/lfg` mocks already in these files (do not duplicate `../models/lfg` — merge `getLfgPost` into the existing one if present). Add `realX` captures + `afterAll` restores mirroring the `realSupabase` pattern.

- [ ] **Step 3: Run the tests; add only stubs the failures demand**

Run: `bun run test:http`
Expected: all three character tests PASS. Add missing per-model stubs one at a time until green.

- [ ] **Step 4: Green gate + commit**

```bash
bun run test:unit && bun run test:http
git add routes/characters.js routes/characters.test.js routes/character-wizard.test.js routes/character-level-up.test.js
git commit -m "refactor: import characters route deps from models; scope its test mocks"
```

---

### Task 11: Switch `util/auth.js` off the barrel, migrate remaining auth mocks, delete the barrel

**Files:**
- Modify: `util/auth.js:2`
- Test: `util/auth.test.js`, `routes/badges.test.js`, `routes/classes-stat-spread.test.js`, `routes/missions.test.js`, `routes/characters.test.js`, `routes/character-wizard.test.js`, `routes/character-level-up.test.js`
- Delete: `util/supabase.js`

**Interfaces:**
- Consumes: `getUserFromToken` from `models/auth`, `getProfile` from `models/profile`.
- After this task, nothing imports `util/supabase`.

- [ ] **Step 1: Point `util/auth.js` at the source models**

In `util/auth.js`, replace line 2:

```js
const { getUserFromToken, getProfile } = require('./supabase');
```

with:

```js
const { getUserFromToken } = require('../models/auth');
const { getProfile } = require('../models/profile');
```

- [ ] **Step 2: Migrate the auth mock in every remaining test**

The 7 test files above mock the barrel (`'../util/supabase'`, or `'./supabase'` in `util/auth.test.js`) to supply `getUserFromToken`/`getProfile` for the real middleware. In each:

- Remove the now-obsolete barrel mock and its `realSupabase` capture + `afterAll` restore (the barrel no longer exists after Step 4).
- Add the auth stubs to the source models instead:
  ```js
  mock.module('../models/auth', () => ({
    getUserFromToken: async (token) => (token === 'valid-jwt' ? { id: 'u1' } : false),
  }));
  mock.module('../models/profile', () => ({
    getProfile: async () => ({ /* keep the file's existing profile stub body */ }),
    // if this file already mocks '../models/profile' (e.g. badges.test.js), MERGE getProfile into that block instead of adding a second mock.module for the same path
  }));
  ```
  (In `util/auth.test.js` the relative path is `'../models/auth'`/`'../models/profile'` from `util/`.)
- Add `const realAuth = require('../models/auth');` (and reuse/keep the profile capture) with matching `afterAll` restores.

- [ ] **Step 3: Delete the barrel file**

```bash
git rm util/supabase.js
```

- [ ] **Step 4: Run the full suite; fix any remaining auth-mock gaps**

Run: `bun run test:unit && bun run test:http`
Expected: PASS. A failure here is almost certainly a test still referencing `util/supabase` or a `getUserFromToken`/`getProfile` stub not yet moved to `models/auth`/`models/profile` — fix and re-run.

- [ ] **Step 5: Verification gate — zero barrel references remain**

Run:
```bash
grep -rn --include=*.js "require(['\"][^'\"]*\/supabase['\"])" . | grep -v node_modules | grep -v models/_base
test -e util/supabase.js && echo "STILL EXISTS" || echo "deleted"
```
Expected: the `grep` prints **nothing** (zero matches), and the `test` prints `deleted`. (`models/_base` is excluded because it is the request-client module, not the barrel; its require path is `../models/_base`, which the pattern does not match anyway.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: switch auth off supabase barrel and delete it (ar-5kph)"
```

---

## Post-plan: close the ticket

After Task 11 is committed and green, mark the ticket done:

```bash
tk add-note ar-5kph "Barrel removed: all 11 consumers import explicit models/* modules; util/supabase.js deleted; suite green; grep gate clean."
tk close ar-5kph
```
