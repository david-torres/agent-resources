// Live trackers on a game table page. Participants (data-live-mode="realtime")
// subscribe to their table's tracker rows; each change is only a ping that
// re-fetches that member's tracker fragment. Everyone else -- and a
// participant whose Realtime connection is down -- falls back to the
// tracker's own hx-trigger poll, which consults shouldPoll().
//
// window-assigned and idempotent: hx-boost re-executes this script on every
// navigation to a table page.
window.TableLive = window.TableLive || (function () {
  let connected = false;
  let channel = null;
  let tableId = null;
  const pending = new Map();
  const openSources = new Set();

  const refresh = (memberId) => {
    clearTimeout(pending.get(memberId));
    pending.set(memberId, setTimeout(() => {
      const el = document.getElementById(`tracker-${memberId}`);
      if (!el) return;
      htmx.ajax('GET', `/tables/${tableId}/members/${memberId}/tracker?v=${el.dataset.version}`, { target: el, swap: 'outerHTML' });
    }, 250));
  };

  const stop = () => {
    const client = typeof App !== 'undefined' && App.getSupabaseClient();
    if (channel && client) client.removeChannel(channel);
    channel = null;
    connected = false;
  };

  const start = (root) => {
    const nextTable = root.dataset.tableLive;
    if (channel && nextTable === tableId) return;
    stop();
    tableId = nextTable;
    if (root.dataset.liveMode !== 'realtime') return;
    const client = typeof App !== 'undefined' && App.getSupabaseClient();
    if (!client) return;
    channel = client
      .channel(`game-table-${tableId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'game_table_member_state', filter: `table_id=eq.${tableId}` },
        (payload) => refresh(payload.new.member_id))
      .subscribe((status) => { connected = status === 'SUBSCRIBED'; });
  };

  // The client only exists once App.init has run, so this registers from scan().
  let watchingSession = false;
  const watchSession = () => {
    if (watchingSession) return;
    const client = typeof App !== 'undefined' && App.getSupabaseClient();
    if (!client || !client.auth) return;
    watchingSession = true;
    client.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') stop(); });
  };

  const scan = () => {
    watchSession();
    const root = document.querySelector('[data-table-live]');
    if (root) start(root);
    else stop();
  };

  document.addEventListener('DOMContentLoaded', scan);
  document.addEventListener('htmx:afterSettle', scan);

  // A tracker swap replaces its <details>; carry the open state across.
  // Bound to document: the app replaces <body> on signed-in page loads.
  document.addEventListener('htmx:beforeSwap', (event) => {
    if (!event.detail.shouldSwap) return;
    const target = event.detail.target;
    if (!target || !target.hasAttribute || !target.hasAttribute('data-tracker')) return;
    const sources = target.querySelector('.tracker-sources');
    if (sources && sources.open) openSources.add(target.id);
    else openSources.delete(target.id);
  });
  document.addEventListener('htmx:afterSwap', (event) => {
    const id = event.detail.elt && event.detail.elt.id;
    if (!id || !openSources.delete(id)) return;
    const sources = document.querySelector(`#${CSS.escape(id)} .tracker-sources`);
    if (sources) sources.open = true;
  });

  document.addEventListener('trackerActed', (event) => {
    const detail = event.detail || {};
    if (typeof App === 'undefined') return;
    App.showToast(detail.message || 'Updated.', {
      type: 'info',
      action: detail.undoable ? {
        label: 'Undo',
        run: () => {
          if (!document.getElementById(`tracker-${detail.memberId}`)) {
            App.showToast('That tracker is gone.', { type: 'info' });
            return;
          }
          htmx.ajax('POST', detail.actionUrl, {
            target: `#tracker-${detail.memberId}`,
            swap: 'outerHTML',
            values: { type: 'undo', version: detail.version },
          });
        },
      } : null,
    });
  });

  // A poll must not abort an in-flight action (hx-sync replaces).
  const requestInFlight = () => !!document.querySelector('[data-tracker].htmx-request, [data-tracker] .htmx-request');

  return { shouldPoll: () => !connected && !requestInFlight(), scan };
})();

// On a boosted navigation this script runs long after DOMContentLoaded, and
// the guard above skips re-creating the module; scan for this page's table.
if (document.readyState !== 'loading') window.TableLive.scan();
