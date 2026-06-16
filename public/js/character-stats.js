// Inline stats editor for the character show page.
//
// The read-only view uses the wizard's box grid (filled + dashed boxes).
// The Edit button swaps the read-only grid for 12 numeric inputs.
// On Save, the form PUTs to /characters/:id/:name? with the 12 stat
// integers; the server's existing full-character handler accepts them
// and ignores any unrelated fields it doesn't receive.

// window-assigned (not `const`) so it survives hx-boost re-execution — see
// character-common.js for the full rationale.
window.CharacterStats = (function () {
  const { STATS, ready, getAuthHeader } = CharacterCommon;
  const showError = (msg) => CharacterCommon.showError('statsEditorError', msg);
  const clearError = () => CharacterCommon.clearError('statsEditorError');

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const updateTotal = () => {
    const sum = $$('.stats-input').reduce((s, el) => {
      const n = parseInt(el.value, 10);
      return s + (isNaN(n) ? 0 : n);
    }, 0);
    const totalEl = document.getElementById('statsTotalSum');
    if (totalEl) totalEl.textContent = sum;
  };

  const init = () => {
    const box = document.getElementById('statsBox');
    if (!box) return;
    const unlockBtn = document.getElementById('statsUnlockBtn');
    if (!unlockBtn) return;

    const readOnly = document.getElementById('statsReadOnly');
    const editor = document.getElementById('statsEditor');
    const form = document.getElementById('characterStatsForm');
    const cancelBtn = document.getElementById('statsCancelBtn');
    const saveBtn = document.getElementById('statsSaveBtn');
    if (!readOnly || !editor || !form || !cancelBtn || !saveBtn) return;

    updateTotal();

    unlockBtn.addEventListener('click', () => {
      readOnly.hidden = true;
      editor.hidden = false;
      unlockBtn.hidden = true;
      const first = form.querySelector('.stats-input');
      if (first) first.focus();
    });

    cancelBtn.addEventListener('click', () => {
      clearError();
      editor.hidden = true;
      readOnly.hidden = false;
      unlockBtn.hidden = false;
    });

    $$('.stats-input').forEach((el) => {
      el.addEventListener('input', updateTotal);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearError();
      saveBtn.classList.add('is-loading');
      saveBtn.disabled = true;

      const payload = {};

      // Coerce stat values to integers; clamp to [0, 20].
      STATS.forEach((stat) => {
        const field = form.querySelector('[name="' + stat + '"]');
        let n = parseInt(field ? field.value : '', 10);
        if (isNaN(n) || n < 0) n = 0;
        if (n > 20) n = 20;
        payload[stat] = n;
      });

      const id = box.getAttribute('data-character-id');
      const url = '/characters/' + encodeURIComponent(id) + '/stats';

      fetch(url, {
        method: 'PATCH',
        headers: Object.assign(getAuthHeader(), {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify(payload)
      }).then((res) => {
        saveBtn.classList.remove('is-loading');
        saveBtn.disabled = false;
        if (!res.ok) {
          return res.text().then((t) => {
            throw new Error(t || ('HTTP ' + res.status));
          });
        }
        window.location.reload();
      }).catch((err) => {
        saveBtn.classList.remove('is-loading');
        saveBtn.disabled = false;
        showError('Save failed: ' + (err && err.message ? err.message : 'Unknown error'));
      });
    });
  };

  ready(init);
  return { init };
})();
