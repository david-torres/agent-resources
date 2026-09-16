const { test, expect, describe } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { renderPowerRatings } = require('../../util/markdown');

const partial = (name) => fs.readFileSync(
  path.join(__dirname, `${name}.handlebars`), 'utf8'
);

const renderPartial = (name, context) => {
  const handlebars = Handlebars.create();
  handlebars.registerHelper('powerRatings', renderPowerRatings);
  for (const dependency of ['class-notes', 'class-sample-perks', 'class-enchantment']) {
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
