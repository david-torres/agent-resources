// The catalogue the save path resolves item names through, and the character
// rows that hold those names.
//
// scripts/report-character-impact.mjs measures this before the pre-release
// import; scripts/load-prerelease-classes.mjs refuses to write while a name it
// removes has no remap entry. Both have to mean the same thing by "in the
// catalogue", so the projection lives here once rather than in each of them.
export const KINDS = ['abilities', 'gear'];
export const ROW_TABLE = { abilities: 'class_abilities', gear: 'class_gear' };

// The three getClasses() calls buildClassContentLookupMaps makes, kept as the
// filters themselves rather than collapsed into one predicate so that a change
// to the runtime map shows up here as a visible difference.
const CATALOGUE_FILTERS = [
  { is_public: true, is_player_created: false, rules_edition: 'advent' },
  { is_public: true, is_player_created: false, rules_edition: 'aspirant' },
  { is_public: true, is_player_created: true }
];

// `classes.is_public` defaults to false, `is_player_created` to false and
// `rules_edition` to 'advent' (baseline schema), and the loader's field
// allowlist sets none of the three -- so a class the load creates is invisible
// to the catalogue map until an owner publishes it.
const CREATED_ROW_DEFAULTS = { is_public: false, is_player_created: false, rules_edition: 'advent' };

const PAGE = 1000;

const inCatalogue = (cls) => CATALOGUE_FILTERS.some(
    (filter) => Object.entries(filter).every(([column, value]) => cls[column] === value));

export const itemNames = (cls, kind) => (Array.isArray(cls?.[kind]) ? cls[kind] : [])
    .map((item) => item?.name?.trim()).filter(Boolean);

// Mirrors buildClassContentLookupMaps' own walk: trimmed names, and only from a
// row carrying an id, because a row without one contributes no class_id.
export const catalogueNames = (classes) => {
  const names = { abilities: new Set(), gear: new Set() };
  for (const cls of classes) {
    if (!cls.id || !inCatalogue(cls)) continue;
    for (const kind of KINDS) for (const name of itemNames(cls, kind)) names[kind].add(name);
  }
  return names;
};

export const projectImport = (classes, plans) => {
  const payloadByRowId = new Map(plans.filter((plan) => plan.row).map((plan) => [plan.row.id, plan.payload]));
  const updated = classes.map((cls) => (payloadByRowId.has(cls.id) ? { ...cls, ...payloadByRowId.get(cls.id) } : cls));
  // buildClassContentLookupMaps skips a class with no id; an inserted row has
  // one immediately, so a placeholder stands in for the id it will be given.
  const created = plans.filter((plan) => !plan.row)
      .map((plan) => ({ ...CREATED_ROW_DEFAULTS, ...plan.payload, id: `pending:${plan.payload.name}` }));
  return [...updated, ...created];
};

// PostgREST caps a response at 1000 rows without saying so, and class_gear
// alone holds more than that.
export const fetchAll = async (supabase, table, columns) => {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns)
        .order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`failed to read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
};

export const fetchHeldRows = async (supabase) => {
  const held = [];
  for (const kind of KINDS) {
    for (const row of await fetchAll(supabase, ROW_TABLE[kind], 'id, name, class_id, character_id')) {
      held.push({ kind, id: row.id, name: row.name.trim(), classId: row.class_id, characterId: row.character_id });
    }
  }
  return held;
};

// Every held name the post-import catalogue cannot resolve, grouped by class and
// kind. `survivesNow` separates the names the import removes from the ones that
// were already unresolvable before it.
export const groupUnresolvable = (held, before, after) => {
  const groups = new Map();
  for (const row of held) {
    if (after[row.kind].has(row.name)) continue;
    const key = `${row.kind} ${row.classId} ${row.name}`;
    if (!groups.has(key)) {
      groups.set(key, {
        kind: row.kind,
        classId: row.classId,
        name: row.name,
        survivesNow: before[row.kind].has(row.name),
        rows: [],
        characters: new Set()
      });
    }
    const group = groups.get(key);
    group.rows.push(row.id);
    group.characters.add(row.characterId);
  }
  return [...groups.values()];
};
