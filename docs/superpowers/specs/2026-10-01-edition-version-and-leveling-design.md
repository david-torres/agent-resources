# Edition version and leveling repair — design spec

Date: 2026-10-01. Status: implemented and locally validated; production rollout pending.

Implementation plan: [task sequence](../plans/2026-10-01-edition-version-and-leveling-implementation.md).
Evidence: [production investigation](../plans/2026-10-01-edition-version-and-leveling-repair.md).

## Problem and intended result

The application treats a class's published version as its underlying character mechanics. As a workaround, Aspirant v1 classes were stored as Aspirant v2. Correcting the records alone would change the leveling curve for legacy characters.

After this change, Aspirant classes display and store `rules_edition = aspirant`, `rules_version = v1`, while their characters retain Advent v2 mechanics. Level requirements agree across creation, sheets, editing, mission updates, level-up, and agent reads. The metadata repair does not change stored character levels or builds.

This spec supersedes the definition of `classes.rules_version` in Part 1 of `2026-09-28-convert-to-aspirant-design.md` and the corresponding decision in the September 29 mode-conversion plan. Conversion's other behavior remains governed by its existing specification.

## Data model

| Value | Meaning |
| --- | --- |
| `classes.rules_edition` | Published edition: Advent or Aspirant |
| `classes.rules_version` | Version within that edition |
| `classes.content_format` | Class content structure; independently selects existing format-dependent behavior |
| `characters.creator_mode` | Character mode; independently selects existing mode-dependent behavior |
| Resolved `mechanics` | Derived mechanics identity: `advent-v1` or `advent-v2` |

Mechanics are calculated, not stored in a new character or class column. Avoid redundant persisted facts that can drift. Do not infer edition from content format, and do not migrate character mode to compensate for bad version metadata.

## Mechanics resolution contract

Provide a pure `resolveCharacterMechanics({ classRules, creatorMode })` function in `util/character-rules.js`. `classRules` is either an explicitly classless `null` or `{ rules_edition, rules_version }` from a successfully loaded class. Repository errors are distinct from `null`.

| Class identity | Absent or Advent mode | Aspirant or Aspiring mode |
| --- | --- | --- |
| Advent v1 | `advent-v1` | `advent-v2` |
| Advent v2 | `advent-v2` | `advent-v2` |
| Aspirant v1 | `advent-v2` | `advent-v2` |
| Classless | `advent-v1` | `advent-v2` |
| Legacy Aspirant v2, rollout only | `advent-v2` | `advent-v2` |

Validate a supplied class identity before applying a mode override. Unsupported pairs are an explicit rules error, not a fallback to Advent v1. Unknown modes use existing mode validation. Classless fallback preserves current behavior; a missing/deleted linked class or database failure does not qualify as classless.

The repository exposes a `getClassRules` result containing edition, version, and content format, with errors preserved. Callers choose mechanics only after resolving the final class reference. No mechanics-sensitive caller may use the raw class version alone.

Capability gates for Defining Quirk, Accessories, Ability Perks, and existing mechanics-specific fields use the resolved mechanics. Economy and format selection continue using their existing rules: an absent-mode legacy character on an Aspirant-tagged Advent-format class does not acquire Aspirant equipment or perk economy merely because its mechanics are Advent v2.

For mutating requests, failed rules reads stop the operation before writes. For read-only sheets/fragments, return a rules-unavailable response rather than displaying guessed progression or editable rule-dependent fields. Agent reads return a structured error rather than guessed mechanics.

## Leveling contract

One pure module, `util/character-leveling.js`, owns the level ceiling and cumulative thresholds. Existing increment arrays may remain compatibility exports, but must derive from the same canonical values.

| Level | Advent v1 missions | Advent v2 / Aspirant v1 missions |
| --- | --- | --- |
| 1 | 0 | 0 |
| 2 | 2 | 2 |
| 3 | 5 | 4 |
| 4 | 9 | 7 |
| 5 | 14 | 10 |
| 6 | 20 | 14 |
| 7 | 27 | 18 |
| 8 | 35 | 23 |
| 9 | 44 | 28 |
| 10 | 54 | 34 |

Expose `levelForCompletedMissions(count, mechanics)`, `missionsRequiredForLevel(level, mechanics)`, and `nextLevelProgress({ level, completedMissions, mechanics })`. Mission counts remain nonnegative; level derivation caps at 10. Requests for a threshold outside levels 1–10 are invalid. At level 10, next-level progress has no target, and Level Up is disabled.

Completed mission counting preserves the existing contract: success and failure each count once, pending/unknown outcomes count zero, and each offscreen row counts once. Difficulty/danger bonuses affect Merx, never completed mission count or level thresholds.

Server derivation, template helpers, mission recalculation, and browser displays consume these same thresholds. The server supplies thresholds and mechanics to the wizard and supplies the current target and required mission count to the sheet's level-up modal. Browser code does not contain a second curve table. Class or mode changes refresh the wizard's rules before deriving progress or enabling submission.

### Automatic and manual characters

- Automatic characters derive level from recorded completed missions through the resolved mechanics on the existing recalculation paths.
- Ordinary edits and metadata migrations preserve manual levels and counters.
- Explicit Level Up continues to use mission history, including for manual characters. Its displayed requirement must use that same history. If stored manual level/counters disagree with history, show the recorded-history requirement; do not create missing historical missions without explicit entered names or selected credits.
- Level Up promotes exactly one level from the stored level. It must not save a lower level or silently jump multiple levels. If recorded progress would produce a different target, return a conflict before writes so the owner can review totals through the existing edit flow. Do not invent a second reconciliation UI in this repair.

## Level-up write contract

Resolve ownership, rules, mechanics, current level, recorded history, and credit availability on the server. Derive the target and validate candidate history including explicitly supplied backfill missions or credits. Submitted mechanics, thresholds, counters, and level values are never authoritative.

Validate stats, perks, economy limits, and the target before committing any backfill mission, credit spend, or character change. Commit mission rows/links, offscreen credit rows, stats, perks, and derived progress in one database transaction. Extend or wrap the existing level-up RPC rather than sequencing independently committed repository calls.

The transaction locks the character and selected credit sources, checks ownership and the class/mode identity and progress snapshot used for validation, and rejects stale state. Coordinate with existing mission/progress writes so a concurrent mission change cannot leave totals based on a stale snapshot. The implementation must establish a consistent lock/order strategy and test it; a preflight read alone is insufficient. Keep all curve arithmetic in the canonical application module; the service-role RPC checks the trusted expected rules/history snapshot and enforces atomic persistence.

On validation failure, stale state, insufficient credits, or injected database failure, no newly created missions, links, credit spends, stats, or perks remain. Retries after a committed request must not repeat its mission/credit changes; assign a request ID and enforce idempotency for the atomic level-up operation.

## Edition/version writes and public metadata

Aspirant v1 book loaders, imports, admin forms, creation, and forks write Aspirant v1. Supported published identities are Advent v1, Advent v2, and Aspirant v1. New writes of Aspirant v2 are rejected even while legacy reads remain compatible. Import defaults use the edition's published version; explicit unsupported pairs produce an error rather than being silently rewritten. Forks across editions validate the destination pair rather than inheriting the source version blindly.

Class labels, filters, history, exports, and class API metadata continue to show the stored published edition/version. Remove hardcoded Aspirant v2 options. Mechanics labels in character progress should identify the applicable rules clearly; avoid presenting the underlying mechanics version as the class's published version.

Agent character responses currently expose `rules_version` as effective mechanics. During the compatibility release retain that legacy field, document its deprecation, and add explicit `mechanics` and `class_rules: { rules_edition, rules_version }` (or `null` for classless). Field selection uses mechanics, not the deprecated alias. Remove or redefine the alias only in a separately communicated API change after checking consumers. Class API `rules_version` remains the edition version throughout.

## Migration and rollout

The read-only October 1 audit found 21 Aspirant classes (6 Advent-format, 15 Aspirant-format) and 48 linked characters. One automatic legacy character has 11 missions and level 5; both must remain unchanged. Counts are evidence from a snapshot, not hardcoded deployment assumptions.

Deploy compatible resolution before correcting data. Re-audit targets and capture class versions/timestamps plus linked character state. Add a new idempotent migration updating existing Aspirant-edition v2 records to v1, preserving class timestamps and relationships. Reject unexpected edition/format cases during rehearsal rather than widening the update to all Aspirant-format rows. Do not rewrite applied migrations.

The migration does not update characters, missions, mode, economy, gear, abilities, perks, stats, ownership, or unlocks. Before/after simulations must show unchanged mechanics and progression for every affected character. Verify counts, timestamps, filters, loaders, and the automatic 11-mission level-5 case afterward.

The existing broad reconciliation script rewrites level, mission counters, and Merx; it is not the metadata repair. Its audit query currently omits mission difficulty/danger. Correct its reads if used for verification, but keep it read-only during this rollout. Any later character repairs need a reviewed list of exact changes; manual history discrepancies are not automatic repair targets.

Once records and consumers are verified, remove legacy Aspirant v2 read compatibility. Rollback after the metadata migration must retain edition-aware resolution or restore captured class metadata before restoring the old application.

## Acceptance criteria

1. All published class paths identify current Aspirant as v1, and new writer paths cannot recreate Aspirant v2.
2. Aspirant v1 uses Advent v2 mechanics with every supported mode and with either content format. Aspirant/Aspiring mode on Advent v1 also uses Advent v2 mechanics.
3. Four missions yields Advent v1 level 2 and Aspirant v1 level 3; 11 yields levels 4 and 5 respectively; 34 yields Aspirant v1 level 10.
4. Client displays, server validation, saved progression, and mission recalculation agree at every threshold; no level-11 path exists.
5. Failed or stale Level Up operations leave no persistent side effects; successful retry is idempotent.
6. Metadata correction changes no stored character level or build. Manual characters remain manual and keep their totals.
7. Quirks, Accessories, Ability Perks, deprecated text, economy, visibility, class families, and unlocks retain existing behavior.
8. A failed class read cannot cause a guessed leveling calculation to be persisted.

## Scope boundaries

This repair keeps the existing curves and counting rules. It does not rewrite manual mission history, convert legacy characters to Aspirant economy, introduce new editions, or redesign progression grants. Transactional level-up handling is included because the selected curve governs mission creation and credit consumption, and a mismatched or failed promotion must not charge a character.
