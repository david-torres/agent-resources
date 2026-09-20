// public/js/signature-entry.js
//
// Renders one printed Signature Item entry (ENCLAVE: Aspirant, pg. 11) and
// prices its purchase. Mounted by the wizard, the edit form, and (read-only)
// the character page -- so it is a pure function of its arguments: it owns
// no application state, performs no I/O, and never reads DATA, document, or
// any other global. character-wizard.js is already the largest file in the
// project and the edit form has no way to reach into it, so this lives as
// its own IIFE, the shape public/js/character-common.js already establishes
// for shared browser code.
(function () {
  'use strict';

  var escapeHtml = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  var tier = function (crossClass) { return crossClass ? 'cross' : 'own'; };

  // Mirrors util/merx-economy.js equipmentSpend for one item. The two are
  // pinned to each other by test/signature-entry.test.js, which prices every
  // shape on both sides; the arithmetic lives twice because a browser cannot
  // require CommonJS and a wizard must reprice as the player clicks.
  var priceOf = function (purchase, opts) {
    if (!purchase || !purchase.owned) return 0;
    var figures = opts.figures;
    var t = tier(opts.crossClass);
    var total = figures.prices.signature[t];
    var enchantment = purchase.enchantment || null;
    if (enchantment && enchantment.source === 'default') total += figures.prices.defaultEnchantment[t];
    if (enchantment && enchantment.source === 'custom') total += figures.prices.customEnchantment[t];
    var mods = Array.isArray(purchase.mods) ? purchase.mods : [];
    var modTable = figures.prices.mod[t];
    for (var i = 0; i < mods.length; i++) {
      // Mirrors util/merx-economy.js priceOfMod: an index past the table
      // (unreachable through the UI, which never renders more than
      // modsPerSignature slots) falls back to the table's last, dearest
      // entry -- never 0 -- so an impossible extra Mod is never undercharged.
      var price = i < modTable.length ? modTable[i] : modTable[modTable.length - 1];
      total += (typeof price === 'number' ? price : 0);
    }
    return total;
  };

  // pg. 8: an Enchantment occupies a Signature slot of its own; Mods occupy none.
  var slotsOf = function (purchase) {
    if (!purchase || !purchase.owned) return 0;
    return 1 + (purchase.enchantment ? 1 : 0);
  };

  // pg. 90: an aspiring character's three chosen Signatures are its Class, so
  // those three price own-class and everything else pays the surcharge. Same
  // rule as util/merx-economy.js isCrossClass, pinned to it by
  // test/signature-entry.test.js. An empty or absent pool prices everything
  // own-class, matching a row written before the pool was stored.
  var inAspiringPool = function (purchase, pool) {
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].class_id === purchase.class_id && pool[i].name === purchase.name) return true;
    }
    return false;
  };

  var isCrossClass = function (purchase, opts) {
    if (opts.economy === 'aspiring') {
      var pool = (Array.isArray(opts.aspiringSignatures) ? opts.aspiringSignatures : []).filter(function (p) { return !!p; });
      return pool.length > 0 && !inAspiringPool(purchase, pool);
    }
    return !!opts.characterClassId && !!purchase.class_id
      && purchase.class_id !== opts.characterClassId;
  };

  // Ruling 5: a rename is a delete plus an insert, so replacing or removing
  // a Signature destroys its Enchantment and Mods outright. This names what
  // would be lost -- built from the same figures and tier priceOf uses, so
  // its total always equals the Merx priceOf would stop charging for them.
  // The bare Signature itself is not listed: owning one costs nothing to
  // lose back, only what was paid on top of it.
  var describePurchase = function (purchase, opts) {
    var figures = opts.figures;
    var t = tier(opts.crossClass);
    var lines = [];
    var total = 0;
    var enchantment = purchase && purchase.enchantment;
    if (enchantment && enchantment.source === 'default') {
      var defaultPrice = figures.prices.defaultEnchantment[t];
      total += defaultPrice;
      lines.push('Default Enchantment  ' + defaultPrice + 'm');
    } else if (enchantment && enchantment.source === 'custom') {
      var customPrice = figures.prices.customEnchantment[t];
      total += customPrice;
      lines.push('Custom Enchantment  ' + customPrice + 'm');
    }
    var mods = Array.isArray(purchase && purchase.mods) ? purchase.mods : [];
    var modTable = figures.prices.mod[t];
    for (var i = 0; i < mods.length; i++) {
      // Mirrors priceOf's own fallback: an index past the table still
      // prices at the table's dearest entry rather than 0.
      var price = i < modTable.length ? modTable[i] : modTable[modTable.length - 1];
      if (typeof price !== 'number') price = 0;
      total += price;
      lines.push('Mod: ' + mods[i].name + '  ' + price + 'm');
    }
    return { total: total, lines: lines };
  };

  var totalOf = function (purchases, opts) {
    var list = Array.isArray(purchases) ? purchases : [];
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      total += priceOf(list[i], {
        figures: opts.figures,
        crossClass: isCrossClass(list[i], opts)
      });
    }
    return total;
  };

  var priceTag = function (price) {
    return price == null ? '' : ' <span class="entry-price">' + price + 'm</span>';
  };

  var metersHtml = function (meters) {
    var list = Array.isArray(meters) ? meters : [];
    if (!list.length) return '';
    var rows = list.map(function (m) {
      return '<div class="entry-meter"><span class="entry-meter-label">' + escapeHtml(m.label)
        + '</span> <span class="entry-meter-value">' + escapeHtml(m.value) + '</span></div>';
    }).join('');
    return '<div class="entry-meters">' + rows + '</div>';
  };

  var radio = function (value, label, checked, price) {
    return '<label class="entry-option">'
      + '<input type="radio" name="enchantment" value="' + value + '"'
      + (checked ? ' checked' : '') + '>'
      + ' ' + escapeHtml(label) + priceTag(price)
      + '</label>';
  };

  // The word counter is an aid, not a gate: util/merx-economy.js
  // countWordsExcludingRatings is the authority and the save rejects an
  // over-long Custom. Counting here too means the player finds out while
  // typing rather than at submit -- so it counts a token as a word by the
  // same Unicode letter-or-number test the server uses, or a Custom written
  // in a non-Latin script would count 0 here and be refused at save.
  var countWords = function (text) {
    var stripped = String(text || '').replace(/<sup>[\s\S]*?<\/sup>/g, ' ').trim();
    if (!stripped) return 0;
    return stripped.split(/\s+/).filter(function (token) {
      return /[\p{L}\p{N}]/u.test(token);
    }).length;
  };

  var customFields = function (chosen, figures) {
    var used = countWords(chosen.description);
    var over = used > figures.enchantmentWordLimit;
    return '<div class="entry-custom">'
      + '<input type="text" data-custom-name value="' + escapeHtml(chosen.name) + '"'
      + ' placeholder="Name it, for easy reference during play">'
      + '<textarea data-custom-description>' + escapeHtml(chosen.description) + '</textarea>'
      + '<div class="entry-wordcount' + (over ? ' is-over' : '') + '">'
      + used + ' / ' + figures.enchantmentWordLimit + ' words</div>'
      + '</div>';
  };

  var enchantmentSection = function (entry, purchase, opts) {
    var figures = opts.figures;
    var t = tier(opts.crossClass);
    var hasDefault = !!(entry.default_enchantment && entry.default_enchantment.name);
    var chosen = (purchase && purchase.enchantment) || null;
    var parts = [];

    if (hasDefault) {
      parts.push('<div class="entry-divider">Default Enchantment</div>');
      parts.push('<div class="entry-enchantment-name">'
        + escapeHtml(entry.default_enchantment.name) + '</div>');
      parts.push('<div class="entry-enchantment-text">'
        + (entry.default_enchantment.description_html
           || escapeHtml(entry.default_enchantment.description || '')) + '</div>');
    }
    if (opts.readOnly) {
      if (chosen && chosen.source === 'custom') {
        parts.push('<div class="entry-divider">Custom Enchantment</div>');
        parts.push('<div class="entry-enchantment-name">' + escapeHtml(chosen.name) + '</div>');
        parts.push('<div class="entry-enchantment-text">' + escapeHtml(chosen.description) + '</div>');
      }
      return parts.join('');
    }

    // The Default Enchantment's printed text above is book content and
    // shows whether or not the Signature is owned, but you cannot buy an
    // Enchantment on a Signature you have not bought -- these controls sit
    // behind the same `owned` gate as modRows/modsReadOnly.
    if (!opts.owned) return parts.join('');

    parts.push('<div class="entry-controls">');
    parts.push(radio('none', 'None', !chosen, null));
    if (hasDefault) {
      parts.push(radio('default', 'Default', chosen && chosen.source === 'default',
                       figures.prices.defaultEnchantment[t]));
    }
    parts.push(radio('custom', 'Custom', chosen && chosen.source === 'custom',
                     figures.prices.customEnchantment[t]));
    if (chosen && chosen.source === 'custom') {
      parts.push(customFields(chosen, figures));
    }
    parts.push('</div>');
    return parts.join('');
  };

  // pg. 87: up to two Mods, the second costing more. The slot count and the
  // price table both come from the figures and are pinned to each other by
  // test/signature-entry.test.js.
  var modRows = function (purchase, opts) {
    var figures = opts.figures;
    var t = tier(opts.crossClass);
    var mods = Array.isArray(purchase.mods) ? purchase.mods : [];
    var rows = [];
    for (var i = 0; i < figures.modsPerSignature; i++) {
      var mod = mods[i] || null;
      rows.push('<div class="entry-mod" data-mod-index="' + i + '">'
        + '<input type="text" data-mod-name value="' + escapeHtml(mod && mod.name) + '"'
        + ' placeholder="Mod ' + (i + 1) + '">'
        + '<input type="text" data-mod-description value="'
        + escapeHtml(mod && mod.description) + '"'
        + ' placeholder="' + figures.modWordLimit + ' words or fewer">'
        + priceTag(figures.prices.mod[t][i])
        + '</div>');
    }
    return '<div class="entry-mods">' + rows.join('') + '</div>';
  };

  // The readOnly counterpart to modRows: what was bought, with no inputs to
  // edit it -- the character page and readOnly renders never offer controls.
  var modsReadOnly = function (purchase) {
    var mods = Array.isArray(purchase && purchase.mods) ? purchase.mods : [];
    if (!mods.length) return '';
    var rows = mods.map(function (mod) {
      return '<div class="entry-mod">' + escapeHtml(mod.name)
        + (mod.description ? ' &mdash; ' + escapeHtml(mod.description) : '') + '</div>';
    }).join('');
    return '<div class="entry-mods">' + rows + '</div>';
  };

  // Book order: name, description, meters, the Default Enchantment divider
  // and its text (always printed, whether or not the Signature is owned),
  // then the Enchantment controls and Mods -- both editable when owned and
  // interactive, read-only when owned and readOnly, absent when not owned.
  var render = function (entry, purchase, opts) {
    var options = opts || {};
    var figures = options.figures;
    var crossClass = !!options.crossClass;
    var readOnly = !!options.readOnly;
    var t = tier(crossClass);
    var p = purchase || { owned: false, enchantment: null, mods: [] };
    var owned = !!p.owned;

    var parts = [];
    parts.push('<div class="entry" data-column="' + entry.column + '" data-position="' + entry.position + '">');
    parts.push('<div class="entry-header">');
    parts.push('<span class="entry-name">' + escapeHtml(entry.name) + '</span>');
    if (!readOnly) parts.push(priceTag(figures.prices.signature[t]));
    parts.push('</div>');
    parts.push('<div class="entry-description">' + (entry.description_html || '') + '</div>');
    parts.push(metersHtml(entry.meters));
    parts.push(enchantmentSection(entry, p, { figures: figures, crossClass: crossClass, readOnly: readOnly, owned: owned }));

    if (owned) {
      parts.push(readOnly ? modsReadOnly(p) : modRows(p, { figures: figures, crossClass: crossClass }));
    }

    parts.push('</div>');
    return parts.join('');
  };

  window.SignatureEntry = {
    render: render,
    priceOf: priceOf,
    slotsOf: slotsOf,
    totalOf: totalOf,
    countWords: countWords,
    isCrossClass: isCrossClass,
    describePurchase: describePurchase
  };
})();
