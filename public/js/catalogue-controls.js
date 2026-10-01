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
    // A function is read on every render, for a caller whose list changes.
    var readEntries = function () {
      var list = typeof options.entries === 'function' ? options.entries() : options.entries;
      return Array.isArray(list) ? list : [];
    };
    var groupBy = options.groupBy;
    var searchOf = options.searchOf;
    var renderEntry = options.renderEntry;
    var term = '';

    var compact = typeof options.isOwned === 'function';
    var selectedClass = '';
    root.innerHTML = (compact
      ? '<div data-catalogue-owned></div>'
        + '<details class="box mt-3" data-catalogue-browser><summary class="has-text-link has-text-weight-semibold">'
        + esc(options.addLabel || 'Add items') + '</summary><div class="mt-4">'
      : '')
      + '<label class="field is-block"><span class="label">Search'
      + (compact ? ' all classes' : '') + '</span>'
      + '<input type="search" class="input mb-3" placeholder="Search by name or class…" data-catalogue-search></label>'
      + (compact ? '<label class="field is-block"><span class="label">Browse class</span>'
        + '<span class="select is-fullwidth"><select data-catalogue-class></select></span></label>'
        + '<p class="help mb-3" data-catalogue-count aria-live="polite"></p>' : '')
      + '<div data-catalogue-groups></div>'
      + (compact ? '</div></details>' : '');
    var input = root.querySelector('[data-catalogue-search]');
    var groupsEl = root.querySelector('[data-catalogue-groups]');
    var ownedEl = root.querySelector('[data-catalogue-owned]');
    var classSelect = root.querySelector('[data-catalogue-class]');
    var countEl = root.querySelector('[data-catalogue-count]');

    var matchesTerm = function (entry) {
      if (!term) return true;
      var text = String(searchOf(entry) || '');
      if (compact) text += ' ' + (groupBy(entry) || '');
      return text.toLowerCase().indexOf(term) !== -1;
    };

    var renderGroups = function (entries, browse) {
      return groupEntries(entries, groupBy).map(function (group) {
        var visible = compact && !browse ? group.entries : group.entries.filter(matchesTerm);
        if (!visible.length) return '';
        var heading = group.label
          ? '<h4 class="title is-6" data-catalogue-group-heading>' + esc(group.label) + '</h4>'
          : '';
        var hidden = browse && !term && selectedClass !== String(group.label || '');
        return '<div class="block" data-catalogue-group' + (hidden ? ' hidden' : '') + '>'
          + heading + renderEntry(visible) + '</div>';
      }).join('');
    };

    var render = function () {
      var entries = readEntries();
      var browsing = compact ? entries.filter(function (entry) { return !options.isOwned(entry); }) : entries;
      if (compact) {
        var classes = groupEntries(browsing, groupBy);
        if (!classes.some(function (group) { return String(group.label || '') === selectedClass; })) {
          selectedClass = classes.length ? String(classes[0].label || '') : '';
        }
        classSelect.innerHTML = classes.map(function (group) {
          var label = String(group.label || '');
          return '<option value="' + esc(label) + '"' + (label === selectedClass ? ' selected' : '') + '>'
            + esc(label || 'Other') + '</option>';
        }).join('');
        classSelect.disabled = !!term || !classes.length;
        var owned = entries.filter(options.isOwned);
        ownedEl.innerHTML = renderGroups(owned, false)
          || '<p class="has-text-grey">' + esc(options.emptyLabel || 'No items owned yet.') + '</p>';
        var count = browsing.filter(function (entry) {
          return matchesTerm(entry) && (term || String(groupBy(entry) || '') === selectedClass);
        }).length;
        countEl.textContent = count ? count + (count === 1 ? ' choice' : ' choices')
          : 'No matching choices. Try another search or class.';
      }
      groupsEl.innerHTML = renderGroups(browsing, compact);
    };

    if (compact) {
      classSelect.addEventListener('change', function () {
        selectedClass = classSelect.value;
        render();
        if (options.onViewChange) options.onViewChange();
      });
      root.querySelector('[data-catalogue-browser]').addEventListener('toggle', function () {
        if (options.onViewChange) options.onViewChange();
      });
    }

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
