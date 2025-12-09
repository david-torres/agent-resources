const z = require("zod");
const { OpenAIChatApi } = require("llm-api");
const { completion } = require("zod-gpt");
const { createMission, addCharacterToMission, updateMission } = require('../models/mission');
const { getOwnCharacters, searchPublicCharacters } = require('../models/character');

const openai = new OpenAIChatApi(
  { apiKey: process.env.OPENAI_API_KEY },
  { model: "gpt-5.1-mini" }
);

const missionSchema = z.object({
  name: z.string().describe("The mission's name or title"),
  date: z.string().nullable().optional().describe("The mission date/time in any recognizable format (e.g., '2024-01-15', 'January 15, 2024', 'last week', 'yesterday'). If not provided, use the current date."),
  outcome: z.string().nullable().optional().describe("The mission outcome, must be one of: 'success', 'failure', or 'pending'. Infer from context if the mission was completed successfully, failed, or is still in progress."),
  focus_words: z.string().nullable().optional().describe("Optional focus words or tags that describe key themes, locations, or concepts from the mission"),
  statement: z.string().nullable().optional().describe("The mission statement, objective, or briefing that describes what the mission was supposed to accomplish"),
  summary: z.string().nullable().optional().describe("A detailed summary or play log of what happened during the mission, including key events, decisions, and outcomes"),
  media_url: z.string().url().nullable().optional().describe("Optional media URL linking to recordings or streams (YouTube, Twitch, etc.) of the mission"),
  characters: z.array(z.string()).nullable().optional().describe("Array of participant character names who took part in the mission.")
});

const outcomeOptions = ['success', 'failure', 'pending'];

const normalizeName = (name = '') =>
  name
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const levenshtein = (a, b) => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
};

const coerceOutcome = (value) => {
  if (!value || typeof value !== 'string') return 'pending';
  const lowered = value.toLowerCase();
  const direct = outcomeOptions.find(opt => lowered.includes(opt));
  return direct || 'pending';
};

const coerceDate = (value) => {
  if (!value || typeof value !== 'string') {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
};

const toText = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const toUrlOrNull = (value) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.toString();
  } catch (_) {
    return null;
  }
};

const dedupe = (items = []) => {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeName(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item.trim());
  }
  return result;
};

const pickBestCharacterMatch = (targetName, candidates = []) => {
  const target = normalizeName(targetName);
  if (!target) return { match: null, ambiguous: [] };

  let best = null;
  let bestScore = Infinity;
  let ties = [];

  for (const candidate of candidates) {
    const normalized = normalizeName(candidate.name);
    if (!normalized) continue;

    let score = levenshtein(target, normalized);
    if (candidate.source === 'own') {
      score -= 0.25; // slight preference for the user's own characters
    }

    if (score < bestScore) {
      best = candidate;
      bestScore = score;
      ties = [candidate];
    } else if (score === bestScore) {
      ties.push(candidate);
    }
  }

  const threshold = Math.max(2, Math.ceil(target.length * 0.35));
  if (best === null || bestScore > threshold) {
    return { match: null, ambiguous: [] };
  }
  if (ties.length > 1) {
    return { match: null, ambiguous: ties };
  }
  return { match: best, ambiguous: [] };
};

const findCharacterMatch = async (name, ownCharactersCache) => {
  const ownCharacters = ownCharactersCache || [];
  const candidates = ownCharacters.map(c => ({ source: 'own', name: c.name, id: c.id }));

  const { data: publicCharacters } = await searchPublicCharacters(name, 5);
  if (Array.isArray(publicCharacters)) {
    for (const pc of publicCharacters) {
      if (!candidates.some(c => c.id === pc.id)) {
        candidates.push({ source: 'public', name: pc.name, id: pc.id });
      }
    }
  }

  const { match, ambiguous } = pickBestCharacterMatch(name, candidates);
  return { match, ambiguous };
};

async function processMissionImport(inputText, profile) {
  const prompt = `Parse the following mission log and try to structure the data following the provided JSON schema info.

Mission log:
${inputText}

JSON output:`;

  const result = await completion(openai, prompt, { schema: missionSchema });

  try {
    const validated = missionSchema.parse(result.data);
    const name = toText(validated.name);
    if (!name) throw new Error('Mission name is required');
    const missionData = {
      name,
      date: coerceDate(validated.date),
      outcome: coerceOutcome(validated.outcome),
      focus_words: toText(validated.focus_words),
      statement: toText(validated.statement),
      summary: toText(validated.summary) || inputText,
      media_url: toUrlOrNull(validated.media_url),
      unregistered_character_names: []
    };

    const { data: created, error } = await createMission(missionData, profile);
    if (error) throw new Error(error.message);

    const mission = Array.isArray(created) ? created[0] : created;

    // Resolve participants to known characters when possible
    const participantNames = dedupe(validated.characters || []);
    const unresolved = [];
    const addedIds = new Set();
    const { data: ownCharacters, error: ownError } = await getOwnCharacters(profile);
    const ownList = ownError ? [] : (ownCharacters || []);

    for (const name of participantNames) {
      const { match, ambiguous } = await findCharacterMatch(name, ownList);
      if (match && match.id) {
        if (!addedIds.has(match.id)) {
          const { error: addErr } = await addCharacterToMission(mission.id, match.id);
          if (addErr) {
            unresolved.push(name);
            continue;
          }
          addedIds.add(match.id);
        }
      } else {
        unresolved.push(name);
        if (ambiguous.length > 1) {
          // Include the name once; UI can later surface ambiguity if desired
          continue;
        }
      }
    }

    if (unresolved.length > 0) {
      const unregisteredNames = dedupe(unresolved);
      const { error: updateError } = await updateMission(mission.id, { unregistered_character_names: unregisteredNames }, profile);
      if (!updateError) {
        mission.unregistered_character_names = unregisteredNames;
      }
    }

    return { mission, matchedCharacterIds: Array.from(addedIds), unresolvedNames: unresolved };
  } catch (error) {
    throw new Error(`Invalid mission data: ${error.message}`);
  }
}

module.exports = { processMissionImport };
