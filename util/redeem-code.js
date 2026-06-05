const { redeemUnlockCode, redeemRulesPdfUnlockCode } = require('./supabase');

// Try a code as a class unlock code first, then as a rules PDF unlock code.
// Returns { type: 'class' | 'pdf', id } on success. When neither table
// matches, returns a single generic error rather than stacking the two
// per-table errors.
const redeemAnyCode = async (code, userId) => {
    const classResult = await redeemUnlockCode(code, userId);
    if (!classResult.error) {
        return { type: 'class', id: classResult.data, error: null };
    }
    const pdfResult = await redeemRulesPdfUnlockCode(code, userId);
    if (!pdfResult.error) {
        return { type: 'pdf', id: pdfResult.data, error: null };
    }
    return { type: null, id: null, error: new Error('Invalid or expired code') };
};

module.exports = { redeemAnyCode };
