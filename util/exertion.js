// Stamina and Essence arithmetic and every tracker action (spec §3). Pure: the
// state in, the next state out. Every number here is the book's rule of thumb
// (Advent pp. 33–36, Aspirant p. 4), so the page always offers a manual
// override beside it.
const { LEVELS } = require('./source-meters');

const THRESHOLDS = ['Green', 'Yellow', 'Red', 'Below Red'];
const BELOW_RED = THRESHOLDS.length - 1;
const COST_UNITS = { Low: 1, Mid: 3, High: 6 };
const BUDGET_BY_PLUSES = [6, 7, 9, 12, 15, 18, 24];
const POOL_STAT = { stamina: 'vigor', essence: 'will' };
const IMPOSABLE = { 'Essence Cost': 'essence', 'Stamina Cost': 'stamina', Cooldown: null };

const budgetFor = (pluses) => {
  const p = Number.isInteger(pluses) && pluses > 0 ? pluses : 0;
  if (p < BUDGET_BY_PLUSES.length) return { budget: BUDGET_BY_PLUSES[p], approximate: false };
  const last = BUDGET_BY_PLUSES.length - 1;
  return { budget: BUDGET_BY_PLUSES[last] + 6 * (p - last), approximate: true };
};

const emptyState = () => ({
  stamina: { threshold: 0, spent: 0 },
  essence: { threshold: 0, spent: 0 },
  useCounts: {},
  cooldowns: {},
  imposedLimiters: {},
});

const stateFromRow = (row) => ({
  stamina: { threshold: row.stamina_threshold ?? 0, spent: row.stamina_spent ?? 0 },
  essence: { threshold: row.essence_threshold ?? 0, spent: row.essence_spent ?? 0 },
  useCounts: { ...(row.use_counts || {}) },
  cooldowns: { ...(row.cooldowns || {}) },
  imposedLimiters: structuredClone(row.imposed_limiters || {}),
});

const stateToColumns = (state) => ({
  stamina_threshold: state.stamina.threshold,
  stamina_spent: state.stamina.spent,
  essence_threshold: state.essence.threshold,
  essence_spent: state.essence.spent,
  use_counts: state.useCounts,
  cooldowns: state.cooldowns,
  imposed_limiters: state.imposedLimiters,
});

const snapshotOf = (state) => structuredClone(stateToColumns(state));

const spendUnits = (pool, units, budget) => {
  let { threshold, spent } = pool;
  if (threshold >= BELOW_RED) return { threshold: BELOW_RED, spent: 0 };
  spent += units;
  while (spent >= budget && threshold < BELOW_RED) {
    spent -= budget;
    threshold += 1;
  }
  return threshold >= BELOW_RED ? { threshold: BELOW_RED, spent: 0 } : { threshold, spent };
};

const restoreUnits = (pool, units, budget) => {
  let { threshold, spent } = pool;
  spent -= units;
  while (spent < 0 && threshold > 0) {
    threshold -= 1;
    spent += budget;
  }
  return { threshold, spent: Math.max(0, spent) };
};

const levelList = (options) => (options.length === 2 ? options.join(' or ') : `${options.slice(0, -1).join(', ')} or ${options[options.length - 1]}`);

// The level a use spends at: the printed cost's only level, or the one the
// player chose inside a range. Returns { units } or { error }.
const costFor = (options, level) => {
  if (!options.length) return { units: 0 };
  if (options.length === 1) return { units: COST_UNITS[options[0]] };
  if (!options.includes(level)) return { error: `Choose ${levelList(options)} for this cost.` };
  return { units: COST_UNITS[level] };
};

const applyAction = (current, action = {}, { stats = {}, sources = [] } = {}) => {
  const state = structuredClone(current);
  const budgets = {
    stamina: budgetFor(stats[POOL_STAT.stamina]).budget,
    essence: budgetFor(stats[POOL_STAT.essence]).budget,
  };
  const sourceFor = (key) => sources.find((s) => s.key === key);
  const needPool = () => (POOL_STAT[action.pool] ? null : 'Unknown pool.');

  switch (action.type) {
    case 'spend':
    case 'restore': {
      const poolError = needPool();
      if (poolError) return { error: poolError };
      const restoringThreshold = action.type === 'restore' && action.amount === 'Threshold';
      if (!restoringThreshold && !COST_UNITS[action.amount]) return { error: 'Pick Low, Mid or High.' };
      const units = restoringThreshold ? budgets[action.pool] : COST_UNITS[action.amount];
      const move = action.type === 'spend' ? spendUnits : restoreUnits;
      state[action.pool] = move(state[action.pool], units, budgets[action.pool]);
      return { state };
    }
    case 'set': {
      const poolError = needPool();
      if (poolError) return { error: poolError };
      const threshold = Number(action.threshold);
      const spent = Number(action.spent ?? 0);
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > BELOW_RED) return { error: 'Pick a Threshold from Green to Below Red.' };
      const max = budgets[action.pool] - 1;
      if (!Number.isInteger(spent) || spent < 0 || spent > max) return { error: `Spent must be from 0 to ${max}.` };
      state[action.pool] = threshold === BELOW_RED ? { threshold, spent: 0 } : { threshold, spent };
      return { state };
    }
    case 'use': {
      const source = sourceFor(action.source);
      if (!source) return { error: 'That source is not on this sheet.' };
      const imposed = state.imposedLimiters[source.key] || [];
      for (const [optionsKey, pool, kind] of [['essenceOptions', 'essence', 'Essence Cost'], ['staminaOptions', 'stamina', 'Stamina Cost']]) {
        const printed = costFor(source[optionsKey], action.level);
        if (printed.error) return { error: printed.error };
        const extra = imposed.filter((l) => l.kind === kind).reduce((sum, l) => sum + COST_UNITS[l.rating], 0);
        if (printed.units + extra > 0) state[pool] = spendUnits(state[pool], printed.units + extra, budgets[pool]);
      }
      state.useCounts[source.key] = (state.useCounts[source.key] || 0) + 1;
      if (source.hasCooldown || imposed.some((l) => l.kind === 'Cooldown')) state.cooldowns[source.key] = true;
      return { state };
    }
    case 'toggle_cooldown': {
      const source = sourceFor(action.source);
      if (!source) return { error: 'That source is not on this sheet.' };
      state.cooldowns[source.key] = !state.cooldowns[source.key];
      return { state };
    }
    case 'impose': {
      const source = sourceFor(action.source);
      if (!source) return { error: 'That source is not on this sheet.' };
      if (!(action.kind in IMPOSABLE)) return { error: 'Pick a Limiter kind.' };
      if (!LEVELS.includes(action.rating)) return { error: 'Pick Low, Mid or High.' };
      state.imposedLimiters[source.key] = [...(state.imposedLimiters[source.key] || []), { kind: action.kind, rating: action.rating }];
      return { state };
    }
    case 'lift': {
      const list = state.imposedLimiters[action.source] || [];
      const index = Number(action.index);
      if (!Number.isInteger(index) || index < 0 || index >= list.length) return { error: 'That Limiter is already gone.' };
      list.splice(index, 1);
      if (list.length) state.imposedLimiters[action.source] = list;
      else delete state.imposedLimiters[action.source];
      return { state };
    }
    default:
      return { error: 'Unknown action.' };
  }
};

module.exports = {
  THRESHOLDS, BELOW_RED, COST_UNITS, budgetFor, emptyState, stateFromRow, stateToColumns, snapshotOf, applyAction,
};
