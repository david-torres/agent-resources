const { test, expect, describe } = require('bun:test');
const { withRuleAccess } = require('./library-access');

const rule = (id) => ({ id, title: `Rule ${id}` });

describe('withRuleAccess', () => {
    const now = new Date('2026-08-17T00:00:00Z');
    const future = '2026-09-01T00:00:00Z';
    const past = '2026-07-01T00:00:00Z';

    const access = (unlock, isAdmin) => {
        const unlocksMap = new Map(unlock ? [['r1', unlock]] : []);
        return withRuleAccess([rule('r1')], unlocksMap, isAdmin, now)[0];
    };

    test('non-admin with a live unlock can view without admin override', () => {
        const result = access({ expires_at: future }, false);
        expect(result.isUnlocked).toBe(true);
        expect(result.isExpired).toBe(false);
        expect(result.canView).toBe(true);
        expect(result.isAdminOverride).toBe(false);
        expect(result.expires_at).toBe(future);
    });

    test('non-admin with no unlock cannot view', () => {
        const result = access(null, false);
        expect(result.isUnlocked).toBe(false);
        expect(result.canView).toBe(false);
        expect(result.isAdminOverride).toBe(false);
        expect(result.expires_at).toBeNull();
    });

    test('admin with no unlock views via admin override', () => {
        const result = access(null, true);
        expect(result.isUnlocked).toBe(false);
        expect(result.canView).toBe(true);
        expect(result.isAdminOverride).toBe(true);
    });

    test('admin with a live unlock is not an admin override', () => {
        const result = access({ expires_at: future }, true);
        expect(result.canView).toBe(true);
        expect(result.isAdminOverride).toBe(false);
    });

    test('admin with an expired unlock views via admin override', () => {
        const result = access({ expires_at: past }, true);
        expect(result.canView).toBe(true);
        expect(result.isExpired).toBe(true);
        expect(result.isAdminOverride).toBe(true);
    });

    const freeAccess = (unlock, isAdmin) => {
        const unlocksMap = new Map(unlock ? [['r1', unlock]] : []);
        return withRuleAccess([{ ...rule('r1'), free_access: true }], unlocksMap, isAdmin, now)[0];
    };

    test('non-admin can view a free-access rule without an unlock', () => {
        const result = freeAccess(null, false);
        expect(result.isUnlocked).toBe(false);
        expect(result.canView).toBe(true);
        expect(result.isAdminOverride).toBe(false);
    });

    test('admin viewing a free-access rule is not an admin override', () => {
        const result = freeAccess(null, true);
        expect(result.canView).toBe(true);
        expect(result.isAdminOverride).toBe(false);
    });

    test('non-admin with an expired unlock cannot view', () => {
        const result = access({ expires_at: past }, false);
        expect(result.isUnlocked).toBe(true);
        expect(result.isExpired).toBe(true);
        expect(result.canView).toBe(false);
        expect(result.isAdminOverride).toBe(false);
    });
});
