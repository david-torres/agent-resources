// models/pdf.test.js
const { test, expect, mock, afterAll } = require('bun:test');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'test-anon-key';
process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-key';

const realBase = require('./_base');

const calls = [];
const makeStorageClient = (clientName) => ({
  storage: {
    from: (bucket) => ({
      upload: async (storagePath) => {
        calls.push({ client: clientName, method: 'upload', bucket, storagePath });
        return { error: null };
      },
      remove: async (paths) => {
        calls.push({ client: clientName, method: 'remove', bucket, paths });
        return { error: null };
      },
    }),
  },
});

mock.module('./_base', () => ({
  supabase: makeStorageClient('anon'),
  supabaseAdmin: {
    ...makeStorageClient('admin'),
    storage: {
      ...makeStorageClient('admin').storage,
      from: (bucket) => ({
        ...makeStorageClient('admin').storage.from(bucket),
        createSignedUrl: async () => ({ data: { signedUrl: 'signed-url' }, error: null }),
      }),
    },
  },
}));

delete require.cache[require.resolve('./pdf')];
const { deletePdfObject, storeClassPdf, storeRulesPdf } = require('./pdf');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./pdf')];
});

test('storeClassPdf rejects a file whose bytes are not a PDF (spoofed content-type)', async () => {
  calls.length = 0;
  const file = { originalname: 'evil.pdf', buffer: Buffer.from('<html><script>alert(1)</script>') };
  const { data, error } = await storeClassPdf('class-1', file);
  expect(data).toBe(null);
  expect(error).toBeTruthy();
  expect(error.message).toMatch(/not a valid PDF/i);
  expect(calls).toEqual([]);
});

test('storeClassPdf accepts a file beginning with the %PDF- signature', async () => {
  calls.length = 0;
  const file = { originalname: 'ok.pdf', buffer: Buffer.from('%PDF-1.7\nbinary...') };
  const { data, error } = await storeClassPdf('class-1', file);
  expect(error).toBe(null);
  expect(data.bucket).toBe('class-pdfs');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ client: 'admin', method: 'upload', bucket: 'class-pdfs' });
});

test('storeRulesPdf uploads through the admin storage client and removes replaced PDFs with admin', async () => {
  calls.length = 0;
  const file = { originalname: 'rules.pdf', buffer: Buffer.from('%PDF-1.7\nbinary...') };
  const { data, error } = await storeRulesPdf('rules-1', file, { previousPath: 'rules-1/old.pdf' });
  expect(error).toBe(null);
  expect(data.bucket).toBe('rules-pdfs');
  expect(calls.map((call) => call.client)).toEqual(['admin', 'admin']);
  expect(calls.map((call) => call.method)).toEqual(['upload', 'remove']);
  expect(calls[1]).toMatchObject({ bucket: 'rules-pdfs', paths: ['rules-1/old.pdf'] });
});

test('deletePdfObject removes through the admin storage client', async () => {
  calls.length = 0;
  const { error } = await deletePdfObject({ bucket: 'rules-pdfs', path: 'rules-1/current.pdf' });
  expect(error).toBe(null);
  expect(calls).toEqual([
    { client: 'admin', method: 'remove', bucket: 'rules-pdfs', paths: ['rules-1/current.pdf'] }
  ]);
});
