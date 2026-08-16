const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { time_ago } = require('../util/handlebars');
// The real app spreads handlebars-helpers into its helper set (app.js:41), and
// home-upcoming-games.handlebars uses `eq` as a subexpression. Register the real
// one rather than a stand-in, so a change in its semantics surfaces here.
const packagedHelpers = require('handlebars-helpers')();

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');

// date_tz's third argument is a Handlebars options object when the template
// omits it (see util/handlebars.js). The stub keeps that shape so a template
// that forgets to pass a timezone renders "[object Object]" instead of
// silently looking correct in this test.
let dateTzCalls = [];
const dateTzStub = (value, format, timezone) => {
  dateTzCalls.push({ value, format, timezone });
  const tzLabel = timezone && typeof timezone === 'object' ? '[no timezone]' : timezone;
  return `[${value}|${format}|${tzLabel}]`;
};

const render = (context) => {
  dateTzCalls = [];
  const hb = Handlebars.create();
  hb.registerHelper('eq', packagedHelpers.eq);
  hb.registerHelper('time_ago', time_ago);
  hb.registerHelper('date_tz', dateTzStub);
  for (const name of ['home-feed-item', 'home-recent-mine', 'home-upcoming-games', 'home-news', 'home-community']) {
    hb.registerPartial(name, read('partials', `${name}.handlebars`));
  }
  return hb.compile(read('home.handlebars'))(context);
};

const FEED = [
  { type: 'character', id: 'c1', name: 'Vex', href: '/characters/c1', meta: 'Level 3 Gunslinger', updated_at: '2026-08-14T00:00:00+00:00' }
];
const NEWS = [{ id: 'n1', title: 'Patch 3', slug: 'patch-3', created_at: '2026-08-07T00:00:00+00:00', excerpt: 'Badges shipped.' }];
const GAMES = [{ id: 'g1', title: 'Saturday Run', date: '2026-08-20T18:00:00+00:00', role: 'host', characterName: null }];

const empty = { recentMine: [], upcomingGames: [], news: [], community: [] };

test('signed-in homepage greets the player and renders their recent work', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true, recentMine: FEED });
  expect(html).toContain('Welcome, Agent: Dave');
  expect(html).toContain('Pick up where you left off');
  expect(html).toContain('href="/characters/c1"');
  expect(html).toContain('Level 3 Gunslinger');
});

test('signed-in homepage does not render the marketing hero or the video', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true });
  expect(html).not.toContain('youtube.com/embed');
  expect(html).not.toContain('hero is-medium');
});

test('signed-out homepage renders the hero and video but no personalized sections', () => {
  const html = render({ ...empty, profile: null, news: NEWS, community: FEED });
  expect(html).toContain('youtube.com/embed');
  expect(html).toContain('Please <a href="/auth">sign in</a>');
  expect(html).not.toContain('Pick up where you left off');
  expect(html).not.toContain('Your upcoming games');
});

test('signed-out homepage still renders news and community activity', () => {
  const html = render({ ...empty, profile: null, news: NEWS, community: FEED });
  expect(html).toContain('Patch 3');
  expect(html).toContain('Recent from the community');
  expect(html).toContain('href="/characters/c1"');
});

test('the get-started callout shows only when the player has no characters', () => {
  const withNone = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: false });
  expect(withNone).toContain('Get started with Agent Resources');

  const withSome = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true, recentMine: FEED });
  expect(withSome).not.toContain('Get started with Agent Resources');
});

test('upcoming games render the role badge and the joined character', () => {
  const html = render({
    ...empty,
    profile: { name: 'Dave' },
    hasCharacters: true,
    upcomingGames: [
      { id: 'g1', title: 'Saturday Run', date: '2026-08-20T18:00:00+00:00', role: 'host', characterName: null },
      { id: 'g2', title: 'Sunday Run', date: '2026-08-21T18:00:00+00:00', role: 'player', characterName: 'Vex' }
    ]
  });
  expect(html).toContain('href="/lfg/g1"');
  expect(html).toContain('Host');
  expect(html).toContain('Player');
  expect(html).toContain('Vex');
});

test('upcoming games and news pass the viewer\'s profile timezone to date_tz, not the server default', () => {
  render({
    ...empty,
    profile: { name: 'Dave', timezone: 'Australia/Sydney' },
    hasCharacters: true,
    upcomingGames: GAMES,
    news: NEWS
  });
  const gameCall = dateTzCalls.find(c => c.value === GAMES[0].date);
  expect(gameCall.timezone).toBe('Australia/Sydney');
  const newsCall = dateTzCalls.find(c => c.value === NEWS[0].created_at);
  expect(newsCall.timezone).toBe('Australia/Sydney');
});

test('the pending-request badge renders only when the player hosts pending requests', () => {
  const withPending = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true, upcomingGames: GAMES, pendingLfgRequests: 2 });
  expect(withPending).toContain('2 pending');

  const withNone = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true, upcomingGames: GAMES, pendingLfgRequests: 0 });
  expect(withNone).not.toContain('pending');
});

test('empty sections are omitted entirely rather than rendering empty headings', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true });
  expect(html).not.toContain('Your upcoming games');
  expect(html).not.toContain('Latest news');
  expect(html).not.toContain('Recent from the community');
  expect(html).not.toContain('Pick up where you left off');
});

test('the FullCalendar container is gone from the homepage', () => {
  const html = render({ ...empty, profile: { name: 'Dave' }, hasCharacters: true });
  expect(html).not.toContain('id="calendar"');
});
