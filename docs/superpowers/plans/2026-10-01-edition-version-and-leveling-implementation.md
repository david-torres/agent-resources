# Edition version and leveling repair — implementation plan

Date: 2026-10-01. Status: application implementation and local migration rehearsal complete; production rollout pending.

Design contract: [spec](../specs/2026-10-01-edition-version-and-leveling-design.md).
Production evidence: [investigation](2026-10-01-edition-version-and-leveling-repair.md).

## Implementation and validation record

Tasks 1–8 are implemented. Edition-aware mechanics, canonical progression, browser requirements, atomic mission/credit/character/perk persistence, idempotent retries, writer validation, agent metadata, and the read-only audit are present in the workspace.

- Complete isolated unit and HTTP suites passed (224 unit files and 28 HTTP files at this checkout).
- Local level-up integration covers failed-perk rollback including new missions and credits, retries, concurrent duplicate requests, stale history, concurrent history writes, stale perk builds, insufficient history, and level 10.
- Production-shaped metadata rehearsal passed with 21 classes/48 characters and the 11-mission level-5 case; timestamps, character snapshots, mission links, and class families were unchanged; rerun was a no-op.
- Local Aspirant conversion/edit and published-identity integration tests pass. All 11 browser checks for leveling, Advent creation, and Aspiring creation passed in the final combined run.
- The broad local integration run passed 22/25 files. Remaining failures in character-content integrity, class form round trips, and image-crop integrity also reproduce under the original repository code in a temporary checkout. They are existing local data/audit issues, not repaired by this change.
- Syntax and whitespace checks passed. Production was read only; no cloud migrations or character repairs were applied. A read-only production check confirmed no character above level 10.

The atomic migration takes short history-table locks before the character lock, then build-table locks in the same order as ordinary atomic edits, to serialize promotion with inserts and updates, and compares the rules, timestamp, mission history, and build snapshot before committing. Delayed automatic progress writes use timestamp compare-and-swap and retry. This favors straightforward transaction correctness for an infrequent operation; lock contention should be observed during rollout.

Tasks 9–10 remain deployment steps. Keep legacy Aspirant/v2 read compatibility while production still has those values. Apply the atomic RPC migration before deploying its caller, then the edition metadata correction after compatible application deployment; only retire compatibility after verification. The deprecated agent API alias remains until consumers migrate.

## Delivery order

Complete Tasks 1–8 and local verification before production deployment. Deploy compatible application code before Task 9's production migration. Task 10 removes temporary read compatibility after verification. Applied migrations remain immutable. Each task lists behavior to prove, not just source text to match.

### Task 1 — Separate rules identity and mechanics

Files: `util/character-rules.js`, `util/character-rules.test.js`.

- Implement the spec's explicit resolver and supported edition/version validation. Use `advent-v1` / `advent-v2` internally for mechanics.
- Support legacy Aspirant/v2 reads temporarily; reject new writes separately.
- Distinguish classless input, unsupported identity, and unavailable linked-class metadata. Do not use content format as a substitute for edition.
- Add the full identity/mode matrix, both content formats on Aspirant v1, classless behavior, unsupported identity, and legacy compatibility tests.

Done when corrected and legacy Aspirant records resolve identically without changing character mode or equipment economy.

### Task 2 — Carry complete class rules through every consumer

Files: `services/character/repository.js`, `models/character.js`, `services/character/service.js`, `services/character/progress.js`, `routes/characters.js`; corresponding tests in services, models, and routes.

- Replace version-only reads with `getClassRules` results containing edition, version, and content format. Preserve lookup errors.
- Resolve class references before selecting mechanics on creation, including name-based fallback.
- Update create/edit/level-up, mission progress, sheet/edit/details/version-fields/auto-calc routes, and agent reads. Use explicit mechanics for version-dependent capability gates and fields.
- Maintain existing economy resolution. Verify legacy Aspirant-edition/Advent-format characters with absent or Advent mode retain their economy.
- Return a rules-unavailable error on failed linked-class reads rather than silently using v1. Preserve intentional classless behavior.

Tests: `services/character/repository.test.js`, `services/character/service.test.js`, `services/character/progress.test.js`, `services/character/input.test.js`, `models/character-agent.test.js`, `routes/character-details.test.js`, `routes/characters.test.js`, and creation/version-fields HTTP coverage.

Done when no mechanics-sensitive call site selects behavior from a raw class `rules_version`, and a corrected legacy class still produces level 5 at 11 completed missions.

### Task 3 — Centralize progression arithmetic

Files: new `util/character-leveling.js` and test; `util/character-derived.js`, `util/enclave-consts.js`, `util/handlebars.js`; derivation/Handlebars tests.

- Implement canonical cumulative tables, level ceiling, level derivation, threshold lookup, and next-level progress from the spec.
- Route totals and template helpers through the module; retain existing increment exports only as derived compatibility values until all references are updated.
- Use explicit mechanics arguments and eliminate permissive unknown-mechanics fallback in mutating derivation.
- Test each threshold immediately below, at, and above; zero/large counts; invalid levels/mechanics; success/failure/pending/offscreen counting; stakes affecting Merx only.

Done when one set of values defines all supported curves and ceiling behavior.

### Task 4 — Align wizard, sheet, and level-up requirements

Files: `routes/characters.js`, `public/js/character-common.js`, `public/js/character-wizard.js`, `public/js/character-level-up.js`, `views/character.handlebars`, `views/partials/character-level-up.handlebars`, `views/partials/character-auto-calc-fields.handlebars`.

- Serialize server-owned progression rules into wizard data and next-level requirements into the sheet/modal.
- Remove the browser's hardcoded v2 table and extra level-11 step. Refresh rules on class/mode changes; avoid submitting while a required refresh is unresolved.
- Render correct required mission counts for Advent v1 and Aspirant v1; use “completed missions.” Disable Level Up at level 10.
- For manual/history discrepancies show history-based requirements and route incompatible promotion outcomes through the spec's conflict behavior. Preserve ordinary manual edits.
- Ensure stale boosted/fragment navigation cannot retain another character's mechanics or thresholds.

Tests: `test/character-wizard-client.test.js`, relevant wizard route tests, `views/partials/character-level-up.test.js`, `routes/character-level-up.test.js`, `e2e/specs/05-level-up-modal.spec.js`, wizard/aspiring browser specs. Test real displayed values and submitted behavior for both curves, not string-presence assertions alone.

Done when the browser, modal, and server agree at 4, 11, and every other threshold, including after class/mode changes.

### Task 5 — Validate and commit level-up atomically

Files: `services/character/service.js`, `services/character/repository.js`, `models/mission.js` / mission repository paths as needed for lock coordination; new migration extending/wrapping `level_up_character_atomic`; service, HTTP, and database level-up tests.

- Move rules/history reads and target derivation before all mutation. Validate exactly one-level promotion, history evidence, credit sources, stats, and perks.
- Replace independently committed backfill/credit calls with one service-role RPC transaction encompassing their rows/links and the existing character/perk update.
- Define a stable lock order for character and credit sources. Check class/mode and mission-progress snapshot at commit; coordinate concurrent mission changes with the existing recalculation paths.
- Add a client request ID and database idempotency protection so a network retry cannot duplicate mission rows or spend credits twice. Keep permissions consistent with existing service-role-only RPCs.
- Reject insufficient evidence, manual/history conflicts, stale rules/history, and level-11 requests without writes.
- Inject failure after mission insertion and before character/perk persistence; assert transaction rollback. Exercise concurrent mission update and duplicate retry against the local database.

Tests: `services/character/service.test.js`, `routes/character-level-up.test.js`, `models/character-level-up.integration.test.js`, atomic character integration coverage, and the browser level-up flow.

Done when failures leave the whole operation unchanged and a retry returns the original committed result without repeating side effects. This task's schema additions require local migration rehearsal before deployment.

### Task 6 — Correct writer defaults and class surfaces

Files: `util/class-import.js`, `scripts/lib/books.mjs`, `scripts/load-prerelease-classes.mjs`, class create/edit/fork routes and forms, `util/seed-classes.js`, `views/character-form.handlebars`, relevant picker/filter helpers, class exports and history views.

- Set current Aspirant book versions and import defaults to v1. Validate explicit edition/version pairs and destination fork metadata.
- Inspect all admin/import/loader/seed/duplicate writer paths. Remove hardcoded Aspirant v2 options; ensure submitted stale unsupported values fail clearly.
- Update misleading comments and tests. Do not change Advent v2 defaults or overwrite owner-controlled fields during loader reloads.
- Replace `util/aspirant-classes-v2.integration.test.js` with a published-version/mechanics invariant test named for the corrected contract.
- Add a supersession note to the old design/plan sections defining class version as mechanics; retain them as historical documents.

Tests: `util/class-import.test.js`, `test/books.test.js`, `test/load-prerelease-classes.test.js`, class form/fork HTTP coverage, class filter/family tests, migration invariant integration test.

Done when fresh inserts, imports, forks, and no-op reloads cannot introduce Aspirant v2 metadata and the v1 catalog/filter path works for both content formats.

### Task 7 — Make agent metadata explicit

Files: `models/character.js`, `models/character-agent.test.js`, agent service/schema descriptions and consumer documentation as discovered.

- Add `mechanics` and `class_rules` to character results. Retain and document the old effective-mechanics `rules_version` as a deprecated compatibility alias for this release.
- Choose character fields through mechanics. Class results continue to return published edition/version.
- Test corrected Aspirant v1 character metadata, legacy-class/no-mode field retention, classless Aspiring, visibility, and failed rules lookup.

Done when callers can distinguish published version from mechanics without an unannounced removal of existing fields.

### Task 8 — Build a repeatable audit and migration rehearsal

Files: new read-only `scripts/audit-edition-mechanics.js` and tests; `scripts/reconcile-character-progress.js`; new corrective migration such as `20261001000001_aspirant_edition_versions.sql` (allocate final timestamp after inspecting current migration order).

- Audit affected class metadata and per-character current/proposed mechanics, stored and history-derived levels/counters, manual/automatic status, and economy. Default to read-only; this auditor has no character-repair mode.
- Fix reconciliation audit reads to include mission difficulty/danger and complete class identity; verify audit derivation agrees with actual recalculation. Do not run its broad apply mode for this repair.
- Create an idempotent correction targeting audited Aspirant-edition v2 rows, including Advent-format legacy rows. Preserve timestamps transactionally and leave IDs, parent links, and all character rows untouched.
- Rehearse on production-shaped local fixtures: 6 legacy classes, 15 Aspirant-format classes, 43 legacy-mode characters, 5 Aspirant-mode characters, and the 11-mission level-5 automatic case. Include Advent controls and unsupported/mismatched metadata cases.
- Compare mechanics, progression, economy, timestamps, character/child snapshots, and unlock-family sets before/after; rerun the migration to prove no-op behavior.

Done when the report proves metadata-only changes, detects unexpected targets, and the automatic character remains level 5.

### Task 9 — Verify and roll out in order

1. Run focused unit tests, then `bun run test:unit`, `bun run test:http`, and `bun run check` as applicable to changed files. Run local integration tests for atomic level-up, corrected classes, mission recalculation, and migrations. Run browser tests for both curves, class/mode switches, manual conflicts, and ceiling behavior.
2. Deploy the new transactional RPC/schema additions and compatible application before the corrective metadata migration. Confirm the existing database's legacy values still yield identical mechanics and levels.
3. Re-audit production and capture metadata/timestamps and linked character state. Treat October 1 counts as reference; review any drift.
4. Apply the corrective migration through the normal production migration workflow. Verify every audited target is v1; unchanged timestamps, character rows, child rows, families, and economy; unchanged level 5 for the 11-mission automatic character.
5. Exercise read-only production class filters, sheets, and agent reads. Use local/staging for writer smoke tests unless production test writes have separate authorization.
6. Record before/after audit and deployment versions. Report automatic discrepancies separately; do not rewrite manual totals or invoke broad reconciliation.

Rollback order: retain the compatible resolver after data correction. If the old application must return, restore captured class versions first while preserving timestamps. Transactional RPC additions remain backward compatible with the prior application until rollback is no longer needed.

Done when production labels say Aspirant v1 and all affected progression behavior is preserved.

### Task 10 — Retire temporary compatibility

- Confirm no Aspirant/v2 class rows remain and no importer/admin/loader path can recreate them.
- Remove only legacy Aspirant/v2 read compatibility and its temporary tests; keep permanent edition/mechanics regressions.
- Keep the deprecated character API alias until a separately communicated consumer migration. Do not bundle an API removal into metadata cleanup.
- Update the spec/plan status with completed validations, migration identity, and any unresolved follow-up.

Done when supported published identities are enforced consistently and production still resolves Aspirant v1 to Advent v2 mechanics.

## Review checkpoints

- Tasks 1–4: curve selection and display are correct before data changes.
- Task 5: transactional behavior is proven by rollback, concurrency, and retry tests.
- Tasks 6–8: writers, API metadata, and rehearsed migration preserve the corrected contract.
- Task 9: production rollout evidence shows no character changes caused by metadata correction.

Application implementation and local validation are complete. Production deployment, the corrective production migration, and compatibility retirement remain pending.
