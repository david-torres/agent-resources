const { test, expect, describe } = require('bun:test');
const { expandRulesUnlocksByTitle } = require('./rules-family');

const pdf = (id, title, edition) => ({ id, title, edition });

describe('expandRulesUnlocksByTitle', () => {
    const rules = [
        pdf('adv-v1', 'Enclave: Advent', 'v1'),
        pdf('adv-v2', 'Enclave: Advent', 'v2'),
        pdf('other', 'Enclave: Aspirant', 'v1')
    ];

    test('an unlock for one version maps to every version of that title', () => {
        const unlocks = [{ rules_pdf_id: 'adv-v1', expires_at: null, unlocked_at: 't' }];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.get('adv-v1')).toBeTruthy();
        expect(map.get('adv-v2')).toBeTruthy();
        expect(map.has('other')).toBe(false);
    });

    test('does not leak across titles', () => {
        const unlocks = [{ rules_pdf_id: 'other', expires_at: null }];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.has('adv-v1')).toBe(false);
        expect(map.get('other')).toBeTruthy();
    });

    test('prefers a non-expiring unlock over an expiring one', () => {
        const unlocks = [
            { rules_pdf_id: 'adv-v1', expires_at: '2026-07-01T00:00:00Z' },
            { rules_pdf_id: 'adv-v2', expires_at: null }
        ];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.get('adv-v1').expires_at).toBeNull();
    });

    test('otherwise prefers the latest expiry', () => {
        const unlocks = [
            { rules_pdf_id: 'adv-v1', expires_at: '2026-07-01T00:00:00Z' },
            { rules_pdf_id: 'adv-v2', expires_at: '2026-08-01T00:00:00Z' }
        ];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.get('adv-v1').expires_at).toBe('2026-08-01T00:00:00Z');
    });

    test('unlock for a PDF not in the visible list is ignored', () => {
        const unlocks = [{ rules_pdf_id: 'inactive-id', expires_at: null }];
        const map = expandRulesUnlocksByTitle(rules, unlocks);
        expect(map.size).toBe(0);
    });

    test('empty unlocks produce an empty map', () => {
        expect(expandRulesUnlocksByTitle(rules, []).size).toBe(0);
    });
});
