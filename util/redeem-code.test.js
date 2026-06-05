const { mock, test, expect, afterAll } = require('bun:test');

const realSupabase = require('./supabase');

let classResult;
let pdfResult;
const classCalls = [];
const pdfCalls = [];

mock.module('./supabase', () => ({
    redeemUnlockCode: async (code, userId) => {
        classCalls.push({ code, userId });
        return classResult;
    },
    redeemRulesPdfUnlockCode: async (code, userId) => {
        pdfCalls.push({ code, userId });
        return pdfResult;
    }
}));

delete require.cache[require.resolve('./redeem-code')];
const { redeemAnyCode } = require('./redeem-code');

afterAll(() => {
    mock.module('./supabase', () => realSupabase);
    delete require.cache[require.resolve('./redeem-code')];
});

const reset = () => {
    classCalls.length = 0;
    pdfCalls.length = 0;
};

test('class code wins without trying the PDF table', async () => {
    reset();
    classResult = { data: 'class-1', error: null };
    pdfResult = { data: null, error: new Error('should not be called') };
    const result = await redeemAnyCode('CODE', 'u1');
    expect(result).toEqual({ type: 'class', id: 'class-1', error: null });
    expect(classCalls).toEqual([{ code: 'CODE', userId: 'u1' }]);
    expect(pdfCalls).toEqual([]);
});

test('falls back to PDF redemption when the class table misses', async () => {
    reset();
    classResult = { data: null, error: new Error('Invalid or expired code') };
    pdfResult = { data: 'pdf-1', error: null };
    const result = await redeemAnyCode('CODE', 'u1');
    expect(result).toEqual({ type: 'pdf', id: 'pdf-1', error: null });
    expect(classCalls.length).toBe(1);
    expect(pdfCalls).toEqual([{ code: 'CODE', userId: 'u1' }]);
});

test('returns one generic error when both tables miss', async () => {
    reset();
    classResult = { data: null, error: new Error('Invalid or expired code') };
    pdfResult = { data: null, error: new Error('Invalid or expired code') };
    const result = await redeemAnyCode('CODE', 'u1');
    expect(result.type).toBeNull();
    expect(result.id).toBeNull();
    expect(result.error.message).toBe('Invalid or expired code');
});
