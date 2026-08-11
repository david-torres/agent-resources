// The whole of the party summary arithmetic. This module is pure on purpose:
// routes/party.js and routes/lfg.js both call it, and neither should own a
// copy of the reduce that routes/lfg.js used to carry inline.
const { test, expect } = require('bun:test');
const { statList } = require('./enclave-consts');
const { summarizeParty } = require('./party-stats');

// Build a character row with every stat 0, then apply the overrides. Keeps
// each test's intent to the stats it actually cares about.
const member = (name, stats = {}) => ({
  id: `id-${name}`,
  name,
  is_public: true,
  is_deceased: false,
  ...Object.fromEntries(statList.map(stat => [stat, 0])),
  ...stats
});

test('an empty party totals zero everywhere and is all gaps', () => {
  const summary = summarizeParty([]);
  expect(summary.memberCount).toBe(0);
  expect(Object.keys(summary.totals).sort()).toEqual([...statList].sort());
  expect(Object.values(summary.totals).every(total => total === 0)).toBe(true);
  expect(summary.gaps).toEqual(statList);
  expect(summary.strongest).toEqual([]);
  expect(summary.weakest).toEqual([]);
  expect(summary.breakdown).toEqual([]);
});

test('a single member totals that member', () => {
  const summary = summarizeParty([member('Ash', { might: 4, luck: 2 })]);
  expect(summary.totals.might).toBe(4);
  expect(summary.totals.luck).toBe(2);
  expect(summary.memberCount).toBe(1);
});

test('multiple members sum per stat', () => {
  const summary = summarizeParty([
    member('Ash', { might: 4, luck: 2 }),
    member('Bee', { might: 3, luck: 1 })
  ]);
  expect(summary.totals.might).toBe(7);
  expect(summary.totals.luck).toBe(3);
});

test('missing or null stat values count as zero rather than NaN', () => {
  // Not hypothetical: a select that omits a column, or a nullable column,
  // yields undefined/null here. NaN would poison the total and every
  // ranking derived from it.
  const partial = { id: 'x', name: 'Partial', is_public: true, might: 3, luck: null };
  const summary = summarizeParty([partial]);
  expect(summary.totals.might).toBe(3);
  expect(summary.totals.luck).toBe(0);
  expect(Number.isNaN(summary.totals.vitality)).toBe(false);
  expect(summary.totals.vitality).toBe(0);
});

test('gaps are exactly the zero-total stats', () => {
  const summary = summarizeParty([member('Ash', { might: 2, luck: 1 })]);
  expect(summary.gaps).not.toContain('might');
  expect(summary.gaps).not.toContain('luck');
  expect(summary.gaps).toContain('arcane');
  expect(summary.gaps.length).toBe(statList.length - 2);
});

test('strongest lists the top three by total, highest first', () => {
  const summary = summarizeParty([
    member('Ash', { might: 9, vigor: 7, skill: 5, luck: 1 })
  ]);
  expect(summary.strongest).toEqual(['might', 'vigor', 'skill']);
});

test('weakest lists the lowest non-gap stats, lowest first', () => {
  const summary = summarizeParty([
    member('Ash', { might: 9, vigor: 7, skill: 5, luck: 1, spirit: 2, will: 3 })
  ]);
  // arcane and the rest are 0, so they are gaps and must not appear here.
  expect(summary.weakest).toEqual(['luck', 'spirit', 'will']);
  summary.weakest.forEach(stat => expect(summary.gaps).not.toContain(stat));
});

test('ties break by statList order so the output is deterministic', () => {
  // vitality, might, resilience all total 3. statList order decides.
  const summary = summarizeParty([
    member('Ash', { vitality: 3, might: 3, resilience: 3, spirit: 1 })
  ]);
  expect(summary.strongest).toEqual(['vitality', 'might', 'resilience']);
});

test('fewer than three non-gap stats yields a shorter list, not padding', () => {
  const summary = summarizeParty([member('Ash', { might: 2, luck: 1 })]);
  expect(summary.strongest).toEqual(['might', 'luck']);
  expect(summary.weakest).toEqual(['luck', 'might']);
});

test('breakdown carries one entry per member, in the order given', () => {
  const summary = summarizeParty([
    member('Ash', { might: 4 }),
    member('Bee', { might: 3 })
  ]);
  expect(summary.breakdown.map(row => row.name)).toEqual(['Ash', 'Bee']);
  expect(summary.breakdown[0].stats.might).toBe(4);
  expect(summary.breakdown[0].id).toBe('id-Ash');
  expect(summary.breakdown[0].is_public).toBe(true);
});
