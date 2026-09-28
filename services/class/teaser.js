const { buildExcerpt } = require('../home/excerpt');

const buildClassTeaser = (overview, designer) => {
  if (typeof overview !== 'string' || !overview.trim()) return null;

  let line = null;
  for (const rawLine of overview.split('\n')) {
    const stripped = buildExcerpt(rawLine, Infinity);
    if (!stripped) continue;
    if (/^class stats:/i.test(stripped)) continue;
    line = stripped.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? stripped;
    break;
  }

  if (!line) return null;

  if (typeof designer === 'string' && designer.trim()) {
    return `${line} Design by ${designer.trim()}`;
  }

  return line;
};

module.exports = { buildClassTeaser };
