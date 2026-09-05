const { test, expect } = require('bun:test');
const { normalizeClassInput } = require('./input');
const { ClassService } = require('./service');
const { AuthorizationError } = require('../../util/errors');

const CLASS_ROW = { id: 'class-1', created_by: 'owner-1' };

const makeRepo = ({ classRow = CLASS_ROW, itemOwnership = [] } = {}) => {
  const calls = [];
  return {
    calls,
    fetchClassItemOwnership: async () => { calls.push(['fetchClassItemOwnership']); return itemOwnership; },
    insertClass: async data => { calls.push(['insertClass', data]); return { data, error: null }; },
    updateClass: async (id, data) => { calls.push(['updateClass', id, data]); return { data, error: null }; },
    deleteClass: async id => { calls.push(['deleteClass', id]); return { error: null }; },
    saveClassPdfMetadata: async (id, data) => { calls.push(['saveClassPdfMetadata', id, data]); return { data, error: null }; },
    insertUnlockCodes: async rows => { calls.push(['insertUnlockCodes', rows]); return { data: rows, error: null }; },
    fetchClassByIdAdmin: async id => { calls.push(['fetchClassByIdAdmin', id]); return { data: classRow, error: null }; }
  };
};

const OWNER_ACTOR = { profileId: 'owner-1', role: 'user' };
const OTHER_ACTOR = { profileId: 'someone-else', role: 'user' };
const ADMIN_ACTOR = { profileId: 'admin-1', role: 'admin' };
const SYSTEM_ACTOR = { role: 'system' };

const GUNSLINGER_ROW = {
  id: 'gs-v1',
  name: 'Gunslinger',
  is_public: true,
  base_class_id: null,
  rules_edition: 'advent',
  gear: [{ name: 'Revolver' }],
  abilities: []
};

const PCC_ROW = {
  id: 'pcc-1',
  name: 'Seamus McGlide — Gunslinger (PCC)',
  is_public: true,
  base_class_id: null,
  rules_edition: 'advent',
  gear: [{ name: 'Revolver' }, { name: 'Spyglass' }],
  abilities: []
};

test('normalizes a class input copy without mutating the submitted payload', () => {
  const input = { name: 'Tinker', image_url: 'javascript:bad()' };
  expect(normalizeClassInput(input)).toEqual({ name: 'Tinker', image_url: null });
  expect(input).toEqual({ name: 'Tinker', image_url: 'javascript:bad()' });
});

test('constructor requires every repository method', () => {
  expect(() => new ClassService({})).toThrow(TypeError);
});

test('constructor requires the repository to expose fetchClassItemOwnership', () => {
  const { fetchClassItemOwnership, ...repoWithoutOwnership } = makeRepo();
  expect(() => new ClassService(repoWithoutOwnership)).toThrow(TypeError);
});

test('createClass derives created_by from the actor, ignoring any input value', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await service.createClass(OWNER_ACTOR, { name: 'Tinker', created_by: 'forged-id' });
  expect(repo.calls).toEqual([['insertClass', { name: 'Tinker', created_by: 'owner-1' }]]);
});

test('createClass respects an explicit created_by from the system actor', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await service.createClass(SYSTEM_ACTOR, { name: 'Tinker', created_by: 'admin-profile' });
  expect(repo.calls).toEqual([['insertClass', { name: 'Tinker', created_by: 'admin-profile' }]]);
});

test('the class owner may update their class; the write reaches the repository', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await service.updateClass(OWNER_ACTOR, 'class-1', { image_url: 'https://example.test/image.png' });
  expect(repo.calls).toEqual([
    ['fetchClassByIdAdmin', 'class-1'],
    ['updateClass', 'class-1', { image_url: 'https://example.test/image.png' }]
  ]);
});

test('an admin may update a class they do not own', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await service.updateClass(ADMIN_ACTOR, 'class-1', { name: 'New name' });
  expect(repo.calls.map(c => c[0])).toEqual(['fetchClassByIdAdmin', 'updateClass']);
});

test('a non-owner non-admin updating a class throws AuthorizationError, never reaching the repository write', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await expect(service.updateClass(OTHER_ACTOR, 'class-1', { name: 'nope' })).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([['fetchClassByIdAdmin', 'class-1']]);
});

test('updating a class that does not exist throws AuthorizationError (not_found)', async () => {
  const repo = makeRepo({ classRow: null });
  const service = new ClassService(repo);
  await expect(service.updateClass(OWNER_ACTOR, 'missing', {})).rejects.toThrow(AuthorizationError);
});

test('the class owner may delete their class', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  const result = await service.deleteClass(OWNER_ACTOR, 'class-1');
  expect(result).toEqual({ error: null });
  expect(repo.calls).toEqual([['fetchClassByIdAdmin', 'class-1'], ['deleteClass', 'class-1']]);
});

test('a non-owner non-admin deleting a class throws AuthorizationError', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await expect(service.deleteClass(OTHER_ACTOR, 'class-1')).rejects.toThrow(AuthorizationError);
});

test('class service rejects PDF metadata without a class id', async () => {
  const service = new ClassService(makeRepo());
  const result = await service.savePdfMetadata(OWNER_ACTOR, null, 'classes/tinker.pdf');
  expect(result.error.message).toBe('Missing class id');
});

test('the class owner may save PDF metadata for their class', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await service.savePdfMetadata(OWNER_ACTOR, 'class-1', 'classes/tinker.pdf');
  expect(repo.calls[1][0]).toBe('saveClassPdfMetadata');
  expect(repo.calls[1][2].pdf_storage_path).toBe('classes/tinker.pdf');
});

test('a non-owner saving PDF metadata throws AuthorizationError', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await expect(service.savePdfMetadata(OTHER_ACTOR, 'class-1', 'classes/tinker.pdf')).rejects.toThrow(AuthorizationError);
});

test('an admin may mint unlock codes', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await service.mintUnlockCodes(ADMIN_ACTOR, [{ code: 'abc' }]);
  expect(repo.calls).toEqual([['insertUnlockCodes', [{ code: 'abc' }]]]);
});

test('the system actor may mint unlock codes', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await service.mintUnlockCodes(SYSTEM_ACTOR, [{ code: 'abc' }]);
  expect(repo.calls).toEqual([['insertUnlockCodes', [{ code: 'abc' }]]]);
});

test('a non-admin minting unlock codes throws AuthorizationError, never reaching the repository', async () => {
  const repo = makeRepo();
  const service = new ClassService(repo);
  await expect(service.mintUnlockCodes(OWNER_ACTOR, [{ code: 'abc' }])).rejects.toThrow(AuthorizationError);
  expect(repo.calls).toEqual([]);
});

test('creating a public class whose gear name belongs to another family returns an error, never reaching the insert', async () => {
  const repo = makeRepo({ itemOwnership: [GUNSLINGER_ROW] });
  const service = new ClassService(repo);

  const result = await service.createClass(OWNER_ACTOR, {
    name: 'Seamus McGlide — Gunslinger (PCC)',
    is_public: true,
    base_class_id: null,
    rules_edition: 'advent',
    gear: [{ name: 'Revolver' }],
    abilities: []
  });

  expect(repo.calls.map(c => c[0])).toEqual(['fetchClassItemOwnership']);
  expect(result.data).toBeNull();
  expect(result.error.message).toContain('Revolver');
  expect(result.error.message).toContain('Gunslinger');
});

test('updating a public class onto another family\'s gear name returns an error, never reaching the update', async () => {
  const repo = makeRepo({ itemOwnership: [GUNSLINGER_ROW] });
  const service = new ClassService(repo);

  const result = await service.updateClass(OWNER_ACTOR, 'class-1', {
    is_public: true,
    base_class_id: null,
    rules_edition: 'advent',
    gear: [{ name: 'Revolver' }],
    abilities: []
  });

  expect(repo.calls.map(c => c[0])).toEqual(['fetchClassByIdAdmin', 'fetchClassItemOwnership']);
  expect(result.data).toBeNull();
  expect(result.error.message).toContain('Revolver');
  expect(result.error.message).toContain('Gunslinger');
});

test('updating a public class that keeps a gear name it already stores reaches the update', async () => {
  const repo = makeRepo({
    classRow: { id: 'class-1', created_by: 'owner-1', gear: [{ name: 'Revolver' }], abilities: [] },
    itemOwnership: [PCC_ROW]
  });
  const service = new ClassService(repo);

  const result = await service.updateClass(OWNER_ACTOR, 'class-1', {
    is_public: true,
    base_class_id: null,
    rules_edition: 'advent',
    gear: [{ name: 'Revolver' }],
    abilities: []
  });

  expect(repo.calls.map(c => c[0])).toEqual(['fetchClassByIdAdmin', 'fetchClassItemOwnership', 'updateClass']);
  expect(result.error).toBeNull();
});

test('updating a public class names the newly added gear name, not the one it already stores', async () => {
  const repo = makeRepo({
    classRow: { id: 'class-1', created_by: 'owner-1', gear: [{ name: 'Revolver' }], abilities: [] },
    itemOwnership: [PCC_ROW]
  });
  const service = new ClassService(repo);

  const result = await service.updateClass(OWNER_ACTOR, 'class-1', {
    is_public: true,
    base_class_id: null,
    rules_edition: 'advent',
    gear: [{ name: 'Revolver' }, { name: 'Spyglass' }],
    abilities: []
  });

  expect(repo.calls.map(c => c[0])).toEqual(['fetchClassByIdAdmin', 'fetchClassItemOwnership']);
  expect(result.data).toBeNull();
  expect(result.error.message).toContain('Spyglass');
  expect(result.error.message).not.toContain('Revolver');
});

test('creating a public class grandfathers nothing, rejecting a colliding gear name stored on another row', async () => {
  const repo = makeRepo({
    classRow: { id: 'class-1', created_by: 'owner-1', gear: [{ name: 'Revolver' }], abilities: [] },
    itemOwnership: [PCC_ROW]
  });
  const service = new ClassService(repo);

  const result = await service.createClass(OWNER_ACTOR, {
    name: 'Fresh Gunslinger',
    is_public: true,
    base_class_id: null,
    rules_edition: 'advent',
    gear: [{ name: 'Revolver' }],
    abilities: []
  });

  expect(repo.calls.map(c => c[0])).toEqual(['fetchClassItemOwnership']);
  expect(result.data).toBeNull();
  expect(result.error.message).toContain('Revolver');
});

test('creating a v2 fork that repeats its own family\'s gear name reaches the insert', async () => {
  const repo = makeRepo({ itemOwnership: [GUNSLINGER_ROW] });
  const service = new ClassService(repo);

  const result = await service.createClass(OWNER_ACTOR, {
    name: 'Gunslinger v2',
    is_public: true,
    base_class_id: 'gs-v1',
    rules_edition: 'advent',
    gear: [{ name: 'Revolver' }],
    abilities: []
  });

  expect(repo.calls.map(c => c[0])).toEqual(['fetchClassItemOwnership', 'insertClass']);
  expect(result.error).toBeNull();
});
