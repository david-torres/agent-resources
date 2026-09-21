// public/js/character-ability-purchases.js
//
// The character edit form's mount for the V1 Perk purchase surface. pg. 3
// lists spending Perks to unlock Abilities, Cross-Class included, as one of
// Aspirant's additions to Advent progression -- so this surface exists only
// for the two V1 economies (util/ability-purchase-data.js is null for
// everyone else, the same contract util/gear-purchase-data.js establishes
// for Signatures).
//
// This file reads the page (its JSON island); the catalogue it draws reads
// nothing at all. Every price, grant and cap the code uses comes from the
// served figures -- no economy number is computed from a literal here. Where
// the comments below name a figure, they are citing the rulebook page the
// code implements, not supplying it.
//
// The rule that matters most: affordability consults both the balance and
// the cap. pg. 7's six-Ability cap "cannot be increased, even via Flavor",
// so a character with Perks in hand but already at its cap cannot buy
// another -- checking the balance alone would sell a seventh.
(function () {
  'use strict';

  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // Mirrors util/perk-economy.js priceOfAbility for one (crossClass, type)
  // pair. The arithmetic lives twice -- a browser cannot require CommonJS --
  // and test/character-ability-purchases.test.js pins the two to each other
  // for every combination, so they cannot drift apart while both stay green.
  // Exposed on the module itself (not only inside a mounted instance) so
  // that pinning test needs no DOM.
  var priceOf = function (figures, crossClass, type) {
    var tier = crossClass ? 'cross' : 'own';
    var rank = type === 'advanced' ? 'advanced' : 'core';
    return figures.prices.ability[tier][rank];
  };

  var mount = function (root) {
    if (!root || !window.CatalogueControls) return null;
    var island = root.querySelector('script[type="application/json"]');
    var data = null;
    try { data = JSON.parse((island && island.textContent) || 'null'); } catch (e) { data = null; }
    if (!data || !data.figures) return null;

    var FIGURES = data.figures;
    var ECONOMY = data.economy;
    // util/ability-purchase-data.js serves the level already run through
    // normalizeLevel (the same clamp util/stat-caps.js applies both ends
    // of), so this file only guards against a non-numeric value -- it never
    // re-derives the ceiling itself.
    var LEVEL = Number(data.level) || 1;
    // What the character has already spent on Ability Perks
    // (util/perk-economy.js#abilityPerkSpend), served rather than
    // recomputed: the server's budget is unlock spend PLUS this, and a
    // surface that only tracked unlock spend would show a balance the
    // server does not agree with.
    var ABILITY_PERK_SPEND = Math.max(0, Number(data.abilityPerkSpend) || 0);
    var entries = Array.isArray(data.entries) ? data.entries : [];

    // The character's current roster: what it already owns, plus whatever
    // this mount buys or drops. Each row is only what the hidden field must
    // carry -- an ability's price and cross-class standing are looked up
    // from `entries` (the island's own catalogue), never duplicated here.
    var purchases = (Array.isArray(data.owned) ? data.owned : []).map(function (row) {
      return {
        name: row.name,
        class_id: row.class_id || null,
        type: row.type === 'advanced' ? 'advanced' : 'core'
      };
    });

    var catalogue = root.querySelector('#abilityCatalogue');
    var abilityField = root.querySelector('#abilityJson');
    var perksSpentEl = root.querySelector('[data-perks-spent]');
    var perksEarnedEl = root.querySelector('[data-perks-earned]');
    var abilitiesUsedEl = root.querySelector('[data-abilities-used]');
    var abilitiesCapEl = root.querySelector('[data-abilities-cap]');

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

    var priceOfEntry = function (entry) {
      return priceOf(FIGURES, entry.crossClass, entry.type);
    };

    // The Perks actually earned by this level, from the served grant and
    // per-level rate -- never a number this file writes down itself.
    var getEarned = function () {
      return FIGURES.grants[ECONOMY] + FIGURES.perksPerLevel * (LEVEL - 1);
    };

    // pg. 7: a character's own Core roster IS its free allowance, so the
    // first `freeCoreAbilities` own-class Core abilities cost nothing; every
    // other ability spends its full price. Every own-Core row prices
    // identically (see util/perk-economy.js#unlockSpend), so the running
    // total does not depend on which ones happen to be waived -- only how
    // many are. ABILITY_PERK_SPEND is added on top, matching
    // util/perk-economy.js#perkSpend's unlockSpend + abilityPerkSpend: the
    // save the server ratchets against charges both.
    var getSpent = function () {
      var free = (FIGURES.freeCoreAbilities && FIGURES.freeCoreAbilities[ECONOMY]) || 0;
      var waived = 0;
      var spend = 0;
      purchases.forEach(function (purchase) {
        var entry = findEntry(purchase.name, purchase.class_id);
        var crossClass = !!(entry && entry.crossClass);
        var isOwnCore = !crossClass && purchase.type === 'core';
        if (isOwnCore && waived < free) {
          waived += 1;
          return;
        }
        spend += entry ? priceOfEntry(entry) : 0;
      });
      return spend + ABILITY_PERK_SPEND;
    };

    var getAbilitiesUsed = function () { return purchases.length; };

    var abilityCap = function () { return FIGURES.abilityCap[ECONOMY]; };

    // What buying `entry` would add to the running spend, given what is
    // already held -- not always its own price, since it may fall inside
    // the free-Core allowance getSpent() already accounts for.
    var marginalCost = function (entry) {
      if (!entry.crossClass && entry.type === 'core') {
        var free = (FIGURES.freeCoreAbilities && FIGURES.freeCoreAbilities[ECONOMY]) || 0;
        var ownCoreHeld = purchases.filter(function (purchase) {
          var held = findEntry(purchase.name, purchase.class_id);
          return held && !held.crossClass && purchase.type === 'core';
        }).length;
        if (ownCoreHeld < free) return 0;
      }
      return priceOfEntry(entry);
    };

    // Both limits pg. 7 states: the Perk balance, and the cap that "cannot
    // be increased, even via Flavor". A surface that checked only the
    // balance would sell a seventh ability to a character with Perks left
    // but no room for it.
    var affordsPurchase = function (entry) {
      var cap = abilityCap();
      if (cap != null && getAbilitiesUsed() + 1 > cap) return false;
      return getSpent() + marginalCost(entry) <= getEarned();
    };

    var serialize = function () {
      return {
        abilities: purchases.map(function (p) {
          return { name: p.name, class_id: p.class_id || null, type: p.type };
        })
      };
    };

    var buyAbility = function (name, classId) {
      var entry = findEntry(name, classId);
      if (!entry) return false;
      if (findPurchase(entry.name, entry.class_id)) return false;
      if (!affordsPurchase(entry)) return false;
      purchases.push({ name: entry.name, class_id: entry.class_id, type: entry.type });
      render();
      return true;
    };

    var dropAbility = function (name, classId) {
      for (var i = purchases.length - 1; i >= 0; i--) {
        var p = purchases[i];
        if (p.name === name && (classId == null || p.class_id === classId)) {
          purchases.splice(i, 1);
          break;
        }
      }
      render();
    };

    // ---- rendering ------------------------------------------------------
    // Kept apart from renderCatalogue below: renderEntry draws one entry,
    // renderCatalogue lays the whole set out through CatalogueControls,
    // which groups by class and searches by name.
    var renderEntry = function (entry) {
      var purchase = findPurchase(entry.name, entry.class_id);
      var origin = entry.crossClass && entry.class_name
        ? '<span class="tag is-info is-light ml-2">' + esc(entry.class_name) + '</span>'
        : '';
      var priceTag = purchase
        ? '<span class="tag is-success is-light ml-2">Owned</span>'
        : '<span class="tag is-warning is-light ml-2">' + priceOfEntry(entry) + ' Perks</span>';
      var button = purchase
        ? '<button type="button" class="button is-small is-danger is-light"'
          + ' data-ability-drop data-ability-name="' + esc(entry.name) + '"'
          + ' data-ability-class="' + esc(entry.class_id || '') + '">Drop</button>'
        : '<button type="button" class="button is-small is-primary"'
          + (affordsPurchase(entry) ? '' : ' disabled')
          + ' data-ability-buy data-ability-name="' + esc(entry.name) + '"'
          + ' data-ability-class="' + esc(entry.class_id || '') + '">Buy</button>';
      return '<div class="box mb-2" data-ability-entry'
        + ' data-ability-name="' + esc(entry.name) + '"'
        + ' data-ability-class="' + esc(entry.class_id || '') + '">'
        + '<p><strong>' + esc(entry.name) + '</strong>' + origin + priceTag + '</p>'
        + '<p class="control mt-2">' + button + '</p>'
        + '</div>';
    };

    // The catalogue's body, per class group: every entry CatalogueControls
    // hands back after search, each drawn by renderEntry above.
    var renderGroupBody = function (groupEntries) {
      return groupEntries.map(renderEntry).join('');
    };

    var catalogueControl = null;
    var renderCatalogue = function () {
      if (!catalogue) return;
      if (catalogueControl) { catalogueControl.render(); return; }
      catalogueControl = window.CatalogueControls.mount(catalogue, {
        entries: entries,
        groupBy: function (entry) { return entry.class_name; },
        searchOf: function (entry) { return entry.name; },
        renderEntry: renderGroupBody
      });
    };

    var renderReadouts = function () {
      if (perksSpentEl) perksSpentEl.textContent = String(getSpent());
      if (perksEarnedEl) perksEarnedEl.textContent = String(getEarned());
      if (abilitiesUsedEl) abilitiesUsedEl.textContent = String(getAbilitiesUsed());
      var cap = abilityCap();
      if (abilitiesCapEl) abilitiesCapEl.textContent = cap == null ? '—' : String(cap);
    };

    // The form is submitted by htmx, which serializes the form's own named
    // fields -- so this hidden input is the only thing that carries a
    // purchase to the server. Written on every change rather than at
    // submit: there is then no moment at which the field disagrees with
    // what is on screen.
    var writeForm = function () {
      if (abilityField) abilityField.value = JSON.stringify(serialize().abilities);
    };

    var render = function () {
      renderCatalogue();
      renderReadouts();
      writeForm();
    };

    if (catalogue) {
      catalogue.addEventListener('click', function (e) {
        var buy = e.target.closest('[data-ability-buy]');
        if (buy) {
          e.preventDefault();
          buyAbility(buy.getAttribute('data-ability-name'), buy.getAttribute('data-ability-class') || null);
          return;
        }
        var drop = e.target.closest('[data-ability-drop]');
        if (drop) {
          e.preventDefault();
          dropAbility(drop.getAttribute('data-ability-name'), drop.getAttribute('data-ability-class') || null);
        }
      });
    }

    render();

    return {
      serialize: serialize,
      getState: function () { return { entries: entries, purchases: purchases }; },
      getSpent: getSpent,
      getEarned: getEarned,
      getAbilitiesUsed: getAbilitiesUsed,
      abilityCap: abilityCap,
      buyAbility: buyAbility,
      dropAbility: dropAbility
    };
  };

  window.CharacterAbilityPurchases = { mount: mount, instance: null, priceOf: priceOf };

  var boot = function () {
    window.CharacterAbilityPurchases.instance =
      mount(document.getElementById('abilityPurchases'));
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
