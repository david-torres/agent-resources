const { test, expect, describe } = require('bun:test');
const { groupRulesVersions } = require('./library-list-grouping');

// Minimal rules_pdf row shape used by the grouping logic.
const pdf = (id, { title = 'Advent', edition = 'v1', created_at = '2026-01-01T00:00:00Z' } = {}) => ({
  id,
  title,
  edition,
  created_at
});

describe('groupRulesVersions', () => {
  test('a single document becomes one group with empty previous', () => {
    const groups = groupRulesVersions([pdf('a')]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('a');
    expect(groups[0].previous).toEqual([]);
  });

  test('two editions of one title collapse to the highest edition', () => {
    const v1 = pdf('v1', { edition: 'v1' });
    const v2 = pdf('v2', { edition: 'v2' });
    const groups = groupRulesVersions([v2, v1]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('v2');
    expect(groups[0].previous.map(r => r.id)).toEqual(['v1']);
  });

  test('distinct titles stay as separate groups', () => {
    const a = pdf('a', { title: 'Advent' });
    const b = pdf('b', { title: 'Aspirant' });
    const groups = groupRulesVersions([a, b]);
    expect(groups.length).toBe(2);
    for (const g of groups) expect(g.previous).toEqual([]);
  });

  test('primary is picked by edition string regardless of input order', () => {
    const v1 = pdf('v1', { edition: 'v1' });
    const v2 = pdf('v2', { edition: 'v2' });
    const v3 = pdf('v3', { edition: 'v3' });
    const groups = groupRulesVersions([v1, v3, v2]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('v3');
    expect(groups[0].previous.map(r => r.id)).toEqual(['v2', 'v1']); // edition desc
  });

  test('equal editions tie-break by newest created_at', () => {
    const older = pdf('older', { edition: 'v1', created_at: '2026-01-01T00:00:00Z' });
    const newer = pdf('newer', { edition: 'v1', created_at: '2026-02-01T00:00:00Z' });
    const groups = groupRulesVersions([older, newer]);
    expect(groups.length).toBe(1);
    expect(groups[0].primary.id).toBe('newer');
    expect(groups[0].previous.map(r => r.id)).toEqual(['older']);
  });

  test('group order follows first appearance of each title in the input', () => {
    const b1 = pdf('b1', { title: 'Bestiary' });
    const a1 = pdf('a1', { title: 'Advent' });
    const b2 = pdf('b2', { title: 'Bestiary', edition: 'v2' });
    const groups = groupRulesVersions([b1, a1, b2]);
    expect(groups.map(g => g.primary.title)).toEqual(['Bestiary', 'Advent']);
  });
});
