const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const customHelpers = require('../../util/handlebars');

const handlebarsHelpers = require('handlebars-helpers')();

function renderPartial(context) {
  const hb = Handlebars.create();
  hb.registerHelper(handlebarsHelpers);
  hb.registerHelper(customHelpers);
  const src = fs.readFileSync(
    path.join(__dirname, 'character-ability-perk.handlebars'),
    'utf8'
  );
  return hb.compile(src)(context);
}

test('character-ability-perk renders sibling-perk compound options without a missing-helper error', () => {
  const html = renderPartial({
    abilityId: 'ability-1',
    position: 1,
    perk: { text: 'Deal extra damage', compounds_with: 'position-0' },
    siblingPerks: [
      { position: 0, text: 'First perk' },
      { position: 1, text: 'Second perk' }
    ]
  });

  // The sibling at position 0 produces a compound option (the current perk at
  // position 1 is excluded by the #unless guard).
  expect(html).toContain('value="position-0"');
  // The current perk compounds_with "position-0", so that option is selected —
  // this is the comparison that used the previously-missing concat helper.
  expect(html).toMatch(/<option value="position-0"\s+selected>/);
});

test('character-ability-perk leaves compound options unselected when nothing compounds', () => {
  const html = renderPartial({
    abilityId: 'ability-1',
    position: 1,
    perk: { text: 'Standalone perk', compounds_with: '' },
    siblingPerks: [
      { position: 0, text: 'First perk' },
      { position: 1, text: 'Second perk' }
    ]
  });

  expect(html).toContain('value="position-0"');
  expect(html).not.toContain('selected');
});

// Alpine word-count tests
const { setupAlpine, render, tick } = require('../../test/helpers/alpine-dom');

test('word count updates as the perk text changes', async () => {
  await setupAlpine();
  await render(`
    <div x-data="{ text: 'two words' }">
      <textarea x-model="text"></textarea>
      <span class="word-count"
            x-text="text.trim() ? text.trim().split(/\\s+/).length : 0"></span>
    </div>
  `);
  expect(document.querySelector('.word-count').textContent).toBe('2');

  const ta = document.querySelector('textarea');
  ta.value = 'now there are four words';
  ta.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  expect(document.querySelector('.word-count').textContent).toBe('5');
});

test('word count is 0 for empty and whitespace-only text', async () => {
  await setupAlpine();
  await render(`
    <div x-data="{ text: '   ' }">
      <span class="word-count"
            x-text="text.trim() ? text.trim().split(/\\s+/).length : 0"></span>
    </div>
  `);
  expect(document.querySelector('.word-count').textContent).toBe('0');
});

test('character-ability-perk template uses Alpine for word count', () => {
  const html = renderPartial({
    abilityId: 'ability-1',
    position: 0,
    perk: { text: 'Sample perk text', compounds_with: '' },
    siblingPerks: []
  });

  // Verify Alpine directives are present
  expect(html).toContain('x-data');
  expect(html).toContain("{ text:");
  expect(html).toContain('x-model="text"');
  expect(html).toContain('x-text="text.trim() ? text.trim().split(/\\s+/).length : 0"');

  // Verify old oninput handler is gone
  expect(html).not.toContain('oninput');

  // Verify textarea is used
  expect(html).toContain('<textarea');
  expect(html).toContain('</textarea>');

  // Verify server-rendered count is present as inner text for pre-initialization
  expect(html).toContain('>3</span>');

  // Verify textarea content has the perk text
  expect(html).toContain('>Sample perk text</textarea>');
});
