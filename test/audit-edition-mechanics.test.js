const { test, expect } = require('bun:test');
const { buildEditionMechanicsAudit } = require('../scripts/audit-edition-mechanics');
const classes = Array.from({ length: 21 }, (_, i) => ({ id: `class-${i}`, rules_edition: 'aspirant', rules_version: 'v1', content_format: i < 6 ? 'advent' : 'aspirant', updated_at: '2026-09-28', base_class_id: null }));
const characters = Array.from({ length: 48 }, (_, i) => ({ id: `character-${i}`, class_id: `class-${i < 43 ? i % 6 : 6 + (i % 15)}`, creator_mode: i < 43 ? null : 'aspirant', auto_calculate: i === 0, level: i === 0 ? 5 : 3, completed_missions: i === 0 ? 11 : 4, common_items: [] }));
const links = Array.from({ length: 11 }, (_, i) => ({ character_id: 'character-0', missions: { id: `mission-${i}`, outcome: 'success', difficulty: 'Low', danger: 'Low' } }));

test('production-shaped audit proves unchanged progression/economy without mutating manual or automatic rows', () => {
  const inputs = { classes, characters, links };
  const before = JSON.stringify(inputs);
  const result = buildEditionMechanicsAudit(inputs);
  expect(result.read_only).toBe(true);
  expect(result.safe_metadata_change).toBe(true);
  expect(result.classes).toHaveLength(0);
  expect(result.characters).toHaveLength(48);
  expect(result.characters[0].current.level).toBe(5);
  expect(result.characters[0].proposed.level).toBe(5);
  expect(result.characters[0].economy).toBe('advent');
  expect(result.characters[43].economy).toBe('aspirant');
  expect(result.characters.slice(1).every(row => !row.auto_calculate)).toBe(true);
  expect(JSON.stringify(inputs)).toBe(before);
});

test('audit rejects unexpected metadata and missing linked classes', () => {
  const result = buildEditionMechanicsAudit({ classes: [{ ...classes[0], rules_version: 'v3' }], characters: [characters[0], { ...characters[1], class_id: 'missing' }] });
  expect(result.safe_metadata_change).toBe(false);
  expect(result.errors).toHaveLength(1);
  expect(result.characters.every(row => row.error)).toBe(true);
});

test('Advent controls use their own curve and classless Aspiring uses v2', () => {
  const result = buildEditionMechanicsAudit({ classes: [{ ...classes[0], rules_edition: 'advent', rules_version: 'v1' }], characters: [characters[0], { ...characters[1], class_id: null, creator_mode: 'aspiring' }], links });
  expect(result.characters[0].current.level).toBe(4);
  expect(result.characters[0].proposed.level).toBe(4);
  expect(result.characters[1].currentMechanics).toBe('advent-v2');
});

test('audit detects obsolete Aspirant v2 identities after rollout', () => {
  const result = buildEditionMechanicsAudit({ classes: [{ ...classes[0], rules_version: 'v2' }], characters: [characters[0]], links });
  expect(result.safe_metadata_change).toBe(false);
  expect(result.classes).toHaveLength(1);
  expect(result.characters[0].error).toContain('Unsupported class rules');
  expect(result.errors).toHaveLength(1);
  expect(buildEditionMechanicsAudit({ classes: [{ ...classes[0], rules_version: 'v2' }], characters: [] }).safe_metadata_change).toBe(false);
});
