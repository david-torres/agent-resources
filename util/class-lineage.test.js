const { test, expect, describe } = require('bun:test');
const {
  aspirantTargetOf, lineageIdOf, lineageCatalogue, purchaseCatalogue
} = require('./class-lineage');

const row = (id, format, base, lists, createdAt) => ({
  id,
  name: lists.name || id,
  base_class_id: base,
  rules_edition: format,
  content_format: format,
  created_at: createdAt,
  gear: (lists.gear || []).map(name => ({ name })),
  abilities: (lists.abilities || []).map(name => ({ name })),
  advanced_abilities: (lists.advanced || []).map(name => ({ name }))
});

const GS_V1 = row('gs-v1', 'advent', null, {
  gear: ['Revolver', 'Duster', 'Spurs'], abilities: ['Trickshot', 'Quickdraw']
}, '2024-01-01T00:00:00Z');
const GS_V2 = row('gs-v2', 'advent', 'gs-v1', {
  gear: ['Revolver', 'Duster', 'Lasso'], abilities: ['Trickshot', 'Quickdraw'], advanced: ['Standoff']
}, '2025-01-01T00:00:00Z');
const GS_ASP = row('gs-asp', 'aspirant', 'gs-v1', {
  gear: [' revolver ', 'Bolo'], abilities: ['TRICKSHOT'], advanced: ['Standoff', 'Deadeye']
}, '2026-01-01T00:00:00Z');
const GS_ASP_2 = row('gs-asp-2', 'aspirant', 'gs-asp', {
  gear: ['Revolver', 'Bolo', 'Sling'], abilities: ['Trickshot'], advanced: ['Standoff', 'Deadeye']
}, '2026-06-01T00:00:00Z');
const WD_V1 = row('wd-v1', 'advent', null, { gear: ['Satchel'], abilities: ['Familiar Face'] }, '2024-01-01T00:00:00Z');
// Another lineage that happens to print the same names.
const SC_ASP = row('sc-asp', 'aspirant', null, { gear: ['Revolver'], abilities: ['Trickshot'] }, '2026-01-01T00:00:00Z');

const CLASSES = [GS_V1, GS_V2, GS_ASP, GS_ASP_2, WD_V1, SC_ASP];

const lists = (rows) => Object.fromEntries(rows.map(r => [r.id, {
  gear: r.gear.map(i => i.name),
  abilities: r.abilities.map(i => i.name),
  advanced: r.advanced_abilities.map(i => i.name)
}]));

describe('aspirantTargetOf', () => {
  test('every Advent version reaches the newest version of the Aspirant family', () => {
    expect(aspirantTargetOf(CLASSES, 'gs-v1').id).toBe('gs-asp-2');
    expect(aspirantTargetOf(CLASSES, 'gs-v2').id).toBe('gs-asp-2');
  });

  test('a class with no Aspirant version, or already Aspirant, has none', () => {
    expect(aspirantTargetOf(CLASSES, 'wd-v1')).toBeNull();
    expect(aspirantTargetOf(CLASSES, 'gs-asp')).toBeNull();
  });
});

describe('lineageIdOf', () => {
  test('both families of a forked class share one lineage', () => {
    const ids = ['gs-v1', 'gs-v2', 'gs-asp', 'gs-asp-2'].map(id => lineageIdOf(CLASSES, id));
    expect(new Set(ids).size).toBe(1);
  });

  test('unrelated classes are lineages of their own', () => {
    const ids = ['gs-v2', 'wd-v1', 'sc-asp'].map(id => lineageIdOf(CLASSES, id));
    expect(new Set(ids).size).toBe(3);
  });

  test('an Advent family with two Aspirant versions is not merged with either', () => {
    const second = row('gs-asp-b', 'aspirant', 'gs-v1', { gear: ['Revolver'] }, '2026-02-01T00:00:00Z');
    const classes = [...CLASSES, second];
    expect(lineageIdOf(classes, 'gs-v2')).not.toBe(lineageIdOf(classes, 'gs-asp-2'));
    expect(lineageIdOf(classes, 'gs-v2')).not.toBe(lineageIdOf(classes, 'gs-asp-b'));
  });
});

describe('lineageCatalogue', () => {
  test('with no own class, the newest Aspirant version comes first and the Advent version keeps only what it alone prints', () => {
    const rows = lineageCatalogue(CLASSES);
    expect(rows.map(r => r.id)).toEqual(['gs-v2', 'gs-asp-2', 'wd-v1', 'sc-asp']);
    expect(lists(rows)).toEqual({
      'gs-v2': { gear: ['Duster', 'Lasso'], abilities: ['Quickdraw'], advanced: [] },
      'gs-asp-2': { gear: ['Revolver', 'Bolo', 'Sling'], abilities: ['Trickshot'], advanced: ['Standoff', 'Deadeye'] },
      'wd-v1': { gear: ['Satchel'], abilities: ['Familiar Face'], advanced: [] },
      'sc-asp': { gear: ['Revolver'], abilities: ['Trickshot'], advanced: [] }
    });
    expect(new Set(rows.slice(0, 2).map(r => r.lineage_id)).size).toBe(1);
  });

  test('names that differ only by case or spacing are one name', () => {
    const rows = lineageCatalogue([GS_V1, GS_ASP]);
    expect(lists(rows)['gs-v1'].gear).toEqual(['Duster', 'Spurs']);
    expect(lists(rows)['gs-v1'].abilities).toEqual(['Quickdraw']);
  });

  test('an older own Aspirant version is kept and comes first', () => {
    const rows = lineageCatalogue(CLASSES, { ownClassId: 'gs-asp' });
    expect(rows.map(r => r.id)).toEqual(['gs-v2', 'gs-asp', 'gs-asp-2', 'wd-v1', 'sc-asp']);
    const byId = lists(rows);
    expect(byId['gs-asp']).toEqual({ gear: [' revolver ', 'Bolo'], abilities: ['TRICKSHOT'], advanced: ['Standoff', 'Deadeye'] });
    expect(byId['gs-asp-2']).toEqual({ gear: ['Sling'], abilities: [], advanced: [] });
    expect(byId['gs-v2']).toEqual({ gear: ['Duster', 'Lasso'], abilities: ['Quickdraw'], advanced: [] });
  });

  test('an own Advent class comes first, ahead of its Aspirant version', () => {
    const byId = lists(lineageCatalogue(CLASSES, { ownClassId: 'gs-v1' }));
    expect(byId['gs-v1']).toEqual({ gear: ['Revolver', 'Duster', 'Spurs'], abilities: ['Trickshot', 'Quickdraw'], advanced: [] });
    expect(byId['gs-asp-2']).toEqual({ gear: ['Bolo', 'Sling'], abilities: [], advanced: ['Standoff', 'Deadeye'] });
    expect(byId['gs-v2']).toEqual({ gear: ['Lasso'], abilities: [], advanced: [] });
  });

  test('rows keep their other fields', () => {
    const [first] = lineageCatalogue([{ ...WD_V1, teaser: 'Wanders.' }]);
    expect(first).toMatchObject({ id: 'wd-v1', name: 'wd-v1', teaser: 'Wanders.', lineage_id: 'wd-v1' });
  });
});

describe('purchaseCatalogue', () => {
  test('an advent character buys from nothing', () => {
    expect(purchaseCatalogue({ economy: 'advent', classes: CLASSES, characterClass: GS_V2 })).toEqual([]);
  });

  test('an aspiring character sees the newest version of every class, unpruned', () => {
    const rows = purchaseCatalogue({ economy: 'aspiring', classes: CLASSES, characterClass: null });
    expect(rows.map(r => r.id)).toEqual(['gs-v2', 'gs-asp-2', 'wd-v1', 'sc-asp']);
    expect(rows[0].gear.map(i => i.name)).toContain('Revolver');
  });

  test('an aspirant character whose own class is no longer served still gets it first', () => {
    const served = CLASSES.filter(c => c.id !== 'gs-asp');
    const byId = lists(purchaseCatalogue({ economy: 'aspirant', classes: served, characterClass: GS_ASP }));
    expect(byId['gs-asp'].gear).toEqual([' revolver ', 'Bolo']);
    expect(byId['gs-asp-2'].gear).toEqual(['Sling']);
  });
});
