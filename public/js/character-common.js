// Shared helpers for the character creator, stats editor, and level-up modules
// (character-wizard.js, character-stats.js, character-level-up.js). Loaded
// before them on every page that uses those modules; exposes the
// CharacterCommon namespace in the same single-IIFE style as public/js/app.js.
const CharacterCommon = (function () {
  // The 12 stats in canonical order (matches statList in
  // util/enclave-consts.js).
  const STATS = [
    'vitality', 'might', 'resilience', 'spirit',
    'arcane', 'will', 'sensory', 'reflex',
    'vigor', 'skill', 'intelligence', 'luck'
  ];

  // Mission count per level (cumulative). Each step costs 2, 2, 3, 3, 4, 4,
  // 5, 5, 6, 6 missions; missionsForLevel returns the running total needed to
  // reach the given level (matches v2LevelingSequence in
  // util/enclave-consts.js).
  const v2LevelingSequence = [2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
  const missionsForLevel = (level) => {
    const lvl = Math.max(1, parseInt(level, 10) || 1);
    if (lvl <= 1) return 0;
    let sum = 0;
    for (let i = 0; i < lvl - 1 && i < v2LevelingSequence.length; i++) {
      sum += v2LevelingSequence[i];
    }
    return sum;
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

  return { STATS, v2LevelingSequence, missionsForLevel, ready, getAuthHeader, showError, clearError };
})();
