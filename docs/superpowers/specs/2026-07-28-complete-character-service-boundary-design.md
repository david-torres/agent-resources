# Complete character mutation service boundary

- **Ticket:** ar-m8ai (P1, epic; blocks ar-g8y7 "Sustainability hardening program")
- **Depends on:** ar-ezes (service-role consolidation) — shipped as PR #141
- **Date:** 2026-07-28
- **Type:** architecture refactor of already-tested code + one atomicity fix

## Problem

ar-ezes moved the character domain's privileged writes and authorization behind
`services/character/{repository,policy,service}.js`, and the headline level-up
workflow and multi-step perk persistence into the service. But the ticket's
acceptance criterion — *"All character mutations are implemented as named use
cases/services with tested contracts and transaction boundaries; route handlers
only translate HTTP and render responses"* — is not yet met. An audit of
`routes/characters.js` and `services/character/` found four residual gaps:

1. **Wizard validation in the route.** `POST /wizard` re-implements input
   validation/coercion (`routes/characters.js:345-384`) that
   `services/character/input.js` already owns — name trim/length cap,
   `creator_mode` whitelist, per-stat integer coercion, `level`/
   `completed_missions` clamping, `commissary_reward` default, boolean coercion.
2. **Perk/named-array reshaping in the route.** Route-local helpers
   `collectAbilityPerks`/`collectNamed` (`routes/characters.js:40-71`, used by
   `POST /` at 744-755 and `PUT /:id` at 1170-1181) assemble domain sub-entities
   from parallel form arrays, duplicating `normalizeAbilityPerks` in `input.js`.
3. **Offscreen-mission writes have no service seam.** The three
   `POST /:id/offscreen-missions*` handlers (`routes/characters.js:576, 667,
   715`) do inline authorization (`creator_id !== profile.id` at 582/635/673/721),
   inline validation (589/684), and inline workflow (`resolveOffscreenSource`
   157-178, conduit-credit balance gate 595-603) entirely in the route.
4. **Level-up is not atomic.** `service.js#levelUp` (424-528) issues many
   independent privileged writes — backfill missions, offscreen rows, owned-field
   update, perk insert, then a separate perk-link update loop — with no
   transaction. A mid-sequence failure leaves partial state (e.g. missions
   created but perks not linked). Create/update are already atomic via the
   `save_character_atomic` RPC; level-up is not.

## Decisions

Two design decisions were made explicitly during brainstorming; the rest follow
the pattern ar-ezes established.

**Offscreen missions: methods on `CharacterService`.** Offscreen missions are
character-scoped sub-entities — they cannot exist without a parent character and
their authorization *is* character ownership. Rather than a standalone
`services/offscreen-mission/` domain (boilerplate for a boundary that adds no
isolation value), add `createOffscreenMission`/`updateOffscreenMission`/
`deleteOffscreenMission(actor, charId, …)` to the existing character service,
with reads/writes in `character/repository.js` and authorization reusing the
existing `canMutateCharacter` policy predicate.

**Level-up atomicity: compute in JS, persist terminal writes in one RPC.** Keep
the derivation and credit-sourcing workflow in `service.js#levelUp` (business
logic stays testable in JS). The backfill-mission and offscreen-credit creation
stay **sequential and upstream** — they are cross-domain (mission service +
offscreen model, each with its own RPC) and cannot join a single Postgres
function without re-implementing them in plpgsql (rejected). They are additive
and re-derivable: their rows represent real events, and the stored counters are
re-derived from them, so a later failure self-heals on the next save. The
*terminal* persistence — owned-field counters + perk insert + perk-link update —
moves into a new `level_up_character_atomic` RPC that runs as one transaction.
This is exactly where the flagged partial-state risk lives ("missions created
but perks not linked"): after the change, if the terminal step aborts, no perks
are half-written and counters heal on next save. Mirrors the existing
`save_character_atomic` pattern rather than porting business logic into plpgsql.

## Scope — the four extractions

| # | Gap | From | To |
| --- | --- | --- | --- |
| 1 | Wizard validation/coercion | `routes/characters.js:345-384` | `services/character/input.js` (extend `normalizeCharacterInput`/`normalizeStatsPayload`); handler delegates to existing `createCharacter` |
| 2 | `collectAbilityPerks`/`collectNamed` reshaping | `routes/characters.js:40-71` (used 744-755, 1170-1181) | `services/character/input.js` (extend `normalizeAbilityPerks`); create/update handlers pass raw body to the service |
| 3 | Offscreen-mission authz + validation + workflow | `routes/characters.js:576, 667, 715` (+157-178, 582-603) | `CharacterService.{create,update,delete}OffscreenMission`; repo methods; reuse `canMutateCharacter`; `asyncHandler`-wrapped handlers |
| 4 | Non-atomic level-up (terminal writes) | `services/character/service.js:424-528` | new `level_up_character_atomic` RPC (migration) + `repository.js#levelUpAtomic` wrapping owned-fields + perk insert + perk-links in one transaction; backfill/offscreen stay sequential upstream (cross-domain, re-derivable) |

## Layered shape (unchanged from ar-ezes)

```
route handler (thin: parse HTTP → actorFromLocals → service call → render)
  → CharacterService.capability(actor, …)
      → repo.load…()                          // privileged read
      → policy.canMutateCharacter(actor, char) // pure predicate
          denied  → throw AuthorizationError → asyncHandler → 403
          allowed → repo.write…() / repo.levelUpAtomic(payload) → { data, error }
```

## Non-goals

- No change to RLS policies or the anon/RLS-scoped read paths.
- No new offscreen-mission features; behavior is preserved, only relocated.
- No change to create/update atomicity (already handled by `save_character_atomic`).
- No standalone offscreen-mission domain (decided against — see Decisions).
- No dependency injection; actor remains passed as data (ar-ezes convention).

## Constraints (carried from ar-ezes)

- `supabaseAdmin` imported only in `models/_base.js` and `services/*/repository.js`.
- Authorization denials **throw** `AuthorizationError` (`code: 'forbidden'` → 403).
- Double-guard preserved: creator-only writes keep BOTH the JS policy check AND
  the SQL `creator_id` filter.
- Every touched route handler is `asyncHandler`-wrapped (Express 4 does not catch
  async throws) — the same regression class fixed three times during ar-ezes.
- Test gate green after each task: `bun run test:unit` and `bun run test:http`
  (exit 0); integration (`character-atomic.integration.test.js` + the new
  level-up rollback test) run where local Supabase is available.

## Verification

Done when all hold:

1. `routes/characters.js` contains no inline validation/coercion, no authz
   comparison, no multi-step persistence, and no workflow helpers beyond HTTP
   request/response shaping. Grep confirms `collectAbilityPerks`/`collectNamed`/
   `resolveOffscreenSource` and the `creator_id !==` checks are gone from the route.
2. Every character mutation — create, update, delete, stats, level-up, upgrade,
   deceased, and all three offscreen-mission operations — is a named
   `CharacterService` method with a tested contract: a non-owner is refused
   (`AuthorizationError` → 403) and an owner succeeds.
3. A level-up rollback integration test proves atomicity: a mid-sequence failure
   leaves no partial state (mirrors `models/character-atomic.integration.test.js`).
4. `bun run test:unit` and `bun run test:http` exit 0.

## Risks

- **Behavioral drift in wizard/perk reshaping.** The route helpers encode subtle
  form-array pairing. Mitigated by moving the logic verbatim into `input.js`
  under unit tests that pin the current input→normalized-shape mapping before the
  route is rewired.
- **Level-up RPC correctness.** A single transactional function replacing several
  writes is the highest-risk change. Mitigated by the rollback integration test
  and by keeping derivation in JS (only persistence moves to SQL).
- **Offscreen credit-gate regression.** The conduit-credit balance gate is
  business logic; moving it into the service must preserve the exact refusal
  behavior. Mitigated by a service contract test covering the insufficient-credit
  path.
