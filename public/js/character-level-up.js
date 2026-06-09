// Level-Up modal for the character show page.
//
// Flow:
//   - Open the modal with App.openModal('#levelUpModal').
//   - User can edit stat values, add a perk to any ability, fill in
//     missing-mission text boxes, and toggle "Conduit Credit".
//   - On Save:
//       1. PUT /characters/:id/:name? with the new level, completed_missions,
//          and the 12 stat integers.
//       2. For each non-empty missing-mission box, POST /missions to create
//          a real mission row tied to this character.
//       3. Reload the page.
//
// Perks added in the modal are kept in local JS state; a follow-up
// PUT to the character with ability_perks persists them via the
// existing updateCharacter path.

(function () {
  'use strict';

  var STATS = [
    'vitality', 'might', 'resilience', 'spirit',
    'arcane', 'will', 'sensory', 'reflex',
    'vigor', 'skill', 'intelligence', 'luck'
  ];

  // Cumulative v2 missions needed to reach level L (matches
  // v2LevelingSequence in util/enclave-consts.js).
  var v2LevelingSequence = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  function missionsForLevel(level) {
    var lvl = Math.max(1, parseInt(level, 10) || 1);
    if (lvl <= 1) return 0;
    var sum = 0;
    for (var i = 0; i < lvl - 1 && i < v2LevelingSequence.length; i++) sum += v2LevelingSequence[i];
    return sum;
  }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function getAuthHeader() {
    var token = localStorage.getItem('authToken');
    return token ? { 'Authorization': 'Bearer ' + token, 'Refresh-Token': localStorage.getItem('refreshToken') || '' } : {};
  }

  function showError(msg) {
    var box = document.getElementById('levelUpError');
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('is-hidden');
  }
  function clearError() {
    var box = document.getElementById('levelUpError');
    if (!box) return;
    box.classList.add('is-hidden');
    box.textContent = '';
  }

  function updateStatTotal() {
    var sum = Array.prototype.slice.call(document.querySelectorAll('.level-up-stat'))
      .reduce(function (s, el) {
        var n = parseInt(el.value, 10);
        return s + (isNaN(n) ? 0 : n);
      }, 0);
    var t = document.getElementById('levelUpTotal');
    if (t) t.textContent = sum;
  }

  // Build a single mission textbox row.
  function makeMissionRow(value) {
    var row = document.createElement('div');
    row.className = 'field has-addons mb-2 level-up-mission-row';
    var control = document.createElement('div');
    control.className = 'control is-expanded';
    var input = document.createElement('input');
    input.className = 'input is-small level-up-mission';
    input.type = 'text';
    input.placeholder = 'Mission name';
    input.value = value || '';
    control.appendChild(input);
    row.appendChild(control);
    var removeCtl = document.createElement('div');
    removeCtl.className = 'control';
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'button is-small is-light level-up-remove-mission';
    removeBtn.innerHTML = '<span class="icon"><i class="fas fa-times"></i></span>';
    removeBtn.addEventListener('click', function () { row.remove(); });
    removeCtl.appendChild(removeBtn);
    row.appendChild(removeCtl);
    return row;
  }

  function ensureEmptyMissionRow() {
    var container = document.getElementById('levelUpMissingMissions');
    if (!container) return;
    var rows = container.querySelectorAll('.level-up-mission-row');
    var last = rows[rows.length - 1];
    if (!last || last.querySelector('.level-up-mission').value.trim() !== '') {
      container.appendChild(makeMissionRow(''));
    }
  }

  function renderInitialMissingMissions(count) {
    var container = document.getElementById('levelUpMissingMissions');
    if (!container) return;
    container.innerHTML = '';
    if (count <= 0) {
      // Show one empty row anyway so the user can add a conduit-credit-less
      // mission if they want to backfill after the fact.
      container.appendChild(makeMissionRow(''));
      return;
    }
    for (var i = 0; i < count; i++) container.appendChild(makeMissionRow(''));
  }

  function buildPerkInput(abilityId) {
    var wrapper = document.createElement('div');
    wrapper.className = 'field has-addons mb-2 level-up-perk';
    wrapper.setAttribute('data-ability-id', abilityId);
    var c1 = document.createElement('div');
    c1.className = 'control is-expanded';
    var input = document.createElement('input');
    input.className = 'input is-small level-up-perk-text';
    input.type = 'text';
    input.placeholder = 'Perk text';
    c1.appendChild(input);
    wrapper.appendChild(c1);
    var c2 = document.createElement('div');
    c2.className = 'control';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button is-small is-light';
    btn.innerHTML = '<span class="icon"><i class="fas fa-times"></i></span>';
    btn.addEventListener('click', function () { wrapper.remove(); });
    c2.appendChild(btn);
    wrapper.appendChild(c2);
    return wrapper;
  }

  function init() {
    var openBtn = document.getElementById('levelUpBtn');
    var modal = document.getElementById('levelUpModal');
    if (!openBtn || !modal) return;

    var statBox = document.getElementById('statsBox');
    if (!statBox) return;
    var characterId = statBox.getAttribute('data-character-id');
    var characterName = statBox.getAttribute('data-character-name') || '';
    var currentLevel = parseInt(statBox.getAttribute('data-character-level') || '1', 10);
    if (isNaN(currentLevel) || currentLevel < 1) currentLevel = 1;
    var completedMissions = parseInt(openBtn.getAttribute('data-completed-missions') || '0', 10);
    if (isNaN(completedMissions) || completedMissions < 0) completedMissions = 0;

    var nextLevel = currentLevel + 1;
    var required = missionsForLevel(nextLevel);
    var missing = Math.max(0, required - completedMissions);

    // Render initial mission rows only if the section is in the DOM (the
    // server only emits the container when there's at least one missing
    // mission). When the section is absent the user can still check the
    // conduit-credit box to level up without backfilling missions.
    if (missing > 0) {
      renderInitialMissingMissions(missing);
    }

    // Wire stat input live total.
    Array.prototype.forEach.call(document.querySelectorAll('.level-up-stat'), function (el) {
      el.addEventListener('input', updateStatTotal);
    });
    updateStatTotal();

    // Wire "Add perk" buttons.
    Array.prototype.forEach.call(document.querySelectorAll('.level-up-add-perk'), function (btn) {
      btn.addEventListener('click', function () {
        var abilityBox = btn.closest('.level-up-ability');
        if (!abilityBox) return;
        var abilityId = abilityBox.getAttribute('data-ability-id');
        var perksContainer = abilityBox.querySelector('.level-up-perks');
        if (!perksContainer) return;
        perksContainer.appendChild(buildPerkInput(abilityId));
        var firstInput = perksContainer.querySelector('.level-up-perk-text');
        if (firstInput) firstInput.focus();
      });
    });

    // Open / close the modal.
    openBtn.addEventListener('click', function () {
      if (typeof App !== 'undefined' && App.openModal) App.openModal('#levelUpModal');
      else modal.classList.add('is-active');
    });

    // Save handler.
    var saveBtn = document.getElementById('levelUpSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', onSave);

    function onSave() {
      clearError();
      saveBtn.classList.add('is-loading');
      saveBtn.disabled = true;

      var stats = {};
      Array.prototype.forEach.call(document.querySelectorAll('.level-up-stat'), function (el) {
        var stat = el.getAttribute('data-stat');
        var n = parseInt(el.value, 10);
        if (isNaN(n) || n < 0) n = 0;
        if (n > 20) n = 20;
        stats[stat] = n;
      });

      var perksByAbility = {};
      Array.prototype.forEach.call(document.querySelectorAll('.level-up-perk-text'), function (el) {
        var text = (el.value || '').trim();
        if (!text) return;
        var perk = el.closest('.level-up-perk');
        if (!perk) return;
        var abilityId = perk.getAttribute('data-ability-id');
        if (!perksByAbility[abilityId]) perksByAbility[abilityId] = [];
        perksByAbility[abilityId].push({ class_ability_id: abilityId, text: text });
      });
      var flatPerks = [];
      Object.keys(perksByAbility).forEach(function (k) {
        perksByAbility[k].forEach(function (p, i) {
          flatPerks.push({ class_ability_id: p.class_ability_id, text: p.text, position: i });
        });
      });

      var useConduitCredit = document.getElementById('levelUpConduitCredit').checked;
      var missionNames = useConduitCredit
        ? []
        : Array.prototype.slice.call(document.querySelectorAll('.level-up-mission'))
            .map(function (el) { return (el.value || '').trim(); })
            .filter(function (v) { return v.length > 0; });

      var putUrl = '/characters/' + encodeURIComponent(characterId) + '/' + encodeURIComponent(characterName);
      var fd = new FormData();
      fd.set('level', String(nextLevel));
      fd.set('completed_missions', String(completedMissions + missionNames.length));
      Object.keys(stats).forEach(function (k) { fd.set(k, String(stats[k])); });
      // Send perks as JSON blob (server is json-aware for this field; the
      // existing updateCharacter normalizes ability_perks).
      if (flatPerks.length) fd.set('ability_perks', JSON.stringify(flatPerks));

      fetch(putUrl, {
        method: 'PUT',
        headers: Object.assign(getAuthHeader(), { 'Accept': 'application/json', 'HX-Request': 'true' }),
        body: fd
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) { throw new Error(t || ('HTTP ' + res.status)); });
        }
        // Create mission rows, if any.
        var chain = Promise.resolve();
        missionNames.forEach(function (name) {
          chain = chain.then(function () {
            var mfd = new FormData();
            mfd.set('name', name);
            mfd.set('date', new Date().toISOString());
            mfd.set('outcome', 'success');
            mfd.set('characters[]', characterId);
            return fetch('/missions', {
              method: 'POST',
              headers: Object.assign(getAuthHeader(), { 'Accept': 'application/json', 'HX-Request': 'true' }),
              body: mfd
            }).then(function (r) {
              if (!r.ok) {
                return r.text().then(function (t) { throw new Error('mission "' + name + '": ' + (t || r.status)); });
              }
            });
          });
        });
        return chain.then(function () { window.location.reload(); });
      }).catch(function (err) {
        saveBtn.classList.remove('is-loading');
        saveBtn.disabled = false;
        showError('Save failed: ' + (err && err.message ? err.message : 'Unknown error'));
      });
    }
  }

  ready(init);
})();
