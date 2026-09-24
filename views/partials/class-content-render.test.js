const { test, expect, describe } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { renderPowerRatings, renderMarkdown } = require('../../util/markdown');

const partial = (name) => fs.readFileSync(
  path.join(__dirname, `${name}.handlebars`), 'utf8'
);

const renderPartial = (name, context) => {
  const handlebars = Handlebars.create();
  handlebars.registerHelper('powerRatings', renderPowerRatings);
  handlebars.registerHelper('markdown', renderMarkdown);
  for (const dependency of [
    'class-notes', 'class-sample-perks', 'class-enchantment', 'class-meters',
    'class-signature-sides', 'class-expanded-tips'
  ]) {
    handlebars.registerPartial(dependency, partial(dependency));
  }
  return handlebars.compile(partial(name))(context);
};

describe('power ratings in class content partials', () => {
  test('a rating renders as a superscript in perk text', () => {
    const html = renderPartial('class-sample-perks', {
      perks: [{ name: 'P', text: 'Boosted <sup>L–H</sup>', dedication: null, compound_text: null }]
    });
    expect(html).toContain('<sup>L–H</sup>');
  });

  test('a hostile string in perk text is neutralized', () => {
    const html = renderPartial('class-sample-perks', {
      perks: [{
        name: 'P',
        text: '<img src=x onerror=alert(1)>',
        dedication: null,
        compound_text: '<a href="javascript:alert(2)">c</a>'
      }]
    });
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
  });

  test('a hostile string in a note is neutralized at both levels', () => {
    const html = renderPartial('class-notes', {
      notes: [{
        text: '<script>alert(1)</script>parent',
        children: [{ text: '<img src=x onerror=alert(2)>child' }]
      }]
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror');
    expect(html).toContain('parent');
    expect(html).toContain('child');
  });

  test('a hostile string in an enchantment description is neutralized', () => {
    const html = renderPartial('class-enchantment', {
      enchantment: { name: 'E', dedication: null, description: '<script>alert(1)</script>safe' }
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('safe');
  });
});

describe('signature sides', () => {
  const item = (i) => ({
    name: `Item ${i + 1}`,
    description: '',
    category: i < 3 ? 'default' : 'elective',
    column: Math.floor(i / 3) + 1,
    position: (i % 3) + 1,
    meters: [],
    notes: [],
    default_enchantment: null
  });

  const renderSides = (gear) => {
    const { signatureSides } = require('../../util/class-gear');
    return renderPartial('class-signature-sides', { sides: signatureSides(gear) });
  };

  test('twelve items render as two sides', () => {
    const html = renderSides(Array.from({ length: 12 }, (_, i) => item(i)));
    expect(html.match(/class="column is-half signature-side"/g)).toHaveLength(2);
    for (let i = 1; i <= 12; i += 1) expect(html).toContain(`Item ${i}`);
  });

  test('book columns 1 and 3 render on the left side, 2 and 4 on the right', () => {
    const gear = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((name, i) => ({
      ...item(i), name
    }));
    const [leftSide, rightSide] = renderSides(gear).split('signature-side"').slice(1);
    for (const name of ['A', 'G']) {
      expect(leftSide).toContain(`>${name}<`);
      expect(rightSide).not.toContain(`>${name}<`);
    }
    for (const name of ['D', 'J']) {
      expect(rightSide).toContain(`>${name}<`);
      expect(leftSide).not.toContain(`>${name}<`);
    }
  });
});

describe('expanded tips', () => {
  test('both audiences render', () => {
    const html = renderPartial('class-expanded-tips', {
      hasExpandedTips: true,
      tips: {
        player: [{ text: 'Player guidance', children: [] }],
        conduit: [{ text: 'Conduit guidance', children: [] }]
      }
    });
    expect(html).toContain('Player guidance');
    expect(html).toContain('Conduit guidance');
  });

  test('empty lists render no section', () => {
    const html = renderPartial('class-expanded-tips', {
      hasExpandedTips: false,
      tips: { player: [], conduit: [] }
    });
    expect(html.trim()).toBe('');
  });
});
