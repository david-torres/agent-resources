// Expert create form: switch the form between v1 and v2 layouts based on the
// selected class, and keep the structured Ability Perks editor in sync with the
// selected Class Abilities. Perks link to abilities by NAME on create; the
// server (createCharacter) remaps name -> new ability row id on save.
//
// window-assigned (not `const`) so it survives hx-boost re-execution — see
// public/js/character-common.js for the full rationale.
window.CharacterFormVersion = (function () {
  const ready = (fn) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };

  // Ability select value is "category::Name"; the perk linkage key is the Name.
  const abilityNameFromValue = (val) => {
    if (!val) return '';
    const s = String(val);
    return (s.includes('::') ? s.split('::')[1] : s).trim();
  };

  const init = () => {
    const classSelect = document.getElementById('char-class-id');
    const abilityList = document.getElementById('class-ability-list');
    const perkGroups = document.getElementById('perk-groups');
    const perkGroupsEmpty = document.getElementById('perk-groups-empty');
    // Only run on the create form (both blocks present).
    const v1Block = document.querySelector('[data-version-block="v1"]');
    const v2Block = document.querySelector('[data-version-block="v2"]');
    if (!classSelect || !abilityList || !v1Block || !v2Block || !perkGroups) return;
    if (classSelect.dataset.versionInit === 'true') return;
    classSelect.dataset.versionInit = 'true';

    let groupSeq = 0;

    const selectedVersion = () => {
      const opt = classSelect.options[classSelect.selectedIndex];
      return (opt && opt.getAttribute('data-version')) || 'v1';
    };

    const applyVersion = () => {
      const v2 = selectedVersion() === 'v2';
      v2Block.hidden = !v2;
      v1Block.hidden = v2;
    };

    // The set of ability names currently selected in the Class Abilities list.
    const selectedAbilityNames = () => {
      const names = [];
      abilityList.querySelectorAll('select[name="abilities[]"]').forEach((sel) => {
        const name = abilityNameFromValue(sel.value);
        if (name && !names.includes(name)) names.push(name);
      });
      return names;
    };

    const groupForName = (name) =>
      perkGroups.querySelector('.perk-group[data-ability-id="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]');

    const updateEmptyHint = () => {
      if (!perkGroupsEmpty) return;
      perkGroupsEmpty.hidden = perkGroups.querySelector('.perk-group') != null;
    };

    const syncPerkGroups = () => {
      const names = selectedAbilityNames();

      // Remove groups whose ability is no longer selected.
      perkGroups.querySelectorAll('.perk-group').forEach((g) => {
        if (!names.includes(g.getAttribute('data-ability-id'))) g.remove();
      });

      // Add a group for each newly-selected ability (fetch the server scaffold).
      names.forEach((name) => {
        if (groupForName(name)) return;
        const key = 'g' + (groupSeq++);
        const url = '/characters/ability-perk-group?ability=' +
          encodeURIComponent(name) + '&key=' + encodeURIComponent(key);
        fetch(url, { headers: { 'Accept': 'text/html' } })
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((html) => {
            // Guard against a race where the ability was removed mid-fetch.
            if (!selectedAbilityNames().includes(name) || groupForName(name)) return;
            const tpl = document.createElement('div');
            tpl.innerHTML = html.trim();
            const node = tpl.firstElementChild;
            if (!node) return;
            perkGroups.appendChild(node);
            if (window.htmx) window.htmx.process(node);
            updateEmptyHint();
          })
          .catch(() => { /* non-fatal: leave the editor as-is */ });
      });

      updateEmptyHint();
    };

    classSelect.addEventListener('change', () => { applyVersion(); });

    // Ability selects are TomSelect-enhanced; they still dispatch `change` on
    // the underlying <select>. Delegate so dynamically-added rows are covered.
    abilityList.addEventListener('change', (e) => {
      if (e.target && e.target.matches('select[name="abilities[]"]')) syncPerkGroups();
    });

    // Rows are added (htmx) and removed (htmx.remove on the delete button)
    // without a `change` event; observe the list to catch removals/additions.
    const observer = new MutationObserver(() => syncPerkGroups());
    observer.observe(abilityList, { childList: true, subtree: true });

    applyVersion();
    syncPerkGroups();
  };

  ready(init);
  return { init };
})();
