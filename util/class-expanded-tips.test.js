const { test, expect, describe } = require('bun:test');
const { normalizeExpandedTips } = require('./class-expanded-tips');

describe('normalizeExpandedTips', () => {
  test('always returns both keys as arrays', () => {
    expect(normalizeExpandedTips(undefined)).toEqual({ player: [], conduit: [] });
    expect(normalizeExpandedTips(null)).toEqual({ player: [], conduit: [] });
    expect(normalizeExpandedTips('nonsense')).toEqual({ player: [], conduit: [] });
  });

  test('keeps text and nests children', () => {
    const value = {
      player: [{ text: 'Look for angles', children: [{ text: 'around cover' }] }],
      conduit: [{ text: 'Force repositioning' }]
    };
    expect(normalizeExpandedTips(value)).toEqual({
      player: [{ text: 'Look for angles', children: [{ text: 'around cover', children: [] }] }],
      conduit: [{ text: 'Force repositioning', children: [] }]
    });
  });

  test('drops blank rows and blank children', () => {
    const value = {
      player: [{ text: '  ' }, { text: 'Real', children: [{ text: '' }] }],
      conduit: []
    };
    expect(normalizeExpandedTips(value)).toEqual({
      player: [{ text: 'Real', children: [] }],
      conduit: []
    });
  });

  test('an extra key is not carried through', () => {
    expect(normalizeExpandedTips({ player: [], conduit: [], designer: [{ text: 'x' }] }))
      .toEqual({ player: [], conduit: [] });
  });
});
