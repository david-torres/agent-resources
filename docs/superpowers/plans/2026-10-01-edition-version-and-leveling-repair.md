# Separate edition versions from character mechanics

Date: 2026-10-01. Status: investigation record; no application or production changes made.

Formal deliverables: [design spec](../specs/2026-10-01-edition-version-and-leveling-design.md) and [implementation plan](2026-10-01-edition-version-and-leveling-implementation.md). Those documents define the proposed implementation; this record preserves the investigation evidence.

## Required behavior

`classes.rules_edition` and `classes.rules_version` identify an edition and its published version. `Aspirant v1` uses Advent v2 character mechanics. It is not `Aspirant v2`.

| Published rules | Character mechanics | Cumulative completed missions for levels 2–10 |
| --- | --- | --- |
| Advent v1 | Advent v1 | 2, 5, 9, 14, 20, 27, 35, 44, 54 |
| Advent v2 | Advent v2 | 2, 4, 7, 10, 14, 18, 23, 28, 34 |
| Aspirant v1 | Advent v2 | 2, 4, 7, 10, 14, 18, 23, 28, 34 |

A character explicitly using Aspirant or Aspiring mode also uses Advent v2 mechanics, including when its class is Advent v1 or it has no class. An Advent or absent mode must not override the mechanics inherited from an Aspirant class. Mode, content format, economy, and published edition version remain distinct facts.

The thresholds above are the current server constants in `util/enclave-consts.js`, confirmed by existing derivation tests. This repair changes how a curve is selected, not the thresholds themselves. Successful and failed real missions count toward level; pending missions do not; every offscreen mission counts once. Merx success bonuses do not multiply leveling progress.

## Findings

### Why the metadata became wrong

- `supabase/migrations/20260928000003_aspirant_classes_v2_rules.sql` explicitly assigns `v2` to Aspirant-format classes to encode Advent v2 mechanics.
- `util/class-import.js` describes the version as character mechanics and forces Aspirant-format imports to `v2`.
- `scripts/lib/books.mjs` sets both Aspirant book descriptors to `rulesVersion: 'v2'`.
- `util/aspirant-classes-v2.integration.test.js` asserts the incorrect metadata invariant.
- The six older Aspirant classes have `content_format = advent`; fixing only Aspirant-format rows misses them. Their edition was retagged by the August 18 migration. The September 22 prerelease migration also sets versions without restricting the edition. Inspect the actual target set when implementing the corrective migration rather than attributing every row to the September 28 migration.

### Where leveling depends on it

`util/character-rules.js#characterRulesVersion` currently receives only class version and creator mode. It cannot recognize Aspirant v1 from its edition. Its result selects the curve in `util/character-derived.js#deriveLevel` and also gates Quirks, Accessories, and Ability Perk processing.

Call paths requiring the full class rules identity:

- Creation, edit/save, and level-up in `services/character/service.js`.
- Mission-triggered progress in `services/character/progress.js`, called through `models/mission.js`.
- Sheet, edit, auto-calculation preview, version-fields fragment, details fragment, and related render paths in `routes/characters.js`.
- Agent character reads in `models/character.js`.
- `scripts/reconcile-character-progress.js`.

The repository's `getClassRulesVersion` selects version and format but omits edition; the model's `classRulesVersion` reduces a class to one string. Both must change. Creation currently resolves mechanics before the class-name fallback fills in `class_id`; resolve the final class reference first so name-based creation cannot choose the wrong curve.

### Separate leveling mismatch

- `public/js/character-common.js#missionsForLevel` always uses the v2 sequence. The wizard and level-up JavaScript consume it.
- `views/partials/character-level-up.handlebars` always uses `getTotalV2MissionsNeeded`, even though Advent v1 characters can open the modal.
- The server's `levelUp` ultimately re-derives the level from mission rows using the selected mechanics. The client can therefore request too few missions and the server can save a different level from the promotion shown in the UI.
- The browser sequence has an extra final `6`, allowing an apparent level-11 threshold, while the server caps derivation at level 10. Server request parsing can also produce `currentLevel + 1` above the ceiling. Enforce the ceiling consistently.
- The modal says “successful missions,” although the derivation counts completed successes and failures. Use “completed missions.”
- Level-up creates backfill and offscreen rows before all later validation completes. Resolve rules and validate promotion requirements before those writes; failed requests must not consume credits or leave newly created missions behind. Add transactional handling if the existing adapter boundaries cannot provide that guarantee.

### Production audit (read-only snapshot)

21 classes are tagged `aspirant`, all with `rules_version = v2`: 6 Advent-format legacy classes and 15 Aspirant-format classes. All are official release rows at this snapshot. 48 characters link to them:

| Class format | Character mode | Automatic | Manual | Total |
| --- | --- | --- | --- | --- |
| Advent | absent | 1 | 41 | 42 |
| Advent | Advent | 0 | 1 | 1 |
| Aspirant | Aspirant | 0 | 5 | 5 |

The automatic character `1426d69f-19b6-4203-912a-ae6feef65704` has 11 stored and recorded completed missions, and is correctly level 5 under Advent v2 mechanics. Retagging its class alone would make the existing resolver select Advent v1 and derive level 4.

Among the 43 legacy characters, comparing both curves yields different levels for 7 characters using recorded mission history, or 9 using stored completed-mission counters. These are potential consequences of a version-only retag, not evidence that those characters currently have incorrect levels.

15 of the 47 manual Aspirant-linked characters have stored levels differing from the current curve applied to recorded history; 25 have stored mission totals differing from recorded history. Manual totals and incomplete logs can explain these differences. Do not automatically overwrite them or assert that this bug caused them. All 9 automatic characters across the production audit currently match their selected curve and mission history.

Existing tests run during investigation: 80 passed, 0 failed across `util/character-rules.test.js`, `util/character-derived.test.js`, `services/character/progress.test.js`, and `views/partials/character-level-up.test.js`. They do not cover edition-based mechanics resolution or the v1 modal threshold mismatch.

## Implementation sequence

### 1. Resolve mechanics explicitly before changing stored versions

- Introduce one pure resolver in `util/character-rules.js` taking class edition, edition version, and creator mode. Return an explicit mechanics identity such as `advent-v1` or `advent-v2`; use clear names at call sites so an edition version cannot be passed as mechanics accidentally.
- Recognize Advent v1, Advent v2, and Aspirant v1 explicitly. Temporarily accept the existing Aspirant/v2 records as Advent v2 mechanics for the staged rollout. Keep this compatibility separate and documented; remove it after production correction and verification.
- Resolve Aspirant/Aspiring mode to Advent v2 mechanics independently of the linked class. Preserve Advent/no-mode characters on Aspirant classes as Advent v2 mechanics without modifying their mode or economy.
- Pass complete class metadata through repository and model adapters, every route, progress calculations, and reconciliation. Do not infer edition from `content_format`; six production classes demonstrate why this is insufficient.
- For mutations, distinguish a genuinely classless character from a failed lookup of a linked class. The current repository silently defaults to v1 on errors; do not recalculate or save using a guessed curve after a database failure.
- Continue selecting equipment/perk economy from the existing mode/format rules. Do not turn the 43 legacy characters into Aspirant economy characters as a side effect of version repair.
- Keep class labels, filters, exports, and class API metadata based on the published edition/version. Character agent responses currently use `rules_version` for effective mechanics; introduce explicit mechanics and edition fields with a compatibility strategy for consumers, and use mechanics to decide which character fields to serialize.

### 2. Make leveling use the same resolved rules everywhere

- Centralize cumulative thresholds, level derivation, next-level mission requirements, and level ceiling in one pure server module. Keep the existing curves.
- Use it for saves, level-up, mission recalculation, auto-calculation previews, sheet progress, and Handlebars helpers.
- Supply the resolved thresholds or exact next-level requirement to the browser from the server. Remove the independent hardcoded v2 curve from the browser; ensure class/mode changes refresh the wizard's curve.
- Make modal text, missing-mission inputs, submitted credit counts, and server validation agree on completed missions and the same next-level threshold.
- Resolve and validate the intended promotion on the server before backfill/credit mutations. Ignore client claims about rules or required mission counts. Reject unavailable promotion, insufficient mission evidence, and level-11 requests without persistent side effects.
- Preserve explicit manual totals on ordinary edits and metadata repair. Existing explicit Level Up behavior derives from history even for manual characters; do not silently replace that policy. Make the modal expose any history/counter mismatch and validate the resulting promotion before writes, so a “Level Up” cannot unexpectedly demote a manually maintained character. Cover this path independently.

### 3. Correct all sources of Aspirant version metadata

- Set Aspirant v1 book descriptors and imports to the published version `v1`; update parser descriptions, fixture expectations, and comments.
- Check admin creation/edit and fork paths so a present-day Aspirant entry cannot acquire `v2` through a default or inherited Advent version. Do not silently assign `v1` to a future unsupported edition/version; reject unsupported combinations explicitly.
- Audit seeds, loader insert paths, and no-op reload behavior. The loader intentionally does not update an existing row's version, so descriptor correction alone cannot repair production.
- Replace the integration invariant that Aspirant classes must be `v2` with edition identity plus resolved-mechanics invariants.
- Review hardcoded Aspirant v2 picker groups, labels, filter links, class exports, histories, and API filters. Version-family edges use edition and content format, so changing only version should not alter ownership or upgrade links; verify this in tests.

### 4. Rehearse and deploy the correction

1. Deploy the resolver and leveling fixes while the database still contains the old version values. Both old metadata and corrected Aspirant v1 metadata must resolve to Advent v2 mechanics during rollout.
2. Capture affected class metadata, timestamps, character levels/counters, and child-row identities. Run a read-only before/after simulation using the production snapshot. Require no curve or level change caused by the metadata correction, and no changes to economy, gear, abilities, perks, stats, modes, class IDs, or unlock families.
3. Add a new idempotent corrective migration; do not rewrite applied migration history. Correct the audited Aspirant-edition classes to `v1`, including legacy Advent-format rows. Explicitly inspect any unexpected format/edition combinations rather than using a broad format-only UPDATE. Preserve `updated_at` using a transaction-scoped trigger strategy consistent with prior migrations.
4. Verify all 21 current targets are Aspirant v1, the automatic 11-mission character remains level 5, and all 48 character rows retain their saved values and child rows. Verify v1 filters and UI labels, and rerun imports/loaders locally to prove they do not recreate v2 metadata.
5. Audit character progress with the corrected resolver. If automatic rows need repair due to intervening changes, report exact deltas and use a level-specific repair that re-reads each row before writing. The existing reconciliation script also rewrites Merx and mission totals and omits difficulty/danger from its audit read; do not run its broad `--apply` as a version repair. Fix that discrepancy before using its audit output to authorize any broader reconciliation.
6. Keep manual totals untouched. Report history discrepancies separately if character repair is later requested. No blanket creator-mode migration is needed.
7. After verification, remove temporary Aspirant/v2 compatibility and enforce supported edition/version pairs at application write boundaries. Consider a database constraint only after confirming all writer paths and future-version policy.

Rollback: before data correction, roll back the application normally. After correction, never restore the old application while Aspirant classes remain v1: it would select the wrong curve for legacy characters. Prefer the corrected resolver or restore the captured class metadata first, with timestamps preserved. A metadata-only correction requires no character rollback because it must not modify characters.

## Required regression coverage

- Matrix: Advent v1, Advent v2, corrected Aspirant v1, and temporary Aspirant/v2 compatibility crossed with absent/Advent/Aspirant/Aspiring mode; include classless Aspiring and class lookup failure.
- Every level threshold, immediately below/at/above; zero missions and the level-10 ceiling. Explicit examples: 4 missions is Advent v1 level 2 but Aspirant v1 level 3; 11 missions is Advent v1 level 4 but Aspirant v1 level 5; 34 missions is Aspirant v1 level 10.
- Corrected Aspirant v1 class with Advent-format content and absent mode, through create, edit/save, sheet/details/API, version-fields, auto-calculation, mission outcome/link/unlink changes, offscreen changes, and level-up.
- Successful and failed missions count once, pending missions count zero, and Merx stakes do not change the curve.
- The v1 and v2 modal/browser requirements match the server; insufficient or stale submissions and ceiling requests cause no mission, credit, stat, or perk writes.
- Manual/history mismatch is handled without surprise demotion or automatic rewriting. Ordinary edits preserve manual totals.
- Quirks, Accessories, Ability Perks, deprecated text, ownership, visibility, and economy survive corrected metadata.
- Migration idempotency and timestamp preservation; imports, loader descriptors, and fresh local seeds use Aspirant v1. Class family/unlock sets remain unchanged.

Run targeted unit and HTTP suites first, then local database integration and browser tests exercising both curves, and rehearse the migration on a production-shaped local fixture before production application. Implementation and deployment are subsequent work; this document authorizes neither production writes nor inferred repair of manual character history.
