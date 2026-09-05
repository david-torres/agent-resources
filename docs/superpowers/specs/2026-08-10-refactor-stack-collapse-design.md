# Refactor Stack Collapse — Design

**Date:** 2026-08-10
**Branch:** `refactor-base` (new), cut from `origin/main`
**Status:** Approved, awaiting implementation plan

## Problem

The refactor has grown into a 14-PR stack: 184 commits and 273 files between
`origin/main` (`2b590d2`) and `origin/virtual-party-tool` (`a82b7f1`). Every
rebase at the bottom ripples through thirteen branches above it, and no
reviewer can hold the shape of the change in their head.

The work is not ready to merge to `main`, so the stack cannot simply be landed
to relieve the pressure. It needs a smaller, stable base to continue from.

Two defects in the current stack state make this urgent:

**The stack has forked into two lineages.** On 2026-08-06 the whole stack was
rebased onto the new `jm-improve-ramp-in` tip and force-pushed:

| Ref | Tip | Base | Region commits |
|---|---|---|---|
| `origin/virtual-party-tool` | `a82b7f1` | `b02d023` (jm tip) | yes |
| `origin/virtual-party-tool-current` | `d714cc5` | `4e714f4` (pre-region) | no |

`git range-diff` confirms the two are patch-identical commit-for-commit except
one README context fixup in the `seed:local` commit. The only real difference
is that `-current` lacks the Supabase region commits `5690fc0` and `b02d023`.
PR #156 and the local working checkout both sit on `-current`, so both are
missing region support.

**PR #155 is mislabeled.** Titled "Add an env variable for setting the supabase
region", its single commit `d8554f0` contains no region code. It reuses the
commit message of `467ac86` verbatim, and its only diff removes the
`rules_pdfs` seeding step from `scripts/seed-local.mjs` — reverting part of
`694fc69` (ar-p8kq) while `seed:rules` remains wired in `package.json`. The
region support it describes already existed in its own base.

## Goal

Replace the 184-commit stack with three logical commits on a new
`refactor-base` branch whose final tree is bit-identical to `a82b7f1`, retarget
the one in-flight PR onto it, and close the rest.

## Non-goals

- **No merge to `main`.** The refactor is not ready; `refactor-base` is a
  working base, not a delivery.
- **No `refactor-base` → `main` PR yet.** A long-lived empty PR only collects
  stale review noise. Open it when the work is ready.
- **No deletion of the old branches.** They stay on origin as the recovery
  path until this work reaches `main`.
- **No content changes.** Not a single line of code differs from `a82b7f1`.
  Defects found along the way get reported, not fixed here.

## Commit structure

Three commits on `refactor-base`, cut from `origin/main` (`2b590d2`). Each
reuses the exact tree object of the PR tip it represents.

### Commit 1 — tree `49772f8`, collapses 60 commits

PRs #128, #129, #130, #131, #132, #133, #141, #142. Boundary: `16ace3f`.

```
refactor: move all data access behind a service and repository layer

Harden contributor setup and the test tiers, and make the Supabase
pooler region configurable via SUPABASE_DB_REGION so setup works
outside us-east-1.

Introduce service seams for character, LFG, mission, and class writes,
then remove the util/supabase model barrel so routes import from
models directly (ar-5kph). Consolidate all service-role access behind
repositories with explicit authorization policies, adding an actor
context, AuthorizationError, and 403 mapping (ar-ezes). Complete the
character mutation boundary, moving payload validation and form-array
reshaping into the input layer and making level-up writes atomic via
a transactional RPC (ar-m8ai).

Collapses PRs #128, #129, #130, #131, #132, #133, #141, #142
Pre-collapse tip: 16ace3f
```

### Commit 2 — tree `696b972`, collapses 96 commits

PRs #143, #146, #147, #148. Boundary: `553066f`.

```
refactor: adopt Alpine.js for view state and add an e2e test tier

Convert client-side view state to Alpine.js — dropdowns, modals, the
stats editor, list filtering and sorting, slug autogeneration, and the
perk counter — deleting the ad-hoc handlers they replace (ar-7v3k).

Fix auth-driven navigation: sync the address bar on redirect, stop the
deferred refresh undoing boosted navigation, and dispatch
INITIAL_SESSION once per page load (ar-h6rt). Correct local-dev
seeding so starter unlocks, class gear, and the rules PDF match what
the seed assigns (ar-w9d2, ar-t2mv, ar-p8kq).

Add a Playwright browser test tier with a prefix-scoped fixture layer,
and fix the defects it found: frozen Alpine classes, Pages CMS queries
running as anon, mutable character class, and broken export downloads.

Collapses PRs #143, #146, #147, #148
Pre-collapse tip: 553066f
```

### Commit 3 — tree `fac4391`, collapses 28 commits

PRs #150, #151. Boundary: `a82b7f1`.

```
feat: add the stat block selector and the virtual party tool

Replace the numeric stat inputs with a star-rating block selector
across the character form, the class spread, the level-up modal, and
the inline editor, with jump-to-N and hover preview in the wizard.

Add a top-level virtual party tool: a pure party summary core, a
getPartyCharacters read resolved through RLS, the /party route and its
membership parsing, and a shared summary partial that the LFG party
stats now render through.

Collapses PRs #150, #151
Pre-collapse tip: a82b7f1
```

### Why these boundaries

The grouping follows stack order. An earlier thematic split — setup and
seeding and tests together, backend apart, frontend apart — was rejected
because those themes are scattered through the stack at positions 1/10/11,
2-8, and 9/12/13/14, so realizing it would require reordering across a real
dependency: PR #146 modifies `public/js/app.js`, which PR #143 rewrote for
Alpine, and edits `views/partials/character-level-up.test.js`, a file PR #143
creates. Moving #146 below #143 would reference a file that does not yet
exist. Contiguous grouping avoids reordering entirely, which is what makes the
collapse a pure squash.

Authorship metadata does not survive the squash. The collapsed PR numbers and
pre-collapse tip SHAs are recorded in each commit message so provenance
survives in text. `Co-Authored-By` trailers from the original commits are
dropped.

## Mechanics

Build the commits directly from the boundary trees. No existing ref is
modified at any point — the sequence only creates new objects, one tag, and
one branch.

The three commit messages above are written to `msg1.txt`, `msg2.txt`, and
`msg3.txt` in the session scratchpad, not in the repository, so they leave no
untracked files behind.

```bash
git tag pre-collapse-vpt a82b7f1

M=$(git rev-parse origin/main)            # 2b590d2
c1=$(git commit-tree 49772f8 -p $M  -F msg1.txt)
c2=$(git commit-tree 696b972 -p $c1 -F msg2.txt)
c3=$(git commit-tree fac4391 -p $c2 -F msg3.txt)
git branch refactor-base $c3
```

`commit-tree` takes author and committer from git config, so authorship lands
as the operator. Because each commit reuses a boundary tree verbatim, `c3` and
`a82b7f1` share tree `fac4391` by construction — tree identity is a structural
fact, not a test outcome. No patches replay, so conflicts cannot occur.

Rejected alternatives: `git merge --squash` per segment stages 273 files
through the worktree three times for the same result, and `rebase -i` with 183
`fixup` lines replays every patch and can stall on any odd intermediate state.
Both re-derive what `commit-tree` gets exactly.

## Verification

Tree identity first. All three must produce empty output:

```bash
git diff a82b7f1 refactor-base      # final tree
git diff 553066f refactor-base~1    # #148 boundary
git diff 16ace3f refactor-base~2    # #142 boundary
```

Then the local suite, in a throwaway worktree so the existing checkout is
undisturbed:

```bash
git worktree add .claude/worktrees/refactor-base refactor-base
cd .claude/worktrees/refactor-base && bun install
bun run check && bun run test:unit && bun run test:http && bun run test:integration
```

What the suite can and cannot establish: `refactor-base` and `a82b7f1` share
tree `fac4391`, so results are necessarily identical on both. A green run
confirms the stack was already green. A red run indicates a pre-existing
failure on `a82b7f1`, not damage from the collapse, and gets reported against
`a82b7f1`. The empty diffs are the proof of correctness; the suite is a health
check on the base being built on.

The e2e tier is out of scope for this run — it requires Playwright browsers and
a seeded local Supabase stack.

## Branch and PR disposition

In order, after verification passes:

1. `git push -u origin refactor-base`, and `git push origin pre-collapse-vpt`.

2. Rebase PR #156 onto the new base:

   ```bash
   git tag pre-rebase-e2e-happy-path origin/e2e-happy-path
   git rebase --onto refactor-base origin/virtual-party-tool-current origin/e2e-happy-path
   ```

   This is the only step where conflicts are possible, because
   `e2e-happy-path` sits on the lineage without the region commits and the two
   lineages diverge on a README hunk in the `seed:local` commit. If conflicts
   exceed trivial README context, stop and surface them rather than resolving
   unilaterally. This rebase heals the forked lineage: #156 picks up the region
   support it currently lacks.

3. `gh pr edit 156 --base refactor-base`, then
   `git push --force-with-lease origin e2e-happy-path`.

4. Close PRs #128, #129, #130, #131, #132, #133, #141, #142, #143, #146, #147,
   #148, #150, #151. Each comment names `refactor-base`, its SHA, and which of
   the three commits absorbed that PR.

5. Close PR #155 with a factual note: the branch carries no region code, the
   region support it describes already landed in #128 (`5690fc0`, `b02d023`),
   and its only diff reverts the `rules_pdfs` seeding step from `694fc69`.
   Draft this for review before posting — it is the one message going to a
   teammate.

Branches stay on origin throughout. They are deleted only once this work
reaches `main`, which is a separate decision.

## Rollback

Everything through step 1 is additive: no existing ref is modified, so rollback
is `git branch -D refactor-base` plus `git push origin --delete refactor-base`.

| Risk | Mitigation |
|---|---|
| Collapse is wrong | `pre-collapse-vpt` tag; all 14 branches remain on origin |
| #156 rebase goes bad | `pre-rebase-e2e-happy-path` tag; `--force-with-lease` blocks clobbering a concurrent push |
| Closed PRs needed again | Reopenable while head branches exist, which is why they are kept |
| PR #155 work lost | `refs/pull/155/head` is permanent on GitHub, fetched locally as `pr/155` |

## Success criteria

- `refactor-base` exists on origin with exactly three commits on top of
  `2b590d2`.
- `git diff a82b7f1 refactor-base` is empty, as are both boundary diffs.
- `check`, `test:unit`, `test:http`, and `test:integration` produce the same
  result on `refactor-base` as on `a82b7f1`.
- PR #156 targets `refactor-base` and contains region support.
- All fourteen stacked PRs — #128, #129, #130, #131, #132, #133, #141, #142,
  #143, #146, #147, #148, #150, #151 — plus #155 are closed, each with an
  explanatory comment.
- The old branches and both safety tags are still on origin.
