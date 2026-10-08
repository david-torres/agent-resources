// The Stat Scaling Table (Advent pp. 35–36, Aspirant p. 4) as the lookups
// every stat tooltip reads.
const { test, expect } = require('bun:test');
const { statScaling, statScalingRow, PLUS_LABELS } = require('./stat-scaling');
const { statList } = require('./enclave-consts');

test('a plus count returns that cell of the printed table', () => {
  expect(statScaling('might', 1)).toEqual({
    stat: 'might',
    statLabel: 'Might',
    note: null,
    pluses: 1,
    label: '+',
    lines: [{ term: null, text: 'Crush an apple one-handed.' }],
  });
});

test('a two-part cell keeps its mechanic term', () => {
  expect(statScaling('will', 0).lines).toEqual([
    { term: 'Essence', text: 'Drop a Threshold after two Mid Costs.' },
    { term: 'Defiance', text: 'Skydive despite being scared to do so.' },
  ]);
});

test('six to eight pluses read the Aspirant expanded table', () => {
  expect(statScaling('might', 6).label).toBe('+++ +++');
  expect(statScaling('might', 6).lines[0].text).toBe('Stop a speeding car in its tracks.');
  expect(statScaling('will', 8).lines[0].text).toBe('Drop a Threshold after a High amount of Low Costs.');
});

test('anything outside Baseline to eight pluses has no entry', () => {
  for (const value of [9, -1, 1.5, null, undefined, '2']) {
    expect(statScaling('might', value)).toBeNull();
  }
  expect(statScaling('charisma', 1)).toBeNull();
});

test('every stat has all nine cells transcribed', () => {
  for (const stat of statList) {
    for (let pluses = 0; pluses <= 8; pluses++) {
      const entry = statScaling(stat, pluses);
      expect(entry).not.toBeNull();
      expect(entry.label).toBe(PLUS_LABELS[pluses]);
      expect(entry.lines.length).toBeGreaterThan(0);
      for (const line of entry.lines) expect(line.text.trim()).not.toBe('');
    }
  }
});

test('a row is the Advent table, Baseline through five pluses', () => {
  const row = statScalingRow('arcane');
  expect(row.map(e => e.label)).toEqual(['Baseline', '+', '++', '+++', '++++', '+++++']);
  expect(row[0].note).toBe('Without Sacrifice');
  expect(statScalingRow('charisma')).toEqual([]);
});
