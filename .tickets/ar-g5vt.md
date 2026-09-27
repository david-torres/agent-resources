---
id: ar-g5vt
status: closed
deps: []
links: []
created: 2026-09-27T22:15:12Z
type: bug
priority: 2
assignee: David Torres
tags: [aspirant, release-review]
---
# Preserve Signature names when pricing Aspiring equipment upgrades

Found in final review of aspirant-v1-classes-and-characters at e0c439e.

public/js/character-gear-purchases.js:285 and :305 construct proposed purchases without name. priceOfPurchase passes that missing name into Aspiring pool matching, which uses both class_id and name. Own-pool Signatures are consequently priced at cross-class rates during affordability checks for both Enchantments and Mods.

Reproduction: create an Aspiring purchase fixture with three own-pool Signatures (6 Merx) and one cross-class Signature (3 Merx), against the 10-Merx grant. With 1 Merx left, adding the first own-pool Mod should cost 1 Merx. setMods returns false and leaves spending at 9 because the proposed item lost its pool identity.

Verified using the existing jsdom gear-purchase fixture.

## Design

Carry purchase.name into both proposed purchase objects, or preserve the original purchase identity when applying equipment changes. Verify the resulting price delta agrees with the server economy.

## Acceptance Criteria

An Aspiring character with 1 Merx remaining can add a 1-Merx first Mod to an own-pool Signature.
Own-pool default/custom Enchantment affordability uses the correct own-class price.
Cross-class equipment still uses cross-class rates, and truly unaffordable purchases remain blocked.
Regression tests cover both Mod and Enchantment changes with a nonempty Aspiring pool at budget boundaries.
