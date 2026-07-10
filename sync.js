// =============================================================
// Shared cloud-sync helper for the dashboard.
// Each page calls initCloudSync({...}) once with its config:
//   appKey         — string row key in the public.app_state table
//   syncedKeys     — exact localStorage keys to mirror
//   syncedPrefixes — localStorage key prefixes to mirror (e.g. 'goals:')
//   onApplied      — optional callback after remote state has been applied
//
// All Supabase access goes through /api/db (server-side proxy).
// No Supabase credentials are needed in the browser.
// =============================================================
(function () {
  'use strict';

  function getSecret() { return window.DASH_APP_SECRET || ''; }

  window.initCloudSync = function (config) {
    const appKey = config && config.appKey;
    const syncedKeys = (config && config.syncedKeys) || [];
    const syncedPrefixes = (config && config.syncedPrefixes) || [];
    const onApplied = config && config.onApplied;
    if (!appKey) return;

    let pushTimer = null;
    let suppressSync = false;
    let lastSyncedJson = null;

    function matches(k) {
      if (!k) return false;
      if (syncedKeys.indexOf(k) !== -1) return true;
      for (let i = 0; i < syncedPrefixes.length; i++) {
        if (k.indexOf(syncedPrefixes[i]) === 0) return true;
      }
      return false;
    }
    function listAllKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (matches(k)) out.push(k);
      }
      return out;
    }
    function collect() {
      const out = {};
      for (const k of listAllKeys()) {
        const v = localStorage.getItem(k);
        if (v == null) continue;
        try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; }
      }
      return out;
    }

    const origSet = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      origSet(k, v);
      try { if (!suppressSync && matches(k)) schedulePush(); } catch (e) {}
    };
    localStorage.removeItem = function (k) {
      origRemove(k);
      try { if (!suppressSync && matches(k)) schedulePush(); } catch (e) {}
    };

    function applyRemote(remote) {
      if (!remote || typeof remote !== 'object') return false;
      suppressSync = true;
      let changed = false;
      try {
        for (const k of Object.keys(remote)) {
          if (!matches(k)) continue;
          const incoming = JSON.stringify(remote[k]);
          const local = localStorage.getItem(k);
          if (local !== incoming) {
            try { origSet(k, incoming); changed = true; } catch (e) {}
          }
        }
        for (const k of listAllKeys()) {
          if (!(k in remote)) {
            try { origRemove(k); changed = true; } catch (e) {}
          }
        }
      } finally { suppressSync = false; }
      if (changed && typeof onApplied === 'function') {
        try { onApplied(); } catch (e) {}
      }
      return changed;
    }

    async function pushNow() {
      const state = collect();
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      try {
        const r = await fetch('/api/db', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Secret': getSecret(),
          },
          body: JSON.stringify({ key: appKey, data: state }),
        });
        if (r.ok) lastSyncedJson = json;
      } catch (e) {}
    }
    function schedulePush() {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, 250);
    }
    function flushOnUnload() {
      const state = collect();
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      try {
        fetch('/api/db', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Secret': getSecret(),
          },
          body: JSON.stringify({ key: appKey, data: state }),
          keepalive: true,
        }).catch(() => {});
        lastSyncedJson = json;
      } catch (e) {}
    }

    async function poll() {
      if (document.hidden) return;
      try {
        const r = await fetch('/api/db?key=' + encodeURIComponent(appKey), {
          headers: { 'X-App-Secret': getSecret() },
        });
        if (!r.ok) return;
        const json = await r.json();
        if (!json || !json.data) return;
        const incoming = JSON.stringify(json.data);
        if (incoming === lastSyncedJson) return;
        lastSyncedJson = incoming;
        applyRemote(json.data);
      } catch (e) {}
    }

    (async function init() {
      try {
        const r = await fetch('/api/db?key=' + encodeURIComponent(appKey), {
          headers: { 'X-App-Secret': getSecret() },
        });
        if (r.ok) {
          const json = await r.json();
          if (json && json.data && Object.keys(json.data).length > 0) {
            lastSyncedJson = JSON.stringify(json.data);
            applyRemote(json.data);
          } else if (Object.keys(collect()).length > 0) {
            schedulePush();
          }
        }
      } catch (e) {}
      setInterval(poll, 30000);
    })();

    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    window.addEventListener('storage', (e) => {
      if (e.key && matches(e.key)) schedulePush();
    });
  };
})();
