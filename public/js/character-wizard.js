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
  // Cross-class (aspirant) signature items cost more than on-class elective
  // gear — the aspirant-mode rule is "borrow from any class, but pay the
  // same rate as buying after creation." 3 Merx matches the post-creation
  // purchase rate; the constant lives here so advent/aspiring modes don't
  // see it (their pool is selected-class only).
  const CROSS_CLASS_GEAR_COST = 3;
  // Advent mode hands every new character 2 merx to spend on common items
  // and class gear. Other modes have a richer merx economy (earned per
  // mission); the wizard for those is out of scope for now.
  const ADVENT_MERX_BUDGET = 2;
  // Aspirant mode: 12 merx base, no per-mission bonus (character is brand
  // new, no mission history). Unlocks broader gear choices across classes.
  const ASPIRANT_MERX_BUDGET = 12;
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
      // Picked stat for each trait slot (split UI: aspirant/aspiring). Used to
      // filter the trait datalist; not persisted server-side — the trait name
      // and the personalityMap lookup are what grant the stat bonuses.
      traitStats: [null, null, null],
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
      perk: '',
      // Name of the ability the perk is currently attached to in aspirant
      // mode. Null while the perk is unspent (no + button clicked yet or the
      // user cleared the textarea). Persisted via writeStorage so a draft
      // resumed from localStorage keeps the assignment.
      perkAbilityName: null,
      // Step 4 filter controls — both empty strings mean "no filter."
      // gearSearch does a case-insensitive name match against every pool
      // entry; gearClassFilter narrows class items to a single origin class.
      gearSearch: '',
      gearClassFilter: '',
      // Aspiring-mode class builder. The user fills 6 slots — 3 class-gear
      // picks (one item each from 3 distinct classes) and 3 ability picks
      // (2 core abilities + 1 advanced ability, from 3 distinct classes;
      // a class can appear in both lists, but at most once in each). Cost
      // is tracked separately in merx (items: 3 each) and perks (core: 1,
      // advanced: 2) against the budget. Only populated in aspiring mode;
      // other modes leave every slot null.
      classBuild: {
        classGear: [
          { classId: null, itemName: null },
          { classId: null, itemName: null },
          { classId: null, itemName: null }
        ],
        coreAbilities: [
          { classId: null, abilityName: null },
          { classId: null, abilityName: null }
        ],
        advancedAbility: { classId: null, abilityName: null }
      },
      // Aspiring-mode pseudo-class metadata — what the user types in the
      // "Name Your Class" form on step 1. Submitted as a player-created
      // class row by the wizard route (aspiring is class-less: the player
      // invents a one-off class for this character rather than picking
      // from the catalog). Null in other modes.
      pseudoClass: {
        name: '',
        tagline: '',
        description: ''
      },
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
  if (kiosk && DATA.mode === 'aspiring') kiosk.classList.add('is-readonly');
  const track = document.getElementById('classKioskTrack');
  const search = document.getElementById('classSearch');
  const selectedPanel = document.getElementById('selectedClassPanel');
  const step1Next = document.getElementById('step1Next');
  // Aspiring pseudo-class form (step 1) — name/tagline/description fields
  // for the player's custom class.
  const pseudoClassNameEl = document.getElementById('pseudoClassName');
  const pseudoClassTaglineEl = document.getElementById('pseudoClassTagline');
  const pseudoClassDescriptionEl = document.getElementById('pseudoClassDescription');
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
  // Aspirant and aspiring modes use a split UI: a <select> for the stat
  // paired with a free-form text input whose suggestions come from a
  // <datalist>. The view renders one set or the other based on mode, so
  // the unused refs are null for advent.
  const trait1StatSelect = document.getElementById('trait1StatSelect');
  const trait2StatSelect = document.getElementById('trait2StatSelect');
  const trait3StatSelect = document.getElementById('trait3StatSelect');
  const trait1Custom = document.getElementById('trait1Custom');
  const trait2Custom = document.getElementById('trait2Custom');
  const trait3Custom = document.getElementById('trait3Custom');
  const trait1Datalist = document.getElementById('trait1Datalist');
  const trait2Datalist = document.getElementById('trait2Datalist');
  const trait3Datalist = document.getElementById('trait3Datalist');
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
  // The aspirant perk is edited inline inside its ability's cartouche on
  // step 3 — no standalone textarea on step 5 anymore.
  // Step 4 gear filter controls: text search across all pool names, plus
  // an origin-class dropdown that only appears when the pool actually spans
  // multiple classes (i.e., aspirant mode with the selected class's items
  // present alongside others). The wrapping <p> is hidden by default;
  // renderGearStep un-hides it on demand.
  const gearSearchEl = document.getElementById('gearSearch');
  const gearClassFilterEl = document.getElementById('gearClassFilter');
  const gearClassFilterWrap = document.getElementById('gearClassFilterWrap');
  const isPublicEl = document.getElementById('wizardIsPublic');
  const hideFromSearchEl = document.getElementById('wizardHideFromSearch');
  const submitEl = document.getElementById('wizardSubmit');
  // The first 3 class gear items ("base") are auto-loaded for free; the
  // 4th and beyond are charged. Used to derive the merx cost of class gear
  // from state.gear.length. Aspirant and aspiring modes skip auto-loaded
  // base gear entirely (aspiring's picked items are sold from the shop at
  // their full cost), so their effective base count is 0 (every pick is paid).
  const FREE_BASE_GEAR_COUNT = 3;
  const effectiveFreeBaseCount = () =>
    (DATA.mode === 'aspirant' || DATA.mode === 'aspiring') ? 0 : FREE_BASE_GEAR_COUNT;

  // Aspiring mode hides the kiosk (step 1 is the pseudo-class form
  // instead). Don't bail on a missing kiosk/track in that mode — the rest
  // of the wizard still needs to init.
  if (DATA.mode !== 'aspiring' && (!kiosk || !track)) return;

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
  // Aspiring hides the kiosk — skip the listener there.
  if (kiosk) kiosk.addEventListener('scroll', scheduleRingUpdate, { passive: true });

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
          const isFree = idx < effectiveFreeBaseCount();
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
    // Aspirant-style classless build: no random pick — the user picks
    // class parts on step 3 instead.
    if (DATA.mode === 'aspiring') return;
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
  if (kiosk) kiosk.addEventListener('wheel', onWheel, { passive: false });

  // ---------- Search filter ----------
  const kioskEmpty = document.getElementById('classKioskEmpty');
  const kioskEmptyTerm = document.getElementById('classKioskEmptyTerm');
  const applySearch = () => {
    const q = (search.value || '').trim().toLowerCase();
    let visibleCount = 0;
    track.querySelectorAll('.wizard-kiosk-card').forEach((el) => {
      const name = (el.getAttribute('data-name') || '').toLowerCase();
      const hit = !q || name.indexOf(q) !== -1;
      el.style.display = hit ? '' : 'none';
      if (hit) visibleCount += 1;
    });
    // Surface a "no matches" message instead of a silently empty scroller.
    // textContent (not innerHTML) keeps the user's raw query safe to echo.
    if (kioskEmpty) {
      kioskEmpty.hidden = visibleCount !== 0;
      if (kioskEmptyTerm) kioskEmptyTerm.textContent = search.value || '';
    }
  };
  if (search) search.addEventListener('input', applySearch);

  // ---------- Click to select ----------
  // Cards are clickable. Scroll the picked card to center so the ring lands
  // on it, then flash it the same way arrow-key / random picks do.
  const selectCardById = (id) => {
    if (!id) return;
    // Aspirant-style classless build: the kiosk is a read-only preview.
    // The user picks class parts on step 3 instead — no single class to
    // pin to state.classId, and the right-column gear pool / ability
    // primer would key off a null selection.
    if (DATA.mode === 'aspiring') return;
    setClassId(id);
    renderSelectedPanel();
    renderSummary();
    scrollToCard(id, true);
    positionRing();
    flashSelectedCard(id);
  };
  if (track) {
    track.addEventListener('click', (e) => {
      const card = e.target.closest('.wizard-kiosk-card');
      if (!card || card.style.display === 'none') return;
      if (DATA.mode === 'aspiring') return; // read-only kiosk in aspiring
      selectCardById(card.getAttribute('data-id'));
    });
  }

  // ---------- Arrow key navigation ----------
  // Left/Right step the centered card to the previous/next visible card;
  // Home/End jump to the first/last. The selection ring is anchored at the
  // kiosk's center, so scrolling a different card to center effectively
  // "moves" the ring onto it. Instant scroll (not smooth) so the
  // IntersectionObserver doesn't fire for every intermediate card on the
  // way to the target.
  //
  // hx-boost swaps the <body> on navigation while keeping the JS realm alive
  // (see character-common.js), so this module re-runs on every boosted page
  // change. `document` is NOT swapped, so registering a fresh keydown listener
  // each run would pile them up on `document` — a slow leak of handlers plus
  // stale closures over the detached DOM. Remove the previous run's handler
  // before registering this one.
  if (window.__wizardKeydownHandler) {
    document.removeEventListener('keydown', window.__wizardKeydownHandler);
  }
  const onKioskKeydown = (e) => {
    if (state.step !== 1) return;
    // Don't hijack arrow keys while typing in form fields (e.g., the search).
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // Aspirant-style classless build: arrow keys browse the kiosk visually
    // but don't change the (null) selected class.
    if (DATA.mode === 'aspiring') return;

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
  };
  window.__wizardKeydownHandler = onKioskKeydown;
  document.addEventListener('keydown', onKioskKeydown);

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
// Aspirant mode uses a flat 12 merx (no per-mission bonus — fresh character).
// Aspiring mode uses a flat 10 merx (the step-4 shop sells the picked items
// plus common items; duplicates are allowed so the budget can always be met).
const getMerxBudget = () => {
    if (DATA.mode === 'aspirant') return ASPIRANT_MERX_BUDGET;
    if (DATA.mode === 'aspiring') return ASPIRING_MERX_BUDGET;
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
// Trait 3 grants +1 to its stat. The stat is resolved in priority order:
//   1. The stat the typed trait name maps to via personalityMap (so a user
//      who picks a stat via the dropdown but types a recognized trait name
//      still gets the mapped stat's bonus).
//   2. The stat the user explicitly picked in the split-UI dropdown (so a
//      user who typed a custom flavor still gets +1 to the stat they chose
//      — the dropdown isn't just for filtering the datalist).
//   3. None — if neither is available, no bonus is awarded (the user gets
//      the full 6+2*(level-1) points to distribute instead).
  const getPersonalityPoints = () => {
    const pts = {};
    let stat3 = state.traits[2] ? getStatForTrait(state.traits[2]) : null;
    if (!stat3 && state.traitStats && state.traitStats[2]) {
      stat3 = state.traitStats[2];
    }
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
  //
  // Aspirant and aspiring modes bypass the unified <select>s in favor of a
  // split control: a <select> for the stat, paired with a free-form text
  // input whose suggestions come from a <datalist> populated dynamically
  // when the stat changes. The trait input still accepts anything (no
  // validation against the datalist), so the user can type a custom
  // flavor name and the existing personalityMap lookup still gives the
  // trait3 bonus if the typed value happens to match.
  const isSplitMode = () => DATA.mode === 'aspirant' || DATA.mode === 'aspiring';

  const statOptionsFor = (idx) => {
    // Slots 1 & 2 (idx 0, 1) are limited to the class's stat spread.
    // Slot 3 (idx 2) accepts any of the 12 stats.
    if (idx === 2) return DATA.statList.slice();
    const spreadStats = getClassSpreadStats();
    // Also exclude the stat the user picked for the previous slot, so
    // "two different class stats" stays enforceable.
    const prevIdx = idx - 1;
    if (prevIdx < 0) return spreadStats;
    const prevStat = state.traitStats && state.traitStats[prevIdx];
    return spreadStats.filter((s) => s !== prevStat);
  };

  const fillDatalist = (datalist, stat) => {
    if (!datalist) return;
    datalist.innerHTML = '';
    if (!stat) return;
    const traits = (DATA.personalityMap && DATA.personalityMap[stat]) || [];
    traits.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      datalist.appendChild(opt);
    });
  };

  const fillStatSelect = (idx, options, placeholder) => {
    const sel = [trait1StatSelect, trait2StatSelect, trait3StatSelect][idx];
    const datalist = [trait1Datalist, trait2Datalist, trait3Datalist][idx];
    const input = [trait1Custom, trait2Custom, trait3Custom][idx];
    if (!sel) return;
    sel.innerHTML = '';
    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = placeholder;
    sel.appendChild(placeholderOpt);
    options.forEach((stat) => {
      const opt = document.createElement('option');
      opt.value = stat;
      opt.textContent = capitalize(stat);
      sel.appendChild(opt);
    });
    sel.disabled = options.length === 0;
    // Prefer the user's explicitly-picked stat; fall back to whatever
    // stat the saved trait maps to so resume restores both controls.
    let picked = state.traitStats && state.traitStats[idx];
    if (!picked && state.traits[idx]) picked = getStatForTrait(state.traits[idx]);
    if (picked && options.indexOf(picked) !== -1) sel.value = picked;
    fillDatalist(datalist, sel.value);
    if (input) {
      input.disabled = !sel.value;
      if (state.traits[idx] != null && input.value !== state.traits[idx]) {
        input.value = state.traits[idx];
      }
    }
  };

  const updateAspirantStatHints = () => {
    // For split mode the stat dropdown IS the source of truth, so the
    // legacy "(stat)" labels stay empty. For advent the existing logic
    // below sets them.
    if (isSplitMode()) {
      if (trait1StatLabel) trait1StatLabel.textContent = '';
      if (trait2StatLabel) trait2StatLabel.textContent = '';
      return;
    }
    const trait1Stat = state.traits[0] ? getStatForTrait(state.traits[0]) : null;
    const trait2Stat = state.traits[1] ? getStatForTrait(state.traits[1]) : null;
    const hintFor = (stat) => stat ? '(' + capitalize(stat) + ')' : '';
    if (trait1StatLabel) trait1StatLabel.textContent = hintFor(trait1Stat);
    if (trait2StatLabel) {
      if (trait2Stat && trait1Stat && trait2Stat === trait1Stat) {
        trait2StatLabel.textContent = '(' + capitalize(trait2Stat) + ' — same as trait 1)';
      } else {
        trait2StatLabel.textContent = hintFor(trait2Stat);
      }
    }
  };
  const populatePersonalitySelects = () => {
    if (isSplitMode()) {
      fillStatSelect(0, statOptionsFor(0), '— Stat —');
      fillStatSelect(1, statOptionsFor(1), '— Stat —');
      fillStatSelect(2, statOptionsFor(2), '— Stat —');
      updateAspirantStatHints();
      return;
    }
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

  // Resolve what a click or hover on `slot` (0-based DOM index) should make
  // this stat's TOTAL. Shared by the click handler and the hover preview so
  // the preview cannot promise something the click won't deliver.
  //
  // This function only GATHERS state. The arithmetic -- the 0-based to
  // 1-based slot conversion, the class+personality floor, and the
  // cap-vs-budget ceiling -- lives in StatBlocks.resolveWizardTarget, which
  // has unit tests; this module has none and cannot be mounted under jsdom.
  // Rebuilding those arguments here would put the one place an off-by-one
  // can live back on the untested side of the line.
  const resolveWizardTotal = (stat, slot) => {
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const remaining = Math.max(0, getTotalPoints()
      - sumPoints(classPts) - sumPoints(persPts) - getUserPointsTotal());
    return window.StatBlocks.resolveWizardTarget({
      slot: slot,
      cp: classPts[stat] || 0,
      pp: persPts[stat] || 0,
      up: state.userStats[stat] || 0,
      remaining: remaining,
      cap: getMaxAssignable()
    });
  };

  // Click handler for stat boxes. Star-rating semantics, matching the
  // statBlocks component every other surface uses: clicking the Nth block
  // sets the stat to N, except that clicking the block you are already on
  // steps down by one.
  const onStatBoxClick = (e) => {
    const box = e.target.closest('.wizard-stat-box');
    if (!box || !box.hasAttribute('data-clickable')) return;
    const stat = box.getAttribute('data-stat');
    const slot = parseInt(box.getAttribute('data-slot'), 10);
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const cp = classPts[stat] || 0;
    const pp = persPts[stat] || 0;

    const userTarget = Math.max(0, resolveWizardTotal(stat, slot) - cp - pp);
    if (userTarget === (state.userStats[stat] || 0)) return;

    if (userTarget <= 0) delete state.userStats[stat];
    else state.userStats[stat] = userTarget;

    renderStatGrid();
    updateStatsDisplay();
    renderSummary();
  };

  // Hover preview. Shows the total a click would produce -- in both
  // directions, so hovering below the current value previews the drop
  // rather than pretending nothing would change.
  const clearStatPreview = () => {
    if (!statGrid) return;
    Array.prototype.forEach.call(
      statGrid.querySelectorAll('.is-preview, .is-preview-off'),
      (el) => el.classList.remove('is-preview', 'is-preview-off')
    );
  };

  const onStatBoxHover = (e) => {
    const box = e.target.closest && e.target.closest('.wizard-stat-box');
    clearStatPreview();
    if (!box || !box.hasAttribute('data-clickable')) return;
    const stat = box.getAttribute('data-stat');
    const slot = parseInt(box.getAttribute('data-slot'), 10);
    const row = box.closest('.wizard-stat-row');
    if (!row) return;
    const classPts = getClassPoints();
    const persPts = getPersonalityPoints();
    const floor = (classPts[stat] || 0) + (persPts[stat] || 0);
    const total = resolveWizardTotal(stat, slot);

    Array.prototype.forEach.call(row.querySelectorAll('.wizard-stat-box'), (b, i) => {
      if (i < floor) return;                          // class/personality: never previewed
      if (i < total) b.classList.add('is-preview');    // would be filled
      else if (b.classList.contains('is-user')) b.classList.add('is-preview-off'); // would be given back
    });
  };

  const onTraitChange = (idx) => {
    return () => {
      // Aspirant/aspiring (split UI) read from the free-form text input;
      // advent reads from the unified <select>.
      if (isSplitMode()) {
        const inp = [trait1Custom, trait2Custom, trait3Custom][idx];
        state.traits[idx] = (inp && inp.value.trim()) || null;
      } else {
        const sel = [trait1Select, trait2Select, trait3Select][idx];
        state.traits[idx] = (sel && sel.value) || null;
      }
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

  // Stat-picker change handler for the split UI. Updates the datalist and
  // clears the trait input if the user had a typed value that doesn't
  // belong to the new stat (we don't want a stale trait to survive a stat
  // change silently).
  const onStatChange = (idx) => {
    return () => {
      const sel = [trait1StatSelect, trait2StatSelect, trait3StatSelect][idx];
      const datalist = [trait1Datalist, trait2Datalist, trait3Datalist][idx];
      const input = [trait1Custom, trait2Custom, trait3Custom][idx];
      if (!sel) return;
      const stat = sel.value;
      if (!Array.isArray(state.traitStats)) state.traitStats = [null, null, null];
      state.traitStats[idx] = stat || null;
      fillDatalist(datalist, stat);
      if (input) {
        input.disabled = !stat;
        // If the existing trait doesn't match any option in the new stat's
        // datalist, clear it. Free-form flavors are still allowed — the user
        // can re-type one in the freshly-enabled input.
        if (stat && input.value) {
          const opts = Array.from((datalist || { options: [] }).options).map((o) => o.value);
          if (opts.length > 0 && opts.indexOf(input.value) === -1) {
            // Keep the typed value if the user explicitly picked a stat but
            // typed a custom flavor — they may want to keep it. Only clear if
            // it used to belong to a previous stat.
            const oldStat = state.traits[idx] ? getStatForTrait(state.traits[idx]) : null;
            if (oldStat && oldStat !== stat) {
              input.value = '';
              state.traits[idx] = null;
            }
          }
        } else if (!stat) {
          input.value = '';
          state.traits[idx] = null;
        }
      }
      // Re-populate so dependent slots (slot 2's option pool, slot 3's)
      // re-prune the just-changed stat.
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
  // Aspirant/aspiring (split UI): free-form text inputs fire 'input' on
  // every keystroke, and the stat <select>s fire 'change' to filter the
  // datalist.
  if (trait1Custom) trait1Custom.addEventListener('input', onTraitChange(0));
  if (trait2Custom) trait2Custom.addEventListener('input', onTraitChange(1));
  if (trait3Custom) trait3Custom.addEventListener('input', onTraitChange(2));
  if (trait1StatSelect) trait1StatSelect.addEventListener('change', onStatChange(0));
  if (trait2StatSelect) trait2StatSelect.addEventListener('change', onStatChange(1));
  if (trait3StatSelect) trait3StatSelect.addEventListener('change', onStatChange(2));
  if (levelInput) levelInput.addEventListener('input', onLevelChange);
  if (statGrid) {
    statGrid.addEventListener('click', onStatBoxClick);
    // mouseover, not mouseenter: this is delegated to the grid and has to
    // fire as the pointer crosses between individual boxes, which mouseenter
    // on the container does not do. mouseleave on the container is still the
    // right clear signal -- it fires once, when the pointer leaves the grid.
    statGrid.addEventListener('mouseover', onStatBoxHover);
    statGrid.addEventListener('mouseleave', clearStatPreview);
  }
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
  // Renders the selected class's abilities as read-only cards. The list shown
  // depends on the wizard mode:
  //   - 'advent'    -> class.abilities_html (the 3 base abilities)
  //   - 'aspirant'  -> class.abilities_html (the 3 base abilities) — the
  //                    aspirant's single free-form perk attaches to one of
  //                    these, so the + buttons must live on cards that
  //                    always exist (advanced_abilities is empty by default).
  //   - 'aspiring'  -> the class-build's picked abilities, rendered as the
  //                    Perk spend step below.
  // Aspiring mode renders the class-build's picked abilities as the Perk
  // spend step. The three abilities are fixed (2 cores at 1 Perk each + 1
  // advanced at 2 Perks = the full 4-Perk budget), so this page is a
  // confirmation of the spend rather than a picker.
  const renderAbilityPrimer = () => {
    if (!abilityPrimerList) return;
    if (DATA.mode === 'aspiring') {
      const build = state.classBuild || {};
      const combos = [];
      (build.coreAbilities || []).forEach((s) => {
        if (s && s.classId && s.abilityName) {
          combos.push({ slot: s, cost: ASPIRING_CORE_PERKS, type: 'core' });
        }
      });
      if (build.advancedAbility && build.advancedAbility.classId && build.advancedAbility.abilityName) {
        combos.push({ slot: build.advancedAbility, cost: ASPIRING_ADVANCED_PERKS, type: 'advanced' });
      }
      if (combos.length === 0) {
        abilityPrimerList.innerHTML = '<p class="has-text-grey">No abilities picked yet — go back to step 1 to choose your class&#39;s core and advanced abilities.</p>';
        return;
      }
      const perkHtml = (c, a) => {
        const htmlLog = c && c.abilityType === 'core' ? 'abilities_html' : 'advanced_abilities_html';
        const list = c && Array.isArray(c[htmlLog]) ? c[htmlLog] : [];
        const hit = list.find((x) => x.name === a.abilityName);
        return (hit && hit.description_html)
          || (a.abilityDescription ? '<p>' + esc(a.abilityDescription) + '</p>' : '<p class="has-text-grey">No description.</p>');
      };
      const perksSpent = combos.reduce((n, c) => n + c.cost, 0);
      abilityPrimerList.innerHTML = combos.map((c) => {
        const cls = builderClassMap[c.slot.classId] || {};
        return ''
          + '<div class="card mb-3">'
          +   '<div class="card-content">'
          +     '<div class="content">'
          +       '<div class="is-flex is-justify-content-space-between is-align-items-flex-start mb-2">'
          +         '<div>'
          +           '<h4 class="title is-5 mb-0">' + esc(c.slot.abilityName) + '</h4>'
          +           ' <span class="tag is-light ml-1">' + esc(cls.name || c.slot.className || '') + '</span>'
          +           (c.type === 'advanced' ? ' <span class="tag is-info is-light ml-1">advanced</span>' : '')
          +         '</div>'
          +         '<span class="tag is-warning is-light">' + c.cost + ' Perk' + (c.cost === 1 ? '' : 's') + '</span>'
          +       '</div>'
          +       perkHtml(cls, c.slot)
          +     '</div>'
          +   '</div>'
          + '</div>';
      }).join('')
      + '<div class="box mt-4 has-background-light">'
      +   '<p class="mb-0">These are your class&#39;s abilities — spending '
      +     '<strong>' + perksSpent + ' / ' + ASPIRING_PERKS_BUDGET + '</strong> '
      +     'Perks in total (core abilities cost 1 Perk each, the advanced ability costs 2).</p>'
      + '</div>';
      return;
    }
    const c = selectedClass();
    const useAdvanced = DATA.mode === 'aspiring';
    const list = useAdvanced
      ? (c && Array.isArray(c.advanced_abilities_html) ? c.advanced_abilities_html : [])
      : (c && Array.isArray(c.abilities_html) ? c.abilities_html : []);
    const showPerkButton = DATA.mode === 'aspirant';
    if (list.length === 0) {
      const emptyMsg = useAdvanced
        ? 'No advanced abilities to show for this class.'
        : 'No abilities to show for this class.';
      abilityPrimerList.innerHTML = '<p class="has-text-grey">' + emptyMsg + '</p>';
      return;
    }
    // Aspirant mode: the perk lives INSIDE the assigned ability's cartouche
    // as an inline textarea, not as a separate box below the cards. State:
    //   - unassigned (state.perkAbilityName === null): every card shows a
    //     "+ Add Perk" button. Click one to assign.
    //   - assigned (state.perkAbilityName === a.name): the chosen card
    //     renders the editor textarea + a "Remove perk" button. The other
    //     cards render no perk UI — there's only one perk to spend.
    // The "type in step 5 first, never click + on step 3" flow still works:
    // a perk with text but no assignment looks the same as an empty perk
    // (every card shows +), so the user picks where to put it on step 3.
    const assignedAbility = state.perkAbilityName || null;
    abilityPrimerList.innerHTML = list.map((a) => {
      let perkArea = '';
      if (showPerkButton) {
        if (assignedAbility === a.name) {
          // Inline editor for the assigned card. data-wizard-perk-editor is
          // the selector the delegated input listener binds to; the value
          // is initialised from state.perk so navigating away and back
          // restores whatever the user typed.
          perkArea = ''
            + '<div class="mt-3 wizard-perk-inline">'
            +   '<label class="label is-small">Perk</label>'
            +   '<textarea class="textarea is-small" rows="3" maxlength="500"'
            +             ' data-wizard-perk-editor'
            +             ' placeholder="One small advantage — a contact, a habit, an heirloom. Up to 500 characters.">'
            +     esc(state.perk || '')
            +   '</textarea>'
            +   '<div class="mt-2 is-flex is-justify-content-space-between is-align-items-center">'
            +     '<p class="help is-size-7 mb-0">Stored on this ability.</p>'
            +     '<button type="button" class="button is-small is-light wizard-perk-remove">Remove perk</button>'
            +   '</div>'
            + '</div>';
        } else if (!assignedAbility) {
          perkArea = ''
            + '<div class="mt-3">'
            +   '<button type="button" class="button is-small is-link is-light wizard-perk-btn"'
            +           ' data-ability-name="' + esc(a.name) + '">'
            +     '<span class="icon"><span class="fas fa-plus"></span></span>'
            +     '<span>Add Perk</span>'
            +   '</button>'
            + '</div>';
        }
      }
      return ''
        + '<div class="card mb-3">'
        +   '<div class="card-content">'
        +     '<div class="content">'
        +       '<h4 class="title is-5 mb-2">' + esc(a.name) + '</h4>'
        +       (a.description_html || '<p class="has-text-grey">No description.</p>')
        +       perkArea
        +     '</div>'
        +   '</div>'
        + '</div>';
    }).join('');
  };

  // No-op stub kept for callers that still invoke refreshStep3Perk — the
  // perk state used to drive a separate preview paragraph and per-button
  // label flips, but those are obsolete now that the editor is inline on
  // the assigned card. Kept so the step-transition call (showStep) and the
  // initial-load hydration still compose cleanly.
  const refreshStep3Perk = () => {};

  // ---------- Step 1 (aspiring): Class Builder ----------
  // Aspirant-style class-building harness. Six slots the user fills by
  // picking an origin class (dropdown of unlocked classes) and then an item
  // or ability within that class. Selection-only: this page just defines
  // WHAT the aspiring class owns. The budget is spent later — the picked
  // items are sold on step 4's gear page at CLASS_GEAR_COST (2 Merx) each,
  // and the picked abilities are the Perk cost on step 3 (core = 1 Perk,
  // advanced = 2 Perks).
  //   - Class Gear slot (3x) -> step 4 shop item (2 Merx each).
  //   - Core Ability slot (2x): cheapest abilities, 1 Perk each.
  //   - Advanced Ability slot (1x): 2 Perks.
  // Budgets: 10 Merx (gear page) + 4 Perks (abilities primer). Validation:
  // every slot filled, classes unique within the items list, classes unique
  // within the abilities list (a class can appear in both lists, but at most
  // once in each).
  const ASPIRING_CORE_PERKS = 1;
  const ASPIRING_ADVANCED_PERKS = 2;
  const ASPIRING_MERX_BUDGET = 10;
  // Perk budget = 2 cores (1 each) + 1 advanced (2) = 4. Don't try to make
  // this smaller without also dropping a slot — the user has to pick all
  // three abilities, and the costs are what they are.
  const ASPIRING_PERKS_BUDGET = 4;

  const builderList = document.getElementById('builderStep');

  // Cheap accessor: does this class have any items/abilities to offer?
  // Filters out classes with no class_gear / abilities / advanced_abilities.
  const buildableClasses = () => {
    if (!Array.isArray(DATA.classes)) return [];
    return DATA.classes.filter((c) => {
      if (!c || !c.id) return false;
      const hasItems = Array.isArray(c.class_gear) && c.class_gear.length > 0;
      const hasCore = Array.isArray(c.abilities) && c.abilities.length > 0;
      const hasAdvanced = Array.isArray(c.advanced_abilities) && c.advanced_abilities.length > 0;
      return hasItems || hasCore || hasAdvanced;
    });
  };

  // Compute the per-slot lookup maps once per render — cheap and avoids
  // re-iterating DATA.classes for every dropdown change.
  const builderClassMap = (() => {
    const map = {};
    if (Array.isArray(DATA.classes)) {
      DATA.classes.forEach((c) => { if (c && c.id) map[c.id] = c; });
    }
    return map;
  })();

  // Returns the items (class_gear) for a class, [] if none.
  const itemsForClass = (classId) => {
    if (!classId) return [];
    const c = builderClassMap[classId];
    return (c && Array.isArray(c.class_gear)) ? c.class_gear : [];
  };
  const coreForClass = (classId) => {
    if (!classId) return [];
    const c = builderClassMap[classId];
    return (c && Array.isArray(c.abilities)) ? c.abilities : [];
  };
  const advancedForClass = (classId) => {
    if (!classId) return [];
    const c = builderClassMap[classId];
    return (c && Array.isArray(c.advanced_abilities)) ? c.advanced_abilities : [];
  };

  // Set a classBuild slot. `opt` carries everything the card needs to
  // render without a follow-up lookup: classId, className, the item/ability
  // name, the description, and (for abilities) the type. `setBuildSlot`
  // also accepts the legacy 3-arg form (kind, idx, classId, name) for the
  // old cartouche/portable-picker change handlers — it just looks the rest
  // up from the wizard's class map / option pool.
  const setBuildSlot = (kind, idx, classId, name, extras) => {
    const build = state.classBuild || {};
    const classMeta = (extras && extras.className) || (builderClassMap[classId] || {}).name || '';
    if (kind === 'classGear') {
      build.classGear[idx] = {
        classId: classId || null,
        className: classMeta,
        itemName: name || null,
        itemDescription: (extras && extras.description) || ''
      };
    } else if (kind === 'coreAbilities') {
      build.coreAbilities[idx] = {
        classId: classId || null,
        className: classMeta,
        abilityName: name || null,
        abilityDescription: (extras && extras.description) || '',
        abilityType: (extras && extras.type) || 'core'
      };
    } else if (kind === 'advancedAbility') {
      build.advancedAbility = {
        classId: classId || null,
        className: classMeta,
        abilityName: name || null,
        abilityDescription: (extras && extras.description) || '',
        abilityType: (extras && extras.type) || 'advanced'
      };
    }
    state.classBuild = build;
  };

  // Add a pick to the first empty slot of the right kind. Returns true if
  // the pick was placed, false if there was no room. For abilities, the
  // kind is 'core' or 'advanced' and matches the option.type.
  const addPick = (section, opt) => {
    if (!opt || !opt.classId || !opt.name) return false;
    const build = state.classBuild || {};
    if (section === 'gear') {
      if (!Array.isArray(build.classGear)) build.classGear = [{}, {}, {}];
      const idx = build.classGear.findIndex((s) => !s || !s.classId || !s.itemName);
      if (idx < 0) return false;
      setBuildSlot('classGear', idx, opt.classId, opt.name, {
        className: opt.className,
        description: opt.description
      });
      return true;
    }
    if (section === 'abilities') {
      const isAdv = opt.type === 'advanced';
      if (isAdv) {
        if (build.advancedAbility && build.advancedAbility.classId && build.advancedAbility.abilityName) return false;
        setBuildSlot('advancedAbility', 0, opt.classId, opt.name, {
          className: opt.className,
          description: opt.description,
          type: 'advanced'
        });
        return true;
      }
      // core
      if (!Array.isArray(build.coreAbilities)) build.coreAbilities = [{}, {}];
      const idx = build.coreAbilities.findIndex((s) => !s || !s.classId || !s.abilityName);
      if (idx < 0) return false;
      setBuildSlot('coreAbilities', idx, opt.classId, opt.name, {
        className: opt.className,
        description: opt.description,
        type: 'core'
      });
      return true;
    }
    return false;
  };

  // Remove a pick by section + index. After removal, all subsequent
  // slots in the same list keep their indices (no compaction) so the
  // cards stay bound to the same DOM node across re-renders.
  const removePick = (section, idx) => {
    const build = state.classBuild || {};
    if (section === 'gear') {
      if (Array.isArray(build.classGear) && idx >= 0 && idx < build.classGear.length) {
        build.classGear[idx] = { classId: null, className: '', itemName: null, itemDescription: '' };
        state.classBuild = build;
      }
    } else if (section === 'abilities') {
      // Abilities: index 0 maps to the advanced slot, indices 1+ to cores.
      if (idx === 0) {
        if (build.advancedAbility) {
          build.advancedAbility = { classId: null, className: '', abilityName: null, abilityDescription: '', abilityType: 'advanced' };
          state.classBuild = build;
        }
      } else {
        const coreIdx = idx - 1;
        if (Array.isArray(build.coreAbilities) && coreIdx >= 0 && coreIdx < build.coreAbilities.length) {
          build.coreAbilities[coreIdx] = { classId: null, className: '', abilityName: null, abilityDescription: '', abilityType: 'core' };
          state.classBuild = build;
        }
      }
    }
  };

  // Find the rendered index (0..N-1) of a pick matching (classId, name)
  // within a section. Used so dismiss can target the right card.
  const findPickIndex = (section, classId, name) => {
    const build = state.classBuild || {};
    if (section === 'gear') {
      return (build.classGear || []).findIndex((s) => s && s.classId === classId && s.itemName === name);
    }
    if (section === 'abilities') {
      const a = build.advancedAbility;
      if (a && a.classId === classId && a.abilityName === name) return 0;
      const coreIdx = (build.coreAbilities || []).findIndex((s) => s && s.classId === classId && s.abilityName === name);
      return coreIdx < 0 ? -1 : coreIdx + 1;
    }
    return -1;
  };

  // Compute the merx / perks spent on the current builder picks. The class
  // gear picks cost merx; the ability picks cost perks. Used both for the
  // live totals and for the Next-button gate.

  // Validate the builder: every slot filled, classes unique within items,
  // classes unique within abilities. Returns { ok: bool, errors: [] } so the
  // UI can surface per-problem messages. Budgets are NOT checked here — the
  // picks are spent on steps 3 (abilities) and 4 (gear), not gate-tested on
  // the selection page.
  const validateBuilder = () => {
    const errors = [];
    const build = state.classBuild || {};
    const filled = (s) => !!(s && s.classId && (s.itemName || s.abilityName));
    const gearFilled = (build.classGear || []).filter(filled);
    const coreFilled = (build.coreAbilities || []).filter(filled);
    const advFilled = build.advancedAbility && filled(build.advancedAbility) ? [build.advancedAbility] : [];

    if (gearFilled.length < 3) errors.push('Pick all 3 Class Gear items.');
    if (coreFilled.length < 2) errors.push('Pick both Core Abilities.');
    if (advFilled.length < 1) errors.push('Pick the Advanced Ability.');

    // Class uniqueness within items list.
    const gearClasses = gearFilled.map((s) => s.classId);
    if (gearClasses.length === new Set(gearClasses).size) {/* ok */}
    else errors.push('Each Class Gear item must come from a different class.');

    // Class uniqueness within abilities list.
    const abilityClasses = [...coreFilled, ...advFilled].map((s) => s.classId);
    if (abilityClasses.length === new Set(abilityClasses).size) {/* ok */}
    else errors.push('Core and Advanced abilities must come from different classes.');

    return { ok: errors.length === 0, errors };
  };

  // Render the builder. Renders even when the slots are empty (so the user
  // can see the form); gates the Next button via validateBuilder().
  const renderBuilderStep = () => {
    if (!builderList) return;
    // Make sure the state shape exists (drafts persisted before this
    // feature shipped won't have classBuild; treat that as empty slots).
    if (!state.classBuild) state.classBuild = {
      classGear: [{classId:null,itemName:null},{classId:null,itemName:null},{classId:null,itemName:null}],
      coreAbilities: [{classId:null,abilityName:null,abilityDescription:null,abilityType:null},{classId:null,abilityName:null,abilityDescription:null,abilityType:null}],
      advancedAbility: {classId:null,abilityName:null,abilityDescription:null,abilityType:null}
    };
    const classes = buildableClasses();

    // Native <select> for the ability pickers inside each ability toggler
    // option. (Gear uses the portable picker, so no <select> there.)
    const renderAbilitySelect = (selectedName, abilities) => '<option value="">— Ability —</option>'
      + abilities.map((a) => '<option value="' + esc(a.name) + '"' + (a.name === selectedName ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('');

    // Build the option arrays once per render so the togglers can show
    // them. For gear: one entry per (class × first 6 class_gear items).
    // For abilities: every core and advanced ability across all classes.
    // The route already gives us description_html for each; pass it
    // through so the cards can show their tooltip / under-title text.
    const gearOptions = [];
    classes.forEach((c) => {
      if (!c || !c.id) return;
      const items = itemsForClass(c.id);
      items.forEach((g) => {
        if (g && g.name) {
          gearOptions.push({
            classId: c.id,
            className: c.name,
            name: g.name,
            description: g.description_html || ''
          });
        }
      });
    });
    gearOptions.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));

    const abilityOptions = [];
    classes.forEach((c) => {
      if (!c || !c.id) return;
      if (Array.isArray(c.abilities)) {
        c.abilities.forEach((a) => {
          if (!a || !a.name) return;
          const html = (c.abilities_html || []).find((x) => x.name === a.name);
          abilityOptions.push({
            classId: c.id,
            className: c.name,
            name: a.name,
            description: (html && html.description_html) || '',
            type: 'core'
          });
        });
      }
      if (Array.isArray(c.advanced_abilities)) {
        c.advanced_abilities.forEach((a) => {
          if (!a || !a.name) return;
          const html = (c.advanced_abilities_html || []).find((x) => x.name === a.name);
          abilityOptions.push({
            classId: c.id,
            className: c.name,
            name: a.name,
            description: (html && html.description_html) || '',
            type: 'advanced'
          });
        });
      }
    });
    abilityOptions.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));

    const build = state.classBuild || (state.classBuild = {
      classGear: [{classId:null,itemName:null},{classId:null,itemName:null},{classId:null,itemName:null}],
      coreAbilities: [{classId:null,abilityName:null},{classId:null,abilityName:null}],
      advancedAbility: {classId:null,abilityName:null}
    });

    // Filterable class picker. Replaces the bulky native <select> dropdown
    // for class selection: a search-as-you-type input that filters the
    // option list, with classes that would violate the "unique within
    // items / unique within abilities" constraint hidden entirely. A
    // class CAN appear in both items and abilities (but at most once in
    // each), so the exclusion set is per slot-type, not global.
    const renderClassPicker = (slotType, slotIdx, currentClassId, excludedClassIds) => {
      const current = builderClassMap[currentClassId];
      const currentName = current ? current.name : '';
      const excluded = new Set((excludedClassIds || []).filter((id) => id && id !== currentClassId));
      const visibleClasses = classes.filter((c) => !excluded.has(c.id));
      const optionLis = visibleClasses.map((c) => {
        const isCurrent = c.id === currentClassId;
        return '<li role="option" data-class-id="' + esc(c.id) + '"' + (isCurrent ? ' class="is-current"' : '') + '>'
          + esc(c.name) + (isCurrent ? ' <span class="tag is-success is-light is-small ml-1">current</span>' : '')
          + '</li>';
      }).join('');
      const excludedCount = classes.length - visibleClasses.length;
      return ''
        + '<div class="class-picker" data-class-picker="' + slotType + '" data-builder-idx="' + slotIdx + '">'
        +   '<input class="input is-small class-picker-input" type="search"'
        +          ' placeholder="Search classes…" autocomplete="off"'
        +          ' value="' + esc(currentName) + '"'
        +          (currentClassId ? '' : ' data-placeholder-default="1"')
        +          ' data-current-class-id="' + esc(currentClassId || '') + '">'
        +   '<button type="button" class="class-picker-clear button is-small" tabindex="-1" hidden>×</button>'
        +   '<ul class="class-picker-options" role="listbox" hidden>'
        +     (optionLis || '<li class="class-picker-empty">No classes match</li>')
        +     (excludedCount > 0 ? '<li class="class-picker-note">'
        +         + excludedCount + ' class' + (excludedCount === 1 ? '' : 'es') + ' hidden (already picked in another ' + (slotType === 'classGear' ? 'gear' : 'ability') + ' slot)'
        +       + '</li>' : '')
        +   '</ul>'
        + '</div>';
    };

    // PORTABLE PICKER — a single search-driven dropdown that picks a
    // (classId, name) pair at once. Reusable for gear (and later for
    // abilities). Options are a flat list of {classId, className, name}
    // entries — for gear, that's one entry per (class × class_gear) pair.
    //
    // The list filters itself in two layers:
    //   1. excludedClassIds — every class already picked in another slot
    //      of the same type is gone entirely (cross-slot uniqueness).
    //   2. Within the current slot, the picked class's OTHER items are
    //      hidden once an item is selected — so the slot is "committed"
    //      and you don't accidentally switch to a same-class item
    //      without first clearing the pick.
    //
    // Live search input filters by class name OR item name (case-insensitive
    // substring). A tiny status note reports the excluded-class count.
    const renderPortablePicker = ({ pickerType, slotIdx, currentValue, options, excludedClassIds, searchPlaceholder }) => {
      const excluded = new Set(excludedClassIds || []);
      const currentClassId = currentValue && currentValue.classId;
      const currentName = currentValue && currentValue.name;
      const currentClassName = currentValue && currentValue.className;
      const visibleOptions = options.filter((o) => {
        if (!o || !o.classId || !o.name) return false;
        if (excluded.has(o.classId)) return false;
        // Commit the slot: only the picked item from the picked class stays.
        if (currentClassId && o.classId === currentClassId && o.name !== currentName) return false;
        return true;
      });
      const optionLis = visibleOptions.map((o) => {
        const isCurrent = currentClassId && o.classId === currentClassId && o.name === currentName;
        return '<li role="option" data-class-id="' + esc(o.classId) + '" data-item-name="' + esc(o.name) + '"' + (isCurrent ? ' class="is-current"' : '') + '>'
          + '<span class="portable-picker-class">' + esc(o.className) + '</span>'
          + '<span class="portable-picker-sep"> · </span>'
          + '<span class="portable-picker-item">' + esc(o.name) + '</span>'
          + (isCurrent ? ' <span class="tag is-success is-light is-small ml-2">current</span>' : '')
          + '</li>';
      }).join('');
      const inputValue = currentName
        ? (currentClassName ? currentClassName + ' · ' + currentName : currentName)
        : '';
      const excludedCount = options.reduce((n, o) => n + (o && excluded.has(o.classId) ? 1 : 0), 0);
      const dataClassId = currentClassId || '';
      const dataName = currentName || '';
      return ''
        + '<div class="portable-picker" data-portable-picker="' + pickerType + '" data-builder-idx="' + slotIdx + '">'
        +   '<input class="input is-small portable-picker-input" type="search"'
        +          ' placeholder="' + esc(searchPlaceholder) + '" autocomplete="off"'
        +          ' value="' + esc(inputValue) + '"'
        +          ' data-current-class-id="' + esc(dataClassId) + '"'
        +          ' data-current-name="' + esc(dataName) + '">'
        +   '<button type="button" class="portable-picker-clear button is-small" tabindex="-1" hidden>×</button>'
        +   '<ul class="portable-picker-options" role="listbox" hidden>'
        +     (optionLis || '<li class="portable-picker-empty">No items match</li>')
        +     (excludedCount > 0
              ? '<li class="portable-picker-note">' + excludedCount + ' item' + (excludedCount === 1 ? '' : 's') + ' hidden (other class' + (excludedCount === 1 ? '' : 'es') + ' already picked in a slot)</li>'
              : '')
        +   '</ul>'
        + '</div>';
    };

    // Compute which class IDs are "used" within the same slot-type as the
    // slot being rendered. The current slot's own class is included in the
    // returned array (so the picker can show it as "current" even though
    // it's logically used by the same slot), and the renderClassPicker
    // helper filters that one back out.
    const usedGearClassIds = () => build.classGear
      .map((s) => s && s.classId)
      .filter((id) => !!id);
    const usedAbilityClassIds = () => [
      ...build.coreAbilities.map((s) => s && s.classId),
      build.advancedAbility && build.advancedAbility.classId
    ].filter((id) => !!id);

    // Render a single toggler section: a clickable button that opens a
    // search-driven dropdown, with picked items shown as cards below. One
    // section per side of the budget (gear vs. abilities). Each card has
    // a small × dismiss button.
    const renderToggler = ({ section, title, picks, options, pickLimit }) => {
      const picksCount = picks.length;
      const full = picksCount >= pickLimit;
      // Abilities are not "any 3": exactly 2 core + 1 advanced. Show the
      // split so the section reads as a rule, not a free count.
      const coresCount = picks.filter((p) => p.abilityType !== 'advanced').length;
      const advCount = picks.filter((p) => p.abilityType === 'advanced').length;
      const countLabel = section === 'abilities'
        ? 'Cores ' + coresCount + '/2 · Adv ' + advCount + '/1'
        : picksCount + '/' + pickLimit;
      // Find the first empty slot kind. For gear, all slots are gear. For
      // abilities, the option's `type` ('core' | 'advanced') decides which
      // slot kind to fill.
      const togglerBtnLabel = picksCount === 0
        ? 'Add ' + title.toLowerCase()
        : 'Add another ' + title.toLowerCase();
      // Exclusion set: classes already picked in this section. Hides
      // already-picked classes from the dropdown.
      const usedClassIds = new Set(picks.map((p) => p.classId));
      // Filter options: drop classes already picked, drop options whose
      // kind doesn't match the available slot (e.g., advanced when 1 is
      // already picked, or when no advanced slot is open).
      const visibleOptions = options.filter((o) => {
        if (!o || !o.classId || !o.name) return false;
        if (usedClassIds.has(o.classId)) return false;
        // For abilities: if option is advanced and advanced slot is taken,
        // hide. For gear: no such restriction (all slots are gear).
        if (section === 'abilities' && o.type === 'advanced') {
          const adv = build.advancedAbility;
          if (adv && adv.classId && adv.abilityName) return false;
        }
        return true;
      });
      const optionLis = visibleOptions.map((o) => {
        return '<li role="option" data-class-id="' + esc(o.classId) + '" data-item-name="' + esc(o.name) + '" data-type="' + esc(o.type || 'gear') + '" data-description="' + esc(o.description || '') + '">'
          + '<span class="toggler-option-class">' + esc(o.className) + '</span>'
          + '<span class="toggler-option-sep"> · </span>'
          + '<span class="toggler-option-item">' + esc(o.name) + '</span>'
          + (o.type && o.type !== 'gear' ? ' <span class="tag is-light is-small ml-2">' + esc(o.type) + '</span>' : '')
          + '</li>';
      }).join('');
      const pickerId = 'toggler-' + section;
      // Toggler button — looks like a button, not a disabled input.
      const togglerBtn = '<button type="button" class="button is-fullwidth is-light toggler-button"'
        + ' data-toggler-button="' + section + '"'
        + (full ? ' disabled' : '')
        + '>'
        + '<span class="icon"><i class="fas fa-plus"></i></span>'
        + '<span>' + esc(togglerBtnLabel) + ' <span class="has-text-grey">(' + countLabel + ')</span></span>'
        + '</button>';
      // Picked cards below.
      const cardsHtml = picks.map((p, i) => {
        const desc = p.description || p.abilityDescription || '';
        const isAdv = p.abilityType === 'advanced';
        const typeTag = isAdv
          ? ' <span class="tag is-info is-light ml-1">advanced</span>'
          : (p.abilityType === 'core' ? ' <span class="tag is-light ml-1">core</span>' : '');
        return ''
          + '<div class="card pick-card" data-toggler-card="' + section + '" data-pick-idx="' + i + '">'
          +   '<div class="card-content p-3">'
          +     '<div class="is-flex is-justify-content-space-between is-align-items-flex-start mb-2">'
          +       '<div>'
          +         '<strong class="pick-card-name">' + esc(p.itemName || p.abilityName) + '</strong>'
          +         ' <span class="tag is-light ml-1">' + esc(p.className || (builderClassMap[p.classId] || {}).name || '') + '</span>'
+ (typeTag)
          +       '</div>'
          +       '<div class="is-flex is-align-items-center" style="gap: 0.5rem;">'
          +         '<button type="button" class="delete pick-card-remove" aria-label="Remove" data-toggler-remove="' + section + '" data-pick-class-id="' + esc(p.classId) + '" data-pick-name="' + esc(p.itemName || p.abilityName) + '"></button>'
          +       '</div>'
          +     '</div>'
          +     (desc ? '<div class="content is-size-7 mb-0">' + desc + '</div>' : '')
          +   '</div>'
          + '</div>';
      }).join('');
      return ''
        + '<div class="toggler-section is-' + section + '">'
        +   '<div class="toggler-header">'
        +     '<h4 class="title is-6 has-text-grey mb-0">' + esc(title) + '</h4>'
        +     '<span class="tag is-light">' + countLabel + '</span>'
        +   '</div>'
        +   '<div class="toggler-trigger" data-toggler-trigger="' + section + '">'
        +     togglerBtn
        +   '</div>'
        +   '<div class="portable-picker toggler-dropdown" data-toggler-picker="' + section + '">'
        +     '<input class="input is-small portable-picker-input" type="search"'
        +            ' placeholder="Search ' + (section === 'gear' ? 'classes or items' : 'classes or abilities') + '…"'
        +            ' autocomplete="off"'
        +            ' data-current-class-id="" data-current-name="">'
        +     '<button type="button" class="portable-picker-clear button is-small" tabindex="-1" hidden>×</button>'
        +     '<ul class="portable-picker-options" role="listbox" hidden>'
        +       (optionLis || '<li class="portable-picker-empty">No matches</li>')
        +     '</ul>'
        +   '</div>'
        +   '<div class="toggler-picks-list">'
        +     (cardsHtml || '<p class="has-text-grey is-size-7 mb-0">No picks yet.</p>')
        +   '</div>'
        + '</div>';
    };

    // Pick helpers — render the gear and ability sections.
    const gearPicks = (build.classGear || [])
      .filter((s) => s && s.classId && s.itemName)
      .map((s) => ({
        classId: s.classId,
        className: s.className || (builderClassMap[s.classId] || {}).name || '',
        itemName: s.itemName,
        description: s.itemDescription || ''
      }));
    const abilityPicks = [];
    (build.coreAbilities || []).forEach((s) => {
      if (!s || !s.classId || !s.abilityName) return;
      abilityPicks.push({
        classId: s.classId,
        className: s.className || (builderClassMap[s.classId] || {}).name || '',
        abilityName: s.abilityName,
        description: s.abilityDescription || '',
        abilityType: 'core'
      });
    });
    if (build.advancedAbility && build.advancedAbility.classId && build.advancedAbility.abilityName) {
      const a = build.advancedAbility;
      abilityPicks.push({
        classId: a.classId,
        className: a.className || (builderClassMap[a.classId] || {}).name || '',
        abilityName: a.abilityName,
        description: a.abilityDescription || '',
        abilityType: 'advanced'
      });
    }

    const validation = validateBuilder();

    // Live-update the "Aspiring <Name>" header in the form section above.
    // (We don't re-render the whole form on every keystroke — the input
    // itself is the source of truth, the header is just a live preview.)
    const nameDisplay = document.getElementById('pseudoClassNameDisplay');
    if (nameDisplay) {
      const pcName = (state.pseudoClass && state.pseudoClass.name || '').trim();
      nameDisplay.textContent = pcName || 'Unnamed';
      nameDisplay.classList.toggle('is-set', !!pcName);
    }

    // Two columns, side by side. Each side is a single toggler section
    // (button + dropdown + picks list), not 3 cartouches — the user
    // picks from the toggler until the section is full.
    builderList.innerHTML =
      '<div class="columns is-variable is-3">'
      + '<div class="column is-half">'
      +   renderToggler({
            section: 'gear',
            title: 'Class Gear',
            picks: gearPicks,
            options: gearOptions,
            pickLimit: 3
          })
      + '</div>'
      + '<div class="column is-half">'
      +   renderToggler({
            section: 'abilities',
            title: 'Abilities',
            picks: abilityPicks,
            options: abilityOptions,
            pickLimit: 3
          })
      + '</div>'
      + '</div>'
      + '<div class="box mt-4 has-background-light">'
      +   '<p class="has-text-grey is-size-7 mb-2">Your budget is spent later: the items you pick show up on the gear page at <strong>2 Merx</strong> each, and the abilities are the <strong>Perk</strong> cost on the abilities primer (core = 1, advanced = 2).</p>'
      + (validation.errors.length
            ? '<p class="help is-danger">' + esc(validation.errors.join(' · ')) + '</p>'
            : '')
      + '</div>';
    // Update the Next-button gate on every render so a completed (or
    // freshly emptied) builder re-enables/disabled the gate correctly.
    updateBuilderGate();
  };

  // Delegated handlers on the builder container.
  if (builderList) {
    // Ability dropdowns are still native <select>s (gear uses the new
    // portable picker, handled below).
    builderList.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLSelectElement)) return;
      if (t.matches('[data-builder-ability]')) {
        const idx = parseInt(t.getAttribute('data-builder-idx'), 10) || 0;
        const build = state.classBuild || {};
        const slot = (t.getAttribute('data-builder-ability') === 'advancedAbility')
          ? (build.advancedAbility || {})
          : (build.coreAbilities[idx] || {});
        const kind = t.getAttribute('data-builder-ability');
        setBuildSlot(kind, idx, slot.classId, t.value || null);
        renderBuilderStep();
        renderSummary();
      }
    });

    // Custom class-picker events: open/filter/select/clear. Delegated on
    // the builder container so re-renders don't lose the listeners.
    builderList.addEventListener('click', (e) => {
      // TOGGLER FIRST — its dropdown is ALSO a .portable-picker, so it
      // must win the match before the legacy class/portable branches.
      const insideToggler = e.target.closest('.toggler-section');
      const insideClass = e.target.closest('.class-picker');
      const insidePortable = e.target.closest('.portable-picker');
      if (insideToggler) {
        const section = insideToggler.querySelector('.toggler-trigger').getAttribute('data-toggler-trigger');
        // Click the + button (or the trigger area) to open the dropdown.
        if (e.target.closest('.toggler-button') || e.target.closest('.portable-picker-input')) {
          const trigger = insideToggler.querySelector('.toggler-trigger');
          const btn = trigger && trigger.querySelector('.toggler-button');
          if (btn && btn.disabled) return;
          const dropdown = insideToggler.querySelector('.portable-picker');
          if (!dropdown) return;
          // Close other dropdowns, then toggle this one.
          builderList.querySelectorAll('.portable-picker.is-open').forEach((p) => {
            if (p !== dropdown) {
              p.classList.remove('is-open');
              const ul = p.querySelector('ul');
              if (ul) ul.hidden = true;
            }
          });
          const wasOpen = dropdown.classList.contains('is-open');
          if (wasOpen) {
            dropdown.classList.remove('is-open');
            const ul = dropdown.querySelector('ul');
            if (ul) ul.hidden = true;
          } else {
            dropdown.classList.add('is-open');
            const ul = dropdown.querySelector('ul');
            if (ul) ul.hidden = false;
            const input = dropdown.querySelector('.portable-picker-input');
            if (input) input.focus();
          }
          return;
        }
        // Click an option in the dropdown to add the pick.
        if (e.target.closest('.portable-picker-options li[data-class-id]')) {
          const li = e.target.closest('.portable-picker-options li[data-class-id]');
          const opt = {
            classId: li.getAttribute('data-class-id'),
            className: (li.querySelector('.toggler-option-class') || {}).textContent || '',
            name: li.getAttribute('data-item-name'),
            type: li.getAttribute('data-type') || 'gear',
            description: (li.querySelector('.toggler-option-item') || {}).dataset.desc || ''
          };
          // Reconstruct description from the option's stored data — we
          // embed it as a data-attribute on the option so it survives the
          // innerHTML round-trip without a re-lookup. Fall back to empty
          // string for legacy renderings.
          opt.description = li.dataset.description || opt.description;
          addPick(section, opt);
          // Close the dropdown before re-rendering.
          const dropdown = insideToggler.querySelector('.portable-picker');
          if (dropdown) {
            dropdown.classList.remove('is-open');
            const ul = dropdown.querySelector('ul');
            if (ul) ul.hidden = true;
          }
          renderBuilderStep();
          renderSummary();
          return;
        }
        // Click the × on a pick card to remove it.
        if (e.target.closest('.pick-card-remove')) {
          const btn = e.target.closest('.pick-card-remove');
          const pickSection = btn.getAttribute('data-toggler-remove');
          const classId = btn.getAttribute('data-pick-class-id');
          const name = btn.getAttribute('data-pick-name');
          // Resolve the slot by identity (id + name), not by rendered
          // position — cards drop out of the filtered list once a middle
          // slot is emptied, so list indexes no longer map to slot indexes.
          const pickIdx = findPickIndex(pickSection, classId, name);
          if (pickIdx < 0) return;
          removePick(pickSection, pickIdx);
          renderBuilderStep();
          renderSummary();
          return;
        }
        // Clear the dropdown's search text (and re-filter the list).
        if (e.target.closest('.portable-picker-clear')) {
          const input = insideToggler.querySelector('.portable-picker-input');
          if (input) {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return;
        }
      }
      // Click outside any picker closes all dropdowns (class + portable).
      if (!insideClass && !insidePortable) {
        builderList.querySelectorAll('.class-picker.is-open, .portable-picker.is-open').forEach((p) => {
          p.classList.remove('is-open');
          const ul = p.querySelector('ul');
          if (ul) ul.hidden = true;
        });
        return;
      }
      // ---- CLASS PICKER (still used for the 3 ability slots for now) ----
      if (insideClass && !insideToggler) {
        const picker = insideClass;
        if (e.target.matches('.class-picker-input')) {
          if (!picker.classList.contains('is-open')) {
            builderList.querySelectorAll('.class-picker.is-open, .portable-picker.is-open').forEach((p) => {
              if (p !== picker) {
                p.classList.remove('is-open');
                const ul = p.querySelector('ul');
                if (ul) ul.hidden = true;
              }
            });
            picker.classList.add('is-open');
            const ul = picker.querySelector('.class-picker-options');
            if (ul) ul.hidden = false;
          }
          return;
        }
        if (e.target.matches('.class-picker-clear')) {
          const kind = picker.getAttribute('data-class-picker');
          const idx = parseInt(picker.getAttribute('data-builder-idx'), 10) || 0;
          setBuildSlot(kind, idx, null, null);
          renderBuilderStep();
          renderSummary();
          return;
        }
        if (e.target.matches('.class-picker-options li[data-class-id]')) {
          const kind = picker.getAttribute('data-class-picker');
          const idx = parseInt(picker.getAttribute('data-builder-idx'), 10) || 0;
          const newClassId = e.target.getAttribute('data-class-id');
          setBuildSlot(kind, idx, newClassId, null);
          picker.classList.remove('is-open');
          const ul = picker.querySelector('.class-picker-options');
          if (ul) ul.hidden = true;
          renderBuilderStep();
          renderSummary();
        }
        return;
      }
      // ---- PORTABLE PICKER (legacy, gear) ----
      if (insidePortable && !insideToggler) {
        const picker = insidePortable;
        if (e.target.matches('.portable-picker-input')) {
          if (!picker.classList.contains('is-open')) {
            builderList.querySelectorAll('.class-picker.is-open, .portable-picker.is-open').forEach((p) => {
              if (p !== picker) {
                p.classList.remove('is-open');
                const ul = p.querySelector('ul');
                if (ul) ul.hidden = true;
              }
            });
            picker.classList.add('is-open');
            const ul = picker.querySelector('.portable-picker-options');
            if (ul) ul.hidden = false;
          }
          return;
        }
        if (e.target.matches('.portable-picker-clear')) {
          const kind = picker.getAttribute('data-portable-picker');
          const idx = parseInt(picker.getAttribute('data-builder-idx'), 10) || 0;
          setBuildSlot(kind, idx, null, null);
          renderBuilderStep();
          renderSummary();
          return;
        }
        if (e.target.matches('.portable-picker-options li[data-class-id]')) {
          const kind = picker.getAttribute('data-portable-picker');
          const idx = parseInt(picker.getAttribute('data-builder-idx'), 10) || 0;
          const newClassId = e.target.getAttribute('data-class-id');
          const newName = e.target.getAttribute('data-item-name');
          setBuildSlot(kind, idx, newClassId, newName);
          picker.classList.remove('is-open');
          const ul = picker.querySelector('.portable-picker-options');
          if (ul) ul.hidden = true;
          renderBuilderStep();
          renderSummary();
        }
      }
    });

    // Live filter for both the class picker (filter by class name) and the
    // portable picker (filter by class name OR item name).
    builderList.addEventListener('input', (e) => {
      // ---- class picker (search by class name) ----
      if (e.target.matches('.class-picker-input')) {
        const picker = e.target.closest('.class-picker');
        if (!picker) return;
        const q = e.target.value.toLowerCase().trim();
        const ul = picker.querySelector('.class-picker-options');
        if (!ul) return;
        let visible = 0;
        Array.from(ul.querySelectorAll('li[data-class-id]')).forEach((li) => {
          const match = !q || (li.textContent || '').toLowerCase().indexOf(q) !== -1;
          li.hidden = !match;
          if (match) visible++;
        });
        let empty = ul.querySelector('.class-picker-empty');
        if (visible === 0 && q) {
          if (!empty) {
            empty = document.createElement('li');
            empty.className = 'class-picker-empty';
            empty.textContent = 'No classes match';
            ul.appendChild(empty);
          }
          empty.hidden = false;
        } else if (empty) {
          empty.hidden = true;
        }
        picker.classList.add('is-open');
        ul.hidden = false;
        const clearBtn = picker.querySelector('.class-picker-clear');
        if (clearBtn) clearBtn.hidden = !e.target.value;
        return;
      }
      // ---- portable picker (search by class name OR item name) ----
      if (e.target.matches('.portable-picker-input')) {
        const picker = e.target.closest('.portable-picker');
        if (!picker) return;
        const q = e.target.value.toLowerCase().trim();
        const ul = picker.querySelector('.portable-picker-options');
        if (!ul) return;
        let visible = 0;
        Array.from(ul.querySelectorAll('li[data-class-id]')).forEach((li) => {
          // Match against the class name (rendered as .portable-picker-class)
          // OR the item name (.portable-picker-item). Either is enough.
          const text = (li.textContent || '').toLowerCase();
          const match = !q || text.indexOf(q) !== -1;
          li.hidden = !match;
          if (match) visible++;
        });
        let empty = ul.querySelector('.portable-picker-empty');
        if (visible === 0 && q) {
          if (!empty) {
            empty = document.createElement('li');
            empty.className = 'portable-picker-empty';
            empty.textContent = 'No items match';
            ul.appendChild(empty);
          }
          empty.hidden = false;
        } else if (empty) {
          empty.hidden = true;
        }
        picker.classList.add('is-open');
        ul.hidden = false;
        const clearBtn = picker.querySelector('.portable-picker-clear');
        if (clearBtn) clearBtn.hidden = !e.target.value;
      }
    });
  }

  // Gate the step-1 Next button (aspiring mode only). Aspiring's pseudo-class
  // form and 6-slot builder both live on step 1, so the gate combines:
  //   - pseudo-class name must be non-empty
  //   - builder picks must satisfy validateBuilder() (all 6 slots filled,
//     classes unique within items, classes unique within abilities)
  const updateBuilderGate = () => {
    if (DATA.mode !== 'aspiring') return;
    const pc = state.pseudoClass || {};
    const nameOk = (pc.name || '').trim().length > 0;
    const builderOk = validateBuilder().ok;
    if (step1Next) step1Next.disabled = !(nameOk && builderOk);
  };
  // (no further action — the change handler already calls renderBuilderStep,
  // and updateBuilderGate runs after each via the wrapping above.)

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

  // Build a flat spend-pool = common items + class gear. Each entry is a
  // "shop item" with { key, name, description_html, cost, kind, subtype }.
  //   - advent/aspiring: only the selected class's gear (all 6 items, so the
  //     user can re-pick a base item as a duplicate). All items cost 2 Merx
  //     (CLASS_GEAR_COST) here; the first 3 are free via STARTING_ON_CLASS_GEAR_ALLOTMENT
  //     at pick time (syncBaseGear stamps cost: 0 on the auto-loaded base rows).
  //   - aspirant: every unlocked class's gear. Cost depends on origin:
  //     items from the user's selected class cost CLASS_GEAR_COST (2 Merx);
  //     items from any other unlocked class cost CROSS_CLASS_GEAR_COST (3 Merx)
  //     to match the post-creation purchase rate. No free allotment in
  //     aspirant mode — the user pays for every pick.
  const getShopPool = () => {
    const pool = [];
    const selectedId = (DATA.mode === 'aspirant') ? (state.classId || null) : null;
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
    if (DATA.mode === 'aspirant') {
      if (Array.isArray(DATA.classes)) {
        DATA.classes.forEach((cls) => {
          if (!cls || !cls.id || !Array.isArray(cls.class_gear)) return;
          cls.class_gear.forEach((g) => {
            if (!g || !g.name) return;
            const isOwnClass = cls.id === selectedId;
            pool.push({
              key: 'class:' + cls.id + ':' + g.name,
              name: g.name,
              description_html: g.description_html || '',
              cost: isOwnClass ? CLASS_GEAR_COST : CROSS_CLASS_GEAR_COST,
              kind: 'class',
              origin_class_id: cls.id,
              origin_class_name: cls.name || '',
              subtype: g.subtype || 'elective'
            });
          });
        });
      }
    } else if (DATA.mode === 'aspiring') {
      // Step 4 is the Merx spend step for aspiring. The shop sells the items
      // picked in the step-1 builder (treated as the aspiring class's own
      // elective gear, so they cost CLASS_GEAR_COST each — cheaper than the
      // aspirant cross-class rate). Nothing is pre-picked; the user spends
      // their 10-Merx budget across these plus common items, duplicates
      // allowed, exactly like the advent shop.
      const build = state.classBuild || {};
      (build.classGear || []).forEach((s) => {
        if (!s || !s.classId || !s.itemName) return;
        const cls = builderClassMap[s.classId] || {};
        const gearList = Array.isArray(cls.class_gear) ? cls.class_gear : [];
        const hit = gearList.find((g) => g && g.name === s.itemName);
        pool.push({
          key: 'class:' + s.classId + ':' + s.itemName,
          name: s.itemName,
          description_html: (hit && hit.description_html) || s.itemDescription || '',
          cost: CLASS_GEAR_COST,
          kind: 'class',
          origin_class_id: s.classId,
          origin_class_name: s.className || cls.name || '',
          subtype: (hit && hit.subtype) || 'elective'
        });
      });
    } else {
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
            origin_class_id: c.id,
            origin_class_name: c.name || '',
            subtype: g.subtype || 'elective'
          });
        });
      }
    }
    return pool;
  };

  // Sum the merx cost of the user's current right-column picks. Common items
  // cost 1 each. Class gear carries its own `cost` (stamped at pick time):
  //   - 0 for the first effectiveFreeBaseCount() entries — auto-loaded base,
  //     free under STARTING_ON_CLASS_GEAR_ALLOTMENT.
  //   - CLASS_GEAR_COST (2) for own-class elective picks.
  //   - CROSS_CLASS_GEAR_COST (3) for cross-class picks (aspirant only).
  // Items beyond the free allotment charge their per-item cost regardless.
  const computeMerxSpent = () => {
    let spent = 0;
    if (Array.isArray(state.commonItems)) {
      spent += state.commonItems.length * COMMON_ITEM_COST;
    }
    if (Array.isArray(state.gear)) {
      const freeFloor = effectiveFreeBaseCount();
      state.gear.forEach((g, idx) => {
        if (idx < freeFloor) return;
        spent += (typeof g.cost === 'number' ? g.cost : CLASS_GEAR_COST);
      });
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
      // Aspirant picks may originate from another class — carry the origin
      // so the server can attribute the gear to the right class row, and
      // the locked-in cost so computeMerxSpent charges the right Merx
      // (2 for the user's own class, 3 for cross-class).
      state.gear.push({
        name: shop.name,
        kind: 'class',
        subtype: shop.subtype,
        cost: shop.cost,
        origin_class_id: shop.origin_class_id || state.classId,
        origin_class_name: shop.origin_class_name || ''
      });
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
        const floor = effectiveFreeBaseCount();
        state.gear.forEach((g, idx) => {
          if (idx >= floor && g && g.kind === 'class' && g.name === gname) n++;
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
      // Stop at the effective free-base count so the free base slots stay put
// (advent's 3 auto-loaded entries are protected; aspirant has none).
      for (let i = state.gear.length - 1; i >= effectiveFreeBaseCount(); i--) {
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
    if (!spendList) return;
    const c = selectedClass();

    // ----- Left column: base gear (auto-loaded) -----
    // Aspirant and aspiring modes hide the base-gear column in the view
    // (aspirant: no starting gear; aspiring: the picked items are sold from
    // the shop, not granted free), so baseGearList may be absent from the
    // DOM. Render it only when present; never block the spend list on its
    // existence.
    if (baseGearList) {
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
    }

    // ----- Right column: shop pool -----
    // note: budget/spent are declared at function scope (not in the else
    // block) because the budget-display and Next-button sections below read
    // them; the original `var` hoisted them function-wide with the same
    // undefined-when-pool-is-empty behavior preserved here.
    const pool = getShopPool();
    // budget/spent are derived up front (not just inside the pool branch) so
    // the budget display and Next-button sections always read sane values,
    // even when the pool is empty.
    const budget = getMerxBudget();
    const spent = computeMerxSpent();

    // ----- Step 4 gear filter controls -----
    // Two layered filters, both keyed off state.gearSearch /
    // state.gearClassFilter. The text search matches against the item
    // name (case-insensitive substring). The class filter narrows class
    // items to one origin class — only enabled when the pool actually
    // spans multiple classes (otherwise it'd be a no-op dropdown).
    const searchText = (state.gearSearch || '').toLowerCase().trim();
    const classFilterId = state.gearClassFilter || '';
    const matchesSearch = (it) => !searchText
      || (it.name || '').toLowerCase().includes(searchText);
    const matchesClass = (it) => it.kind !== 'class'
      || !classFilterId
      || it.origin_class_id === classFilterId;

    // Populate the class filter dropdown once per (selected class, pool)
    // change. We refresh the options on every render — cheap, and it keeps
    // the choices in sync if the user picks a different class.
    if (gearClassFilterEl && gearClassFilterWrap) {
      const classNames = [];
      const seen = new Set();
      for (const it of pool) {
        if (it.kind !== 'class' || !it.origin_class_id || !it.origin_class_name) continue;
        if (seen.has(it.origin_class_id)) continue;
        seen.add(it.origin_class_id);
        classNames.push({ id: it.origin_class_id, name: it.origin_class_name });
      }
      // Only show the dropdown if the pool has items from >1 class — the
      // filter is a no-op otherwise and just clutters the UI.
      const showFilter = classNames.length > 1;
      gearClassFilterWrap.hidden = !showFilter;
      if (showFilter) {
        classNames.sort((a, b) => a.name.localeCompare(b.name));
        gearClassFilterEl.innerHTML = '<option value="">All classes</option>'
          + classNames.map((cn) => '<option value="' + esc(cn.id) + '">' + esc(cn.name) + '</option>').join('');
        gearClassFilterEl.value = classFilterId;
      } else {
        gearClassFilterEl.value = '';
      }
    }

    if (pool.length === 0) {
      spendList.innerHTML = '<p class="has-text-grey">Nothing available to spend Merx on.</p>';
    } else {
      const tab = activeShopTab();
      // Pre-filter: kind matches active tab, plus the two search filters.
      const filtered = pool.filter((it) => it.kind === tab && matchesSearch(it) && matchesClass(it));
      const remaining = budget === Infinity ? Infinity : budget - spent;
      const renderCard = (it) => {
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
          // Class items also get a small "from <Class>" tag so the user
          // knows which class a signature item originates from — important
          // in aspirant mode where many classes share the pool.
          let originTag = '';
          if (it.kind === 'class' && it.origin_class_name) {
            originTag = '<span class="tag is-light mr-1">' + esc(it.origin_class_name) + '</span>';
          }
          return ''
            + '<div class="' + cardCls + '" data-shop-key="' + esc(it.key) + '">'
            +   '<div class="card-content p-3">'
            +     '<div class="is-flex is-justify-content-space-between is-align-items-flex-start mb-1">'
            +       '<h5 class="title is-6 mb-0">' + esc(it.name) + '</h5>'
            +       '<span class="tag is-warning is-light">' + it.cost + ' Merx</span>'
            +     '</div>'
            +     '<div class="mb-1">' + subtypeTag + originTag + '</div>'
            +     '<div class="content mb-1 is-size-7">' + (it.description_html || '') + '</div>'
            +     '<div class="is-size-7">' + status + '</div>'
            +   '</div>'
            + '</div>';
      };
      let cardsHtml = '';
      if (tab === 'class' && c && c.id) {
        // Aspirant-style pool: section "Your class — <name>" first, then
        // "Other classes" below. Search/class-filter already happened above,
        // so each section's items are pre-filtered.
        const yours = filtered.filter((it) => it.origin_class_id === c.id);
        const others = filtered.filter((it) => it.origin_class_id !== c.id);
        if (yours.length > 0) {
          cardsHtml += '<h5 class="title is-6 mt-2 mb-2">Your class — ' + esc(c.name) + '</h5>';
          cardsHtml += yours.map(renderCard).join('');
        }
        if (others.length > 0) {
          cardsHtml += '<h5 class="title is-6 mt-4 mb-2">Other classes</h5>';
          cardsHtml += others.map(renderCard).join('');
        }
      } else {
        cardsHtml = filtered.map(renderCard).join('');
      }
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
      spendList.innerHTML = cardsHtml || '<p class="has-text-grey">No items match your search.</p>';
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
      classCount = Math.max(0, state.gear.length - effectiveFreeBaseCount());
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

    // ----- Next button gates on budget being spent (advent and aspiring) -----
    // Both modes start with a fixed Merx budget to spend here; the gate stays
    // locked until the whole budget is laid out (aspiring spends its 10 Merx
    // across the picked items and common items, duplicates allowed).
    if (step4Next) {
      if (DATA.mode === 'advent' || DATA.mode === 'aspiring') {
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
    // Aspirant mode: gear is class-agnostic (cross-class pool), so re-entering
    // step 4 with a new class must not wipe the user's picks. Just no-op.
    if (DATA.mode === 'aspirant') return;
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
    // Stamp cost: 0 on the auto-loaded base so computeMerxSpent treats
    // them as free even if a user picks a duplicate of one of them later
    // (the duplicate carries CLASS_GEAR_COST from the pool and so charges
    // correctly; the original free slot stays free).
    const additions = base.map((g) => {
      return {
        name: g.name,
        kind: 'class',
        subtype: 'base',
        cost: 0,
        origin_class_id: c.id,
        origin_class_name: c.name || ''
      };
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
// have safe defaults, so they don't gate the button. Aspiring is class-less
// (the pseudo-class name is already gated on step 1), so only the character
// name gates submit there.
  const isStep5Valid = () => {
    if (DATA.mode === 'aspiring') {
      return (state.name || '').trim().length > 0;
    }
    return !!(state.classId && (state.name || '').trim().length > 0);
  };

  const updateSubmitButton = () => {
    if (!submitEl) return;
    submitEl.disabled = !isStep5Valid();
  };

  // ---------- Step navigation ----------
  const showStep = (n) => {
    // Defensive clamp: callers are gated, but never let a stray value put the
    // wizard into a non-existent step (which would hide every panel).
    n = Math.max(1, Math.min(STEP_COUNT, n));
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
    if (n === 3) { renderAbilityPrimer(); refreshStep3Perk(); }
    if (n === 4) refreshStep4();
    if (n === 5) refreshStep5();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveAndGoNext = () => {
    // Always persist the combined stats (class + personality + user) so
    // downstream steps see a single source of truth.
    state.stats = getCombinedStats();
    writeStorage(state);
    let next = state.step + 1;
    if (next <= STEP_COUNT) showStep(next);
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
  // Step 4 gear filters: live re-render on input/change. No submit gate;
  // these are pure UI state.
  if (gearSearchEl) {
    gearSearchEl.addEventListener('input', () => {
      state.gearSearch = gearSearchEl.value || '';
      renderGearStep();
    });
  }
  if (gearClassFilterEl) {
    gearClassFilterEl.addEventListener('change', () => {
      state.gearClassFilter = gearClassFilterEl.value || '';
      renderGearStep();
    });
  }
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
  // Aspiring pseudo-class form (step 1) — the user types the SUFFIX of
  // the class name; the system prepends "Aspiring " so the full identity
  // is always "Aspiring <suffix>". Avoids the user having to retype the
  // prefix and keeps the input compact. tagline/description are free-form.
  const ASPIRING_NAME_PREFIX = 'Aspiring ';
  if (pseudoClassNameEl) {
    pseudoClassNameEl.addEventListener('input', () => {
      if (!state.pseudoClass) state.pseudoClass = { name: '', tagline: '', description: '' };
      const suffix = pseudoClassNameEl.value;
      // Full class identity: "Aspiring <suffix>". Empty suffix -> empty
      // name (the gate rejects it).
      state.pseudoClass.name = suffix.trim()
        ? ASPIRING_NAME_PREFIX + suffix.trim()
        : '';
      // Live-update the "Aspiring <Name>" preview header so it tracks
      // the input. The header isn't part of the builder container, so
      // we update it here rather than re-rendering the whole builder.
      const nameDisplay = document.getElementById('pseudoClassNameDisplay');
      if (nameDisplay) {
        nameDisplay.textContent = state.pseudoClass.name || 'Unnamed';
        nameDisplay.classList.toggle('is-set', !!state.pseudoClass.name);
      }
      updateBuilderGate();
    });
  }
  if (pseudoClassTaglineEl) {
    pseudoClassTaglineEl.addEventListener('input', () => {
      if (!state.pseudoClass) state.pseudoClass = { name: '', tagline: '', description: '' };
      state.pseudoClass.tagline = pseudoClassTaglineEl.value;
    });
  }
  if (pseudoClassDescriptionEl) {
    pseudoClassDescriptionEl.addEventListener('input', () => {
      if (!state.pseudoClass) state.pseudoClass = { name: '', tagline: '', description: '' };
      state.pseudoClass.description = pseudoClassDescriptionEl.value;
    });
  }
  // Step 3 perk interactions live on abilityPrimerList. Two delegated handlers:
  //   .wizard-perk-btn   — "+ Add Perk" on an unassigned card. Click
  //                        assigns the perk to that card and re-renders so
  //                        the editor appears inline on the chosen card.
  //   .wizard-perk-remove — "Remove perk" on the assigned card. Clears both
  //                        the text and the assignment, re-renders so the
  //                        + buttons come back on every card.
  //   [data-wizard-perk-editor] — the inline textarea. Updates state.perk
  //                        without re-rendering (re-rendering would yank
  //                        the caret mid-keystroke).
  if (abilityPrimerList) {
    abilityPrimerList.addEventListener('click', (e) => {
      const removeBtn = e.target.closest && e.target.closest('.wizard-perk-remove');
      if (removeBtn) {
        state.perk = '';
        state.perkAbilityName = null;
        renderAbilityPrimer();
        return;
      }
      const btn = e.target.closest && e.target.closest('.wizard-perk-btn');
      if (!btn) return;
      state.perkAbilityName = btn.getAttribute('data-ability-name') || null;
      renderAbilityPrimer();
      // Focus the freshly-rendered inline editor so the user can start
      // typing immediately.
      const editor = abilityPrimerList.querySelector('[data-wizard-perk-editor]');
      if (editor) editor.focus();
    });
    abilityPrimerList.addEventListener('input', (e) => {
      const ta = e.target.closest && e.target.closest('[data-wizard-perk-editor]');
      if (!ta) return;
      state.perk = ta.value;
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
      // Aspiring: pseudo-class metadata (the user-invented class name and
      // description from step 1). Sent alongside the character payload; the
      // server creates a player-created class row keyed to the user's
      // profile, then links the new character to that class.
      pseudo_class: DATA.mode === 'aspiring' ? {
        name: (state.pseudoClass && state.pseudoClass.name || '').trim(),
        tagline: (state.pseudoClass && state.pseudoClass.tagline || '').trim(),
        description: (state.pseudoClass && state.pseudoClass.description || '').trim()
      } : null,
      level: state.level || 1,
      completed_missions: state.successfulMissions || 0,
      appearance: state.appearance || '',
      background: state.background || '',
      // Aspirant mode: send the free-form perk. Stored in the characters.perks
      // column (V1-only). Server-side input.js already drops `perks` for v2,
      // so it's safe to send unconditionally.
      perks: state.perk || '',
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
    // Aspirant perk attachment: if the user assigned their single perk to
    // one of the three base abilities, ship it as a structured v2 perk row
    // (class_ability_id is the ability NAME — server-side
    // remapPerkAbilityIdsByName rewrites it to the freshly-inserted row id).
    // Server strips ability_perks on v1 characters (V2_ONLY_FIELDS), so this
    // is safe to send unconditionally; the `perks` string above still
    // carries the same text for v1.
    if (DATA.mode === 'aspirant' && state.perkAbilityName && (state.perk || '').trim()) {
      payload.ability_perks = [{
        class_ability_id: state.perkAbilityName,
        text: state.perk.trim(),
        position: 0
      }];
    }
    // Class gear: each entry becomes a class_gear row via setCharacterGear.
    // The shape matches the model's normalizeGearItems ({name, class_id?}).
    // For aspirant and aspiring modes a pick may originate from another
    // class — use that origin as the class_id so the gear is attributed
    // correctly server-side. Aspiring's step-4 shop records origin_class_id
    // on every pick, so the generic branch handles it like the others.
    if (Array.isArray(state.gear) && state.gear.length) {
      payload.gear = state.gear.map((g) => {
        if (!g || !g.name) return null;
        const cid = g.origin_class_id || state.classId;
        return { name: g.name, class_id: cid };
      }).filter(Boolean);
    }
    // Common items: array of strings, normalized server-side.
    if (Array.isArray(state.commonItems) && state.commonItems.length) {
      payload.common_items = state.commonItems
        .map((i) => i && i.name ? i.name : null)
        .filter(Boolean);
    }
    // Class abilities: the chosen class's ability list is auto-granted to the
    // character. Advent/aspiring use the base `abilities` array; aspirant uses
    // `advanced_abilities` (the same list shown in step 3). We send them as
    // {name, class_id} so the server's normalizeAbilityItems +
    // setCharacterAbilities writes rows into public.class_abilities.
    // Aspiring is class-less: abilities come from state.classBuild.coreAbilities
    // + .advancedAbility, each potentially from a different unlocked class.
    const c = (typeof selectedClass === 'function') ? selectedClass() : null;
    if (DATA.mode === 'aspiring') {
      const build = state.classBuild || {};
      const corePicks = (build.coreAbilities || [])
        .filter((s) => s && s.classId && s.abilityName)
        .map((s) => ({ name: s.abilityName, class_id: s.classId, type: 'core' }));
      const adv = build.advancedAbility;
      const advPicks = (adv && adv.classId && adv.abilityName)
        ? [{ name: adv.abilityName, class_id: adv.classId, type: 'advanced' }]
        : [];
      const abilityPicks = corePicks.concat(advPicks);
      if (abilityPicks.length) payload.abilities = abilityPicks;
    } else {
      const abilityList = (c && DATA.mode === 'aspirant')
        ? (Array.isArray(c.advanced_abilities) ? c.advanced_abilities : c.abilities)
        : (c && c.abilities);
      if (c && Array.isArray(abilityList) && abilityList.length) {
        payload.abilities = abilityList
          .map((a) => a && a.name ? { name: a.name, class_id: state.classId } : null)
          .filter(Boolean);
      }
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
  // Aspiring hides the kiosk — skip kiosk/selected-panel renders there.
  if (DATA.mode !== 'aspiring') {
    renderKiosk();
    renderSelectedPanel();
  }
  renderSummary();
  // Refresh step 2 first if we're resuming a draft past step 1, so the
  // personality selects and stat grid reflect stored picks before showStep
  // reveals the panel. Same trick for the step 3 primer, step 4 gear, and
  // step 5 textareas.
  if ((state.step || 1) >= 1 && DATA.mode === 'aspiring') {
    // Aspiring's step 1 owns the pseudo-class form + 6-slot builder.
    // Hydrate the form fields from the draft and render the builder.
    // The stored name is the FULL "Aspiring <suffix>" — strip the
    // "Aspiring " prefix back off before seeding the input, since the
    // user only types the suffix.
    if (pseudoClassNameEl) {
      const stored = (state.pseudoClass && state.pseudoClass.name) || '';
      pseudoClassNameEl.value = stored.startsWith('Aspiring ')
        ? stored.slice('Aspiring '.length)
        : stored;
    }
    if (pseudoClassTaglineEl) pseudoClassTaglineEl.value = (state.pseudoClass && state.pseudoClass.tagline) || '';
    if (pseudoClassDescriptionEl) pseudoClassDescriptionEl.value = (state.pseudoClass && state.pseudoClass.description) || '';
    renderBuilderStep();
    updateBuilderGate();
  }
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
  // Aspiring is class-less — skip the class pick so selectedClass() stays
  // null and the gear/ability pulls come from the builder on step 3.
  let initialId = null;
  if (DATA.mode !== 'aspiring') {
    initialId = (state.classId && classesById[state.classId])
      ? state.classId
      : (DATA.preselectedClassId && classesById[DATA.preselectedClassId]
          ? DATA.preselectedClassId
          : DATA.classes[Math.floor(Math.random() * DATA.classes.length)].id);
    setClassId(initialId);
    renderSelectedPanel();
    renderSummary();
  }
  // Defer the initial scroll to the next frame so the kiosk and its
  // children have their final layout dimensions. Without this, the first
  // call to getBoundingClientRect on the kiosk can return a 0-width rect
  // and the random card ends up off-screen. A single delayed retry guards
  // against cards' art images still loading and shifting the track width
  // a beat after the first scroll. Skip entirely for aspiring — there's
  // no selected class to scroll to, and the kiosk is read-only.
  if (initialId) {
    requestAnimationFrame(() => {
      scrollToCard(initialId, false);
      positionRing();
    });
    setTimeout(() => {
      scrollToCard(initialId, false);
      positionRing();
      flashSelectedCard(initialId);
    }, 200);
  }

  // buildSubmitPayload / onSubmitSuccess are invoked from the Submit button in
  // views/character-wizard.handlebars; getState is a console debug handle.
  return { buildSubmitPayload, onSubmitSuccess, getState: () => state };
})();
