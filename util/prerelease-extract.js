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

module.exports = { parseStatLine };
