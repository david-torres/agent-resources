const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { date_tz } = require('../../util/handlebars');

// Register the same date helpers the real app registers (see app.js), plus the
// full handlebars-helpers set so template helpers like `eq` resolve. If the
// template references a helper that isn't registered, rendering throws
// "Missing helper".
require('handlebars-helpers')({ handlebars: Handlebars });
Handlebars.registerHelper('date_tz', date_tz);

function renderPartial(context) {
  const src = fs.readFileSync(
    path.join(__dirname, 'similar-missions.handlebars'),
    'utf8'
  );
  return Handlebars.compile(src)(context);
}

test('similar-missions renders each mission name and a human-readable date without a missing-helper error', () => {
  const context = {
    profile: { timezone: 'America/New_York' },
    missions: [
      {
        id: 'm1',
        name: 'Op Nightfall',
        date: '2026-07-15T18:00:00Z',
        creator_name: 'Alice',
        characters: [{}, {}]
      }
    ]
  };

  const html = renderPartial(context);

  expect(html).toContain('Op Nightfall');
  expect(html).toContain('2026');
  expect(html).toMatch(/Jul(y)?/);
});
