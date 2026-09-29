// Which generation of the character rules -- Advent 'v1' or 'v2' -- a
// character is built under. A class's rules_version answers it for an Advent
// character. Aspirant V1 builds on Advent v2, and a character on the Aspirant
// rules may use Aspirant or Advent classes alike, so its rules come from its
// mode, not its class. Aspiring characters are Aspirant-book characters too.
const V2_MODES = new Set(['aspirant', 'aspiring']);

const characterRulesVersion = ({ classRulesVersion, creatorMode } = {}) =>
  (V2_MODES.has(creatorMode) || classRulesVersion === 'v2' ? 'v2' : 'v1');

module.exports = { characterRulesVersion };
