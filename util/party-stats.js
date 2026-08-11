const { statList } = require('./enclave-consts');

// Every consumer of a party summary — routes/party.js and routes/lfg.js —
// goes through this function. It is pure so it can be tested without a
// database, and shared so the two pages cannot drift apart the way they
// would if each kept its own reduce.

const HIGHLIGHT_COUNT = 3;

// A stat column can arrive undefined (the select omitted it) or null (the
// column is nullable). Both mean "contributes nothing", not NaN.
const statValue = (character, stat) => Number(character?.[stat]) || 0;

const summarizeParty = (characters = []) => {
  const members = Array.isArray(characters) ? characters : [];

  const totals = Object.fromEntries(statList.map(stat => [
    stat,
    members.reduce((sum, member) => sum + statValue(member, stat), 0)
  ]));

  const gaps = statList.filter(stat => totals[stat] === 0);
  const covered = statList.filter(stat => totals[stat] > 0);

  // Sort a copy: statList's own order is the tiebreaker, and Array#sort is
  // stable in every engine we run on, so filtering it first and sorting by
  // total alone gives deterministic ties without a secondary comparator.
  const byTotalDesc = [...covered].sort((a, b) => totals[b] - totals[a]);
  const byTotalAsc = [...covered].sort((a, b) => totals[a] - totals[b]);

  return {
    totals,
    gaps,
    strongest: byTotalDesc.slice(0, HIGHLIGHT_COUNT),
    weakest: byTotalAsc.slice(0, HIGHLIGHT_COUNT),
    breakdown: members.map(member => ({
      id: member.id,
      name: member.name,
      is_public: member.is_public,
      is_deceased: member.is_deceased,
      stats: Object.fromEntries(statList.map(stat => [stat, statValue(member, stat)]))
    })),
    memberCount: members.length
  };
};

module.exports = { summarizeParty };
