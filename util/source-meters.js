// Reads the printed meters on an ability or Signature (class JSON, merged onto
// the character's rows by services/character/repository.js) into what a live
// tracker needs: which cost levels a use can take, whether it has a Cooldown,
// and how many Finite Uses it has.
const LEVELS = ['Low', 'Mid', 'High'];
const USES_APPROX = { Low: 10, Mid: 25, High: 50 };

const MECHANICS = [
  ['pitch', 'Pitch'], ['inference', 'Inference'], ['deduction', 'Deduction'], ['intuition', 'Intuition'],
  ['happenstance', 'Happenstance'], ['manifestation', 'Manifestation'], ['heartening', 'Heartening'],
  ['defiance', 'Defiance'], ['turning-point', 'Turning Point'], ['energywork', 'Energywork'],
];

const PRINTED_LABELS = new Set(['Essence Cost', 'Stamina Cost', 'Cooldown', 'Uses']);

// Ranges print with an en dash; a trailing "+" means "or a little more" and
// does not change which levels a player chooses between.
const levelsIn = (value) => {
  const [from, to] = String(value ?? '').replace(/\+/g, '').trim().split(/\s*[–-]\s*/);
  const start = LEVELS.indexOf(from);
  const end = LEVELS.indexOf(to ?? from);
  if (start < 0 || end < 0) return [];
  return LEVELS.slice(Math.min(start, end), Math.max(start, end) + 1);
};

const parseUses = (value) => {
  const label = String(value ?? '').trim();
  const counted = label.match(/^(\d+)(?:\s*[–-]\s*(\d+))?x$/);
  if (counted) return { label, max: Number(counted[2] ?? counted[1]) };
  if (Object.hasOwn(USES_APPROX, label)) return { label, approx: USES_APPROX[label] };
  return null;
};

const parseMeters = (meters = []) => {
  const byLabel = new Map((Array.isArray(meters) ? meters : []).map((m) => [m.label, m.value]));
  return {
    essenceOptions: levelsIn(byLabel.get('Essence Cost')),
    staminaOptions: levelsIn(byLabel.get('Stamina Cost')),
    hasCooldown: byLabel.has('Cooldown'),
    uses: byLabel.has('Uses') ? parseUses(byLabel.get('Uses')) : null,
    printed: (Array.isArray(meters) ? meters : []).filter((m) => PRINTED_LABELS.has(m.label)),
  };
};

const sourcesFor = (character) => [
  ...(character?.abilities || []).map((a) => ({ key: `ability:${a.id}`, name: a.name, kind: 'Ability', ...parseMeters(a.meters) })),
  ...(character?.gear || []).map((g) => ({ key: `gear:${g.id}`, name: g.name, kind: 'Signature', ...parseMeters(g.meters) })),
  ...MECHANICS.map(([slug, name]) => ({ key: `mechanic:${slug}`, name, kind: 'Mechanic', ...parseMeters([]) })),
];

module.exports = { levelsIn, parseUses, parseMeters, sourcesFor, MECHANICS, LEVELS };
