// Turns a member's tracker state and sources into what the table-tracker
// partial renders. Pure; every rule number comes from util/exertion.js.
const { budgetFor, THRESHOLDS } = require('../../util/exertion');

const POOLS = [['stamina', 'Stamina', 'vigor'], ['essence', 'Essence', 'will']];

const remainingFor = (uses, used) => {
  if (!uses) return null;
  if (uses.max !== undefined) return Math.max(0, uses.max - used);
  return `about ${Math.max(0, uses.approx - used)}`;
};

const buildTrackerView = ({ state, version, sources, stats = {}, canTrack, isConduit, actionUrl }) => ({
  version,
  canTrack,
  isConduit,
  actionUrl,
  pools: POOLS.map(([name, label, stat]) => {
    const { budget, approximate } = budgetFor(stats[stat]);
    const { threshold, spent } = state[name];
    return {
      name,
      label,
      threshold,
      thresholdLabel: THRESHOLDS[threshold],
      spent,
      budget,
      approximate,
      segments: Array.from({ length: budget }, (_, i) => i < spent),
      thresholdOptions: THRESHOLDS.map((value, index) => ({ value: index, label: value, selected: index === threshold })),
      spendAmounts: ['Low', 'Mid', 'High'],
      restoreAmounts: ['Low', 'Mid', 'High', 'Threshold'],
      actionUrl,
      canTrack,
    };
  }),
  sources: sources.map((source) => {
    const used = state.useCounts[source.key] || 0;
    const levels = [...new Set([...source.essenceOptions, ...source.staminaOptions])];
    return {
      key: source.key,
      name: source.name,
      kind: source.kind,
      used,
      heavyUse: used >= 3,
      cooldownOn: Boolean(state.cooldowns[source.key]),
      hasCooldown: source.hasCooldown,
      uses: source.uses,
      remaining: remainingFor(source.uses, used),
      printed: source.printed,
      imposed: (state.imposedLimiters[source.key] || []).map((limiter, index) => ({ ...limiter, index })),
      levels,
      needsLevel: source.essenceOptions.length > 1 || source.staminaOptions.length > 1,
      actionUrl,
      canTrack,
      isConduit,
    };
  }),
});

module.exports = { buildTrackerView };
