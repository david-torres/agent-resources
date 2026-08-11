const { test, expect } = require('bun:test');
const { normalizeClassInput } = require('./input');
const { ClassService } = require('./service');
const { AuthorizationError } = require('../../util/errors');

const CLASS_ROW = { id: 'class-1', created_by: 'owner-1' };

const makeRepo = ({ classRow = CLASS_ROW } = {}) => {
  const calls = [];
  return {
    calls,
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

test('normalizes a class input copy without mutating the submitted payload', () => {
  const input = { name: 'Tinker', image_url: 'javascript:bad()' };
  expect(normalizeClassInput(input)).toEqual({ name: 'Tinker', image_url: null });
  expect(input).toEqual({ name: 'Tinker', image_url: 'javascript:bad()' });
});

test('constructor requires every repository method', () => {
  expect(() => new ClassService({})).toThrow(TypeError);
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
