const hasHighStakes = mission => ['difficulty', 'danger'].some(axis => mission?.[axis] != null && mission[axis] !== 'conventional');

module.exports = { hasHighStakes };
