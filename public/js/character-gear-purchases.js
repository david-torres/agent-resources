// public/js/character-gear-purchases.js
//
// The character edit form's mount for public/js/signature-entry.js. The
// rulebook puts a Signature purchase "including during character creation" --
// creation is one occasion among others, and Merx earned on missions has to
// be spendable afterwards, on the form every character is edited on.
//
// This file reads the page (its JSON island, its common-item rows); the
// component it mounts reads nothing at all. Every price, grant and cap comes
// from the served figures -- no economy number is written down here.
//
// ----------------------------------------------------------------------
// THE SERIALISATION RULE, and it is INVERTED from the wizard's
// ----------------------------------------------------------------------
// The save reads three states for a gear item's `enchantment` (and the same
// three for `mods`):
//
//   key absent      -> keep whatever is stored
//   explicit null   -> remove the Enchantment
//   an object       -> set it
//
// The wizard CREATES a character: nothing is stored, so it sends an explicit
// null for an unenchanted Signature. HERE THE OPPOSITE IS CORRECT. A row the
// player never opened must submit NO `enchantment` key at all, so
// save_character_atomic preserves what is stored. Only a row the player
// actually edited submits the key -- including an explicit null, which means
// "un-enchant this Signature".
//
// That contract exists precisely for this form: it has always submitted gear
// as bare "Class::Item" strings, and such a save must never wipe a purchase.
(function () {
  'use strict';

  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  var mount = function (root) {
    if (!root || !window.SignatureEntry) return null;
    var island = root.querySelector('script[type="application/json"]');
    var data = null;
    try { data = JSON.parse((island && island.textContent) || 'null'); } catch (e) { data = null; }
    if (!data || !data.figures) return null;

    var SignatureEntry = window.SignatureEntry;
    var FIGURES = data.figures;
    var ECONOMY = data.economy;
    var CHARACTER_CLASS_ID = data.characterClassId || null;
    var EARNED_MERX = Math.max(0, Number(data.earnedMerx) || 0);
    var entries = Array.isArray(data.entries) ? data.entries : [];

    // `touched` is this mount's own bookkeeping, never sent: it is what tells
    // an edited row from one the player only looked at. See the rule above.
    var purchases = (Array.isArray(data.purchases) ? data.purchases : []).map(function (row) {
      return {
        name: row.name,
        class_id: row.class_id || null,
        owned: true,
        enchantment: row.enchantment || null,
        mods: Array.isArray(row.mods) ? row.mods : [],
        touched: false
      };
    });

    var open = null;
    var pending = null;

    var grid = root.querySelector('#purchaseGrid');
    var drawer = root.querySelector('#purchaseDrawer');
    var pendingBox = root.querySelector('#purchasePending');
    var gearField = root.querySelector('#purchaseGearJson');
    var merxSpentEl = root.querySelector('[data-merx-spent]');
    var merxBudgetEl = root.querySelector('[data-merx-budget]');
    var slotsUsedEl = root.querySelector('[data-slots-used]');
    var slotsCapEl = root.querySelector('[data-slots-cap]');

    var findEntry = function (name, classId) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].name === name && (classId == null || entries[i].class_id === classId)) {
          return entries[i];
        }
      }
      return null;
    };

    var findPurchase = function (name, classId) {
      for (var i = 0; i < purchases.length; i++) {
        if (purchases[i].name === name && (classId == null || purchases[i].class_id === classId)) {
          return purchases[i];
        }
      }
      return null;
    };

    var crossClassFor = function (classId) {
      return SignatureEntry.isCrossClass({ class_id: classId },
        { economy: ECONOMY, characterClassId: CHARACTER_CLASS_ID });
    };

    var priceOfPurchase = function (purchase) {
      return SignatureEntry.priceOf(purchase,
        { figures: FIGURES, crossClass: crossClassFor(purchase.class_id) });
    };

    // Same figures and tier as priceOfPurchase, so a removal warning can never
    // report a different sum than the purchase actually cost.
    var describePurchaseFor = function (purchase) {
      return SignatureEntry.describePurchase(purchase,
        { figures: FIGURES, crossClass: crossClassFor(purchase.class_id) });
    };

    var priceOfEntry = function (entry) {
      return SignatureEntry.priceOf({ owned: true, enchantment: null, mods: [] },
        { figures: FIGURES, crossClass: crossClassFor(entry.class_id) });
    };

    // The Common Items the form is carrying right now, read from the page:
    // they share the same Merx, so a readout that ignored them would overstate
    // what is left to spend. Their rows are added and removed by htmx, so they
    // are counted at render time rather than held in state.
    var commonItemCount = function () {
      var fields = document.querySelectorAll('#common-items-list [name="common_items[]"]');
      var count = 0;
      for (var i = 0; i < fields.length; i++) {
        if (String(fields[i].value || '').trim()) count++;
      }
      return count;
    };

    // The real budget on this surface: the creation grant this economy gives,
    // plus every Merx the character has earned on missions since.
    var getBudget = function () {
      return FIGURES.grants[ECONOMY] + EARNED_MERX;
    };

    var getSpent = function () {
      return SignatureEntry.totalOf(purchases, {
        figures: FIGURES, economy: ECONOMY, characterClassId: CHARACTER_CLASS_ID
      }) + commonItemCount() * FIGURES.prices.commonItem;
    };

    var getSlotsUsed = function () {
      return purchases.reduce(function (slots, p) {
        return slots + SignatureEntry.slotsOf(p);
      }, 0);
    };

    var signatureCap = function () { return FIGURES.signatureCap[ECONOMY]; };

    // Both limits the save enforces on this economy (services/character/
    // input.js validateEconomyLimits): a surface that let a player assemble
    // either breach would hand them a character they cannot save.
    var affordsChange = function (merxDelta, slotDelta) {
      if (getSpent() + merxDelta > getBudget()) return false;
      var cap = signatureCap();
      return cap === null || getSlotsUsed() + slotDelta <= cap;
    };

    // A Default stores its source and nothing else: the text belongs to the
    // class, which serves it with the entry. A Signature that prints no
    // Default cannot take one.
    var normalizeEnchantment = function (enchantment, entry) {
      if (!enchantment || !enchantment.source) return null;
      if (enchantment.source === 'default') {
        return (entry && entry.default_enchantment && entry.default_enchantment.name)
          ? { source: 'default' }
          : null;
      }
      return {
        source: 'custom',
        name: enchantment.name || '',
        description: enchantment.description || ''
      };
    };

    // ---- serialisation ------------------------------------------------
    // The rule at the top of this file, in code: a row is described by name
    // and owning class always, and by its equipment only when the player
    // edited it. An untouched row mentions no `enchantment` or `mods` key, so
    // the save keeps what is stored.
    var serialize = function () {
      return {
        gear: purchases.map(function (p) {
          var item = { name: p.name };
          if (p.class_id) item.class_id = p.class_id;
          if (p.touched) {
            item.enchantment = p.enchantment || null;
            item.mods = Array.isArray(p.mods) ? p.mods : [];
          }
          return item;
        })
      };
    };

    // ---- mutations ----------------------------------------------------
    var buySignature = function (name, classId) {
      var entry = findEntry(name, classId);
      if (!entry) return false;
      if (findPurchase(entry.name, entry.class_id)) return false;
      var purchase = {
        name: entry.name,
        class_id: entry.class_id,
        owned: true,
        enchantment: null,
        mods: [],
        // Nothing is stored for a Signature bought just now, so there is
        // nothing to keep: it states both keys.
        touched: true
      };
      if (!affordsChange(priceOfPurchase(purchase), SignatureEntry.slotsOf(purchase))) return false;
      purchases.push(purchase);
      render();
      return true;
    };

    var dropSignature = function (name, classId) {
      for (var i = purchases.length - 1; i >= 0; i--) {
        var p = purchases[i];
        if (p.name === name && (classId == null || p.class_id === classId)) {
          purchases.splice(i, 1);
          break;
        }
      }
      if (open && open.name === name) open = null;
      render();
    };

    // Ruling 5: a rename is a delete plus an insert, so dropping a Signature
    // that carries a paid Enchantment or Mods destroys them outright. A bare
    // Signature -- describePurchase answers `total: 0` -- has nothing to lose
    // and goes at once.
    var removeSignature = function (name, classId) {
      var purchase = findPurchase(name, classId);
      if (!purchase) return false;
      var described = describePurchaseFor(purchase);
      if (described.total > 0) {
        pending = {
          name: name, classId: purchase.class_id, lines: described.lines, total: described.total
        };
        render();
        return true;
      }
      dropSignature(name, purchase.class_id);
      return true;
    };

    var getPendingConfirmation = function () { return pending; };

    var confirmPending = function () {
      if (!pending) return;
      var held = pending;
      pending = null;
      dropSignature(held.name, held.classId);
    };

    // Discards the pending removal without touching the purchase: the
    // Signature, its Enchantment (a typed Custom included) and its Mods were
    // never removed, so there is nothing to restore.
    var cancelPending = function () {
      if (!pending) return;
      pending = null;
      render();
    };

    // pg. 8: an Enchantment is bought onto a Signature the character owns, and
    // takes a Signature slot as well as its price, so both gates apply.
    // The apply* pair below changes the purchase and nothing else; the
    // exported set* wrappers re-render around them. Typing into a Mod field
    // needs the change without the re-render that would take the caret out of
    // the field, which is the whole reason the two are separate.
    var applyEnchantment = function (name, enchantment, classId) {
      var purchase = findPurchase(name, classId);
      if (!purchase) return false;
      var next = normalizeEnchantment(enchantment, findEntry(name, purchase.class_id));
      var after = { owned: true, class_id: purchase.class_id, enchantment: next, mods: purchase.mods };
      if (!affordsChange(priceOfPurchase(after) - priceOfPurchase(purchase),
                         SignatureEntry.slotsOf(after) - SignatureEntry.slotsOf(purchase))) return false;
      purchase.enchantment = next;
      purchase.touched = true;
      return true;
    };

    // pg. 87: a Mod is a purchase, so an unnamed row is not one -- otherwise
    // an empty row between two named ones would charge the second at the
    // dearer rate the table gives a Signature's second Mod. Mods take no slot.
    var applyMods = function (name, mods, classId) {
      var purchase = findPurchase(name, classId);
      if (!purchase) return false;
      var next = (Array.isArray(mods) ? mods : []).map(function (m) {
        return {
          name: ((m && m.name) || '').trim(),
          description: ((m && m.description) || '').trim()
        };
      }).filter(function (m) { return m.name.length > 0; });
      var after = { owned: true, class_id: purchase.class_id, enchantment: purchase.enchantment, mods: next };
      if (!affordsChange(priceOfPurchase(after) - priceOfPurchase(purchase), 0)) return false;
      purchase.mods = next;
      purchase.touched = true;
      return true;
    };

    var setEnchantment = function (name, enchantment, classId) {
      var changed = applyEnchantment(name, enchantment, classId);
      render();
      return changed;
    };

    var setMods = function (name, mods, classId) {
      var changed = applyMods(name, mods, classId);
      render();
      return changed;
    };

    var openSignature = function (name, classId) {
      var entry = findEntry(name, classId);
      if (!entry) return false;
      open = (open && open.name === entry.name && open.classId === entry.class_id)
        ? null
        : { name: entry.name, classId: entry.class_id };
      render();
      return true;
    };

    // ---- rendering ----------------------------------------------------
    var isOpen = function (entry) {
      return !!open && open.name === entry.name && open.classId === entry.class_id;
    };

    var renderCell = function (entry) {
      var purchase = findPurchase(entry.name, entry.class_id);
      var tag = purchase
        ? '<span class="tag is-success is-light ml-2">Owned</span>'
        : '<span class="tag is-warning is-light ml-2">' + priceOfEntry(entry) + ' Merx</span>';
      var origin = crossClassFor(entry.class_id) && entry.class_name
        ? '<span class="tag is-info is-light ml-2">' + esc(entry.class_name) + '</span>'
        : '';
      return '<button type="button"'
        + ' class="button is-small is-fullwidth is-justify-content-space-between mb-2'
        + (isOpen(entry) ? ' is-active' : '') + '"'
        + ' data-signature-name="' + esc(entry.name) + '"'
        + ' data-signature-class="' + esc(entry.class_id) + '">'
        + '<span>' + esc(entry.name) + '</span>' + origin + tag
        + '</button>';
    };

    // The book prints a class's Signatures down columns; `column` carries that
    // layout, so the grid keeps it. An entry with no column recorded (a
    // carried cross-class row) prints in the first.
    var renderGrid = function () {
      if (!grid) return;
      var columns = [];
      entries.forEach(function (entry) {
        var key = entry.column || 1;
        var column = null;
        for (var i = 0; i < columns.length; i++) if (columns[i].key === key) column = columns[i];
        if (!column) { column = { key: key, cells: [] }; columns.push(column); }
        column.cells.push(entry);
      });
      columns.sort(function (a, b) { return a.key - b.key; });
      grid.innerHTML = columns.length
        ? '<div class="columns is-multiline">' + columns.map(function (column) {
            return '<div class="column">' + column.cells.map(renderCell).join('') + '</div>';
          }).join('') + '</div>'
        : '';
    };

    var renderPurchaseControls = function (entry, purchase) {
      if (purchase) {
        return '<p class="control mt-3"><button type="button"'
          + ' class="button is-small is-danger is-light" data-signature-sell>Remove</button></p>';
      }
      var price = priceOfEntry(entry);
      var affordable = affordsChange(price, 1);
      return '<p class="control mt-3"><button type="button" class="button is-small is-primary"'
        + (affordable ? '' : ' disabled') + ' data-signature-buy'
        + '>Buy for ' + price + ' Merx</button></p>';
    };

    var renderDrawer = function () {
      if (!drawer) return;
      var entry = open ? findEntry(open.name, open.classId) : null;
      if (!entry) {
        drawer.hidden = true;
        drawer.innerHTML = '';
        return;
      }
      var purchase = findPurchase(entry.name, entry.class_id);
      drawer.hidden = false;
      drawer.innerHTML = SignatureEntry.render(entry, purchase, {
        figures: FIGURES,
        crossClass: crossClassFor(entry.class_id),
        economy: ECONOMY,
        readOnly: false
      }) + renderPurchaseControls(entry, purchase);
    };

    // The warning's prices are the `lines` describePurchase already priced
    // from the served figures -- nothing here writes down a figure of its own.
    var renderPending = function () {
      if (!pendingBox) return;
      pendingBox.hidden = !pending;
      if (!pending) { pendingBox.innerHTML = ''; return; }
      pendingBox.className = 'notification is-warning';
      pendingBox.innerHTML = ''
        + '<p>Removing "' + esc(pending.name) + '" also removes what you paid for it:</p>'
        + '<ul>' + pending.lines.map(function (line) {
            return '<li>' + esc(line) + '</li>';
          }).join('') + '</ul>'
        + '<div class="buttons">'
        +   '<button type="button" class="button is-small is-danger" data-confirm-removal>Remove anyway</button>'
        +   '<button type="button" class="button is-small" data-cancel-removal>Keep it</button>'
        + '</div>';
    };

    var renderReadouts = function () {
      if (merxSpentEl) merxSpentEl.textContent = String(getSpent());
      if (merxBudgetEl) merxBudgetEl.textContent = String(getBudget());
      if (slotsUsedEl) slotsUsedEl.textContent = String(getSlotsUsed());
      var cap = signatureCap();
      if (slotsCapEl) slotsCapEl.textContent = cap === null ? '—' : String(cap);
    };

    // The form is submitted by htmx, which serializes the form's own named
    // fields -- so this hidden input is the only thing that carries a purchase
    // to the server. Written on every change rather than at submit: there is
    // then no moment at which the field disagrees with what is on screen.
    var writeForm = function () {
      if (gearField) gearField.value = JSON.stringify(serialize().gear);
    };

    var render = function () {
      renderGrid();
      renderDrawer();
      renderPending();
      renderReadouts();
      writeForm();
    };

    // ---- wiring -------------------------------------------------------
    if (grid) {
      grid.addEventListener('click', function (e) {
        var cell = e.target.closest('[data-signature-name]');
        if (!cell) return;
        e.preventDefault();
        openSignature(cell.getAttribute('data-signature-name'),
          cell.getAttribute('data-signature-class'));
      });
    }

    // Reads the drawer's text fields into the open purchase, leaving the
    // drawer itself alone. The Enchantment name and description are only read
    // when a Custom is the one chosen; the Mod rows are read whenever the
    // entry offers them.
    var readDrawerFields = function () {
      if (!open || !drawer) return;
      var purchase = findPurchase(open.name, open.classId);
      if (!purchase) return;
      if (purchase.enchantment && purchase.enchantment.source === 'custom') {
        var nameEl = drawer.querySelector('[data-custom-name]');
        var descEl = drawer.querySelector('[data-custom-description]');
        applyEnchantment(open.name, {
          source: 'custom',
          name: nameEl ? nameEl.value : '',
          description: descEl ? descEl.value : ''
        }, open.classId);
      }
      var rows = Array.prototype.slice.call(drawer.querySelectorAll('[data-mod-index]'));
      if (rows.length) {
        applyMods(open.name, rows.map(function (row) {
          var modName = row.querySelector('[data-mod-name]');
          var modDesc = row.querySelector('[data-mod-description]');
          return {
            name: modName ? modName.value : '',
            description: modDesc ? modDesc.value : ''
          };
        }), open.classId);
      }
    };

    // What the Enchantment radios mean. Picking Custom keeps whatever text is
    // already typed, so switching away and back does not wipe it.
    var enchantmentChoice = function (value, purchase) {
      if (value === 'default') return { source: 'default' };
      if (value !== 'custom') return null;
      var current = (purchase && purchase.enchantment) || {};
      return {
        source: 'custom',
        name: current.source === 'custom' ? current.name : '',
        description: current.source === 'custom' ? current.description : ''
      };
    };

    var isDrawerTextField = function (el) {
      return !!el && !!el.closest(
        '[data-custom-name],[data-custom-description],[data-mod-name],[data-mod-description]'
      );
    };

    if (drawer) {
      drawer.addEventListener('click', function (e) {
        if (!open) return;
        if (e.target.closest('[data-signature-buy]')) {
          e.preventDefault();
          buySignature(open.name, open.classId);
          return;
        }
        if (e.target.closest('[data-signature-sell]')) {
          e.preventDefault();
          removeSignature(open.name, open.classId);
        }
      });
      drawer.addEventListener('change', function (e) {
        if (!open) return;
        var radio = e.target.closest('input[name="enchantment"]');
        if (radio) {
          setEnchantment(open.name,
            enchantmentChoice(radio.value, findPurchase(open.name, open.classId)), open.classId);
          return;
        }
        // A committed text field: re-render, which both settles the word
        // count and puts back what a refused change (an unaffordable Mod)
        // left typed.
        if (isDrawerTextField(e.target)) {
          readDrawerFields();
          render();
        }
      });
      drawer.addEventListener('input', function (e) {
        // Typed text lands on the purchase as it is typed, but the drawer is
        // not re-rendered: replacing the field mid-word would take the caret
        // out of it. Only what a Mod's price moves is refreshed.
        if (!isDrawerTextField(e.target)) return;
        readDrawerFields();
        renderReadouts();
        writeForm();
      });
    }

    if (pendingBox) {
      pendingBox.addEventListener('click', function (e) {
        if (e.target.closest('[data-confirm-removal]')) {
          e.preventDefault();
          confirmPending();
        } else if (e.target.closest('[data-cancel-removal]')) {
          e.preventDefault();
          cancelPending();
        }
      });
    }

    render();

    return {
      serialize: serialize,
      getState: function () { return { entries: entries, purchases: purchases, open: open }; },
      getBudget: getBudget,
      getSpent: getSpent,
      getSlotsUsed: getSlotsUsed,
      buySignature: buySignature,
      removeSignature: removeSignature,
      getPendingConfirmation: getPendingConfirmation,
      confirmPending: confirmPending,
      cancelPending: cancelPending,
      setEnchantment: setEnchantment,
      setMods: setMods,
      openSignature: openSignature
    };
  };

  window.CharacterGearPurchases = { mount: mount, instance: null };

  var boot = function () {
    window.CharacterGearPurchases.instance =
      mount(document.getElementById('signaturePurchases'));
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
