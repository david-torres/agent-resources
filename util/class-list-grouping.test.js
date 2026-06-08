const { test, expect, describe } = require('bun:test');
const { groupClassVersions } = require('./class-list-grouping');

// Minimal class row shape used by the grouping logic.
const cls = (id, { base = null, edition = 'advent', version = 'v1', created_at = '2026-01-01T00:00:00Z', name = id } = {}) => ({
  id,
  name,
  base_class_id: base,
  rules_edition: edition,
  rules_version: version,
  created_at
});

describe('groupClassVersions', () => {
  test('a single class becomes one group with empty previous', () => {
    const groups = groupClassVersions([cls('a')]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('a');
    expect(groups[0].previous).toEqual([]);
  });

  test('v1 -> v2 chain collapses to v2 with v1 in previous', () => {
    const v1 = cls('v1', { version: 'v1', created_at: '2026-01-01T00:00:00Z' });
    const v2 = cls('v2', { base: 'v1', version: 'v2', created_at: '2026-02-01T00:00:00Z' });
    const groups = groupClassVersions([v1, v2]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('v2');
    expect(groups[0].previous.map(c => c.id)).toEqual(['v1']);
  });

  test('different editions of the same name stay as separate groups', () => {
    const adv = cls('adv', { edition: 'advent', name: 'Stalker' });
    const asp = cls('asp', { base: 'adv', edition: 'aspirant', name: 'Stalker' });
    const groups = groupClassVersions([adv, asp]);
    expect(groups.length).toBe(2);
    expect(groups.map(g => g.primary.id).sort()).toEqual(['adv', 'asp']);
    for (const g of groups) expect(g.previous).toEqual([]);
  });

  test('branching family picks the newest-created leaf as primary', () => {
    const v1 = cls('v1', { created_at: '2026-01-01T00:00:00Z' });
    const a = cls('a', { base: 'v1', created_at: '2026-02-01T00:00:00Z' });
    const b = cls('b', { base: 'v1', created_at: '2026-03-01T00:00:00Z' });
    const groups = groupClassVersions([v1, a, b]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('b');
    expect(groups[0].previous.map(c => c.id)).toEqual(['a', 'v1']); // newest-first
  });

  test('a chain with a missing intermediate degrades into separate groups', () => {
    // v2's base (v1) is not in the list, so v2 cannot reach v3's branch via v1.
    const v2 = cls('v2', { base: 'missing-v1', version: 'v2', created_at: '2026-02-01T00:00:00Z' });
    const v3 = cls('v3', { base: 'v2', version: 'v2', created_at: '2026-03-01T00:00:00Z' });
    const lone = cls('lone', { base: 'missing-v1', version: 'v1', created_at: '2026-01-01T00:00:00Z' });
    const groups = groupClassVersions([v2, v3, lone]);
    // v2 <-> v3 connect; lone has no in-list neighbor.
    expect(groups.length).toBe(2);
    const byPrimary = Object.fromEntries(groups.map(g => [g.primary.id, g.previous.map(c => c.id)]));
    expect(byPrimary['v3']).toEqual(['v2']);
    expect(byPrimary['lone']).toEqual([]);
  });
});
