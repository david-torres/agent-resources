// Character Creator wizard — step 1 (class kiosk) + shell scaffolding for steps 2-5.
// Vanilla JS, single IIFE, no deps beyond what's already loaded (htmx on the layout).
(function () {
  'use strict';

  var STORAGE_KEY = 'agentResources.characterWizard';
  var OVERSCROLL_THRESHOLD = 3; // wheel events past the end before triggering random pick
  var STEP_COUNT = 5;
  // Trackpad/mouse wheel deltas land directly on the kiosk's scrollLeft, so
  // the raw delta makes the row whip past. Dialing it down keeps the scroll
  // feeling deliberate without losing the link between input and motion.
  var SCROLL_SENSITIVITY = 0.5;
  // Step 4 gear costs. Mirrors util/character-derived.js so the wizard
  // matches what the server will charge at submit time.
  var COMMON_ITEM_COST = 1;
  var CLASS_GEAR_COST = 2;
  // Advent mode hands every new character 2 merx to spend on common items
  // and class gear. Other modes have a richer merx economy (earned per
  // mission); the wizard for those is out of scope for now.
  var ADVENT_MERX_BUDGET = 2;

  // ---------- Data ----------
  var dataEl = document.getElementById('wizard-data');
  var DATA = dataEl ? JSON.parse(dataEl.textContent || 'null') : null;
  if (!DATA) { console.warn('wizard: no data'); return; }

  var params = new URLSearchParams(window.location.search);
  var forceFresh = params.get('fresh') === '1';

  // ---------- State ----------
  var defaultState = function () {
    return {
      mode: DATA.mode,
      step: 1,
      classId: DATA.preselectedClassId || null,
      traits: [null, null, null],
      userStats: {},
      stats: {},
      level: 1,
      successfulMissions: 0,
      gear: [],
      commonItems: [],
      quirks: [],
      accessories: [],
      abilityPerks: [],
      name: '',
      appearance: '',
      background: '',
      isPublic: true,
      hideFromSearch: false,
      updatedAt: Date.now()
    };
  };

  // Mission count per level. Spec: 1→2, 2→2, 3→3, 4→3, 5→4, 6→4, 7→5, 8→5,
  // 9→6, 10→6. Follows 2 + floor((level-1)/2), so it extends sensibly past 10.
  var missionsForLevel = function (level) {
    var lvl = Math.max(1, parseInt(level, 10) || 1);
    return 2 + Math.floor((lvl - 1) / 2);
  };

  var readStorage = function () {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  };
  var writeStorage = function (s) {
    s.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
    catch (_) { /* quota / private mode — non-fatal */ }
  };

  var state;
  if (forceFresh) {
    state = defaultState();
  } else {
    var stored = readStorage();
    state = stored && stored.mode ? stored : defaultState();
    // If the query pins a mode that differs from storage and we're not forcing
    // fresh, honor the query (lets the selector's "Resume" still work because
    // it navigates with the stored mode; a direct ?mode= link updates it).
    if (DATA.mode && state.mode !== DATA.mode) state.mode = DATA.mode;
    if (DATA.preselectedClassId && !state.classId) state.classId = DATA.preselectedClassId;
  }
  window.__wizardState = state;

  // ---------- DOM refs ----------
  var kiosk = document.getElementById('classKiosk');
  var track = document.getElementById('classKioskTrack');
  var search = document.getElementById('classSearch');
  var selectedPanel = document.getElementById('selectedClassPanel');
  var step1Next = document.getElementById('step1Next');
  var steps = Array.prototype.slice.call(document.querySelectorAll('.wizard-step'));
  var stepIndicators = Array.prototype.slice.call(document.querySelectorAll('.wizard-steps li'));
  var summaryClass = document.getElementById('summaryClass');
  var summaryStats = document.getElementById('summaryStats');
  var summaryAbilities = document.getElementById('summaryAbilities');
  var summaryGear = document.getElementById('summaryGear');
  // Step 2
  var trait1Select = document.getElementById('trait1Select');
  var trait2Select = document.getElementById('trait2Select');
  var trait3Select = document.getElementById('trait3Select');
  var trait1StatLabel = document.getElementById('trait1StatLabel');
  var trait2StatLabel = document.getElementById('trait2StatLabel');
  var statsBox = document.getElementById('statsBox');
  var statPointsTotal = document.getElementById('statPointsTotal');
  var statPointsAssigned = document.getElementById('statPointsAssigned');
  var statPointsRemaining = document.getElementById('statPointsRemaining');
  var statPointsLine = document.getElementById('statPointsLine');
  var statGrid = document.getElementById('statGrid');
  var levelInput = document.getElementById('wizardLevel');
  var summaryMissionsEl = document.getElementById('summaryMissions');
  var summarySuccessfulInput = document.getElementById('summarySuccessful');
  var step2Next = document.getElementById('step2Next');
  // Step 3
  var abilityPrimerList = document.getElementById('abilityPrimerList');
  // Step 4
  var baseGearList = document.getElementById('baseGearList');
  var spendList = document.getElementById('spendList');
  var merxSpentEl = document.getElementById('merxSpent');
  var merxBudgetEl = document.getElementById('merxBudget');
  var commonCountBadge = document.getElementById('commonCountBadge');
  var classCountBadge = document.getElementById('classCountBadge');
  var step4Next = document.getElementById('step4Next');
  var shopTabs = Array.prototype.slice.call(document.querySelectorAll('[data-shop-tab]'));
  var customCommonItemInput = document.getElementById('customCommonItemInput');
  var customCommonItemAdd = document.getElementById('customCommonItemAdd');
  // Step 5
  var appearanceEl = document.getElementById('wizardAppearance');
  var backgroundEl = document.getElementById('wizardBackground');
  var nameEl = document.getElementById('wizardName');
  var isPublicEl = document.getElementById('wizardIsPublic');
  var hideFromSearchEl = document.getElementById('wizardHideFromSearch');
  var submitEl = document.getElementById('wizardSubmit');
  var submitErrorEl = document.getElementById('wizardSubmitError');
  // The first 3 class gear items ("base") are auto-loaded for free; the
  // 4th and beyond are charged. Used to derive the merx cost of class gear
  // from state.gear.length.
  var FREE_BASE_GEAR_COUNT = 3;

  if (!kiosk || !track) return;

  // ---------- Class helpers ----------
  var classesById = {};
  DATA.classes.forEach(function (c) { classesById[c.id] = c; });

  var selectedClass = function () {
    return state.classId ? classesById[state.classId] || null : null;
  };

  // Escape helper for injecting into innerHTML (limited, but enough for teaser text).
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // Build a CSS background-image value for the class art. Uses
  // background-size: cover so the image fills the 2:3 card without being
  // stretched: it scales to cover, preserves the source's aspect ratio,
  // and crops the overflow. (The previous 100/crop.w × 100/crop.h math only
  // preserved aspect ratio when the crop and the card shared one; the new
  // 2:3 card stretches square source images, hence the switch to cover.)
  var artBackgroundStyle = function (c) {
    if (!c || !c.image_url) return '';
    var src = c.image_url;
    return 'background-image:url(' + esc(src) + ');'
      + 'background-size:cover;'
      + 'background-position:center;'
      + 'background-color:#222;';
  };

  // Edition label for the bottom ribbon, e.g. "Advent v1" / "Aspirant Preview v2".
  var editionLabel = function (c) {
    var edRaw = (c.rules_edition || 'advent');
    var ed = edRaw === 'aspirant' ? 'Aspirant Preview' : (edRaw.charAt(0).toUpperCase() + edRaw.slice(1));
    var ver = (c.rules_version || 'v1').toUpperCase();
    return ed + ' · ' + ver;
  };

  // ---------- Render: kiosk cards ----------
  var renderKiosk = function () {
    track.innerHTML = DATA.classes.map(function (c) {
      var bg = artBackgroundStyle(c);
      var pccTag = c.is_player_created
        ? '<span class="wizard-kiosk-ribbon-pcc">PCC</span>'
        : '';
      return ''
        + '<div class="wizard-kiosk-card" data-id="' + esc(c.id) + '" data-name="' + esc(c.name) + '">'
        +   '<div class="wizard-kiosk-art" style="' + bg + '"></div>'
        +   '<div class="wizard-kiosk-ribbon-top">'
        +     '<span class="wizard-kiosk-ribbon-name">' + esc(c.name) + '</span>'
        +     pccTag
        +   '</div>'
        +   '<div class="wizard-kiosk-ribbon-bottom">'
        +     '<span class="wizard-kiosk-ribbon-edition">' + esc(editionLabel(c)) + '</span>'
        +   '</div>'
        + '</div>';
    }).join('');
  };

  // ---------- Selection ring positioning ----------
  // The ring is positioned on the currently selected card, not at the kiosk's
  // center. Scrolling is decoupled from selection: the user can scroll the
  // track freely to browse, and the ring follows the selected card.
  var frame = document.querySelector('.wizard-kiosk-frame');
  var positionRing = function () {
    if (!frame) return;
    var id = state.classId;
    if (!id) { frame.style.display = 'none'; return; }
    var cardEl = track.querySelector('[data-id="' + id.replace(/"/g, '\\"') + '"]');
    if (!cardEl) { frame.style.display = 'none'; return; }
    frame.style.display = '';
    var kioskRect = kiosk.getBoundingClientRect();
    var cardRect = cardEl.getBoundingClientRect();
    var ringRect = frame.getBoundingClientRect();
    var cardLeft = cardRect.left - kioskRect.left;
    var cardTop = cardRect.top - kioskRect.top;
    // Center the ring's border-box on the card. The ring's static CSS keeps
    // it centered as a fallback before JS measures things; we override with
    // pixel values and clear the centering rules so they don't fight us.
    frame.style.left = (cardLeft + (cardRect.width - ringRect.width) / 2) + 'px';
    frame.style.top = (cardTop + (cardRect.height - ringRect.height) / 2) + 'px';
    frame.style.right = 'auto';
    frame.style.margin = '0';
    frame.style.transform = 'none';
  };

  // Throttle ring updates to one per animation frame. Scrolling fires a lot
  // of events; rAF keeps the ring glued to the card without thrashing layout.
  var ringUpdateScheduled = false;
  var scheduleRingUpdate = function () {
    if (ringUpdateScheduled) return;
    ringUpdateScheduled = true;
    requestAnimationFrame(function () {
      ringUpdateScheduled = false;
      positionRing();
    });
  };

  // Keep the ring pinned to the selected card as the user scrolls the deck.
  kiosk.addEventListener('scroll', scheduleRingUpdate, { passive: true });

  // ---------- Selected-class description panel ----------
  // Single entry point for changing the selected class. Updates state.classId
  // and (in advent mode) reloads step 4's base gear, since the auto-loaded
  // left-list gear is class-bound and the right-list picks were made against
  // the old class's elective pool.
  var setClassId = function (id) {
    var prev = state.classId;
    state.classId = id;
    if (prev !== id && DATA.mode === 'advent') {
      // resetBaseGear() is defined further down — guarded by a flag to
      // avoid a forward-reference issue (we're called from kiosk code that
      // runs before step 4 listeners are wired up).
      if (typeof syncBaseGear === 'function') syncBaseGear();
    }
  };

  var renderSelectedPanel = function () {
    var c = selectedClass();
    if (!c) {
      selectedPanel.innerHTML = '<p class="has-text-grey">No class selected.</p>';
      return;
    }
    // Description/tips come pre-rendered as sanitized HTML from the server
    // (see routes/characters.js → renderMarkdown on c.description/c.tips).
    // Falling back to the teaser keeps the panel populated for classes that
    // only have a short blurb.
    var desc = c.description_html || c.teaser_html || '<p class="has-text-grey">No description available.</p>';
    var stat = DATA.statList.map(function (k) {
      var v = (c.stat_spread && c.stat_spread[k]) || 0;
      if (!v) return '';
      return '<span class="tag is-light mr-1">' + esc(k) + ': +' + v + '</span>';
    }).join('');
    var tipsBlock = '';
    if (c.tips_html) {
      tipsBlock = ''
        + '<div class="wizard-tips mt-3">'
        +   '<h5 class="title is-6 mb-1">Tips</h5>'
        +   '<div class="content mb-0">' + c.tips_html + '</div>'
        + '</div>';
    }
    selectedPanel.innerHTML = ''
      + '<h4 class="title is-5">' + esc(c.name)
      +   ' <span class="tag is-small is-info is-light">' + esc(editionLabel(c)) + '</span>'
      + '</h4>'
      + '<div class="content">' + desc + '</div>'
      + (stat ? '<div><strong>Stat spread:</strong> ' + stat + '</div>' : '')
      + tipsBlock;
  };

  // ---------- Summary panel ----------
  // Update the static level/missions/successful inputs that live in the
  // summary aside (they're outside #wizardSummaryBody so the dynamic innerHTML
  // re-render below doesn't touch them).
  var renderSummaryMeta = function () {
    var lvl = state.level || 1;
    var missions = missionsForLevel(lvl);
    var successful = parseInt(state.successfulMissions, 10) || 0;
    if (successful < 0) successful = 0;
    if (successful > missions) successful = missions;
    state.successfulMissions = successful;
    if (levelInput && levelInput.value !== String(lvl)) levelInput.value = String(lvl);
    if (summaryMissionsEl) summaryMissionsEl.textContent = String(missions);
    if (summarySuccessfulInput && summarySuccessfulInput.value !== String(successful)) {
      summarySuccessfulInput.value = String(successful);
    }
  };

  var renderSummary = function () {
    renderSummaryMeta();
    var c = selectedClass();

    // ----- Header: class card + traits -----
    var headerHtml = '';
    if (c) {
      // Render the same kiosk-card markup (scaled down via .is-summary) so
      // the selected class is visible at a glance after step 1.
      var bg = artBackgroundStyle(c);
      var pccTag = c.is_player_created
        ? '<span class="wizard-kiosk-ribbon-pcc">PCC</span>'
        : '';
      headerHtml += ''
        + '<div class="wizard-kiosk-card is-summary mb-3">'
        +   '<div class="wizard-kiosk-art" style="' + bg + '"></div>'
        +   '<div class="wizard-kiosk-ribbon-top">'
        +     '<span class="wizard-kiosk-ribbon-name">' + esc(c.name) + '</span>'
        +     pccTag
        +   '</div>'
        +   '<div class="wizard-kiosk-ribbon-bottom">'
        +     '<span class="wizard-kiosk-ribbon-edition">' + esc(editionLabel(c)) + '</span>'
        +   '</div>'
        + '</div>';
    } else {
      headerHtml += '<p class="has-text-grey is-size-7">Step 1: pick a class to begin.</p>';
    }
    if (state.traits.some(function (t) { return t; })) {
      headerHtml += '<p class="is-size-7"><strong>Traits:</strong> ' + state.traits.map(esc).filter(Boolean).join(', ') + '</p>';
    }
    if (summaryClass) summaryClass.innerHTML = headerHtml;

    // ----- Stats column -----
    // Compute the combined stats on the fly so the summary reflects step 2
    // picks before the user clicks Next (state.stats only gets persisted on
    // saveAndGoNext).
    var statsHtml = '';
    var combined = (typeof getCombinedStats === 'function') ? getCombinedStats() : (state.stats || {});
    var statEntries = Object.keys(combined).filter(function (k) { return combined[k] > 0; });
    if (statEntries.length) {
      statsHtml = '<ul class="is-size-7">' + statEntries.map(function (k) {
        return '<li>' + esc(k) + ' <strong>' + combined[k] + '</strong></li>';
      }).join('') + '</ul>';
    } else {
      statsHtml = '<p class="has-text-grey is-size-7">Pick traits to allocate stats.</p>';
    }
    if (summaryStats) summaryStats.innerHTML = statsHtml;

    // ----- Abilities column -----
    var abilitiesHtml = '';
    if (c && Array.isArray(c.abilities_html) && c.abilities_html.length) {
      abilitiesHtml = '<ul class="is-size-7">' + c.abilities_html.map(function (a) {
        return '<li><strong>' + esc(a.name) + '</strong></li>';
      }).join('') + '</ul>';
    } else {
      abilitiesHtml = '<p class="has-text-grey is-size-7">—</p>';
    }
    if (summaryAbilities) summaryAbilities.innerHTML = abilitiesHtml;

    // ----- Gear column -----
    // List each class gear entry with a Base / Picked tag (the first
    // FREE_BASE_GEAR_COUNT entries are auto-loaded and free; anything beyond
    // that was picked from the shop at 2 merx). Custom common items get a
    // "Custom" tag so the user can tell apart their typed-in items from the
    // seeded list.
    var gearHtml = '';
    var hasGear = (Array.isArray(state.gear) && state.gear.length)
      || (Array.isArray(state.commonItems) && state.commonItems.length);
    if (hasGear) {
      gearHtml = '<ul class="is-size-7">';
      if (Array.isArray(state.gear)) {
        state.gear.forEach(function (g, idx) {
          if (!g || !g.name) return;
          var isFree = idx < FREE_BASE_GEAR_COUNT;
          var tag = isFree
            ? ' <span class="tag is-success is-light is-small">Base</span>'
            : ' <span class="tag is-warning is-light is-small">Picked</span>';
          gearHtml += '<li>' + esc(g.name) + tag + '</li>';
        });
      }
      if (Array.isArray(state.commonItems)) {
        state.commonItems.forEach(function (i) {
          if (!i || !i.name) return;
          var customTag = i.custom
            ? ' <span class="tag is-link is-light is-small">Custom</span>'
            : '';
          gearHtml += '<li>' + esc(i.name) + customTag + '</li>';
        });
      }
      gearHtml += '</ul>';
    } else {
      gearHtml = '<p class="has-text-grey is-size-7">—</p>';
    }
    if (summaryGear) summaryGear.innerHTML = gearHtml;
  };

  // ---------- Scroll helpers ----------
  var scrollToCard = function (id, smooth) {
    var el = track.querySelector('[data-id="' + id.replace(/"/g, '\\"') + '"]');
    if (!el) return;
    var kioskRect = kiosk.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    var delta = (elRect.left + elRect.width / 2) - (kioskRect.left + kioskRect.width / 2);
    kiosk.scrollBy({ left: delta, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Briefly tag the card as "just selected" so CSS can flash a flourish. Re-run
  // safe: removes any prior tag, forces a reflow, then re-adds.
  var flashSelectedCard = function (id) {
    var el = track.querySelector('[data-id="' + (id || '').replace(/"/g, '\\"') + '"]');
    if (!el) return;
    el.classList.remove('is-flash');
    // force reflow so the animation re-runs
    void el.offsetWidth;
    el.classList.add('is-flash');
  };

  var pickRandomAndScroll = function () {
    // Only pick from classes matching the current search filter (the visible set),
    // so the user sees the result land on a card they're already looking at.
    var visible = Array.prototype.filter.call(track.querySelectorAll('.wizard-kiosk-card'), function (el) {
      return el.offsetParent !== null;
    });
    if (visible.length === 0) return;
    var target = visible[Math.floor(Math.random() * visible.length)];
    setClassId(target.getAttribute('data-id'));
    renderSelectedPanel();
    renderSummary();
    scrollToCard(state.classId, true);
    positionRing();
    flashSelectedCard(state.classId);
  };

  // ---------- Overscroll detection (wheel) ----------
  var overscrollCount = 0;
  var overscrollTimer = null;
  var onWheel = function (e) {
    // Translate vertical wheel (and trackpad gestures) into horizontal scroll
    // so mouse users can browse the row without holding shift. Browsers that
    // emit deltaX for true horizontal scroll (shift+wheel, trackpad two-finger
    // sideways) will just use the larger axis. Pinch-zoom (ctrlKey) is left
    // alone so the user can still zoom the page over the kiosk.
    if (e.ctrlKey) return;
    var dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (dx !== 0) {
      kiosk.scrollLeft += dx * SCROLL_SENSITIVITY;
      e.preventDefault();
    }

    var atLeft = kiosk.scrollLeft <= 0;
    var atRight = kiosk.scrollLeft + kiosk.clientWidth >= kiosk.scrollWidth - 1;
    var goingPast = (atLeft && dx < 0) || (atRight && dx > 0);
    if (!goingPast) { overscrollCount = 0; return; }
    overscrollCount++;
    clearTimeout(overscrollTimer);
    overscrollTimer = setTimeout(function () { overscrollCount = 0; }, 400);
    if (overscrollCount >= OVERSCROLL_THRESHOLD) {
      overscrollCount = 0;
      pickRandomAndScroll();
    }
  };
  kiosk.addEventListener('wheel', onWheel, { passive: false });

  // ---------- Search filter ----------
  var applySearch = function () {
    var q = (search.value || '').trim().toLowerCase();
    Array.prototype.forEach.call(track.querySelectorAll('.wizard-kiosk-card'), function (el) {
      var name = (el.getAttribute('data-name') || '').toLowerCase();
      var hit = !q || name.indexOf(q) !== -1;
      el.style.display = hit ? '' : 'none';
    });
  };
  if (search) search.addEventListener('input', applySearch);

  // ---------- Click to select ----------
  // Cards are clickable. Scroll the picked card to center so the ring lands
  // on it, then flash it the same way arrow-key / random picks do.
  var selectCardById = function (id) {
    if (!id) return;
    setClassId(id);
    renderSelectedPanel();
    renderSummary();
    scrollToCard(id, true);
    positionRing();
    flashSelectedCard(id);
  };
  track.addEventListener('click', function (e) {
    var card = e.target.closest('.wizard-kiosk-card');
    if (!card || card.style.display === 'none') return;
    selectCardById(card.getAttribute('data-id'));
  });

  // ---------- Arrow key navigation ----------
  // Left/Right step the centered card to the previous/next visible card;
  // Home/End jump to the first/last. The selection ring is anchored at the
  // kiosk's center, so scrolling a different card to center effectively
  // "moves" the ring onto it. Instant scroll (not smooth) so the
  // IntersectionObserver doesn't fire for every intermediate card on the
  // way to the target.
  document.addEventListener('keydown', function (e) {
    if (state.step !== 1) return;
    // Don't hijack arrow keys while typing in form fields (e.g., the search).
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    var key = e.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    e.preventDefault();

    var visible = Array.prototype.filter.call(
      track.querySelectorAll('.wizard-kiosk-card'),
      function (el) { return el.style.display !== 'none'; }
    );
    if (visible.length === 0) return;

    var currentId = state.classId;
    var currentIdx = -1;
    for (var i = 0; i < visible.length; i++) {
      if (visible[i].getAttribute('data-id') === currentId) { currentIdx = i; break; }
    }
    if (currentIdx === -1) currentIdx = 0;

    var targetIdx = currentIdx;
    if (key === 'ArrowLeft') targetIdx = currentIdx - 1;
    else if (key === 'ArrowRight') targetIdx = currentIdx + 1;
    else if (key === 'Home') targetIdx = 0;
    else if (key === 'End') targetIdx = visible.length - 1;

    // Clamp to bounds. (Randomize-on-exhausted is a follow-up.)
    if (targetIdx < 0) targetIdx = 0;
    if (targetIdx >= visible.length) targetIdx = visible.length - 1;
    if (targetIdx === currentIdx) return;

    var targetEl = visible[targetIdx];
    var targetId = targetEl.getAttribute('data-id');
    setClassId(targetId);
    renderSelectedPanel();
    renderSummary();
    scrollToCard(targetId, false);
    positionRing();
    flashSelectedCard(targetId);
  });

  // ---------- Step 2: Personality & Stats ----------

  var capitalize = function (s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  };

  // Stats that the selected class puts points into, in insertion order.
  var getClassSpreadStats = function () {
    var c = selectedClass();
    if (!c || !c.stat_spread) return [];
    return Object.keys(c.stat_spread);
  };

  // Map a trait name back to the stat it belongs to (via personalityMap).
  var getStatForTrait = function (trait) {
    if (!trait) return null;
    for (var stat in DATA.personalityMap) {
      if (DATA.personalityMap[stat].indexOf(trait) !== -1) return stat;
    }
    return null;
  };

  // { stat: points } contributed by the class's stat_spread.
  var getClassPoints = function () {
    var c = selectedClass();
    var pts = {};
    if (c && c.stat_spread) {
      Object.keys(c.stat_spread).forEach(function (stat) {
        pts[stat] = c.stat_spread[stat] || 0;
      });
    }
    return pts;
  };

  // The 3rd personality trait gives +1 to the stat it represents.
  var getPersonalityPoints = function () {
    var pts = {};
    var stat3 = getStatForTrait(state.traits[2]);
    if (stat3) pts[stat3] = 1;
    return pts;
  };

  var getMaxAssignable = function () {
    return state.level > 1 ? 5 : 3;
  };

  // The grid always shows 5 boxes per stat. At level 1 the last 2 render as
  // "locked" (dashed) per the spec; they become assignable at level 2+.
  var getBoxesPerStat = function () { return 5; };

  var getTotalPoints = function () {
    return 6 + Math.max(0, (state.level - 1) * 2);
  };

  var sumPoints = function (pts) {
    return Object.keys(pts).reduce(function (s, k) { return s + (pts[k] || 0); }, 0);
  };

  var getUserPointsTotal = function () {
    return sumPoints(state.userStats || {});
  };

  // Cap state.userStats so:
  //  - no stat exceeds (max-assignable - class - personality) for that stat, and
  //  - the total user-assigned points don't exceed what the level allows.
  // If the total still exceeds after per-stat caps, trim from the stat with
  // the most points so the user sees the fewest boxes change.
  var capUserStats = function () {
    var classPts = getClassPoints();
    var persPts = getPersonalityPoints();
    var max = getMaxAssignable();
    DATA.statList.forEach(function (stat) {
      var cap = max - (classPts[stat] || 0) - (persPts[stat] || 0);
      if (cap < 0) cap = 0;
      if ((state.userStats[stat] || 0) > cap) {
        state.userStats[stat] = cap;
      }
    });
    var allowed = Math.max(0, getTotalPoints() - sumPoints(classPts) - sumPoints(persPts));
    while (getUserPointsTotal() > allowed) {
      var biggest = null, biggestVal = 0;
      DATA.statList.forEach(function (stat) {
        var v = state.userStats[stat] || 0;
        if (v > biggestVal) { biggestVal = v; biggest = stat; }
      });
      if (!biggest) break;
      state.userStats[biggest]--;
    }
    // Prune zero entries.
    Object.keys(state.userStats).forEach(function (k) {
      if (!state.userStats[k]) delete state.userStats[k];
    });
  };

  // Combined { stat: total } = class + personality + user.
  var getCombinedStats = function () {
    var out = {};
    var classPts = getClassPoints();
    var persPts = getPersonalityPoints();
    var all = DATA.statList.concat(Object.keys(classPts), Object.keys(persPts), Object.keys(state.userStats || {}));
    all.forEach(function (stat) {
      out[stat] = (classPts[stat] || 0) + (persPts[stat] || 0) + (state.userStats[stat] || 0);
    });
    return out;
  };

  // Populate the 3 personality selects based on the class's spread.
  // Per spec: traits 1 and 2 must come from 2 *different* stats in the
  // class's stat_spread. The user picks any two of the spread's stats for
  // traits 1 and 2 (not just the first two in insertion order). Trait 3
  // comes from any of the 12 stats not used for 1 or 2. If the class's
  // spread has fewer than 2 stats, the constraint can't be met — show a
  // message and lock the selects so the user can go back and pick a class
  // that satisfies the rule.
  var populatePersonalitySelects = function () {
    var spreadStats = getClassSpreadStats();
    var canPickFirstTwo = spreadStats.length >= 2;

    var lockFirstTwo = function (reason) {
      [trait1Select, trait2Select].forEach(function (sel) {
        if (!sel) return;
        sel.innerHTML = '';
        var opt = document.createElement('option');
        opt.value = '';
        opt.textContent = reason;
        sel.appendChild(opt);
        sel.disabled = true;
      });
      if (trait1StatLabel) trait1StatLabel.textContent = '';
      if (trait2StatLabel) trait2StatLabel.textContent = '';
    };

    if (!canPickFirstTwo) {
      var msg = spreadStats.length === 0
        ? '— Class has no stat spread —'
        : '— Class has only 1 stat in its spread; pick a class with 2+ —';
      lockFirstTwo(msg);
      if (trait3Select) {
        trait3Select.innerHTML = '';
        var opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— Pick traits 1 & 2 first —';
        trait3Select.appendChild(opt);
        trait3Select.disabled = true;
      }
      return;
    }

    // Determine the stat each currently selected trait belongs to. We use
    // these to prune the other selects' options.
    var trait1Stat = state.traits[0] ? getStatForTrait(state.traits[0]) : null;
    var trait2Stat = state.traits[1] ? getStatForTrait(state.traits[1]) : null;

    if (trait1StatLabel) trait1StatLabel.textContent = '(any class stat)';
    if (trait2StatLabel) trait2StatLabel.textContent = '(a different class stat)';

    // Fill a select with every trait from the given stats, labeled by stat
    // so the user can see which stat each trait belongs to.
    var fillFromStats = function (sel, stats, emptyMsg) {
      sel.innerHTML = '';
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = stats.length ? '— Pick a trait —' : (emptyMsg || '— No options —');
      sel.appendChild(placeholder);
      if (stats.length === 0) { sel.disabled = true; return; }
      stats.forEach(function (stat) {
        if (!DATA.personalityMap[stat]) return;
        DATA.personalityMap[stat].forEach(function (trait) {
          var opt = document.createElement('option');
          opt.value = trait;
          opt.textContent = capitalize(trait) + ' (' + capitalize(stat) + ')';
          sel.appendChild(opt);
        });
      });
      sel.disabled = false;
    };

    // Trait 1: any of the class's spread stats.
    fillFromStats(trait1Select, spreadStats.slice(), '— Class has no stat spread —');

    // Trait 2: any spread stat except the one trait 1 already uses.
    var trait2Stats = spreadStats.filter(function (s) { return s !== trait1Stat; });
    fillFromStats(trait2Select, trait2Stats,
      trait1Stat ? '— Trait 1 already covers every class stat —' : '— Pick trait 1 first —');

    // Trait 3: any of the 12 stats not used by traits 1 or 2.
    var excluded = {};
    if (trait1Stat) excluded[trait1Stat] = true;
    if (trait2Stat) excluded[trait2Stat] = true;
    var trait3Stats = DATA.statList.filter(function (s) { return !excluded[s]; });
    fillFromStats(trait3Select, trait3Stats, '— Pick traits 1 & 2 first —');

    // Restore saved selections, clearing any that are now invalid (e.g.,
    // trait 2 ended up pointing at the same stat as trait 1 after a
    // re-population).
    if (state.traits[0] && trait1Select) trait1Select.value = state.traits[0];
    if (state.traits[1] && trait2Select) {
      if (trait2Stat && trait2Stat === trait1Stat) {
        state.traits[1] = null;
        trait2Select.value = '';
      } else {
        trait2Select.value = state.traits[1];
      }
    }
    if (state.traits[2] && trait3Select) {
      var t3Stat = getStatForTrait(state.traits[2]);
      if (t3Stat && (t3Stat === trait1Stat || t3Stat === trait2Stat)) {
        state.traits[2] = null;
        trait3Select.value = '';
      } else {
        trait3Select.value = state.traits[2];
      }
    }
  };

  // Render the 12-stat grid: name, point boxes (always 5 per stat), labels.
  // At level 1 the last 2 boxes render as "locked" (dashed) per the spec;
  // they become assignable at level 2+.
  var renderStatGrid = function () {
    if (!statGrid) return;
    var classPts = getClassPoints();
    var persPts = getPersonalityPoints();
    var assignable = getMaxAssignable();
    var boxesPerStat = getBoxesPerStat();
    var userPts = state.userStats || {};

    statGrid.innerHTML = DATA.statList.map(function (stat) {
      var cp = classPts[stat] || 0;
      var pp = persPts[stat] || 0;
      var up = userPts[stat] || 0;
      var total = cp + pp + up;
      var boxes = '';
      for (var i = 0; i < boxesPerStat; i++) {
        var cls, clickable = false, title = '';
        if (i < cp + pp) {
          cls = 'is-class';
          title = cp && i < cp ? 'Assigned by class' : 'Assigned by personality';
        } else if (i < total) {
          cls = 'is-user';
          title = 'You assigned this point (click to remove)';
          clickable = true;
        } else if (i < assignable) {
          cls = 'is-assignable';
          title = 'Click to assign a point';
          clickable = true;
        } else {
          cls = 'is-locked';
          title = 'Above the per-stat maximum at this level';
        }
        var clickAttr = clickable ? ' data-clickable="1"' : '';
        boxes += '<div class="wizard-stat-box ' + cls + '" data-stat="' + stat + '" data-slot="' + i + '" title="' + title + '"' + clickAttr + '></div>';
      }
      var labels = '';
      if (cp || pp || up) {
        var bits = [];
        if (cp) bits.push('<span class="tag is-small is-dark" title="Class-assigned">C:' + cp + '</span>');
        if (pp) bits.push('<span class="tag is-small is-info" title="Personality-assigned">P:+1</span>');
        if (up) bits.push('<span class="tag is-small is-grey" title="You assigned">U:' + up + '</span>');
        labels = '<div class="wizard-stat-labels">' + bits.join(' ') + '</div>';
      }
      return ''
        + '<div class="wizard-stat-row" data-stat="' + stat + '">'
        +   '<div class="wizard-stat-name">' + capitalize(stat) + '</div>'
        +   '<div class="wizard-stat-boxes">' + boxes + '</div>'
        +   labels
        + '</div>';
    }).join('');
  };

  // Update the points summary line and enable/disable the stat section.
  var updateStatsDisplay = function () {
    var allPicked = state.traits[0] && state.traits[1] && state.traits[2];
    if (allPicked) {
      if (statsBox) {
        statsBox.removeAttribute('aria-disabled');
        // The locked-prompt paragraph sits inside #statsBox; hide it once
        // the user has picked all three traits so the active stat grid takes
        // over the box.
        var prompt = statsBox.querySelector('.wizard-stats-prompt');
        if (prompt) prompt.hidden = true;
      }
      if (statGrid) statGrid.hidden = false;
      if (statPointsLine) statPointsLine.hidden = false;
      var total = getTotalPoints();
      var assigned = sumPoints(getClassPoints()) + sumPoints(getPersonalityPoints()) + getUserPointsTotal();
      var remaining = Math.max(0, total - assigned);
      if (statPointsTotal) statPointsTotal.textContent = total;
      if (statPointsAssigned) statPointsAssigned.textContent = assigned;
      if (statPointsRemaining) statPointsRemaining.textContent = remaining;
      if (step2Next) step2Next.disabled = remaining > 0;
    } else {
      if (statsBox) {
        statsBox.setAttribute('aria-disabled', 'true');
        var prompt = statsBox.querySelector('.wizard-stats-prompt');
        if (prompt) prompt.hidden = false;
      }
      if (statGrid) statGrid.hidden = true;
      if (statPointsLine) statPointsLine.hidden = true;
      if (step2Next) step2Next.disabled = true;
    }
  };

  // Click handler for stat boxes: add or remove a user-assigned point.
  var onStatBoxClick = function (e) {
    var box = e.target.closest('.wizard-stat-box');
    if (!box || !box.hasAttribute('data-clickable')) return;
    var stat = box.getAttribute('data-stat');
    var slot = parseInt(box.getAttribute('data-slot'), 10);
    var classPts = getClassPoints();
    var persPts = getPersonalityPoints();
    var cp = classPts[stat] || 0;
    var pp = persPts[stat] || 0;
    var up = state.userStats[stat] || 0;
    var total = cp + pp + up;
    var remaining = Math.max(0, getTotalPoints() - sumPoints(classPts) - sumPoints(persPts) - getUserPointsTotal());

    if (slot >= cp + pp && slot < total) {
      // User-assigned box: remove a point.
      state.userStats[stat] = up - 1;
      if (state.userStats[stat] <= 0) delete state.userStats[stat];
    } else if (slot >= total && remaining > 0) {
      // Assignable box: add a point (if budget remains).
      state.userStats[stat] = up + 1;
    } else {
      return;
    }

    renderStatGrid();
    updateStatsDisplay();
    renderSummary();
  };

  var onTraitChange = function (idx) {
    return function () {
      var sel = [trait1Select, trait2Select, trait3Select][idx];
      state.traits[idx] = (sel && sel.value) || null;
      // Re-populate so the other selects' option pools stay in sync with
      // the new pick (e.g., trait 2 drops traits from the stat trait 1
      // just claimed; trait 3 drops both). Repopulating also re-runs the
      // validity check that clears a saved pick that no longer satisfies
      // the "two different stats" rule.
      populatePersonalitySelects();
      capUserStats();
      renderStatGrid();
      updateStatsDisplay();
      renderSummary();
    };
  };

  var onLevelChange = function () {
    var v = parseInt(levelInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 20) v = 20;
    if (levelInput.value !== String(v)) levelInput.value = String(v);
    state.level = v;
    capUserStats();
    renderStatGrid();
    updateStatsDisplay();
    renderSummary();
  };

  // Refresh step 2 (called when entering the step, and on init).
  // If the class changed since the last time step 2 was shown, clear the
  // personality and user-stat picks — they're keyed off the old class's
  // spread. The first time step 2 is shown (e.g., resuming a stored draft)
  // we trust the saved state and skip the reset.
  var _step2Visited = false;
  var _step2LastClassId = null;
  var refreshStep2 = function () {
    if (_step2Visited && state.classId !== _step2LastClassId) {
      state.traits = [null, null, null];
      state.userStats = {};
    }
    _step2Visited = true;
    _step2LastClassId = state.classId;
    populatePersonalitySelects();
    capUserStats();
    renderStatGrid();
    updateStatsDisplay();
    if (levelInput) levelInput.value = String(state.level || 1);
    // Keep state.stats in sync with the live picks so a page reload mid-step
    // resumes with the right totals (state.stats only gets persisted on
    // saveAndGoNext otherwise).
    state.stats = getCombinedStats();
  };

  // Wire up step 2 listeners.
  if (trait1Select) trait1Select.addEventListener('change', onTraitChange(0));
  if (trait2Select) trait2Select.addEventListener('change', onTraitChange(1));
  if (trait3Select) trait3Select.addEventListener('change', onTraitChange(2));
  if (levelInput) levelInput.addEventListener('input', onLevelChange);
  if (statGrid) statGrid.addEventListener('click', onStatBoxClick);
  // "Of which successful" input in the summary aside. Capped at the total
  // mission count for the current level (handled in renderSummaryMeta).
  if (summarySuccessfulInput) {
    summarySuccessfulInput.addEventListener('input', function () {
      state.successfulMissions = parseInt(summarySuccessfulInput.value, 10) || 0;
      renderSummaryMeta();
    });
  }

  // ---------- Step 3: Ability Primer ----------
  // Renders the selected class's 3 abilities as read-only cards. Per current
  // scope the primer is only shown in advent mode; other modes fall back to
  // a one-liner so the step still has a body to display.
  var renderAbilityPrimer = function () {
    if (!abilityPrimerList) return;
    if (DATA.mode !== 'advent') {
      abilityPrimerList.innerHTML = '<p class="has-text-grey">Ability primer is only available in Advent mode.</p>';
      return;
    }
    var c = selectedClass();
    if (!c || !Array.isArray(c.abilities_html) || c.abilities_html.length === 0) {
      abilityPrimerList.innerHTML = '<p class="has-text-grey">No abilities to show for this class.</p>';
      return;
    }
    abilityPrimerList.innerHTML = c.abilities_html.map(function (a) {
      return ''
        + '<div class="card mb-3">'
        +   '<div class="card-content">'
        +     '<div class="content">'
        +       '<h4 class="title is-5 mb-2">' + esc(a.name) + '</h4>'
        +       (a.description_html || '<p class="has-text-grey">No description.</p>')
        +     '</div>'
        +   '</div>'
        + '</div>';
    }).join('');
  };

  // ---------- Step 4: Gear Selection ----------
  // Layout: left column = class base gear (auto-loaded, free). Right column
  // = a shop of common items (1 merx) and elective class gear (2 merx) the
  // user can spend an advent-mode 2-merx budget on. Duplicates are allowed
  // (same item can be picked multiple times). State shape:
  //   state.gear         = [ { name, kind: 'base' | 'elective' } ]   (left + right picks)
  //   state.commonItems  = [ { name } ]                              (right picks that are common items)
  //   state.merxSpent    = number (kept in sync with the rendered list)
  // state.gear merges the auto-loaded base picks and any elective picks
  // (the server model already keys off `class_id` to charge for on-class
  // gear, so base picks don't need to be flagged separately — they're free
  // via STARTING_ON_CLASS_GEAR_ALLOTMENT).

  // Build a flat spend-pool = common items + selected class's gear (all 6
  // items, so the user can re-pick a base item as a duplicate). Each entry
  // is a "shop item" with { key, name, description_html, cost, kind,
  // subtype }. The left list is still auto-loaded with the first 3 ("base")
  // items for free; the right list shows the whole pool at 2 merx each.
  var getShopPool = function () {
    var pool = [];
    if (Array.isArray(DATA.commonItems)) {
      DATA.commonItems.forEach(function (it) {
        pool.push({
          key: 'common:' + (it.name || ''),
          name: it.name || '',
          description_html: it.description_html || '',
          cost: COMMON_ITEM_COST,
          kind: 'common'
        });
      });
    }
    var c = selectedClass();
    if (c && Array.isArray(c.class_gear)) {
      c.class_gear.forEach(function (g) {
        if (!g || !g.name) return;
        pool.push({
          key: 'class:' + (c.id || '') + ':' + g.name,
          name: g.name,
          description_html: g.description_html || '',
          cost: CLASS_GEAR_COST,
          kind: 'class',
          subtype: g.subtype || 'elective'
        });
      });
    }
    return pool;
  };

  // Sum the merx cost of the user's current right-column picks. Common items
  // cost 1 each. Class gear is free for the first FREE_BASE_GEAR_COUNT
  // entries (auto-loaded base), then 2 merx for each additional pick —
  // including duplicates of base items.
  var computeMerxSpent = function () {
    var spent = 0;
    if (Array.isArray(state.commonItems)) {
      spent += state.commonItems.length * COMMON_ITEM_COST;
    }
    if (Array.isArray(state.gear)) {
      var charged = Math.max(0, state.gear.length - FREE_BASE_GEAR_COUNT);
      spent += charged * CLASS_GEAR_COST;
    }
    return spent;
  };

  // How many times has the user already picked `key` (across common + class)?
  var countPicks = function (key) {
    var n = 0;
    if (key.indexOf('common:') === 0) {
      var cname = key.slice('common:'.length);
      if (Array.isArray(state.commonItems)) {
        state.commonItems.forEach(function (it) { if (it && it.name === cname) n++; });
      }
    } else if (key.indexOf('class:') === 0) {
      if (Array.isArray(state.gear)) {
        var rest = key.slice('class:'.length);
        var colonAt = rest.indexOf(':');
        if (colonAt > -1) {
          var gname = rest.slice(colonAt + 1);
          state.gear.forEach(function (g) {
            if (g && g.kind === 'class' && g.name === gname) n++;
          });
        }
      }
    }
    return n;
  };

  var pickShopItem = function (key) {
    var pool = getShopPool();
    var shop = null;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].key === key) { shop = pool[i]; break; }
    }
    if (!shop) return;
    var budget = DATA.mode === 'advent' ? ADVENT_MERX_BUDGET : Infinity;
    if (computeMerxSpent() + shop.cost > budget) return; // over budget
    if (shop.kind === 'common') {
      if (!Array.isArray(state.commonItems)) state.commonItems = [];
      state.commonItems.push({ name: shop.name });
    } else {
      if (!Array.isArray(state.gear)) state.gear = [];
      state.gear.push({ name: shop.name, kind: 'class', subtype: shop.subtype });
    }
    renderGearStep();
    renderSummary();
  };

  // Add a user-typed "make your own" common item. Trims input, rejects
  // empty/overlong names, and gates on the merx budget just like the
  // pre-seeded common items.
  var addCustomCommonItem = function (rawName) {
    if (!customCommonItemInput) return;
    var name = (rawName == null ? customCommonItemInput.value : rawName).trim();
    if (!name) return;
    if (name.length > 80) name = name.slice(0, 80);
    var budget = DATA.mode === 'advent' ? ADVENT_MERX_BUDGET : Infinity;
    if (computeMerxSpent() + COMMON_ITEM_COST > budget) return; // over budget
    if (!Array.isArray(state.commonItems)) state.commonItems = [];
    state.commonItems.push({ name: name, custom: true });
    if (rawName == null) customCommonItemInput.value = '';
    renderGearStep();
    renderSummary();
  };

  // Active tab in the shop ('common' | 'class'). Persisted on state so a
  // re-render (e.g., after a class change) keeps the user's tab choice.
  var activeShopTab = function () {
    return state.shopTab === 'class' ? 'class' : 'common';
  };

  var renderGearStep = function () {
    if (!baseGearList || !spendList) return;
    var c = selectedClass();

    // ----- Left column: base gear (auto-loaded) -----
    if (!c) {
      baseGearList.innerHTML = '<p class="has-text-grey">No class selected.</p>';
    } else if (!Array.isArray(c.base_gear) || c.base_gear.length === 0) {
      baseGearList.innerHTML = '<p class="has-text-grey">This class has no base gear.</p>';
    } else {
      baseGearList.innerHTML = c.base_gear.map(function (g) {
        return ''
          + '<div class="card mb-2">'
          +   '<div class="card-content p-3">'
          +     '<div class="content mb-0">'
          +       '<h5 class="title is-6 mb-1">' + esc(g.name) + '</h5>'
          +       (g.description_html || '')
          +     '</div>'
          +   '</div>'
          + '</div>';
      }).join('');
    }

    // ----- Right column: shop pool -----
    var pool = getShopPool();
    if (pool.length === 0) {
      spendList.innerHTML = '<p class="has-text-grey">Nothing available to spend Merx on.</p>';
    } else {
      var tab = activeShopTab();
      var filtered = pool.filter(function (it) { return it.kind === tab; });
      var budget = DATA.mode === 'advent' ? ADVENT_MERX_BUDGET : Infinity;
      var spent = computeMerxSpent();
      var remaining = budget === Infinity ? Infinity : budget - spent;
      if (filtered.length === 0) {
        spendList.innerHTML = '<p class="has-text-grey">No items in this tab.</p>';
      } else {
        spendList.innerHTML = filtered.map(function (it) {
          var picked = countPicks(it.key);
          var canAfford = remaining === Infinity || remaining >= it.cost;
          var cardCls = 'card mb-2 gear-shop-item' + (picked ? ' is-picked' : '') + (canAfford ? '' : ' is-disabled');
          var status = picked
            ? '<span class="tag is-success is-light">Picked ×' + picked + '</span>'
            : (canAfford
                ? '<span class="has-text-grey">Click to add</span>'
                : '<span class="has-text-grey">Not enough Merx</span>');
          // On class-gear cards, badge the subtype (Base / Elective) so the
          // user knows which items are free on the left and which are paid.
          var subtypeTag = '';
          if (it.kind === 'class' && it.subtype) {
            var subtypeLabel = it.subtype === 'base' ? 'Base' : 'Elective';
            var subtypeCls = it.subtype === 'base' ? 'is-success is-light' : 'is-info is-light';
            subtypeTag = '<span class="tag ' + subtypeCls + ' mr-1">' + subtypeLabel + '</span>';
          }
          return ''
            + '<div class="' + cardCls + '" data-shop-key="' + esc(it.key) + '">'
            +   '<div class="card-content p-3">'
            +     '<div class="is-flex is-justify-content-space-between is-align-items-flex-start mb-1">'
            +       '<h5 class="title is-6 mb-0">' + esc(it.name) + '</h5>'
            +       '<span class="tag is-warning is-light">' + it.cost + ' Merx</span>'
            +     '</div>'
            +     '<div class="mb-1">' + subtypeTag + '</div>'
            +     '<div class="content mb-1 is-size-7">' + (it.description_html || '') + '</div>'
            +     '<div class="is-size-7">' + status + '</div>'
            +   '</div>'
            + '</div>';
        }).join('');
      }
    }

    // ----- Shop tab state + counts -----
    shopTabs.forEach(function (li) {
      var t = li.getAttribute('data-shop-tab');
      li.classList.toggle('is-active', t === activeShopTab());
    });
    var commonCount = 0, classCount = 0;
    if (Array.isArray(state.commonItems)) commonCount = state.commonItems.length;
    if (Array.isArray(state.gear)) {
      // The badge shows "picks from the shop" — i.e., class gear beyond the
      // 3 free base slots, which is the same thing computeMerxSpent charges.
      classCount = Math.max(0, state.gear.length - FREE_BASE_GEAR_COUNT);
    }
    if (commonCountBadge) commonCountBadge.textContent = commonCount;
    if (classCountBadge) classCountBadge.textContent = classCount;

    // ----- Merx budget display -----
    if (merxSpentEl) merxSpentEl.textContent = String(spent);
    if (merxBudgetEl) merxBudgetEl.textContent = budget === Infinity ? '∞' : String(budget);

    // ----- Custom common item form gating -----
    // Disable the input + add button once the user is out of merx so they
    // can't add a freebie by typing their own. The actual check lives in
    // addCustomCommonItem (defense in depth).
    if (customCommonItemInput || customCommonItemAdd) {
      var canAffordAny = budget === Infinity || (budget - spent) >= COMMON_ITEM_COST;
      if (customCommonItemInput) customCommonItemInput.disabled = !canAffordAny;
      if (customCommonItemAdd) customCommonItemAdd.disabled = !canAffordAny;
    }

    // ----- Next button gates on budget being spent (advent mode only) -----
    if (step4Next) {
      if (DATA.mode === 'advent') {
        step4Next.disabled = spent < ADVENT_MERX_BUDGET;
      } else {
        step4Next.disabled = false;
      }
    }
  };

  // Auto-load the selected class's base gear into state.gear if no class
  // gear is currently recorded. Idempotent: changing class in step 1 then
  // returning clears any prior gear and reloads.
  var syncBaseGear = function () {
    var c = selectedClass();
    if (!c) return;
    var base = Array.isArray(c.base_gear) ? c.base_gear : [];
    // Drop any class-gear picks the user made against the old class — they
    // are class-bound, and the user has not been able to evaluate them
    // against the new class's pool. Common items are class-agnostic and
    // stay, but the brief "safe" rule from the prior round (clear in
    // advent) is kept: the user is re-entering step 1 and should re-pick.
    state.gear = [];
    if (DATA.mode === 'advent') {
      state.commonItems = [];
    }
    // Push the current class's base items onto the front of state.gear.
    // All gear picks share kind 'class' — the FREE_BASE_GEAR_COUNT constant
    // in computeMerxSpent is what separates free base slots from paid picks.
    var additions = base.map(function (g) {
      return { name: g.name, kind: 'class', subtype: 'base' };
    });
    state.gear = additions.concat(state.gear);
  };

  var refreshStep4 = function () {
    syncBaseGear();
    renderGearStep();
  };

  // ---------- Step 5: Finishing Touches ----------
  // Name + appearance + backstory textareas + visibility toggles. The
  // textareas are part of the static HTML (rendered by handlebars with the
  // initial state), so refreshStep5 only needs to sync state -> textarea
  // on resume. Updates flow the other direction via input listeners.

  var refreshStep5 = function () {
    // Defensive: only set .value if it differs, so the user's caret position
    // isn't yanked around on every re-render (e.g., if we ever re-render
    // this step from elsewhere).
    if (appearanceEl && appearanceEl.value !== (state.appearance || '')) {
      appearanceEl.value = state.appearance || '';
    }
    if (backgroundEl && backgroundEl.value !== (state.background || '')) {
      backgroundEl.value = state.background || '';
    }
    if (nameEl && nameEl.value !== (state.name || '')) {
      nameEl.value = state.name || '';
    }
    if (isPublicEl) isPublicEl.checked = state.isPublic !== false;
    if (hideFromSearchEl) hideFromSearchEl.checked = !!state.hideFromSearch;
    updateSubmitButton();
  };

  // Submit is enabled only when the wizard has the minimum required data:
  // a non-empty name and a selected class. Appearance / backstory / visiblity
  // have safe defaults, so they don't gate the button.
  var isStep5Valid = function () {
    return !!(state.classId && (state.name || '').trim().length > 0);
  };

  var updateSubmitButton = function () {
    if (!submitEl) return;
    submitEl.disabled = !isStep5Valid();
  };

  // ---------- Step navigation ----------
  var showStep = function (n) {
    state.step = n;
    steps.forEach(function (el) {
      var s = Number(el.getAttribute('data-step-panel'));
      el.hidden = s !== n;
    });
    stepIndicators.forEach(function (li) {
      var s = Number(li.getAttribute('data-step'));
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
    });
    if (n === 2) refreshStep2();
    if (n === 3) renderAbilityPrimer();
    if (n === 4) refreshStep4();
    if (n === 5) refreshStep5();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  var saveAndGoNext = function () {
    // Always persist the combined stats (class + personality + user) so
    // downstream steps see a single source of truth.
    state.stats = getCombinedStats();
    writeStorage(state);
    if (state.step < STEP_COUNT) showStep(state.step + 1);
  };
  var goBack = function () {
    if (state.step > 1) showStep(state.step - 1);
  };

  if (step1Next) step1Next.addEventListener('click', saveAndGoNext);
  Array.prototype.forEach.call(document.querySelectorAll('[data-wizard-next]'), function (b) {
    b.addEventListener('click', saveAndGoNext);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-wizard-prev]'), function (b) {
    b.addEventListener('click', goBack);
  });

  // Step 4 listeners: shop-item clicks and tab switching. Delegated to the
  // container so re-renders don't need to re-bind.
  if (spendList) {
    spendList.addEventListener('click', function (e) {
      var card = e.target.closest('[data-shop-key]');
      if (!card || card.classList.contains('is-disabled')) return;
      pickShopItem(card.getAttribute('data-shop-key'));
    });
  }
  shopTabs.forEach(function (li) {
    li.addEventListener('click', function () {
      var t = li.getAttribute('data-shop-tab');
      if (t) {
        state.shopTab = t;
        renderGearStep();
      }
    });
  });
  // Custom common item: button click or Enter in the input. addCustomCommonItem
  // gates on the merx budget, so it's safe to wire up regardless of state.
  if (customCommonItemAdd) {
    customCommonItemAdd.addEventListener('click', function () {
      addCustomCommonItem();
      if (customCommonItemInput) customCommonItemInput.focus();
    });
  }
  if (customCommonItemInput) {
    customCommonItemInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomCommonItem();
      }
    });
  }
  // Step 5: appearance / background / name / visibility flow from inputs ->
  // state on every change. saveAndGoNext already persists state on Next, so
  // navigating forward and back keeps the inputs in sync (handlebars renders
  // the initial value from state, refreshStep5 catches resume cases).
  if (appearanceEl) {
    appearanceEl.addEventListener('input', function () {
      state.appearance = appearanceEl.value;
    });
  }
  if (backgroundEl) {
    backgroundEl.addEventListener('input', function () {
      state.background = backgroundEl.value;
    });
  }
  if (nameEl) {
    nameEl.addEventListener('input', function () {
      state.name = nameEl.value;
      updateSubmitButton();
    });
  }
  if (isPublicEl) {
    isPublicEl.addEventListener('change', function () {
      state.isPublic = !!isPublicEl.checked;
    });
  }
  if (hideFromSearchEl) {
    hideFromSearchEl.addEventListener('change', function () {
      state.hideFromSearch = !!hideFromSearchEl.checked;
    });
  }

  // ---------- Submit ----------
  // Reshape the wizard's localStorage-shaped state into the payload that
  // createCharacter (in models/character.js) expects. Mirrors the field
  // names on the expert form at views/character-form.handlebars so the
  // server-side handler is a thin shim.
  var buildSubmitPayload = function () {
    var combined = (typeof getCombinedStats === 'function') ? getCombinedStats() : (state.stats || {});
    var payload = {
      name: (state.name || '').trim(),
      class_id: state.classId,
      level: state.level || 1,
      completed_missions: state.successfulMissions || 0,
      appearance: state.appearance || '',
      background: state.background || '',
      is_public: state.isPublic !== false, // default true on the wizard
      hide_from_search: !!state.hideFromSearch,
      creator_mode: state.mode || null,
      // 3 trait rows. Use trait0/trait1/trait2 keys — the model pulls these
      // out before insert and writes them to the traits table.
      trait0: state.traits[0] || null,
      trait1: state.traits[1] || null,
      trait2: state.traits[2] || null
    };
    // Combined stats: the model's createCharacter passes unknown fields
    // through to the insert; the characters table has 12 stat int columns.
    DATA.statList.forEach(function (stat) {
      payload[stat] = combined[stat] || 0;
    });
    // Class gear: each entry becomes a class_gear row via setCharacterGear.
    // The shape matches the model's normalizeGearItems ({name, class_id?}).
    if (Array.isArray(state.gear) && state.gear.length) {
      payload.gear = state.gear.map(function (g) {
        return g && g.name ? { name: g.name, class_id: state.classId } : null;
      }).filter(Boolean);
    }
    // Common items: array of strings, normalized server-side.
    if (Array.isArray(state.commonItems) && state.commonItems.length) {
      payload.common_items = state.commonItems
        .map(function (i) { return i && i.name ? i.name : null; })
        .filter(Boolean);
    }
    return payload;
  };

  var showSubmitError = function (msg) {
    if (!submitErrorEl) return;
    submitErrorEl.textContent = msg;
    submitErrorEl.hidden = false;
  };
  var clearSubmitError = function () {
    if (!submitErrorEl) return;
    submitErrorEl.textContent = '';
    submitErrorEl.hidden = true;
  };

  var submitCharacter = function () {
    if (!submitEl) return;
    if (submitEl.disabled) return; // either invalid or already in-flight
    if (!state.classId) {
      showSubmitError('Pick a class on step 1 before submitting.');
      showStep(1);
      return;
    }
    var trimmedName = (state.name || '').trim();
    if (!trimmedName) {
      showSubmitError('Give your character a name before submitting.');
      if (nameEl) nameEl.focus();
      return;
    }
    // Persist any final edits (e.g., the user typed in the name field but
    // hasn't blurred) so the server sees the latest values.
    state.stats = getCombinedStats();
    state.appearance = appearanceEl ? appearanceEl.value : state.appearance;
    state.background = backgroundEl ? backgroundEl.value : state.background;
    state.name = trimmedName;
    writeStorage(state);

    var payload = buildSubmitPayload();
    submitEl.disabled = true;
    clearSubmitError();

    fetch('/characters/wizard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      // Always re-enable the button — even on error — so the user can retry
      // (or hit Back to fix something). Validation/save errors come back with
      // a JSON body; htmx-style redirects come back as a 200 with a body
      // shaped like {redirect: '...'}.
      if (res.ok) {
        return res.json().then(function (body) {
          if (body && body.redirect) {
            // Drop the localStorage draft now that the character exists on
            // the server — otherwise a refresh would offer a stale
            // "restore draft" prompt for a character that's already saved.
            try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
            window.location.href = body.redirect;
            return;
          }
          // No redirect payload — treat as a success but stay put.
          submitEl.disabled = false;
        });
      }
      return res.json().then(function (body) {
        var msg = (body && body.error) ? body.error : ('Submit failed (' + res.status + ').');
        showSubmitError(msg);
        submitEl.disabled = false;
      });
    }).catch(function (err) {
      console.error('wizard submit failed', err);
      showSubmitError('Network error — please try again.');
      submitEl.disabled = false;
    });
  };

  if (submitEl) submitEl.addEventListener('click', submitCharacter);

  // ---------- Init ----------
  renderKiosk();
  renderSelectedPanel();
  renderSummary();
  // Refresh step 2 first if we're resuming a draft past step 1, so the
  // personality selects and stat grid reflect stored picks before showStep
  // reveals the panel. Same trick for the step 3 primer, step 4 gear, and
  // step 5 textareas.
  if ((state.step || 1) >= 2) refreshStep2();
  if ((state.step || 1) >= 3) renderAbilityPrimer();
  if ((state.step || 1) >= 4) refreshStep4();
  if ((state.step || 1) >= 5) refreshStep5();
  showStep(state.step || 1);
  // Submit gate depends on class + name; both can be in flux during init.
  updateSubmitButton();

  // Center the initial (or random) class synchronously, then snap the ring
  // onto it. Scrolling no longer mutates state.classId, so the ring tracks
  // the card we set here (and any later arrow-key step) instead of the
  // whichever card happens to be under the kiosk's center line.
  var initialId = state.classId && classesById[state.classId]
    ? state.classId
    : DATA.classes[Math.floor(Math.random() * DATA.classes.length)].id;
  setClassId(initialId);
  renderSelectedPanel();
  renderSummary();
  // Defer the initial scroll to the next frame so the kiosk and its
  // children have their final layout dimensions. Without this, the first
  // call to getBoundingClientRect on the kiosk can return a 0-width rect
  // and the random card ends up off-screen.
  requestAnimationFrame(function () {
    scrollToCard(initialId, false);
    positionRing();
    setTimeout(function () { flashSelectedCard(initialId); }, 250);
  });
})();
