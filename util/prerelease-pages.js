// A record hand-added to the artifact after extraction carries no page_range,
// so it cannot be located in the PDF and cannot be verified against it. Both
// helpers skip such a record rather than letting it abort the whole run.
const ranges = (rows) => (Array.isArray(rows) ? rows : [])
  .map((row) => row && row.page_range)
  .filter((range) => Array.isArray(range) && range.length === 2);

const coveredPages = (rows) => {
  const covered = new Set();
  for (const [first, last] of ranges(rows)) {
    for (let page = first; page <= last; page += 1) covered.add(page);
  }
  return covered;
};

const maxCoveredPage = (rows) => ranges(rows)
  .reduce((highest, [, last]) => Math.max(highest, last), 0);

module.exports = { coveredPages, maxCoveredPage };
