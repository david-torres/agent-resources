// Shared helpers for the character creator and level-up modules
// (character-wizard.js, character-level-up.js), plus the Alpine
// characterStats component in alpine-components.js. Loaded before them on
// every page that uses those modules; exposes the CharacterCommon
// namespace.
//
// Assigned to `window` rather than a top-level `const` so the script is safe to
// re-execute. The layout sets hx-boost, which swaps the <body> (where these
// module scripts live) on navigation while keeping the JS realm alive, so each
// script runs again on every boosted page change — a `const` throws
// "redeclaration of const X" on the second run. app.js can use `const` because
// it loads in <head>, outside the swapped region, and never re-runs. The other
// character modules follow this same window-assignment for the same reason.
window.CharacterCommon = (function () {
  // The 12 stats in canonical order (matches statList in
  // util/enclave-consts.js).
  const STATS = [
    'vitality', 'might', 'resilience', 'spirit',
    'arcane', 'will', 'sensory', 'reflex',
    'vigor', 'skill', 'intelligence', 'luck'
  ];

  // Thresholds are supplied by the server for the selected class and mode.
  const missionsForLevel = (level, progression) => {
    const lvl = Number(level);
    if (!progression || !Number.isInteger(lvl) || lvl < 1 || lvl > progression.maxLevel
        || !Array.isArray(progression.thresholds) || !Number.isFinite(progression.thresholds[lvl - 1])) {
      throw new Error('Character progression rules unavailable');
    }
    return progression.thresholds[lvl - 1];
  };

  // Run fn once the DOM is parsed.
  const ready = (fn) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };

  // Auth headers from the stored session tokens (same localStorage keys
  // app.js writes on sign-in).
  const getAuthHeader = () => {
    const token = localStorage.getItem('authToken');
    return token ? { 'Authorization': 'Bearer ' + token, 'Refresh-Token': localStorage.getItem('refreshToken') || '' } : {};
  };

  // Show/clear a feature-local error box by element id.
  const showError = (elementId, msg) => {
    const box = document.getElementById(elementId);
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('is-hidden');
  };
  const clearError = (elementId) => {
    const box = document.getElementById(elementId);
    if (!box) return;
    box.classList.add('is-hidden');
    box.textContent = '';
  };

  return { STATS, missionsForLevel, ready, getAuthHeader, showError, clearError };
})();
