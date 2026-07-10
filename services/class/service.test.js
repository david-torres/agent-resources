const { test, expect } = require('bun:test');
const { normalizeClassInput } = require('./input');
const { ClassService } = require('./service');

const makeAdapter = () => {
  const calls = [];
  return {
    calls,
    createClassRow: async data => { calls.push(['create', data]); return { data, error: null }; },
    updateClassRow: async (id, data) => { calls.push(['update', id, data]); return { data, error: null }; },
    deleteClassRow: async id => { calls.push(['delete', id]); return { error: null }; },
    savePdfMetadataRow: async (id, data) => { calls.push(['pdf', id, data]); return { data, error: null }; }
  };
};

test('normalizes a class input copy without mutating the submitted payload', () => {
  const input = { name: 'Tinker', image_url: 'javascript:bad()' };
  expect(normalizeClassInput(input)).toEqual({ name: 'Tinker', image_url: null });
  expect(input).toEqual({ name: 'Tinker', image_url: 'javascript:bad()' });
});

test('class service passes normalized writes through its adapter', async () => {
  const adapter = makeAdapter();
  const service = new ClassService(adapter);
  await service.updateClass('class-1', { image_url: 'https://example.test/image.png' });
  expect(adapter.calls).toEqual([['update', 'class-1', { image_url: 'https://example.test/image.png' }]]);
});

test('class service rejects PDF metadata without a class id', async () => {
  const service = new ClassService(makeAdapter());
  const result = await service.savePdfMetadata(null, 'classes/tinker.pdf');
  expect(result.error.message).toBe('Missing class id');
});
