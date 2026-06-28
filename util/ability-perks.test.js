const { test, expect, describe } = require('bun:test');
const { remapPerkAbilityIds, remapPerkAbilityIdsByName } = require('./ability-perks');

const ability = (id, name, class_id = 'class-1') => ({ id, name, class_id });
const perk = (class_ability_id, text, position, compounds_with = null) => ({
  class_ability_id,
  text,
  position,
  compounds_with
});

describe('remapPerkAbilityIds', () => {
  test('remaps perk ability ids from old rows to new rows by name + class_id (the FK bug scenario)', () => {
    const previous = [ability('old-a1', 'Strike'), ability('old-a2', 'Guard')];
    const next = [ability('new-a1', 'Strike'), ability('new-a2', 'Guard')];
    const perks = [perk('old-a1', 'Deal +1 damage', 0), perk('old-a2', 'Block first hit', 1)];

    const out = remapPerkAbilityIds(perks, previous, next);

    expect(out).toEqual([
      perk('new-a1', 'Deal +1 damage', 0),
      perk('new-a2', 'Block first hit', 1)
    ]);
  });

  test('preserves text, position, and compounds_with unchanged while remapping the id', () => {
    const previous = [ability('old-a1', 'Strike')];
    const next = [ability('new-a1', 'Strike')];
    const perks = [perk('old-a1', 'Compound perk', 3, 'position-2')];

    const out = remapPerkAbilityIds(perks, previous, next);

    expect(out).toEqual([perk('new-a1', 'Compound perk', 3, 'position-2')]);
  });

  test('drops perks whose old ability has no matching new row (ability removed in this submission)', () => {
    const previous = [ability('old-a1', 'Strike'), ability('old-a2', 'Guard')];
    const next = [ability('new-a1', 'Strike')]; // Guard removed
    const perks = [perk('old-a1', 'kept', 0), perk('old-a2', 'dropped', 1)];

    const out = remapPerkAbilityIds(perks, previous, next);

    expect(out).toEqual([perk('new-a1', 'kept', 0)]);
  });

  test('keeps perks already referencing a new row id unchanged', () => {
    const previous = [ability('old-a1', 'Strike')];
    const next = [ability('new-a1', 'Strike')];
    const perks = [perk('new-a1', 'already new', 0)];

    const out = remapPerkAbilityIds(perks, previous, next);

    expect(out).toEqual([perk('new-a1', 'already new', 0)]);
  });

  test('drops perks matching neither old nor new rows', () => {
    const previous = [ability('old-a1', 'Strike')];
    const next = [ability('new-a1', 'Strike')];
    const perks = [perk('ghost-id', 'orphan', 0)];

    const out = remapPerkAbilityIds(perks, previous, next);

    expect(out).toEqual([]);
  });

  test('maps multiple perks on the same ability to the same new id', () => {
    const previous = [ability('old-a1', 'Strike')];
    const next = [ability('new-a1', 'Strike')];
    const perks = [
      perk('old-a1', 'first', 0),
      perk('old-a1', 'second', 1)
    ];

    const out = remapPerkAbilityIds(perks, previous, next);

    expect(out).toEqual([
      perk('new-a1', 'first', 0),
      perk('new-a1', 'second', 1)
    ]);
  });

  test('returns [] for non-array perks input', () => {
    expect(remapPerkAbilityIds(null, [], [])).toEqual([]);
    expect(remapPerkAbilityIds(undefined, [], [])).toEqual([]);
    expect(remapPerkAbilityIds({}, [], [])).toEqual([]);
    expect(remapPerkAbilityIds('nope', [], [])).toEqual([]);
  });

  test('treats missing/empty new abilities gracefully by dropping all old-id perks', () => {
    const previous = [ability('old-a1', 'Strike')];
    const perks = [perk('old-a1', 'no new home', 0)];

    expect(remapPerkAbilityIds(perks, previous, [])).toEqual([]);
    expect(remapPerkAbilityIds(perks, previous, undefined)).toEqual([]);
    expect(remapPerkAbilityIds(perks, undefined, undefined)).toEqual([]);
  });

  test('does not mutate the input arrays', () => {
    const previous = [ability('old-a1', 'Strike')];
    const next = [ability('new-a1', 'Strike')];
    const perks = [perk('old-a1', 'orig', 0)];
    const perksSnapshot = JSON.parse(JSON.stringify(perks));
    const previousSnapshot = JSON.parse(JSON.stringify(previous));
    const nextSnapshot = JSON.parse(JSON.stringify(next));

    remapPerkAbilityIds(perks, previous, next);

    expect(perks).toEqual(perksSnapshot);
    expect(previous).toEqual(previousSnapshot);
    expect(next).toEqual(nextSnapshot);
  });
});

describe('remapPerkAbilityIdsByName', () => {
  test('maps a perk whose class_ability_id is an ability NAME to the new row id', () => {
    const next = [ability('row-1', 'Strike'), ability('row-2', 'Guard')];
    const perks = [perk('Strike', 'Deal +1 damage', 0), perk('Guard', 'Block first hit', 1)];

    expect(remapPerkAbilityIdsByName(perks, next)).toEqual([
      perk('row-1', 'Deal +1 damage', 0),
      perk('row-2', 'Block first hit', 1)
    ]);
  });

  test('keeps a perk that already references a valid new row id', () => {
    const next = [ability('row-1', 'Strike')];
    const perks = [perk('row-1', 'Already linked', 0)];

    expect(remapPerkAbilityIdsByName(perks, next)).toEqual([perk('row-1', 'Already linked', 0)]);
  });

  test('drops perks whose ability name has no matching row', () => {
    const next = [ability('row-1', 'Strike')];
    const perks = [perk('Strike', 'kept', 0), perk('Ghost', 'dropped', 1)];

    expect(remapPerkAbilityIdsByName(perks, next)).toEqual([perk('row-1', 'kept', 0)]);
  });

  test('preserves text, position, and compounds_with while remapping', () => {
    const next = [ability('row-1', 'Strike')];
    const perks = [perk('Strike', 'Compound', 3, 'position-2')];

    expect(remapPerkAbilityIdsByName(perks, next)).toEqual([
      perk('row-1', 'Compound', 3, 'position-2')
    ]);
  });

  test('treats null/undefined newAbilities as empty (drops all perks)', () => {
    const perks = [perk('Strike', 'x', 0)];
    expect(remapPerkAbilityIdsByName(perks, null)).toEqual([]);
    expect(remapPerkAbilityIdsByName(perks, undefined)).toEqual([]);
  });

  test('returns [] for non-array perks and does not mutate inputs', () => {
    expect(remapPerkAbilityIdsByName(null, [])).toEqual([]);
    const next = [ability('row-1', 'Strike')];
    const perks = [perk('Strike', 'x', 0)];
    const snapshot = JSON.parse(JSON.stringify(perks));
    remapPerkAbilityIdsByName(perks, next);
    expect(perks).toEqual(snapshot);
  });
});
