const { test, expect } = require('bun:test');
const { JSDOM } = require('jsdom');
const fs = require('fs');

const boot = ({ level = 4, required = 14, completed = 11 } = {}) => {
  const dom = new JSDOM(`<button id="levelUpBtn"></button>
    <div id="statsBox" data-character-id="character-a" data-character-level="${level}"></div>
    <div id="levelUpModal" data-next-level="${level < 10 ? level + 1 : ''}"
      data-required-missions="${required}" data-completed-missions="${completed}">
      <div id="levelUpMissingMissions"></div><button id="levelUpSaveBtn"></button>
      <div id="levelUpError" class="is-hidden"></div>
    </div>`, { url: 'http://localhost' });
  const { window } = dom;
  new Function('window', 'document', 'localStorage', fs.readFileSync('public/js/character-common.js', 'utf8'))(window, window.document, window.localStorage);
  window.CharacterCommon.ready = fn => fn();
  let uuidCalls = 0;
  window.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++uuidCalls).padStart(12, '0')}`;
  const requests = [];
  const fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    throw new Error('Connection lost');
  };
  new Function('window', 'document', 'CharacterCommon', 'fetch', 'CustomEvent', fs.readFileSync('public/js/character-level-up.js', 'utf8'))(
    window, window.document, window.CharacterCommon, fetch, window.CustomEvent);
  return { window, document: window.document, requests };
};
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

test('modal initializes missing completed history counts for each server-selected curve', () => {
  const v1 = boot({ level: 4, required: 14, completed: 11 });
  expect(v1.document.querySelectorAll('.level-up-mission')).toHaveLength(3);
  v1.window.close();
  const aspirant = boot({ level: 4, required: 10, completed: 7 });
  expect(aspirant.document.querySelectorAll('.level-up-mission')).toHaveLength(3);
  aspirant.window.close();
});

test('level-up retry preserves request ID and sends history plus explicitly named missions', async () => {
  const page = boot({ level: 4, required: 14, completed: 11 });
  Array.from(page.document.querySelectorAll('.level-up-mission')).forEach((input, index) => { input.value = `Mission ${index}`; });
  page.document.getElementById('levelUpSaveBtn').click();
  await settled();
  page.document.getElementById('levelUpSaveBtn').click();
  await settled();
  expect(page.requests).toHaveLength(2);
  expect(page.requests[0].request_id).toBe(page.requests[1].request_id);
  expect(page.requests[0].mission_names).toEqual(['Mission 0', 'Mission 1', 'Mission 2']);
  expect(page.requests[0].completed_missions).toBe(14);
  expect(page.requests[0].level).toBe(5);
  page.document.querySelector('.level-up-mission').value = 'Changed mission';
  page.document.getElementById('levelUpSaveBtn').click();
  await settled();
  expect(page.requests[2].request_id).not.toBe(page.requests[1].request_id);
  page.window.close();
});

test('level-ten modal disables opening and cannot send a promotion', () => {
  const page = boot({ level: 10 });
  expect(page.document.getElementById('levelUpBtn').disabled).toBe(true);
  page.document.getElementById('levelUpSaveBtn').click();
  expect(page.requests).toHaveLength(0);
  page.window.close();
});
