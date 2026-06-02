// models/pdf.test.js
const { test, expect, mock, afterAll } = require('bun:test');
const realBase = require('./_base');

// Minimal storage stub: the accept path calls supabase.storage.from().upload().
mock.module('./_base', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  },
  supabaseAdmin: {},
}));

delete require.cache[require.resolve('./pdf')];
const { storeClassPdf } = require('./pdf');

afterAll(() => {
  mock.module('./_base', () => realBase);
  delete require.cache[require.resolve('./pdf')];
});

test('storeClassPdf rejects a file whose bytes are not a PDF (spoofed content-type)', async () => {
  const file = { originalname: 'evil.pdf', buffer: Buffer.from('<html><script>alert(1)</script>') };
  const { data, error } = await storeClassPdf('class-1', file);
  expect(data).toBe(null);
  expect(error).toBeTruthy();
  expect(error.message).toMatch(/not a valid PDF/i);
});

test('storeClassPdf accepts a file beginning with the %PDF- signature', async () => {
  const file = { originalname: 'ok.pdf', buffer: Buffer.from('%PDF-1.7\nbinary...') };
  const { data, error } = await storeClassPdf('class-1', file);
  expect(error).toBe(null);
  expect(data.bucket).toBe('class-pdfs');
});
