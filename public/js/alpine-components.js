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
    root: null,

    init() {
      // Capture the x-data root here, not inside edit(). $el is bound to
      // whichever element invoked the current method — inside edit() that
      // is the Edit <button> itself (called via @click="edit()"), which has
      // no .stats-input descendants, so querySelector off $el there always
      // returns null and focus silently never moves. init() runs with $el
      // bound to the x-data root, which does contain the inputs.
      this.root = this.$el;
    },

    get total() {
      return Object.values(this.stats)
        .reduce((sum, value) => sum + (parseInt(value, 10) || 0), 0);
    },

    edit() {
      this.error = '';
      this.editing = true;
      this.$nextTick(() => {
        const first = this.root.querySelector('.stats-input');
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

  // Click-to-sort table. Replaces the inline script in
  // views/character-list.handlebars.
  Alpine.data('sortableTable', () => ({
    key: null,
    dir: 1,

    // `$el` inside a method binds to the element that INVOKED it — here the
    // clicked <th>, not the table. Querying 'thead th' from a <th> returns
    // nothing, colIndex resolves to -1, and sorting silently does nothing.
    // Capture the root in init(), where `$el` IS the x-data element.
    root: null,

    init() {
      this.root = this.$el;
    },

    indicator(key) {
      if (this.key !== key) return '⇅';
      return this.dir === 1 ? '▲' : '▼';
    },

    sortBy(key, type) {
      this.dir = this.key === key ? -this.dir : 1;
      this.key = key;

      // Each sortable <th> carries data-sort-key; its position in the
      // header row is the cell index to read in every body row.
      const columns = Array.from(this.root.querySelectorAll('thead th'));
      const colIndex = columns.findIndex((th) => th.dataset.sortKey === key);
      if (colIndex === -1) return;

      const body = this.root.querySelector('tbody');
      const rows = Array.from(body.querySelectorAll('tr'));

      const valueOf = (row) => {
        const cell = row.children[colIndex];
        if (!cell) return '';
        return cell.dataset.sortValue !== undefined
          ? cell.dataset.sortValue
          : cell.textContent.trim();
      };

      rows.sort((a, b) => {
        const av = valueOf(a);
        const bv = valueOf(b);
        if (type === 'number') {
          return ((parseFloat(av) || 0) - (parseFloat(bv) || 0)) * this.dir;
        }
        return av.localeCompare(bv) * this.dir;
      });

      rows.forEach((row) => body.appendChild(row));
    }
  }));
});
