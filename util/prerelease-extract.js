const { statList } = require('./enclave-consts');

const parseStatLine = (line) => {
  const spread = {};
  for (const token of String(line).split(/[,/]/)) {
    const match = token.trim().match(/^(\++)\s*([A-Za-z]+)\*?$/);
    if (!match) continue;
    const stat = match[2].toLowerCase();
    if (!statList.includes(stat)) {
      throw new Error(`Unknown stat in stat line: ${match[2]}`);
    }
    spread[stat] = match[1].length;
  }
  return spread;
};

const round1 = (value) => Math.round(value * 10) / 10;

// Bands are derived per page rather than hardcoded so a page laid out
// slightly differently still resolves correctly.
const clusterBands = (xMins, tolerance = 6) => {
  const sorted = [...xMins].sort((a, b) => a - b);
  const bands = [];
  let run = [];
  for (const x of sorted) {
    if (run.length && x - run[0] > tolerance) {
      bands.push(round1(run.reduce((a, b) => a + b, 0) / run.length));
      run = [];
    }
    run.push(x);
  }
  if (run.length) bands.push(round1(run.reduce((a, b) => a + b, 0) / run.length));
  return bands;
};

module.exports = { parseStatLine, clusterBands };
