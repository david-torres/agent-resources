// Character Creator wizard — step 1 (class kiosk) + shell scaffolding for steps 2-5.
// Vanilla JS, single IIFE, no deps beyond what's already loaded (htmx on the layout).
// window-assigned (not `const`) so it survives hx-boost re-execution — see
// character-common.js for the full rationale.
window.CharacterWizard = (function () {
  const { missionsForLevel } = CharacterCommon;
  const STORAGE_KEY = 'agentResources.characterWizard';
  const OVERSCROLL_THRESHOLD = 3; // wheel events past the end before triggering random pick
  const STEP_COUNT = 5;
  // Trackpad/mouse wheel deltas land directly on the kiosk's scrollLeft, so
  // the raw delta makes the row whip past. Dialing it down keeps the scroll
  // feeling deliberate without losing the link between input and motion.
  const SCROLL_SENSITIVITY = 0.5;
  // Step 4 gear costs. Mirrors util/character-derived.js so the wizard
  // matches what the server will charge at submit time.
  const COMMON_ITEM_COST = 1;
  const CLASS_GEAR_COST = 2;
  // Advent mode hands every new character 2 merx to spend on common items
  // and class gear. Other modes have a richer merx economy (earned per
  // mission); the wizard for those is out of scope for now.
  const ADVENT_MERX_BUDGET = 2;
  // Bonus merx awarded per successful mission in advent mode. 1 merx per
  // successful mission on top of the base 2. Unbounded — character history
  // matters.
  const BONUS_MERX_PER_SUCCESSFUL = 1;

  // ---------- Data ----------
  const dataEl = document.getElementById('wizard-data');
  const DATA = dataEl ? JSON.parse(dataEl.textContent || 'null') : null;
  if (!DATA) { console.warn('wizard: no data'); return; }

  const params = new URLSearchParams(window.location.search);
  const forceFresh = params.get('fresh') === '1';

  // ---------- State ----------
  const defaultState = () => {
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

  const readStorage = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  };
  const writeStorage = (s) => {
    s.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }
    catch (_) { /* quota / private mode — non-fatal */ }
  };

  let state;
  if (forceFresh) {
    state = defaultState();
  } else {
    const stored = readStorage();
    state = stored && stored.mode ? stored : defaultState();
    // If the query pins a mode that differs from storage and we're not forcing
    // fresh, honor the query (lets the selector's "Resume" still work because
    // it navigates with the stored mode; a direct ?mode= link updates it).
    if (DATA.mode && state.mode !== DATA.mode) state.mode = DATA.mode;
    if (DATA.preselectedClassId && !state.classId) state.classId = DATA.preselectedClassId;
  }

  // ---------- DOM refs ----------
  const kiosk = document.getElementById('classKiosk');
  const track = document.getElementById('classKioskTrack');
  const search = document.getElementById('classSearch');
  const selectedPanel = document.getElementById('selectedClassPanel');
  const step1Next = document.getElementById('step1Next');
  const steps = Array.from(document.querySelectorAll('.wizard-step'));
  const stepIndicators = Array.from(document.querySelectorAll('.wizard-steps li'));
  const summaryClass = document.getElementById('summaryClass');
  const summaryStats = document.getElementById('summaryStats');
  const summaryAbilities = document.getElementById('summaryAbilities');
  const summaryGear = document.getElementById('summaryGear');
  // Step 2
  const trait1Select = document.getElementById('trait1Select');
  const trait2Select = document.getElementById('trait2Select');
  const trait3Select = document.getElementById('trait3Select');
  const trait1StatLabel = document.getElementById('trait1StatLabel');
  const trait2StatLabel = document.getElementById('trait2StatLabel');
  const statsBox = document.getElementById('statsBox');
  const statPointsTotal = document.getElementById('statPointsTotal');
  const statPointsAssigned = document.getElementById('statPointsAssigned');
  const statPointsRemaining = document.getElementById('statPointsRemaining');
  const statPointsLine = document.getElementById('statPointsLine');
  const statGrid = document.getElementById('statGrid');
  const levelInput = document.getElementById('wizardLevel');
  const summaryMissionsEl = document.getElementById('summaryMissions');
  const summarySuccessfulInput = document.getElementById('summarySuccessful');
  const step2Next = document.getElementById('step2Next');
  // Step 3
  const abilityPrimerList = document.getElementById('abilityPrimerList');
  // Step 4
  const baseGearList = document.getElementById('baseGearList');
  const spendList = document.getElementById('spendList');
  const merxSpentEl = document.getElementById('merxSpent');
  const merxBudgetEl = document.getElementById('merxBudget');
  const commonCountBadge = document.getElementById('commonCountBadge');
  const classCountBadge = document.getElementById('classCountBadge');
  const step4Next = document.getElementById('step4Next');
  const shopTabs = Array.from(document.querySelectorAll('[data-shop-tab]'));
  const customCommonItemInput = document.getElementById('customCommonItemInput');
  const customCommonItemAdd = document.getElementById('customCommonItemAdd');
  // Step 5
  const appearanceEl = document.getElementById('wizardAppearance');
  const backgroundEl = document.getElementById('wizardBackground');
  const nameEl = document.getElementById('wizardName');
  const isPublicEl = document.getElementById('wizardIsPublic');
  const hideFromSearchEl = document.getElementById('wizardHideFromSearch');
  const submitEl = document.getElementById('wizardSubmit');
  // The first 3 class gear items ("base") are auto-loaded for free; the
  // 4th and beyond are charged. Used to derive the merx cost of class gear
  // from state.gear.length.
  const FREE_BASE_GEAR_COUNT = 3;

  if (!kiosk || !track) return;

  // ---------- Class helpers ----------
  const classesById = {};
  DATA.classes.forEach((c) => { classesById[c.id] = c; });

  const selectedClass = () => {
    return state.classId ? classesById[state.classId] || null : null;
  };

  // Escape helper for injecting into innerHTML (limited, but enough for teaser text).
  const esc = (s) => {
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
  const artBackgroundStyle = (c) => {
    if (!c || !c.image_url) return '';
    const src = c.image_url;
    return 'background-image:url(' + esc(src) + ');'
      + 'background-size:cover;'
      + 'background-position:center;'
      + 'background-color:#222;';
  };

  // Edition label for the bottom ribbon, e.g. "Advent v1" / "Aspirant Preview v2".
  const editionLabel = (c) => {
    const edRaw = (c.rules_edition || 'advent');
    const ed = edRaw === 'aspirant' ? 'Aspirant Preview' : (edRaw.charAt(0).toUpperCase() + edRaw.slice(1));
    const ver = (c.rules_version || 'v1').toUpperCase();
    return ed + ' · ' + ver;
  };

  // ---------- Render: kiosk cards ----------
  const renderKiosk = () => {
    track.innerHTML = DATA.classes.map((c) => {
      const bg = artBackgroundStyle(c);
      const pccTag = c.is_player_created
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
  const frame = document.querySelector('.wizard-kiosk-frame');
  const positionRing = () => {
    if (!frame) return;
    const id = state.classId;
    if (!id) { frame.style.display = 'none'; return; }
    const cardEl = track.querySelector('[data-id="' + id.replace(/"/g, '\\"') + '"]');
    if (!cardEl) { frame.style.display = 'none'; return; }
    frame.style.display = '';
    const kioskRect = kiosk.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const ringRect = frame.getBoundingClientRect();
    const cardLeft = cardRect.left - kioskRect.left;
    const cardTop = cardRect.top - kioskRect.top;
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
  let ringUpdateScheduled = false;
  const scheduleRingUpdate = () => {
    if (ringUpdateScheduled) return;
    ringUpdateScheduled = true;
    requestAnimationFrame(() => {
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
  const setClassId = (id) => {
    const prev = state.classId;
    state.classId = id;
    if (prev !== id && DATA.mode === 'advent') {
      // resetBaseGear() is defined further down — guarded by a flag to
      // avoid a forward-reference issue (we're called from kiosk code that
      // runs before step 4 listeners are wired up).
      if (typeof syncBaseGear === 'function') syncBaseGear();
    }
    // Toggle selected/not-selected state on the cards. Tracked alongside
    // state.classId so CSS can dim non-selected cards and emphasize the
    // selected one (the .wizard-kiosk-frame corner brackets still mark the
    // pick visually, but the card itself now also signals its state).
    const cards = track.querySelectorAll('.wizard-kiosk-card');
    for (let i = 0; i < cards.length; i++) {
      const cid = cards[i].getAttribute('data-id');
      if (cid === id) {
        cards[i].classList.add('is-selected');
        cards[i].classList.remove('is-not-selected');
      } else {
        cards[i].classList.add('is-not-selected');
        cards[i].classList.remove('is-selected');
      }
    }
  };

  const renderSelectedPanel = () => {
    const c = selectedClass();
    if (!c) {
      selectedPanel.innerHTML = '<p class="has-text-grey">No class selected.</p>';
      return;
    }
    // Description/tips come pre-rendered as sanitized HTML from the server
    // (see routes/characters.js → renderMarkdown on c.description/c.tips).
    // Falling back to the teaser keeps the panel populated for classes that
    // only have a short blurb.
    const desc = c.description_html || c.teaser_html || '<p class="has-text-grey">No description available.</p>';
    const stat = DATA.statList.map((k) => {
      const v = (c.stat_spread && c.stat_spread[k]) || 0;
      if (!v) return '';
      return '<span class="tag is-light mr-1">' + esc(k) + ': +' + v + '</span>';
    }).join('');
    let tipsBlock = '';
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
  const renderSummaryMeta = () => {
    const lvl = state.level || 1;
    const missions = missionsForLevel(lvl);
    let successful = parseInt(state.successfulMissions, 10) || 0;
    if (successful < 0) successful = 0;
    if (successful > missions) successful = missions;
    state.successfulMissions = successful;
    if (levelInput && levelInput.value !== String(lvl)) levelInput.value = String(lvl);
    if (summaryMissionsEl) summaryMissionsEl.value = String(missions);
    if (summarySuccessfulInput && summarySuccessfulInput.value !== String(successful)) {
      summarySuccessfulInput.value = String(successful);
    }
  };

  const renderSummary = () => {
    renderSummaryMeta();
    const c = selectedClass();

    // ----- Header: class card + traits -----
    let headerHtml = '';
    if (c) {
      // Render the same kiosk-card markup (scaled down via .is-summary) so
      // the selected class is visible at a glance after step 1.
      const bg = artBackgroundStyle(c);
      const pccTag = c.is_player_created
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
    if (state.traits.some((t) => t)) {
      headerHtml += '<p class="is-size-7"><strong>Traits:</strong> ' + state.traits.map(esc).filter(Boolean).join(', ') + '</p>';
    }
    if (summaryClass) summaryClass.innerHTML = headerHtml;

    // ----- Stats column -----
    // Compute the combined stats on the fly so the summary reflects step 2
    // picks before the user clicks Next (state.stats only gets persisted on
    // saveAndGoNext).
    let statsHtml = '';
    const combined = (typeof getCombinedStats === 'function') ? getCombinedStats() : (state.stats || {});
    const statEntries = Object.keys(combined).filter((k) => combined[k] > 0);
    if (statEntries.length) {
      statsHtml = '<ul class="is-size-7">' + statEntries.map((k) => {
        return '<li>' + esc(k) + ' <strong>' + combined[k] + '</strong></li>';
      }).join('') + '</ul>';
    } else {
      statsHtml = '<p class="has-text-grey is-size-7">Pick traits to allocate stats.</p>';
    }
    if (summaryStats) summaryStats.innerHTML = statsHtml;

    // ----- Abilities column -----
    let abilitiesHtml = '';
    if (c && Array.isArray(c.abilities_html) && c.abilities_html.length) {
      abilitiesHtml = '<ul class="is-size-7">' + c.abilities_html.map((a) => {
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
    let gearHtml = '';
    const hasGear = (Array.isArray(state.gear) && state.gear.length)
      || (Array.isArray(state.commonItems) && state.commonItems.length);
    if (hasGear) {
      gearHtml = '<ul class="is-size-7">';
      if (Array.isArray(state.gear)) {
        state.gear.forEach((g, idx) => {
          if (!g || !g.name) return;
          const isFree = idx < FREE_BASE_GEAR_COUNT;
          const tag = isFree
            ? ' <span class="tag is-success is-light is-small">Base</span>'
            : ' <span class="tag is-warning is-light is-small">Picked</span>';
          gearHtml += '<li>' + esc(g.name) + tag + '</li>';
        });
      }
      if (Array.isArray(state.commonItems)) {
        state.commonItems.forEach((i) => {
          if (!i || !i.name) return;
          const customTag = i.custom
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
  // Center `id`'s card inside the kiosk. Uses scrollIntoView with
  // { inline: 'center' } because the kiosk has scroll-snap-type: x mandatory
  // and cards have scroll-snap-align: center: a raw scrollBy() can be
  // overridden by the browser's snap pass on the next frame, leaving the
  // kiosk on a *different* card than the one we just picked. scrollIntoView
  // is the documented way to compose with scroll-snap and lands on the
  // exact target card on first try. `smooth` controls the animation; the
  // snap target is the same either way.
  const scrollToCard = (id, smooth) => {
    const el = track.querySelector('[data-id="' + id.replace(/"/g, '\\"') + '"]');
    if (!el) return;
    el.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: smooth ? 'smooth' : 'auto'
    });
  };

  // Briefly tag the card as "just selected" so CSS can flash a flourish. Re-run
  // safe: removes any prior tag, forces a reflow, then re-adds.
  const flashSelectedCard = (id) => {
    const el = track.querySelector('[data-id="' + (id || '').replace(/"/g, '\\"') + '"]');
    if (!el) return;
    el.classList.remove('is-flash');
    // force reflow so the animation re-runs
    void el.offsetWidth;
    el.classList.add('is-flash');
  };

  const pickRandomAndScroll = () => {
    // Only pick from classes matching the current search filter (the visible set),
    // so the user sees the result land on a card they're already looking at.
    const visible = Array.from(track.querySelectorAll('.wizard-kiosk-card')).filter((el) => {
      return el.offsetParent !== null;
    });
    if (visible.length === 0) return;
    const target = visible[Math.floor(Math.random() * visible.length)];
    setClassId(target.getAttribute('data-id'));
    renderSelectedPanel();
    renderSummary();
    scrollToCard(state.classId, true);
    positionRing();
    flashSelectedCard(state.classId);
  };

  // ---------- Overscroll detection (wheel) ----------
  let overscrollCount = 0;
  let overscrollTimer = null;
  const onWheel = (e) => {
    // Translate vertical wheel (and trackpad gestures) into horizontal scroll
    // so mouse users can browse the row without holding shift. Browsers that
    // emit deltaX for true horizontal scroll (shift+wheel, trackpad two-finger
    // sideways) will just use the larger axis. Pinch-zoom (ctrlKey) is left
    // alone so the user can still zoom the page over the kiosk.
    if (e.ctrlKey) return;
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (dx !== 0) {
      kiosk.scrollLeft += dx * SCROLL_SENSITIVITY;
      e.preventDefault();
    }

    const atLeft = kiosk.scrollLeft <= 0;
    const atRight = kiosk.scrollLeft + kiosk.clientWidth >= kiosk.scrollWidth - 1;
    const goingPast = (atLeft && dx < 0) || (atRight && dx > 0);
    if (!goingPast) { overscrollCount = 0; return; }
    overscrollCount++;
    clearTimeout(overscrollTimer);
    overscrollTimer = setTimeout(() => { overscrollCount = 0; }, 400);
    if (overscrollCount >= OVERSCROLL_THRESHOLD) {
      overscrollCount = 0;
      pickRandomAndScroll();
    }
  };
  kiosk.addEventListener('wheel', onWheel, { passive: false });

  // ---------- Search filter ----------
  const applySearch = () => {
    const q = (search.value || '').trim().toLowerCase();
    track.querySelectorAll('.wizard-kiosk-card').forEach((el) => {
      const name = (el.getAttribute('data-name') || '').toLowerCase();
      const hit = !q || name.indexOf(q) !== -1;
      el.style.display = hit ? '' : 'none';
    });
  };
  if (search) search.addEventListener('input', applySearch);

  // ---------- Click to select ----------
  // Cards are clickable. Scroll the picked card to center so the ring lands
  // on it, then flash it the same way arrow-key / random picks do.
  const selectCardById = (id) => {
    if (!id) return;
    setClassId(id);
    renderSelectedPanel();
    renderSummary();
    scrollToCard(id, true);
    positionRing();
    flashSelectedCard(id);
  };
  track.addEventListener('click', (e) => {
    const card = e.target.closest('.wizard-kiosk-card');
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
  document.addEventListener('keydown', (e) => {
    if (state.step !== 1) return;
    // Don't hijack arrow keys while typing in form fields (e.g., the search).
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    const key = e.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    e.preventDefault();

    const visible = Array.from(track.querySelectorAll('.wizard-kiosk-card'))
      .filter((el) => el.style.display !== 'none');
    if (visible.length === 0) return;

    const currentId = state.classId;
    let currentIdx = -1;
    for (let i = 0; i < visible.length; i++) {
      if (visible[i].getAttribute('data-id') === currentId) { currentIdx = i; break; }
    }
    if (currentIdx === -1) currentIdx = 0;

    let targetIdx = currentIdx;
    if (key === 'ArrowLeft') targetIdx = currentIdx - 1;
    else if (key === 'ArrowRight') targetIdx = currentIdx + 1;
    else if (key === 'Home') targetIdx = 0;
    else if (key === 'End') targetIdx = visible.length - 1;

    // Clamp to bounds. (Randomize-on-exhausted is a follow-up.)
    if (targetIdx < 0) targetIdx = 0;
    if (targetIdx >= visible.length) targetIdx = visible.length - 1;
    if (targetIdx === currentIdx) return;

    const targetEl = visible[targetIdx];
    const targetId = targetEl.getAttribute('data-id');
    setClassId(targetId);
    renderSelectedPanel();
    renderSummary();
    scrollToCard(targetId, false);
    positionRing();
    flashSelectedCard(targetId);
  });

  // ---------- Step 2: Personality & Stats ----------

  const capitalize = (s) => {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  };

  // Stats that the selected class puts points into, in insertion order.
  const getClassSpreadStats = () => {
    const c = selectedClass();
    if (!c || !c.stat_spread) return [];
    return Object.keys(c.stat_spread);
  };

  // Merx budget. In advent mode the base budget (2) is bumped by 1 per
  // successful mission, so a veteran can spend more on elective gear.
  // Outside advent mode the budget is unbounded (free pick).
  const getMerxBudget = () => {
    if (DATA.mode !== 'advent') return Infinity;
    let successful = parseInt(state.successfulMissions, 10) || 0;
    if (successful < 0) successful = 0;
    return ADVENT_MERX_BUDGET + (successful * BONUS_MERX_PER_SUCCESSFUL);
  };

  // Map a trait name back to the stat it belongs to (via personalityMap).
  const getStatForTrait = (trait) => {
    if (!trait) return null;
    for (const stat in DATA.personalityMap) {
      if (DATA.personalityMap[stat].indexOf(trait) !== -1) return stat;
    }
    return null;
  };

  // { stat: points } contributed by the class's stat_spread.
  const getClassPoints = () => {
    const c = selectedClass();
    const pts = {};
    if (c && c.stat_spread) {
      Object.keys(c.stat_spread).forEach((stat) => {
        pts[stat] = c.stat_spread[stat] || 0;
      });
    }
    return pts;
  };

  // The 3rd personality trait gives +1 to the stat it represents.
  const getPersonalityPoints = () => {
    const pts = {};
    const stat3 = getStatForTrait(state.traits[2]);
    if (stat3) pts[stat3] = 1;
    return pts;
  };

  const getMaxAssignable = () => {
    return state.level > 1 ? 5 : 3;
  };

  // The grid always shows 5 boxes per stat. At level 1 the last 2 render as
  // "locked" (dashed) per the spec; they become assignable at level 2+.
  const getBoxesPerStat = () => 5;

  const getTotalPoints = () => {
    return 6 + Math.max(0, (state.level - 1) * 2);
  };

  const sumPoints = (pts) => {
    return Object.keys(pts).reduce((s, k) => s + (pts[k] || 0), 0);
  };

  const getUserPointsTotal = () => {
    return sumPoints(state.userStats || {});
  };

  // Cap state.userStats so:
  //  - no stat exceeds (max-assignable - class - personality) for that stat, and
  //  - the total user-assigned points don't exceed what the level allows.
  // If the total still exceeds after per-stat caps, trim from the stat with
  // the most points so the user sees the fewest boxes change.
  const capUserStats = () => {
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const max = getMaxAssignable();
    DATA.statList.forEach((stat) => {
      let cap = max - (classPts[stat] || 0) - (persPts[stat] || 0);
      if (cap < 0) cap = 0;
      if ((state.userStats[stat] || 0) > cap) {
        state.userStats[stat] = cap;
      }
    });
    const allowed = Math.max(0, getTotalPoints() - sumPoints(classPts) - sumPoints(persPts));
    while (getUserPointsTotal() > allowed) {
      let biggest = null, biggestVal = 0;
      DATA.statList.forEach((stat) => {
        const v = state.userStats[stat] || 0;
        if (v > biggestVal) { biggestVal = v; biggest = stat; }
      });
      if (!biggest) break;
      state.userStats[biggest]--;
    }
    // Prune zero entries.
    Object.keys(state.userStats).forEach((k) => {
      if (!state.userStats[k]) delete state.userStats[k];
    });
  };

  // Combined { stat: total } = class + personality + user.
  const getCombinedStats = () => {
    const out = {};
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const all = DATA.statList.concat(Object.keys(classPts), Object.keys(persPts), Object.keys(state.userStats || {}));
    all.forEach((stat) => {
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
  const populatePersonalitySelects = () => {
    const spreadStats = getClassSpreadStats();
    const canPickFirstTwo = spreadStats.length >= 2;

    const lockFirstTwo = (reason) => {
      [trait1Select, trait2Select].forEach((sel) => {
        if (!sel) return;
        sel.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = reason;
        sel.appendChild(opt);
        sel.disabled = true;
      });
      if (trait1StatLabel) trait1StatLabel.textContent = '';
      if (trait2StatLabel) trait2StatLabel.textContent = '';
    };

    if (!canPickFirstTwo) {
      const msg = spreadStats.length === 0
        ? '— Class has no stat spread —'
        : '— Class has only 1 stat in its spread; pick a class with 2+ —';
      lockFirstTwo(msg);
      if (trait3Select) {
        trait3Select.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— Pick traits 1 & 2 first —';
        trait3Select.appendChild(opt);
        trait3Select.disabled = true;
      }
      return;
    }

    // Determine the stat each currently selected trait belongs to. We use
    // these to prune the other selects' options.
    const trait1Stat = state.traits[0] ? getStatForTrait(state.traits[0]) : null;
    const trait2Stat = state.traits[1] ? getStatForTrait(state.traits[1]) : null;

    if (trait1StatLabel) trait1StatLabel.textContent = '(any class stat)';
    if (trait2StatLabel) trait2StatLabel.textContent = '(a different class stat)';

    // Fill a select with every trait from the given stats, labeled by stat
    // so the user can see which stat each trait belongs to.
    const fillFromStats = (sel, stats, emptyMsg) => {
      sel.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = stats.length ? '— Pick a trait —' : (emptyMsg || '— No options —');
      sel.appendChild(placeholder);
      if (stats.length === 0) { sel.disabled = true; return; }
      stats.forEach((stat) => {
        if (!DATA.personalityMap[stat]) return;
        DATA.personalityMap[stat].forEach((trait) => {
          const opt = document.createElement('option');
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
    const trait2Stats = spreadStats.filter((s) => s !== trait1Stat);
    fillFromStats(trait2Select, trait2Stats,
      trait1Stat ? '— Trait 1 already covers every class stat —' : '— Pick trait 1 first —');

    // Trait 3: any of the 12 stats not used by traits 1 or 2.
    const excluded = {};
    if (trait1Stat) excluded[trait1Stat] = true;
    if (trait2Stat) excluded[trait2Stat] = true;
    const trait3Stats = DATA.statList.filter((s) => !excluded[s]);
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
      const t3Stat = getStatForTrait(state.traits[2]);
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
  const renderStatGrid = () => {
    if (!statGrid) return;
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const assignable = getMaxAssignable();
    const boxesPerStat = getBoxesPerStat();
    const userPts = state.userStats || {};

    statGrid.innerHTML = DATA.statList.map((stat) => {
      const cp = classPts[stat] || 0;
      const pp = persPts[stat] || 0;
      const up = userPts[stat] || 0;
      const total = cp + pp + up;
      let boxes = '';
      for (let i = 0; i < boxesPerStat; i++) {
        let cls, clickable = false, title = '';
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
        const clickAttr = clickable ? ' data-clickable="1"' : '';
        boxes += '<div class="wizard-stat-box ' + cls + '" data-stat="' + stat + '" data-slot="' + i + '" title="' + title + '"' + clickAttr + '></div>';
      }
      let labels = '';
      if (cp || pp || up) {
        const bits = [];
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
  const updateStatsDisplay = () => {
    const allPicked = state.traits[0] && state.traits[1] && state.traits[2];
    if (allPicked) {
      if (statsBox) {
        statsBox.removeAttribute('aria-disabled');
        // The locked-prompt paragraph sits inside #statsBox; hide it once
        // the user has picked all three traits so the active stat grid takes
        // over the box.
        const prompt = statsBox.querySelector('.wizard-stats-prompt');
        if (prompt) prompt.hidden = true;
      }
      if (statGrid) statGrid.hidden = false;
      if (statPointsLine) statPointsLine.hidden = false;
      const total = getTotalPoints();
      const assigned = sumPoints(getClassPoints()) + sumPoints(getPersonalityPoints()) + getUserPointsTotal();
      const remaining = Math.max(0, total - assigned);
      if (statPointsTotal) statPointsTotal.textContent = total;
      if (statPointsAssigned) statPointsAssigned.textContent = assigned;
      if (statPointsRemaining) statPointsRemaining.textContent = remaining;
      if (step2Next) step2Next.disabled = remaining > 0;
    } else {
      if (statsBox) {
        statsBox.setAttribute('aria-disabled', 'true');
        const prompt = statsBox.querySelector('.wizard-stats-prompt');
        if (prompt) prompt.hidden = false;
      }
      if (statGrid) statGrid.hidden = true;
      if (statPointsLine) statPointsLine.hidden = true;
      if (step2Next) step2Next.disabled = true;
    }
  };

  // Click handler for stat boxes: add or remove a user-assigned point.
  const onStatBoxClick = (e) => {
    const box = e.target.closest('.wizard-stat-box');
    if (!box || !box.hasAttribute('data-clickable')) return;
    const stat = box.getAttribute('data-stat');
    const slot = parseInt(box.getAttribute('data-slot'), 10);
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const cp = classPts[stat] || 0;
    const pp = persPts[stat] || 0;
    const up = state.userStats[stat] || 0;
    const total = cp + pp + up;
    const remaining = Math.max(0, getTotalPoints() - sumPoints(classPts) - sumPoints(persPts) - getUserPointsTotal());

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

  const onTraitChange = (idx) => {
    return () => {
      const sel = [trait1Select, trait2Select, trait3Select][idx];
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

  const onLevelChange = () => {
    let v = parseInt(levelInput.value, 10);
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
  let _step2Visited = false;
  let _step2LastClassId = null;
  const refreshStep2 = () => {
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
    summarySuccessfulInput.addEventListener('input', () => {
      state.successfulMissions = parseInt(summarySuccessfulInput.value, 10) || 0;
      renderSummaryMeta();
      // The merx budget depends on successfulMissions in advent mode, so
      // re-render the gear step so the budget badge + Next button reflect
      // the new total. Safe to call when not on step 4 (it just rewrites
      // the same DOM).
      if (typeof renderGearStep === 'function') renderGearStep();
    });
  }

  // ---------- Step 3: Ability Primer ----------
  // Renders the selected class's 3 abilities as read-only cards. Per current
  // scope the primer is only shown in advent mode; other modes fall back to
  // a one-liner so the step still has a body to display.
  const renderAbilityPrimer = () => {
    if (!abilityPrimerList) return;
    if (DATA.mode !== 'advent') {
      abilityPrimerList.innerHTML = '<p class="has-text-grey">Ability primer is only available in Advent mode.</p>';
      return;
    }
    const c = selectedClass();
    if (!c || !Array.isArray(c.abilities_html) || c.abilities_html.length === 0) {
      abilityPrimerList.innerHTML = '<p class="has-text-grey">No abilities to show for this class.</p>';
      return;
    }
    abilityPrimerList.innerHTML = c.abilities_html.map((a) => {
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
  const getShopPool = () => {
    const pool = [];
    if (Array.isArray(DATA.commonItems)) {
      DATA.commonItems.forEach((it) => {
        pool.push({
          key: 'common:' + (it.name || ''),
          name: it.name || '',
          description_html: it.description_html || '',
          cost: COMMON_ITEM_COST,
          kind: 'common'
        });
      });
    }
    const c = selectedClass();
    if (c && Array.isArray(c.class_gear)) {
      c.class_gear.forEach((g) => {
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
  const computeMerxSpent = () => {
    let spent = 0;
    if (Array.isArray(state.commonItems)) {
      spent += state.commonItems.length * COMMON_ITEM_COST;
    }
    if (Array.isArray(state.gear)) {
      const charged = Math.max(0, state.gear.length - FREE_BASE_GEAR_COUNT);
      spent += charged * CLASS_GEAR_COST;
    }
    return spent;
  };

  // How many times has the user already picked `key` (across common + class)?
  const countPicks = (key) => {
    let n = 0;
    if (key.indexOf('common:') === 0) {
      const cname = key.slice('common:'.length);
      if (Array.isArray(state.commonItems)) {
        state.commonItems.forEach((it) => { if (it && it.name === cname) n++; });
      }
    } else if (key.indexOf('class:') === 0) {
      if (Array.isArray(state.gear)) {
        const rest = key.slice('class:'.length);
        const colonAt = rest.indexOf(':');
        if (colonAt > -1) {
          const gname = rest.slice(colonAt + 1);
          state.gear.forEach((g) => {
            if (g && g.kind === 'class' && g.name === gname) n++;
          });
        }
      }
    }
    return n;
  };

  const pickShopItem = (key) => {
    const pool = getShopPool();
    let shop = null;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].key === key) { shop = pool[i]; break; }
    }
    if (!shop) return;
    const budget = getMerxBudget();
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

  // How many picks of `key` can the user remove? For common items this is
  // every seeded pick (custom items are removed via removeCustomCommonItem).
  // For class gear it EXCLUDES the auto-loaded free base slots (the first
  // FREE_BASE_GEAR_COUNT entries of state.gear) — those are free and
  // class-defining, so they aren't deselectable from the shop.
  const removablePicks = (key) => {
    if (key.indexOf('common:') === 0) {
      const cname = key.slice('common:'.length);
      let n = 0;
      if (Array.isArray(state.commonItems)) {
        state.commonItems.forEach((it) => { if (it && it.name === cname && !it.custom) n++; });
      }
      return n;
    }
    if (key.indexOf('class:') === 0) {
      const rest = key.slice('class:'.length);
      const colonAt = rest.indexOf(':');
      if (colonAt < 0) return 0;
      const gname = rest.slice(colonAt + 1);
      let n = 0;
      if (Array.isArray(state.gear)) {
        state.gear.forEach((g, idx) => {
          if (idx >= FREE_BASE_GEAR_COUNT && g && g.kind === 'class' && g.name === gname) n++;
        });
      }
      return n;
    }
    return 0;
  };

  // Remove one pick of `key` (the most recent removable one), freeing its
  // Merx. No-op if nothing removable — in particular, free base gear is never
  // dropped here. Mirrors pickShopItem so the budget/Next gating recomputes.
  const unpickShopItem = (key) => {
    if (key.indexOf('common:') === 0) {
      const cname = key.slice('common:'.length);
      if (!Array.isArray(state.commonItems)) return;
      for (let i = state.commonItems.length - 1; i >= 0; i--) {
        const it = state.commonItems[i];
        if (it && it.name === cname && !it.custom) { state.commonItems.splice(i, 1); break; }
      }
    } else if (key.indexOf('class:') === 0) {
      if (!Array.isArray(state.gear)) return;
      const rest = key.slice('class:'.length);
      const colonAt = rest.indexOf(':');
      if (colonAt < 0) return;
      const gname = rest.slice(colonAt + 1);
      // Stop at FREE_BASE_GEAR_COUNT so the free base slots stay put.
      for (let i = state.gear.length - 1; i >= FREE_BASE_GEAR_COUNT; i--) {
        const g = state.gear[i];
        if (g && g.kind === 'class' && g.name === gname) { state.gear.splice(i, 1); break; }
      }
    }
    renderGearStep();
    renderSummary();
  };

  // Remove a user-typed custom common item by its index in state.commonItems.
  const removeCustomCommonItem = (idx) => {
    if (!Array.isArray(state.commonItems)) return;
    if (!(idx >= 0) || idx >= state.commonItems.length) return;
    const it = state.commonItems[idx];
    if (!it || !it.custom) return;
    state.commonItems.splice(idx, 1);
    renderGearStep();
    renderSummary();
  };

  // Add a user-typed "make your own" common item. Trims input, rejects
  // empty/overlong names, and gates on the merx budget just like the
  // pre-seeded common items.
  const addCustomCommonItem = (rawName) => {
    if (!customCommonItemInput) return;
    let name = (rawName == null ? customCommonItemInput.value : rawName).trim();
    if (!name) return;
    if (name.length > 80) name = name.slice(0, 80);
    const budget = getMerxBudget();
    if (computeMerxSpent() + COMMON_ITEM_COST > budget) return; // over budget
    if (!Array.isArray(state.commonItems)) state.commonItems = [];
    state.commonItems.push({ name: name, custom: true });
    if (rawName == null) customCommonItemInput.value = '';
    renderGearStep();
    renderSummary();
  };

  // Active tab in the shop ('class' | 'common'). Persisted on state so a
  // re-render (e.g., after a class change) keeps the user's tab choice.
  // Class Gear is the default tab when the user hasn't picked one yet.
  const activeShopTab = () => {
    return state.shopTab === 'common' ? 'common' : 'class';
  };

  const renderGearStep = () => {
    if (!baseGearList || !spendList) return;
    const c = selectedClass();

    // ----- Left column: base gear (auto-loaded) -----
    if (!c) {
      baseGearList.innerHTML = '<p class="has-text-grey">No class selected.</p>';
    } else if (!Array.isArray(c.base_gear) || c.base_gear.length === 0) {
      baseGearList.innerHTML = '<p class="has-text-grey">This class has no base gear.</p>';
    } else {
      baseGearList.innerHTML = c.base_gear.map((g) => {
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
    // note: budget/spent are declared at function scope (not in the else
    // block) because the budget-display and Next-button sections below read
    // them; the original `var` hoisted them function-wide with the same
    // undefined-when-pool-is-empty behavior preserved here.
    const pool = getShopPool();
    let budget;
    let spent;
    if (pool.length === 0) {
      spendList.innerHTML = '<p class="has-text-grey">Nothing available to spend Merx on.</p>';
    } else {
      const tab = activeShopTab();
      const filtered = pool.filter((it) => it.kind === tab);
      budget = getMerxBudget();
      spent = computeMerxSpent();
      const remaining = budget === Infinity ? Infinity : budget - spent;
      let cardsHtml = filtered.map((it) => {
          const picked = countPicks(it.key);
          const canAfford = remaining === Infinity || remaining >= it.cost;
          const cardCls = 'card mb-2 gear-shop-item' + (picked ? ' is-picked' : '') + (canAfford ? '' : ' is-disabled');
          const removable = removablePicks(it.key);
          const removeCtl = removable
            ? ' <a class="gear-remove has-text-danger ml-2" data-shop-remove="' + esc(it.key) + '">Remove</a>'
            : '';
          const status = (picked
            ? '<span class="tag is-success is-light">Picked ×' + picked + '</span>'
            : (canAfford
                ? '<span class="has-text-grey">Click to add</span>'
                : '<span class="has-text-grey">Not enough Merx</span>'))
            + removeCtl;
          // On class-gear cards, badge the subtype (Base / Elective) so the
          // user knows which items are free on the left and which are paid.
          let subtypeTag = '';
          if (it.kind === 'class' && it.subtype) {
            const subtypeLabel = it.subtype === 'base' ? 'Base' : 'Elective';
            const subtypeCls = it.subtype === 'base' ? 'is-success is-light' : 'is-info is-light';
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
      // Custom "make your own" common items aren't in the shop pool, so render
      // them here (Common Items tab only) as already-picked, removable cards.
      if (tab === 'common' && Array.isArray(state.commonItems)) {
        cardsHtml += state.commonItems.map((it, idx) => {
          if (!it || !it.custom) return '';
          return ''
            + '<div class="card mb-2 gear-shop-item is-picked">'
            +   '<div class="card-content p-3">'
            +     '<div class="is-flex is-justify-content-space-between is-align-items-flex-start mb-1">'
            +       '<h5 class="title is-6 mb-0">' + esc(it.name) + '</h5>'
            +       '<span class="tag is-warning is-light">' + COMMON_ITEM_COST + ' Merx</span>'
            +     '</div>'
            +     '<div class="mb-1"><span class="tag is-link is-light mr-1">Custom</span></div>'
            +     '<div class="is-size-7"><span class="tag is-success is-light">Picked</span>'
            +       ' <a class="gear-remove has-text-danger ml-2" data-custom-remove="' + idx + '">Remove</a></div>'
            +   '</div>'
            + '</div>';
        }).join('');
      }
      spendList.innerHTML = cardsHtml || '<p class="has-text-grey">No items in this tab.</p>';
    }

    // ----- Shop tab state + counts -----
    shopTabs.forEach((li) => {
      const t = li.getAttribute('data-shop-tab');
      li.classList.toggle('is-active', t === activeShopTab());
    });
    let commonCount = 0, classCount = 0;
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
      const canAffordAny = budget === Infinity || (budget - spent) >= COMMON_ITEM_COST;
      if (customCommonItemInput) customCommonItemInput.disabled = !canAffordAny;
      if (customCommonItemAdd) customCommonItemAdd.disabled = !canAffordAny;
    }

    // ----- Next button gates on budget being spent (advent mode only) -----
    if (step4Next) {
      if (DATA.mode === 'advent') {
        step4Next.disabled = spent < getMerxBudget();
      } else {
        step4Next.disabled = false;
      }
    }
  };

  // Auto-load the selected class's base gear into state.gear if no class
  // gear is currently recorded. Idempotent: changing class in step 1 then
  // returning clears any prior gear and reloads.
  const syncBaseGear = () => {
    const c = selectedClass();
    if (!c) return;
    const base = Array.isArray(c.base_gear) ? c.base_gear : [];
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
    const additions = base.map((g) => {
      return { name: g.name, kind: 'class', subtype: 'base' };
    });
    state.gear = additions.concat(state.gear);
  };

  const refreshStep4 = () => {
    syncBaseGear();
    renderGearStep();
  };

  // ---------- Step 5: Finishing Touches ----------
  // Name + appearance + backstory textareas + visibility toggles. The
  // textareas are part of the static HTML (rendered by handlebars with the
  // initial state), so refreshStep5 only needs to sync state -> textarea
  // on resume. Updates flow the other direction via input listeners.

  const refreshStep5 = () => {
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
  const isStep5Valid = () => {
    return !!(state.classId && (state.name || '').trim().length > 0);
  };

  const updateSubmitButton = () => {
    if (!submitEl) return;
    submitEl.disabled = !isStep5Valid();
  };

  // ---------- Step navigation ----------
  const showStep = (n) => {
    state.step = n;
    steps.forEach((el) => {
      const s = Number(el.getAttribute('data-step-panel'));
      el.hidden = s !== n;
    });
    stepIndicators.forEach((li) => {
      const s = Number(li.getAttribute('data-step'));
      li.classList.toggle('is-active', s === n);
      li.classList.toggle('is-done', s < n);
    });
    if (n === 2) refreshStep2();
    if (n === 3) renderAbilityPrimer();
    if (n === 4) refreshStep4();
    if (n === 5) refreshStep5();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveAndGoNext = () => {
    // Always persist the combined stats (class + personality + user) so
    // downstream steps see a single source of truth.
    state.stats = getCombinedStats();
    writeStorage(state);
    if (state.step < STEP_COUNT) showStep(state.step + 1);
  };
  const goBack = () => {
    if (state.step > 1) showStep(state.step - 1);
  };

  if (step1Next) step1Next.addEventListener('click', saveAndGoNext);
  document.querySelectorAll('[data-wizard-next]').forEach((b) => {
    b.addEventListener('click', saveAndGoNext);
  });
  document.querySelectorAll('[data-wizard-prev]').forEach((b) => {
    b.addEventListener('click', goBack);
  });

  // Step 4 listeners: shop-item clicks and tab switching. Delegated to the
  // container so re-renders don't need to re-bind.
  if (spendList) {
    spendList.addEventListener('click', (e) => {
      // Remove controls are handled first and intentionally bypass the
      // is-disabled guard below: deselecting is how the user frees Merx when
      // they're at budget and want to pick something else instead.
      const removeBtn = e.target.closest('[data-shop-remove]');
      if (removeBtn) {
        e.preventDefault();
        unpickShopItem(removeBtn.getAttribute('data-shop-remove'));
        return;
      }
      const customRemoveBtn = e.target.closest('[data-custom-remove]');
      if (customRemoveBtn) {
        e.preventDefault();
        removeCustomCommonItem(parseInt(customRemoveBtn.getAttribute('data-custom-remove'), 10));
        return;
      }
      const card = e.target.closest('[data-shop-key]');
      if (!card || card.classList.contains('is-disabled')) return;
      pickShopItem(card.getAttribute('data-shop-key'));
    });
  }
  shopTabs.forEach((li) => {
    li.addEventListener('click', () => {
      const t = li.getAttribute('data-shop-tab');
      if (t) {
        state.shopTab = t;
        renderGearStep();
      }
    });
  });
  // Custom common item: button click or Enter in the input. addCustomCommonItem
  // gates on the merx budget, so it's safe to wire up regardless of state.
  if (customCommonItemAdd) {
    customCommonItemAdd.addEventListener('click', () => {
      addCustomCommonItem();
      if (customCommonItemInput) customCommonItemInput.focus();
    });
  }
  if (customCommonItemInput) {
    customCommonItemInput.addEventListener('keydown', (e) => {
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
    appearanceEl.addEventListener('input', () => {
      state.appearance = appearanceEl.value;
    });
  }
  if (backgroundEl) {
    backgroundEl.addEventListener('input', () => {
      state.background = backgroundEl.value;
    });
  }
  if (nameEl) {
    nameEl.addEventListener('input', () => {
      state.name = nameEl.value;
      updateSubmitButton();
    });
  }
  if (isPublicEl) {
    isPublicEl.addEventListener('change', () => {
      state.isPublic = !!isPublicEl.checked;
    });
  }
  if (hideFromSearchEl) {
    hideFromSearchEl.addEventListener('change', () => {
      state.hideFromSearch = !!hideFromSearchEl.checked;
    });
  }

  // ---------- Submit ----------
  // Reshape the wizard's localStorage-shaped state into the payload that
  // createCharacter (in models/character.js) expects. Mirrors the field
  // names on the expert form at views/character-form.handlebars so the
  // server-side handler is a thin shim.
  const serializePayload = () => {
    const combined = (typeof getCombinedStats === 'function') ? getCombinedStats() : (state.stats || {});
    const payload = {
      name: (state.name || '').trim(),
      class_id: state.classId,
      level: state.level || 1,
      completed_missions: state.successfulMissions || 0,
      appearance: state.appearance || '',
      background: state.background || '',
      is_public: state.isPublic !== false, // default true on the wizard
      hide_from_search: !!state.hideFromSearch,
      creator_mode: state.mode || null,
      commissary_reward: 0,
      // 3 trait rows. Use trait0/trait1/trait2 keys — the model pulls these
      // out before insert and writes them to the traits table.
      trait0: state.traits[0] || null,
      trait1: state.traits[1] || null,
      trait2: state.traits[2] || null
    };
    // Combined stats: the model's createCharacter passes unknown fields
    // through to the insert; the characters table has 12 stat int columns.
    DATA.statList.forEach((stat) => {
      payload[stat] = combined[stat] || 0;
    });
    // Class gear: each entry becomes a class_gear row via setCharacterGear.
    // The shape matches the model's normalizeGearItems ({name, class_id?}).
    if (Array.isArray(state.gear) && state.gear.length) {
      payload.gear = state.gear.map((g) => {
        return g && g.name ? { name: g.name, class_id: state.classId } : null;
      }).filter(Boolean);
    }
    // Common items: array of strings, normalized server-side.
    if (Array.isArray(state.commonItems) && state.commonItems.length) {
      payload.common_items = state.commonItems
        .map((i) => i && i.name ? i.name : null)
        .filter(Boolean);
    }
    // Class abilities: the chosen class's full ability list is auto-granted
    // to the character in advent mode. We send them as {name, class_id} so
    // the server's normalizeAbilityItems + setCharacterAbilities writes
    // rows into public.class_abilities.
    const c = (typeof selectedClass === 'function') ? selectedClass() : null;
    if (c && Array.isArray(c.abilities) && c.abilities.length) {
      payload.abilities = c.abilities
        .map((a) => a && a.name ? { name: a.name, class_id: state.classId } : null)
        .filter(Boolean);
    }
    return payload;
  };

  // The Submit button carries hx-post="/characters/wizard" (see
  // views/character-wizard.handlebars), so the request rides the app's global
  // htmx:configRequest pipeline in public/js/app.js — which attaches the
  // Authorization *and* Refresh-Token headers, so an expired-but-refreshable
  // session is renewed instead of bounced. Server-side validation/save errors
  // render into #alerts via sendError's HX-Retarget, and on success the server
  // replies with an HX-Location header that htmx follows to the new character
  // — identical to the expert create form. The button is disabled until the
  // wizard is valid (updateSubmitButton), which gates the request client-side.
  //
  // The Submit button's hx-vals calls CharacterWizard.buildSubmitPayload() at
  // request time to serialize the wizard's localStorage-shaped state into the
  // payload createCharacter expects (mirrors the field names on
  // views/character-form.handlebars). It also flushes the latest field edits
  // into state and persists the draft first, so the server sees values the
  // user may have typed without blurring.
  const buildSubmitPayload = () => {
    state.stats = getCombinedStats();
    if (appearanceEl) state.appearance = appearanceEl.value;
    if (backgroundEl) state.background = backgroundEl.value;
    if (nameEl) state.name = (nameEl.value || '').trim();
    writeStorage(state);
    return serializePayload();
  };

  // Fired from the Submit button's hx-on::after-request on success: drop the
  // saved draft now that the character exists server-side, so returning to the
  // creator doesn't offer to restore a character that's already been saved.
  const onSubmitSuccess = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* non-fatal */ }
  };

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
  // On a fresh page load, pick a random class so the kiosk pre-scrolls to
  // something interesting. Order of preference:
  //   1. state.classId from a stored draft (so refreshes don't re-roll a
  //      class the user already picked).
  //   2. ?class=... on the URL (preselected class).
  //   3. Random pick from the class list.
  const initialId = (state.classId && classesById[state.classId])
    ? state.classId
    : (DATA.preselectedClassId && classesById[DATA.preselectedClassId]
        ? DATA.preselectedClassId
        : DATA.classes[Math.floor(Math.random() * DATA.classes.length)].id);
  setClassId(initialId);
  renderSelectedPanel();
  renderSummary();
  // Defer the initial scroll to the next frame so the kiosk and its
  // children have their final layout dimensions. Without this, the first
  // call to getBoundingClientRect on the kiosk can return a 0-width rect
  // and the random card ends up off-screen. A single delayed retry guards
  // against cards' art images still loading and shifting the track width
  // a beat after the first scroll.
  requestAnimationFrame(() => {
    scrollToCard(initialId, false);
    positionRing();
  });
  setTimeout(() => {
    scrollToCard(initialId, false);
    positionRing();
    flashSelectedCard(initialId);
  }, 200);

  // buildSubmitPayload / onSubmitSuccess are invoked from the Submit button in
  // views/character-wizard.handlebars; getState is a console debug handle.
  return { buildSubmitPayload, onSubmitSuccess, getState: () => state };
})();
