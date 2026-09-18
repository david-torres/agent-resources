// A `classes` stub that honours the filters AND the projection. The projection
// matters as much as the filter for family-scoped queries: util/class-family.js
// compares both family axes strictly, so a query that omits content_format
// hands it undefined on one side and every edge fails closed. A stub that
// returned whole rows whatever was selected would hide that.
const classesStub = (rows) => {
  const project = (row, columns) => (columns === '*' ? { ...row } : Object.fromEntries(
    columns.split(',').map(c => c.trim()).map(c => [c, row[c]])
  ));
  const matchesOr = (row, expression) => expression.split(',').some((clause) => {
    const [column, , value] = clause.split('.');
    return String(row[column]) === value;
  });

  const builder = (columns, predicates) => {
    const result = () => ({
      data: rows.filter(row => predicates.every(p => p(row))).map(row => project(row, columns)),
      error: null
    });
    const chain = {
      select: (c) => builder(c, predicates),
      eq: (column, value) => builder(columns, [...predicates, row => row[column] === value]),
      or: (expression) => builder(columns, [...predicates, row => matchesOr(row, expression)]),
      // Chainable, because callers stack two `.order()`s before awaiting.
      order: () => chain,
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
    };
    return chain;
  };

  return { from: () => builder('*', []) };
};

module.exports = { classesStub };
