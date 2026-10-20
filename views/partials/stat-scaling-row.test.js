// What each plus of a stat buys, shown on the stat's name wherever a stat is
// being chosen.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const hbsHelpers = require('handlebars-helpers')();
const customHelpers = require('../../util/handlebars');

const partial = (name) => fs.readFileSync(path.join(__dirname, `${name}.handlebars`), 'utf8');

const render = (context) => {
  const hb = Handlebars.create();
  hb.registerHelper(hbsHelpers);
  hb.registerHelper(customHelpers);
  hb.registerPartial('stat-scaling-entry', partial('stat-scaling-entry'));
  return hb.compile(partial('stat-scaling-row'))(context);
};

test('the row lists Baseline through five pluses, in order', () => {
  const html = render({ stat: 'might' });
  const order = ['Lift your own bodyweight.', 'Crush an apple one-handed.', 'Rip a college textbook in half.',
    'Lift one end of a car.', 'Overhead press an entire car.', 'Throw a car a dozen yards.'];
  const positions = order.map(text => html.indexOf(text));
  expect(positions.every(p => p >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(html).not.toContain('Stop a speeding car');
});

test('an id makes the row addressable for client-rendered triggers', () => {
  expect(render({ stat: 'luck', id: 'stat-scaling-row-luck' })).toContain('id="stat-scaling-row-luck"');
  expect(render({ stat: 'luck' })).not.toContain('id=');
});
