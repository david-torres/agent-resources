// Level-Up modal for the character show page.
//
// Flow:
//   - Open the modal with App.openModal('#levelUpModal').
//   - User can edit stat values, add a perk to any ability (optionally
//     compounding it with an existing or sibling perk), fill in
//     missing-mission text boxes, and toggle "Conduit Credit".
//   - On Save: a single POST /characters/:id/level-up carries the new level,
//     completed_missions, the 12 stat integers, any backfill mission names (or
//     the conduit-credit flag), and the newly-added perks. The server creates
//     the mission/credit rows, re-derives the character's totals, and appends
//     the perks (resolving their compound links). Then the page reloads.
//
// Perks added here are append-only: each carries a client `ref` so a new perk
// can compound with another perk added in the same save (`new:<ref>`) or with
// an existing perk (by its row id). The server validates and persists the link.

const CharacterLevelUp = (function () {
  const { missionsForLevel, ready, getAuthHeader } = CharacterCommon;
  const showError = (msg) => CharacterCommon.showError('levelUpError', msg);
  const clearError = () => CharacterCommon.clearError('levelUpError');

  const updateStatTotal = () => {
    const sum = Array.from(document.querySelectorAll('.level-up-stat'))
      .reduce((s, el) => {
        const n = parseInt(el.value, 10);
        return s + (isNaN(n) ? 0 : n);
      }, 0);
    const t = document.getElementById('levelUpTotal');
    if (t) t.textContent = sum;
  };

  // Build a single mission textbox row.
  const makeMissionRow = (value) => {
    const row = document.createElement('div');
    row.className = 'field has-addons mb-2 level-up-mission-row';
    const control = document.createElement('div');
    control.className = 'control is-expanded';
    const input = document.createElement('input');
    input.className = 'input is-small level-up-mission';
    input.type = 'text';
    input.placeholder = 'Mission name';
    input.value = value || '';
    control.appendChild(input);
    row.appendChild(control);
    const removeCtl = document.createElement('div');
    removeCtl.className = 'control';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'button is-small is-light level-up-remove-mission';
    removeBtn.innerHTML = '<span class="icon"><i class="fas fa-times"></i></span>';
    removeBtn.addEventListener('click', () => { row.remove(); });
    removeCtl.appendChild(removeBtn);
    row.appendChild(removeCtl);
    return row;
  };

  const ensureEmptyMissionRow = () => {
    const container = document.getElementById('levelUpMissingMissions');
    if (!container) return;
    const rows = container.querySelectorAll('.level-up-mission-row');
    const last = rows[rows.length - 1];
    if (!last || last.querySelector('.level-up-mission').value.trim() !== '') {
      container.appendChild(makeMissionRow(''));
    }
  };

  const renderInitialMissingMissions = (count) => {
    const container = document.getElementById('levelUpMissingMissions');
    if (!container) return;
    container.innerHTML = '';
    if (count <= 0) {
      // Show one empty row anyway so the user can add a conduit-credit-less
      // mission if they want to backfill after the fact.
      container.appendChild(makeMissionRow(''));
      return;
    }
    for (let i = 0; i < count; i++) container.appendChild(makeMissionRow(''));
  };

  let perkRefSeq = 0;

  const truncateLabel = (s) => {
    s = (s || '').trim();
    if (s.length > 40) s = s.slice(0, 39) + '…';
    return s || '(empty)';
  };

  const makeOption = (value, label) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  };

  // Rebuild the compound-with <select> for every new perk in this ability box.
  // Targets are the ability's existing perks (by row id) plus the other new
  // perks added in this session (by `new:<ref>`); a perk can't compound with
  // itself. Options are built via the DOM (textContent) so perk text can't
  // inject markup. The server validates the chosen target independently.
  const refreshCompoundOptions = (box) => {
    const existingPerks = Array.from(box.querySelectorAll('.level-up-existing-perk'))
      .map((el) => {
        const textEl = el.querySelector('.level-up-existing-perk-text');
        return {
          value: el.getAttribute('data-perk-id'),
          label: 'Existing: ' + truncateLabel(textEl ? textEl.textContent : '')
        };
      });
    const newWrappers = Array.from(box.querySelectorAll('.level-up-perk'));

    newWrappers.forEach((wrapper) => {
      const sel = wrapper.querySelector('.level-up-perk-compound');
      if (!sel) return;
      const selfRef = wrapper.getAttribute('data-ref');
      const prev = sel.value;

      while (sel.firstChild) sel.removeChild(sel.firstChild);
      sel.appendChild(makeOption('', '(no compound)'));
      existingPerks.forEach((p) => {
        if (p.value) sel.appendChild(makeOption(p.value, p.label));
      });
      newWrappers.forEach((other) => {
        const ref = other.getAttribute('data-ref');
        if (ref === selfRef) return;
        const t = other.querySelector('.level-up-perk-text');
        sel.appendChild(makeOption('new:' + ref, 'New: ' + truncateLabel(t ? t.value : '')));
      });

      // Keep the prior choice when its target still exists; else clear it.
      sel.value = prev;
      if (sel.value !== prev) sel.value = '';
    });
  };

  const buildPerkInput = (abilityId) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'field has-addons mb-2 level-up-perk';
    wrapper.setAttribute('data-ability-id', abilityId);
    wrapper.setAttribute('data-ref', 'p' + (++perkRefSeq));

    const c1 = document.createElement('div');
    c1.className = 'control is-expanded';
    const input = document.createElement('input');
    input.className = 'input is-small level-up-perk-text';
    input.type = 'text';
    input.placeholder = 'Perk text';
    c1.appendChild(input);
    wrapper.appendChild(c1);

    // Compound-with selector; options are filled by refreshCompoundOptions.
    const c2 = document.createElement('div');
    c2.className = 'control';
    const selectWrap = document.createElement('div');
    selectWrap.className = 'select is-small';
    const sel = document.createElement('select');
    sel.className = 'level-up-perk-compound';
    sel.appendChild(makeOption('', '(no compound)'));
    selectWrap.appendChild(sel);
    c2.appendChild(selectWrap);
    wrapper.appendChild(c2);

    // Refresh sibling labels when this perk's text settles.
    input.addEventListener('change', () => {
      const box = wrapper.closest('.level-up-ability');
      if (box) refreshCompoundOptions(box);
    });

    const c3 = document.createElement('div');
    c3.className = 'control';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button is-small is-light';
    btn.innerHTML = '<span class="icon"><i class="fas fa-times"></i></span>';
    btn.addEventListener('click', () => {
      const box = wrapper.closest('.level-up-ability');
      wrapper.remove();
      if (box) refreshCompoundOptions(box);
    });
    c3.appendChild(btn);
    wrapper.appendChild(c3);

    return wrapper;
  };

  const init = () => {
    const openBtn = document.getElementById('levelUpBtn');
    const modal = document.getElementById('levelUpModal');
    if (!openBtn || !modal) return;

    const statBox = document.getElementById('statsBox');
    if (!statBox) return;
    const characterId = statBox.getAttribute('data-character-id');
    const characterName = statBox.getAttribute('data-character-name') || '';
    let currentLevel = parseInt(statBox.getAttribute('data-character-level') || '1', 10);
    if (isNaN(currentLevel) || currentLevel < 1) currentLevel = 1;
    let completedMissions = parseInt(openBtn.getAttribute('data-completed-missions') || '0', 10);
    if (isNaN(completedMissions) || completedMissions < 0) completedMissions = 0;

    const nextLevel = currentLevel + 1;
    const required = missionsForLevel(nextLevel);
    const missing = Math.max(0, required - completedMissions);

    // Render initial mission rows only if the section is in the DOM (the
    // server only emits the container when there's at least one missing
    // mission). When the section is absent the user can still check the
    // conduit-credit box to level up without backfilling missions.
    if (missing > 0) {
      renderInitialMissingMissions(missing);
    }

    // Wire stat input live total.
    document.querySelectorAll('.level-up-stat').forEach((el) => {
      el.addEventListener('input', updateStatTotal);
    });
    updateStatTotal();

    // Wire "Add perk" buttons.
    document.querySelectorAll('.level-up-add-perk').forEach((btn) => {
      btn.addEventListener('click', () => {
        const abilityBox = btn.closest('.level-up-ability');
        if (!abilityBox) return;
        const abilityId = abilityBox.getAttribute('data-ability-id');
        const perksContainer = abilityBox.querySelector('.level-up-perks');
        if (!perksContainer) return;
        const newPerk = buildPerkInput(abilityId);
        perksContainer.appendChild(newPerk);
        refreshCompoundOptions(abilityBox);
        const textInput = newPerk.querySelector('.level-up-perk-text');
        if (textInput) textInput.focus();
      });
    });

    // Open / close the modal.
    openBtn.addEventListener('click', () => {
      if (typeof App !== 'undefined' && App.openModal) App.openModal('#levelUpModal');
      else modal.classList.add('is-active');
    });

    const onSave = () => {
      clearError();
      saveBtn.classList.add('is-loading');
      saveBtn.disabled = true;

      const stats = {};
      document.querySelectorAll('.level-up-stat').forEach((el) => {
        const stat = el.getAttribute('data-stat');
        let n = parseInt(el.value, 10);
        if (isNaN(n) || n < 0) n = 0;
        if (n > 20) n = 20;
        stats[stat] = n;
      });

      // Each new perk carries its client `ref` and chosen compound link. The
      // server appends perks (assigning positions) and resolves the link to a
      // row id: `new:<ref>` points at another perk in this batch, a bare value
      // is an existing perk's id. Empty perks are skipped.
      const flatPerks = [];
      document.querySelectorAll('.level-up-perk').forEach((wrapper) => {
        const textEl = wrapper.querySelector('.level-up-perk-text');
        const text = (textEl && textEl.value || '').trim();
        if (!text) return;
        const sel = wrapper.querySelector('.level-up-perk-compound');
        flatPerks.push({
          class_ability_id: wrapper.getAttribute('data-ability-id'),
          text: text,
          ref: wrapper.getAttribute('data-ref'),
          compounds_with: (sel && sel.value) ? sel.value : null
        });
      });

      const conduitCreditEl = document.getElementById('levelUpConduitCredit');
      const useConduitCredit = !!(conduitCreditEl && conduitCreditEl.checked);
      const missionNames = useConduitCredit
        ? []
        : Array.from(document.querySelectorAll('.level-up-mission'))
            .map((el) => (el.value || '').trim())
            .filter((v) => v.length > 0);

      let targetCompleted = useConduitCredit ? required : (completedMissions + missionNames.length);
      if (targetCompleted < required) targetCompleted = required;
      const putUrl = '/characters/' + encodeURIComponent(characterId) + '/level-up';
      const payload = {
        level: nextLevel,
        completed_missions: targetCompleted,
        stats: stats,
        mission_names: missionNames,
        use_conduit_credit: useConduitCredit,
        ability_perks: flatPerks
      };

      fetch(putUrl, {
        method: 'POST',
        headers: Object.assign(getAuthHeader(), { 'Accept': 'application/json', 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      }).then((res) => {
        if (!res.ok) {
          return res.text().then((t) => { throw new Error(t || ('HTTP ' + res.status)); });
        }
        window.location.reload();
      }).catch((err) => {
        saveBtn.classList.remove('is-loading');
        saveBtn.disabled = false;
        showError('Save failed: ' + (err && err.message ? err.message : 'Unknown error'));
      });
    };

    // Save handler.
    const saveBtn = document.getElementById('levelUpSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', onSave);
  };

  ready(init);
  return { init };
})();
