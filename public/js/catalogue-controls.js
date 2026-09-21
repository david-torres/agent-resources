// public/js/catalogue-controls.js
//
// The one grouping-and-search control both purchase catalogues on the
// character edit form mount: the Signature grid
// (character-gear-purchases.js) and the Ability catalogue
// (character-ability-purchases.js). A second ungrouped catalogue is what
// forced the question, so this is built once and used by both.
//
// It groups entries by whatever `groupBy` returns and filters them by
// `searchOf` against a search term it owns -- the caller's view carries no
// search markup of its own. It renders no entry itself: each group's body is
// produced by the `renderEntry` the caller supplies, given that group's
// (already search-filtered) entries. This file knows nothing about Perks,
// Merx, abilities or Signatures.
(function () {
  'use strict';

  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // Buckets `entries` by `groupBy(entry)`, in the order each key is first
  // seen. An entry whose groupBy value is null, undefined or '' falls into
  // one shared, unlabelled group rather than being dropped -- both the
  // ability and Signature catalogues carry rows a donor class no longer
  // resolves.
  // `byKey` has no prototype: its keys are player-authored class names, and a
  // class called `constructor` or `toString` would otherwise find an inherited
  // value where this looks for a group it has already made, then push onto
  // something that is not a group and take the whole catalogue down with it.
  var groupEntries = function (entries, groupBy) {
    var order = [];
    var byKey = Object.create(null);
    entries.forEach(function (entry) {
      var label = groupBy(entry);
      var key = (label == null || label === '') ? '' : label;
      if (!byKey[key]) {
        byKey[key] = { label: key || null, entries: [] };
        order.push(key);
      }
      byKey[key].entries.push(entry);
    });
    return order.map(function (key) { return byKey[key]; });
  };

  var mount = function (root, options) {
    if (!root) return null;
    var entries = Array.isArray(options.entries) ? options.entries : [];
    var groupBy = options.groupBy;
    var searchOf = options.searchOf;
    var renderEntry = options.renderEntry;
    var term = '';

    root.innerHTML = ''
      + '<input type="search" class="input mb-3" placeholder="Search..." data-catalogue-search>'
      + '<div data-catalogue-groups></div>';
    var input = root.querySelector('[data-catalogue-search]');
    var groupsEl = root.querySelector('[data-catalogue-groups]');

    var matchesTerm = function (entry) {
      if (!term) return true;
      return String(searchOf(entry) || '').toLowerCase().indexOf(term) !== -1;
    };

    var render = function () {
      var groups = groupEntries(entries, groupBy);
      groupsEl.innerHTML = groups.map(function (group) {
        var visible = group.entries.filter(matchesTerm);
        if (!visible.length) return '';
        var heading = group.label
          ? '<h4 class="title is-6" data-catalogue-group-heading>' + esc(group.label) + '</h4>'
          : '';
        return '<div class="block" data-catalogue-group>' + heading + renderEntry(visible) + '</div>';
      }).join('');
    };

    var setSearch = function (value) {
      var raw = value == null ? '' : String(value);
      term = raw.trim().toLowerCase();
      input.value = raw;
      render();
    };

    input.addEventListener('input', function () { setSearch(input.value); });

    // Both catalogues mount inside the character form (views/character-form.
    // handlebars), which submits on Enter through its own submit button. A
    // search box is not a way to save a character, so Enter here narrows the
    // list and goes no further.
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') event.preventDefault();
    });

    render();

    return { render: render, setSearch: setSearch };
  };

  window.CatalogueControls = { mount: mount };
})();
