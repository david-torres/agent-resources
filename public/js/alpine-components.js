// Alpine.data() registrations.
//
// This file MUST load before the Alpine CDN tag in head.handlebars.
// Alpine's CDN build calls Alpine.start() inside a queueMicrotask that
// fires immediately after its own script tag — before the next deferred
// script — so an alpine:init listener registered later never runs.
//
// Unlike the character-* modules this is loaded from <head>, outside the
// hx-boost swap region, so it executes exactly once and can use const.
document.addEventListener('alpine:init', () => {
  // Inline stats editor on the character show page. Replaces the old
  // vanilla-JS stats-editor module (now deleted).
  //
  // The save stays a fetch rather than becoming hx-patch: the endpoint
  // responds with JSON, so htmx would try to swap a JSON body into the
  // DOM. Changing the route is out of scope.
  Alpine.data('characterStats', (characterId, initialStats) => ({
    editing: false,
    saving: false,
    error: '',
    stats: Object.assign({}, initialStats),

    get total() {
      return Object.values(this.stats)
        .reduce((sum, value) => sum + (parseInt(value, 10) || 0), 0);
    },

    edit() {
      this.error = '';
      this.editing = true;
      this.$nextTick(() => {
        const first = this.$el.querySelector('.stats-input');
        if (first) first.focus();
      });
    },

    cancel() {
      this.error = '';
      this.editing = false;
      this.stats = Object.assign({}, initialStats);
    },

    save() {
      this.error = '';
      this.saving = true;

      // Coerce to integers and clamp to [0, 20], matching the range the
      // old module enforced before PATCHing.
      const payload = {};
      Object.keys(this.stats).forEach((stat) => {
        let n = parseInt(this.stats[stat], 10);
        if (isNaN(n) || n < 0) n = 0;
        if (n > 20) n = 20;
        payload[stat] = n;
      });

      return fetch('/characters/' + encodeURIComponent(characterId) + '/stats', {
        method: 'PATCH',
        headers: Object.assign(CharacterCommon.getAuthHeader(), {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify(payload)
      }).then((res) => {
        if (!res.ok) {
          return res.text().then((text) => {
            throw new Error(text || ('HTTP ' + res.status));
          });
        }
        window.location.reload();
      }).catch((err) => {
        this.error = 'Save failed: ' + ((err && err.message) || 'Unknown error');
      }).finally(() => {
        this.saving = false;
      });
    }
  }));
});
