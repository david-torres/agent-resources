// Inline stats editor for the character show page.
//
// The read-only view uses the wizard's box grid (filled + dashed boxes).
// The Edit button swaps the read-only grid for 12 numeric inputs.
// On Save, the form PUTs to /characters/:id/:name? with the 12 stat
// integers; the server's existing full-character handler accepts them
// and ignores any unrelated fields it doesn't receive.

(function () {
  'use strict';

  var STATS = [
    'vitality', 'might', 'resilience', 'spirit',
    'arcane', 'will', 'sensory', 'reflex',
    'vigor', 'skill', 'intelligence', 'luck'
  ];

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function getAuthHeader() {
    var token = localStorage.getItem('authToken');
    return token ? { 'Authorization': 'Bearer ' + token, 'Refresh-Token': localStorage.getItem('refreshToken') || '' } : {};
  }

  function showError(msg) {
    var box = document.getElementById('statsEditorError');
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('is-hidden');
  }
  function clearError() {
    var box = document.getElementById('statsEditorError');
    if (!box) return;
    box.classList.add('is-hidden');
    box.textContent = '';
  }

  function updateTotal() {
    var sum = $$('.stats-input').reduce(function (s, el) {
      var n = parseInt(el.value, 10);
      return s + (isNaN(n) ? 0 : n);
    }, 0);
    var totalEl = document.getElementById('statsTotalSum');
    if (totalEl) totalEl.textContent = sum;
  }

  function init() {
    var box = document.getElementById('statsBox');
    if (!box) return;
    var unlockBtn = document.getElementById('statsUnlockBtn');
    if (!unlockBtn) return;

    var readOnly = document.getElementById('statsReadOnly');
    var editor = document.getElementById('statsEditor');
    var form = document.getElementById('characterStatsForm');
    var cancelBtn = document.getElementById('statsCancelBtn');
    var saveBtn = document.getElementById('statsSaveBtn');
    if (!readOnly || !editor || !form || !cancelBtn || !saveBtn) return;

    updateTotal();

    unlockBtn.addEventListener('click', function () {
      readOnly.hidden = true;
      editor.hidden = false;
      unlockBtn.hidden = true;
      var first = form.querySelector('.stats-input');
      if (first) first.focus();
    });

    cancelBtn.addEventListener('click', function () {
      clearError();
      editor.hidden = true;
      readOnly.hidden = false;
      unlockBtn.hidden = false;
    });

    $$('.stats-input').forEach(function (el) {
      el.addEventListener('input', updateTotal);
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearError();
      saveBtn.classList.add('is-loading');
      saveBtn.disabled = true;

      var fd = new FormData(form);

      // Coerce stat values to integers; clamp to [0, 20].
      STATS.forEach(function (stat) {
        var n = parseInt(fd.get(stat), 10);
        if (isNaN(n) || n < 0) n = 0;
        if (n > 20) n = 20;
        fd.set(stat, String(n));
      });

      var id = box.getAttribute('data-character-id');
      var name = box.getAttribute('data-character-name') || '';
      var url = '/characters/' + encodeURIComponent(id) + '/' + encodeURIComponent(name);

      fetch(url, {
        method: 'PUT',
        headers: Object.assign(getAuthHeader(), {
          'Accept': 'application/json',
          'HX-Request': 'true'
        }),
        body: fd
      }).then(function (res) {
        saveBtn.classList.remove('is-loading');
        saveBtn.disabled = false;
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error(t || ('HTTP ' + res.status));
          });
        }
        window.location.reload();
      }).catch(function (err) {
        saveBtn.classList.remove('is-loading');
        saveBtn.disabled = false;
        showError('Save failed: ' + (err && err.message ? err.message : 'Unknown error'));
      });
    });
  }

  ready(init);
})();
