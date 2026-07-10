const { test, expect } = require('bun:test');
const { CharacterService } = require('./service');

test('CharacterService forwards create/update requests to its injected persistence adapter', async () => {
  const calls = [];
  const adapter = {
    createCharacter: async (input, actor) => {
      calls.push(['create', input, actor]);
      return { data: { id: 'new-character' }, error: null };
    },
    updateCharacter: async (id, input, actor) => {
      calls.push(['update', id, input, actor]);
      return { data: { id }, error: null };
    }
  };
  const service = new CharacterService(adapter);
  const actor = { id: 'profile-1' };

  expect(await service.createCharacter({ name: 'New' }, actor)).toMatchObject({ data: { id: 'new-character' }, error: null });
  expect(await service.updateCharacter('character-1', { name: 'Changed' }, actor)).toMatchObject({ data: { id: 'character-1' }, error: null });
  expect(calls).toEqual([
    ['create', { name: 'New' }, actor],
    ['update', 'character-1', { name: 'Changed' }, actor]
  ]);
});

test('CharacterService rejects an incomplete persistence adapter', () => {
  expect(() => new CharacterService({ createCharacter() {} })).toThrow(/requires/);
});
