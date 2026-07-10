/**
 * Application boundary for character writes. The adapter deliberately owns
 * storage details; callers only receive the established `{ data, error }`
 * result contract.
 */
class CharacterService {
  constructor(adapter) {
    if (!adapter || typeof adapter.createCharacter !== 'function' || typeof adapter.updateCharacter !== 'function') {
      throw new TypeError('CharacterService requires createCharacter and updateCharacter adapter methods');
    }
    this.adapter = adapter;
  }

  createCharacter(input, actor) {
    return this.adapter.createCharacter(input, actor);
  }

  updateCharacter(id, input, actor) {
    return this.adapter.updateCharacter(id, input, actor);
  }
}

module.exports = { CharacterService };
