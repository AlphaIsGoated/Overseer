// =============================================================
// Persistent dashboard top bar.
// Drop this on any page with:
//     <script src="topbar.js" defer></script>
// It self-injects HTML + CSS, reads progress from the same
// localStorage keys the dashboard's tabs already use, and a
// water "+1" button writes to localStorage and (if configured)
// pushes a merged update to the Supabase health row so the
// new bottle appears on every device within ~1 second.
// =============================================================
(function () {
  'use strict';

  // -------- Supabase config (same project as the rest of the dashboard) --------
  // For your audience's standalone, replace these with placeholders
  // and have them paste their own values, just like the other pages.
  // Prefer Vercel env vars (served via /api/config → window.DASH_*),
  // otherwise fall back to these defaults.
  const TOPBAR_SUPABASE_URL = (window.DASH_SUPABASE_URL) || 'https://srajryooffirbroltjmg.supabase.co';
  const TOPBAR_SUPABASE_KEY = (window.DASH_SUPABASE_KEY) || 'sb_publishable_5142ZwTLF_DkSVRzciNuRA_bHwRAu4c';

  // -------- CSS --------
  // Themes are applied by setting data-theme="X" on <html>.
  // Each theme overrides the shared CSS custom properties used by every
  // page, so a single attribute flip changes the whole visual language.
  // Default (no data-theme attribute) = the original dark/mint design.
  const css = `
[data-theme="midnight"] {
  --theme-bg: #08080f; --theme-bg2: #0c0c18;
  --theme-accent: #A78BFA; --theme-accent2: #818CF8;
  --theme-success: #A78BFA; --theme-warning: #FBBF24; --theme-danger: #F87171;
}
[data-theme="warm"] {
  --theme-bg: #0a0806; --theme-bg2: #120e09;
  --theme-accent: #F59E0B; --theme-accent2: #FCD34D;
  --theme-success: #D97706; --theme-warning: #F59E0B; --theme-danger: #EF4444;
}
[data-theme="minimal"] {
  --theme-bg: #000000; --theme-bg2: #080808;
  --theme-accent: #FAFAFA; --theme-accent2: #C0C0C0;
  --theme-success: #E0E0E0; --theme-warning: #A0A0A0; --theme-danger: #808080;
}
[data-theme="midnight"] body, [data-theme="warm"] body, [data-theme="minimal"] body {
  background: var(--theme-bg);
}
[data-theme] .topbar, [data-theme] .bottombar {
  background: var(--theme-bg, #0a0a0b);
}
[data-theme] .gm-card, [data-theme] .tile, [data-theme] .coach-panel,
[data-theme] .modal, [data-theme] .po-modal {
  background: color-mix(in srgb, var(--theme-bg2, rgba(255,255,255,0.04)) 90%, transparent);
}
.topbar {
  position: sticky; top: 0; z-index: 40;
  display: flex; justify-content: flex-end; align-items: center;
  gap: 8px;
  padding: max(10px, env(safe-area-inset-top)) 14px 8px;
  background: #0a0a0b;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
.topbar-water-wrap {
  display: flex; align-items: stretch;
}
.topbar-water-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 14px;
  background: rgba(125, 211, 252, 0.08);
  border: 1px solid rgba(125, 211, 252, 0.16);
  border-right: none;
  border-radius: 12px 0 0 12px;
  text-decoration: none;
  color: #FAFAFA;
  -webkit-tap-highlight-color: transparent;
}
.topbar-water-pill .topbar-pill-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #7DD3FC; flex-shrink: 0;
}
.topbar-water-pill.warn .topbar-pill-dot { background: #fbbf24; }
.topbar-water-pill.miss .topbar-pill-dot {
  background: #ff8a8a;
  animation: topbar-miss-pulse 1.6s ease-in-out infinite;
}
@keyframes topbar-miss-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
  50%      { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0); }
}
.topbar-pill-count {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px; font-weight: 700;
  color: #FAFAFA;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.topbar-water-add {
  width: 44px;
  border: 1px solid rgba(125, 211, 252, 0.16);
  background: linear-gradient(180deg, rgba(125, 211, 252, 0.28), rgba(110, 231, 183, 0.28));
  color: #FFFFFF;
  font-family: inherit; font-size: 20px; font-weight: 700; line-height: 1;
  cursor: pointer;
  border-radius: 0 12px 12px 0;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, transform 0.10s;
}
.topbar-water-add:active { transform: scale(0.94); }
.topbar-water-add.flash {
  background: linear-gradient(180deg, rgba(125, 211, 252, 0.7), rgba(110, 231, 183, 0.7));
}
.topbar-finance-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s;
}
.topbar-finance-btn:hover { background: rgba(255, 255, 255, 0.08); }
.topbar-finance-icon {
  font-size: 20px; line-height: 1;
  filter: grayscale(100%) brightness(1.4);
  opacity: 0.85;
}

/* Bottom tab bar — Instagram-style */
.bottombar {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 40;
  display: flex; justify-content: space-around; align-items: stretch;
  padding: 6px 0 calc(6px + env(safe-area-inset-bottom));
  background: #0a0a0b;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
.bottombar-tab {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px;
  padding: 6px 0 4px;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.04em;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s;
}
.bottombar-tab-icon {
  font-size: 24px; line-height: 1;
  filter: grayscale(100%) brightness(1.2);
  opacity: 0.55;
  transition: opacity 0.15s, filter 0.15s, transform 0.10s;
}
.bottombar-tab.active {
  color: #FAFAFA;
}
.bottombar-tab.active .bottombar-tab-icon {
  filter: grayscale(100%) brightness(1.6);
  opacity: 1;
}
.bottombar-tab:active .bottombar-tab-icon { transform: scale(0.92); }

/* ===== Your Coach — JARVIS-styled floating widget, present on every
   page. Same mint/cyan HUD palette as the boot animation, so it reads
   as the same "system" everywhere rather than a generic chat bubble. ===== */
.coach-fab {
  position: fixed; z-index: 70;
  right: 14px; bottom: calc(82px + env(safe-area-inset-bottom));
  width: 54px; height: 54px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #0c1411 0%, #050706 70%);
  border: 1.5px solid rgba(110,231,183,0.45);
  box-shadow: 0 0 16px rgba(110,231,183,0.35), 0 6px 18px rgba(0,0,0,0.5);
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  animation: coachPulse 2.6s ease-in-out infinite;
}
.coach-fab svg { width: 24px; height: 24px; color: #6EE7B7; filter: drop-shadow(0 0 4px rgba(110,231,183,0.7)); }
.coach-fab.has-insight::after {
  content: ''; position: absolute; top: 2px; right: 2px; width: 10px; height: 10px;
  border-radius: 50%; background: #67E8F9; box-shadow: 0 0 6px rgba(103,232,249,0.9);
}
@keyframes coachPulse { 0%,100% { box-shadow: 0 0 16px rgba(110,231,183,0.35), 0 6px 18px rgba(0,0,0,0.5); } 50% { box-shadow: 0 0 26px rgba(110,231,183,0.6), 0 6px 18px rgba(0,0,0,0.5); } }

.coach-panel-bg { position: fixed; inset: 0; z-index: 80; display: none; align-items: flex-end; justify-content: center; background: rgba(0,0,0,0.55); backdrop-filter: blur(6px); }
.coach-panel-bg.show { display: flex; }
.coach-panel {
  width: 100%; max-width: 480px; max-height: 78vh; min-height: 360px;
  display: flex; flex-direction: column;
  background: #06090a; border: 1px solid rgba(110,231,183,0.3);
  border-bottom: none; border-radius: 20px 20px 0 0;
  box-shadow: 0 -10px 50px rgba(0,0,0,0.6), 0 0 30px rgba(110,231,183,0.08);
  padding: 14px 16px max(14px, env(safe-area-inset-bottom));
}
.coach-head { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid rgba(110,231,183,0.15); }
.coach-ring { width: 26px; height: 26px; flex-shrink: 0; }
.coach-ring circle { fill: none; stroke: #6EE7B7; }
.coach-ring .cr-outer { stroke-width: 1.3; stroke-dasharray: 3 5; opacity: 0.6; animation: coachSpin 6s linear infinite; transform-origin: 13px 13px; }
.coach-ring .cr-inner { stroke-width: 1.6; stroke: #67E8F9; opacity: 0.85; animation: coachSpin 3.5s linear infinite reverse; transform-origin: 13px 13px; }
@keyframes coachSpin { to { transform: rotate(360deg); } }
.coach-title { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #eafff6; text-shadow: 0 0 8px rgba(110,231,183,0.6); }
.coach-sub { font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.08em; color: rgba(110,231,183,0.5); margin-top: 1px; }
.coach-head-spacer { flex: 1; }
.coach-voice-toggle, .coach-close { width: 30px; height: 30px; border-radius: 9px; border: 1px solid rgba(110,231,183,0.25); background: rgba(110,231,183,0.06); color: #8eeebf; font-size: 14px; cursor: pointer; flex-shrink: 0; }
.coach-voice-toggle.on { background: rgba(110,231,183,0.22); color: #eafff6; }
.coach-feed { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 4px 2px 10px; }
.coach-msg { max-width: 88%; font-size: 13.5px; line-height: 1.5; }
.coach-msg.user { align-self: flex-end; color: #d8d6cf; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 9px 13px; }
.coach-msg.coach { align-self: flex-start; color: #c9f7e3; background: rgba(110,231,183,0.05); border: 1px solid rgba(110,231,183,0.25); border-left: 3px solid #6EE7B7; border-radius: 0 12px 12px 12px; padding: 9px 13px; white-space: pre-wrap; }
.coach-msg.coach.proactive { border-left-color: #67E8F9; border-color: rgba(103,232,249,0.3); }
.coach-input-row { display: flex; gap: 8px; margin-top: 8px; }
.coach-input { flex: 1; min-width: 0; background: rgba(255,255,255,0.03); border: 1px solid rgba(110,231,183,0.2); color: #eafff6; border-radius: 11px; padding: 11px 13px; font-family: inherit; font-size: 13.5px; outline: none; }
.coach-input:focus { border-color: rgba(110,231,183,0.5); }
.coach-input::placeholder { color: rgba(255,255,255,0.3); }
.coach-send, .coach-mic { width: 42px; flex-shrink: 0; border: 0; border-radius: 11px; cursor: pointer; font-size: 16px; }
.coach-send { background: #6EE7B7; color: #04140d; }
.coach-mic { background: rgba(110,231,183,0.08); color: #8eeebf; border: 1px solid rgba(110,231,183,0.2); }
.coach-mic.listening { background: #67E8F9; color: #04140d; }
.coach-dots { display: inline-flex; gap: 4px; } .coach-dots i { width: 5px; height: 5px; border-radius: 50%; background: #6EE7B7; opacity: 0.4; animation: coachDot 1.2s ease-in-out infinite; }
.coach-dots i:nth-child(2) { animation-delay: 0.2s; } .coach-dots i:nth-child(3) { animation-delay: 0.4s; }
@keyframes coachDot { 0%,100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } }

/* Push page content above the fixed bottom bar */
body.has-bottombar {
  padding-bottom: calc(72px + env(safe-area-inset-bottom)) !important;
}

@media (max-width: 480px) {
  .topbar { padding-left: 10px; padding-right: 10px; gap: 6px; }
  .topbar-water-pill { padding: 8px 11px; gap: 6px; }
  .topbar-pill-count { font-size: 12px; }
  .topbar-water-add { width: 40px; font-size: 18px; }
  .topbar-finance-btn { width: 40px; height: 38px; }
  .topbar-finance-icon { font-size: 18px; }
  .bottombar-tab-icon { font-size: 22px; }
  .bottombar-tab { font-size: 10px; }
}

/* === Global mobile lockdown ===
   1) Hide the right-side scrollbar on phones (iOS uses overlay scrollbars anyway).
   2) Stop iOS auto-text-size-adjust.
   3) touch-action: pan-y prevents pinch-zoom while still allowing vertical scroll.
   4) overscroll-behavior on every common modal class stops scroll chaining —
      scrolling inside a settings popup won't drag the page behind it.
   5) When body has .topbar-modal-open, the page can't scroll at all (locked).
*/
html, body {
  -webkit-text-size-adjust: 100%;
}
@media (max-width: 768px) {
  html { touch-action: pan-y; }
  ::-webkit-scrollbar { width: 0; height: 0; display: none; }
  html, body { scrollbar-width: none; -ms-overflow-style: none; }
}
.modal-bg, .modal, .po-modal-bg, .po-modal, .wt-overlay, .wt-viewer {
  overscroll-behavior: contain;
}
body.topbar-modal-open {
  overflow: hidden;
  touch-action: none;
}
/* On phones, blow the modals up to full screen and let them be the only
   scrolling element. Way less "is this scrolling the page or the modal?"
   confusion. */
@media (max-width: 480px) {
  .modal-bg, .po-modal-bg {
    padding: 0 !important;
    align-items: stretch !important;
    justify-content: stretch !important;
  }
  .modal, .po-modal {
    width: 100% !important;
    max-width: 100% !important;
    max-height: 100vh !important;
    height: 100vh !important;
    border-radius: 0 !important;
    padding-top: max(20px, env(safe-area-inset-top)) !important;
    padding-bottom: max(28px, env(safe-area-inset-bottom)) !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
  }
}
`;

  // -------- HTML --------
  const topbarHtml = `
<header class="topbar" id="topbar" role="navigation" aria-label="Quick actions">
  <div class="topbar-water-wrap">
    <a href="health.html#water" class="topbar-water-pill" id="topbarWater" aria-label="Water progress">
      <span class="topbar-pill-dot"></span>
      <span class="topbar-pill-count" id="topbarWaterCount">0/0</span>
    </a>
    <button class="topbar-water-add" id="topbarWaterAdd" aria-label="Log one drink" type="button">+</button>
  </div>
  <a href="finance.html" class="topbar-finance-btn" id="topbarFinance" aria-label="Finance">
    <span class="topbar-finance-icon">📊</span>
  </a>
</header>
`;

  const bottombarHtml = `
<nav class="bottombar" id="bottombar" role="navigation" aria-label="Main tabs">
  <a href="index.html" class="bottombar-tab" data-page="main">
    <span class="bottombar-tab-icon">🏠</span>
    <span>Main</span>
  </a>
  <a href="health.html" class="bottombar-tab" data-page="health">
    <span class="bottombar-tab-icon">💊</span>
    <span>Health</span>
  </a>
  <a href="gym.html" class="bottombar-tab" data-page="fitness">
    <span class="bottombar-tab-icon">💪</span>
    <span>Fitness</span>
  </a>
</nav>
`;

  const coachHtml = `
<button class="coach-fab" id="coachFab" aria-label="Open Your Coach" type="button">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>
</button>
<div class="coach-panel-bg" id="coachPanelBg">
  <div class="coach-panel">
    <div class="coach-head">
      <svg class="coach-ring" viewBox="0 0 26 26"><circle class="cr-outer" cx="13" cy="13" r="11"/><circle class="cr-inner" cx="13" cy="13" r="7"/></svg>
      <div>
        <div class="coach-title">Your Coach</div>
        <div class="coach-sub" id="coachSub">SYSTEMS NOMINAL</div>
      </div>
      <div class="coach-head-spacer"></div>
      <button class="coach-voice-toggle" id="coachVoiceToggle" type="button" title="Read replies aloud" aria-label="Toggle spoken replies">🔊</button>
      <button class="coach-close" id="coachClose" type="button" aria-label="Close">✕</button>
    </div>
    <div class="coach-feed" id="coachFeed"></div>
    <div class="coach-input-row">
      <input class="coach-input" id="coachInput" placeholder="Ask your coach…" autocomplete="off">
      <button class="coach-mic" id="coachMic" type="button" aria-label="Speak">🎙️</button>
      <button class="coach-send" id="coachSend" type="button" aria-label="Send">→</button>
    </div>
  </div>
</div>
`;

  // Pages where we suppress the app chrome: finance has its own internal
  // 4-tab bottom nav and self-contained back button.
  function isFinancePage() {
    const p = (window.location.pathname || '').toLowerCase();
    return p.endsWith('/finance.html') || p.endsWith('finance.html');
  }
  // When the water tracker is iframed inside health.html, the embedded
  // page shouldn't render its own chrome again.
  function isEmbedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }
  function shouldShowChrome() {
    return !isFinancePage() && !isEmbedded();
  }
  function currentPageKey() {
    const p = (window.location.pathname || '').toLowerCase();
    if (p.endsWith('health.html')) return 'health';
    if (p.endsWith('gym.html')) return 'fitness';
    return 'main'; // index.html, /, or anything else falls back to main
  }

  function injectStyleAndHTML() {
    if (document.getElementById('topbar') || document.getElementById('bottombar')) return;
    if (!shouldShowChrome()) return;

    const style = document.createElement('style');
    style.id = 'topbar-style';
    style.textContent = css;
    document.head.appendChild(style);

    const topWrap = document.createElement('div');
    topWrap.innerHTML = topbarHtml.trim();
    document.body.insertBefore(topWrap.firstChild, document.body.firstChild);

    const bottomWrap = document.createElement('div');
    bottomWrap.innerHTML = bottombarHtml.trim();
    document.body.appendChild(bottomWrap.firstChild);

    // Highlight the active bottom tab.
    const active = currentPageKey();
    document.querySelectorAll('.bottombar-tab').forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-page') === active);
    });

    // Reserve room above the fixed bottom bar so page content can scroll
    // past it without being hidden.
    document.body.classList.add('has-bottombar');

    // Coach widget has two top-level fixed elements (fab + panel) — just
    // append the container itself rather than unwrapping; both children
    // are position:fixed so the wrapper has zero visual footprint.
    const coachWrap = document.createElement('div');
    coachWrap.innerHTML = coachHtml.trim();
    document.body.appendChild(coachWrap);
    initCoach();
  }

  // -------- Active-date helpers (match the goals page 6 AM rollover) --------
  function activeDateKey() {
    const now = new Date();
    const d = new Date(now);
    if (now.getHours() < 6) d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function calendarDateKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // -------- Read progress from localStorage --------
  function getGoalsProgress() {
    const key = 'goals:' + activeDateKey();
    let goals = [];
    try { goals = JSON.parse(localStorage.getItem(key)) || []; } catch (e) {}
    const total = Array.isArray(goals) ? goals.length : 0;
    const done = total ? goals.filter(g => g && g.done).length : 0;
    return { done, total };
  }

  function getStackProgress() {
    let items = [];
    try { items = JSON.parse(localStorage.getItem('stack:items')) || []; } catch (e) {}
    let taken = {};
    try { taken = JSON.parse(localStorage.getItem('stack:taken:' + activeDateKey())) || {}; } catch (e) {}
    const total = Array.isArray(items) ? items.length : 0;
    const done = total ? items.filter(i => i && taken[i.id]).length : 0;
    return { done, total };
  }

  function getWaterProgress() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state) return { done: 0, total: 0 };
    const todayKey = calendarDateKey();
    const done = (state.logs || {})[todayKey] || 0;
    const p = state.profile || { weightKg: 75 };
    // p.weightKg is always stored as true kilograms regardless of the
    // display unit (see po-water.html's computeTargetMl) — no further
    // conversion needed here.
    const base = (p.weightKg || 0) * 35;
    const exercise = (p.activityHrsPerWeek || 0) / 7 * 500;
    const caffeine = Math.max(0, (state.caffeineMgPerDay || 0) - 200) * 1.5;
    const subs = (state.substances || []).reduce((s, x) => {
      const dose = (x && x.dose != null ? x.dose : (x && x.defaultDose)) || 0;
      return s + Math.max(0, dose * ((x && x.mlPerUnit) || 0));
    }, 0);
    let adjust = 0;
    if (p.sex === 'm') adjust += 200;
    if ((p.age || 0) >= 50) adjust += 100;
    const totalMl = base + exercise + caffeine + subs + adjust;
    let unitVol;
    if (state.unit === 'glass') unitVol = state.glassMl || 250;
    else if (state.unit === 'oz') unitVol = 30;
    else if (state.unit === 'ml') unitVol = 1;
    else unitVol = state.bottleMl || 500;
    const total = Math.max(1, Math.ceil(totalMl / unitVol));
    return { done, total };
  }

  function classifyStatus(done, total) {
    if (total === 0) return 'idle';
    if (done >= total) return 'good';
    if (done >= total * 0.5) return 'warn';
    // Past 6pm and still under half → flag as missed
    const h = new Date().getHours();
    if (h >= 18 && done < total * 0.5) return 'miss';
    return 'warn';
  }

  function setPillStatus(pillEl, status) {
    pillEl.classList.remove('good', 'warn', 'miss');
    if (status === 'warn' || status === 'miss') pillEl.classList.add(status);
  }

  function render() {
    const waterEl = document.getElementById('topbarWater');
    if (!waterEl) return; // not injected yet

    const w = getWaterProgress();
    const countEl = document.getElementById('topbarWaterCount');
    if (countEl) countEl.textContent = w.total ? w.done + '/' + w.total : '0/0';
    setPillStatus(waterEl, classifyStatus(w.done, w.total));
  }

  // -------- Water +1 (works from any page) --------
  function defaultWaterState() {
    return {
      unit: 'bottle', bottleMl: 500, glassMl: 250, weightUnit: 'lb',
      profile: { weightKg: 75, age: 25, sex: 'm', activityHrsPerWeek: 5 },
      caffeineMgPerDay: 200, substances: [], logs: {}
    };
  }

  async function pushWaterMergedToSupabase(localWater) {
    // Only do this when we're NOT on the health page — health page
    // has its own sync that already detects the localStorage change.
    if (window.location.pathname.endsWith('/health.html') ||
        window.location.pathname.endsWith('health.html')) return;

    if (!window.supabase || !TOPBAR_SUPABASE_URL || !TOPBAR_SUPABASE_KEY) return;
    if (TOPBAR_SUPABASE_URL.indexOf('PASTE-') === 0) return;

    try {
      const supa = window.supabase.createClient(TOPBAR_SUPABASE_URL, TOPBAR_SUPABASE_KEY);
      const { data } = await supa
        .from('app_state').select('data').eq('key', 'health').maybeSingle();
      const current = (data && data.data) || {};
      const merged = Object.assign({}, current, { po_water_v1: localWater });
      await supa.from('app_state').upsert(
        { key: 'health', data: merged, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    } catch (e) { /* offline — local change will sync next time user visits health */ }
  }

  function addWater() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state || typeof state !== 'object') state = defaultWaterState();
    state.logs = state.logs || {};
    const k = calendarDateKey();
    state.logs[k] = (state.logs[k] || 0) + 1;
    try { localStorage.setItem('po_water_v1', JSON.stringify(state)); } catch (e) {}
    render();

    const btn = document.getElementById('topbarWaterAdd');
    if (btn) {
      btn.classList.add('flash');
      setTimeout(() => btn.classList.remove('flash'), 220);
    }

    pushWaterMergedToSupabase(state);
  }

  // -------- Mobile lockdown helpers --------
  // Belt-and-suspenders zoom prevention — iOS Safari sometimes ignores
  // user-scalable=no, so we also kill the gesture events directly.
  function blockGesture(e) { e.preventDefault(); }
  function lockGestures() {
    document.addEventListener('gesturestart', blockGesture, { passive: false });
    document.addEventListener('gesturechange', blockGesture, { passive: false });
    document.addEventListener('gestureend', blockGesture, { passive: false });
    // Also kill the iOS double-tap-to-zoom on any tap.
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  }

  // Watch every known modal-bg / overlay class — when any one of them
  // gets `.show` or `.is-open`, lock the body scroll. When the last
  // one closes, unlock.
  function startModalLock() {
    const MODAL_SELECTORS = [
      '.modal-bg', '.po-modal-bg', '.wt-overlay', '.wt-viewer', '.wt-cam'
    ];
    function anyOpen() {
      for (const sel of MODAL_SELECTORS) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.classList.contains('show') || el.classList.contains('is-open')) {
            return true;
          }
        }
      }
      return false;
    }
    function sync() {
      document.body.classList.toggle('topbar-modal-open', anyOpen());
    }
    const observer = new MutationObserver(sync);
    // Observe class changes anywhere in body — modal toggles are rare so
    // a global subtree observer is cheap.
    observer.observe(document.body, {
      attributes: true, attributeFilter: ['class'], subtree: true
    });
    sync();
  }

  // -------- API usage/spend logging --------
  // Every AI proxy endpoint (ai-chat, vision-tool, nova, scan) returns its
  // Anthropic token usage as response headers (see api/_lib/security.js
  // setUsageHeaders) without changing their JSON body contracts. Pages
  // that call those endpoints read those headers and call this to log an
  // entry here, so spend can be estimated in one place (the index.html
  // settings panel) regardless of which module made the call.
  const USAGE_KEY = 'apiusage:log';
  // source is a short module name ('gym', 'finance', 'nova', 'marathon', 'coach', etc.)
  // so the settings page can break down spending by module.
  window.logApiUsage = function (inputTokens, outputTokens, model, source) {
    if (!inputTokens && !outputTokens) return;
    let log = [];
    try { log = JSON.parse(localStorage.getItem(USAGE_KEY)) || []; } catch (e) {}
    log.push({ ts: Date.now(), model: model || 'claude-opus-4-8', inputTokens: Number(inputTokens) || 0, outputTokens: Number(outputTokens) || 0, source: source || 'other' });
    if (log.length > 2000) log = log.slice(log.length - 2000);
    localStorage.setItem(USAGE_KEY, JSON.stringify(log));

    // Budget alert: check if this month's spend has crossed the user's
    // configured threshold. Runs after every logged call so the warning
    // appears immediately rather than only when the settings page is open.
    try {
      const budgetStr = localStorage.getItem('settings:monthly_budget');
      if (budgetStr) {
        const budget = parseFloat(budgetStr);
        if (budget > 0) {
          const PRICES = { 'claude-haiku-4-5': { in: 1, out: 5 }, 'claude-sonnet-4-6': { in: 3, out: 15 }, 'claude-opus-4-8': { in: 5, out: 25 } };
          const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
          const monthSpend = log.filter(e => e.ts >= monthStart.getTime()).reduce((s, e) => {
            const p = PRICES[e.model] || PRICES['claude-opus-4-8'];
            return s + (e.inputTokens / 1e6) * p.in + (e.outputTokens / 1e6) * p.out;
          }, 0);
          const pct = monthSpend / budget;
          if (pct >= 1 && localStorage.getItem('settings:budget_alerted') !== 'over') {
            localStorage.setItem('settings:budget_alerted', 'over');
            showBudgetAlert('Budget exceeded — monthly AI spend ($' + monthSpend.toFixed(2) + ') is over your $' + budget.toFixed(2) + ' limit. Conservation mode recommended.', 'danger');
          } else if (pct >= 0.8 && localStorage.getItem('settings:budget_alerted') !== '80' && localStorage.getItem('settings:budget_alerted') !== 'over') {
            localStorage.setItem('settings:budget_alerted', '80');
            showBudgetAlert('Heads-up — AI spend this month is $' + monthSpend.toFixed(2) + ' (80%+ of your $' + budget.toFixed(2) + ' budget).', 'warn');
          }
        }
      }
    } catch (e) {}
  };
  if (window.initCloudSync) {
    window.initCloudSync({ appKey: 'apiusage', syncedKeys: [USAGE_KEY] });
  }

  // Shows a dismissible top-of-page banner for budget warnings.
  // Uses a simple fixed bar rather than a modal so it doesn't interrupt work.
  function showBudgetAlert(msg, level) {
    if (document.getElementById('budget-alert-bar')) return; // one at a time
    const bar = document.createElement('div');
    bar.id = 'budget-alert-bar';
    const bg = level === 'danger' ? 'rgba(255,107,107,0.15)' : 'rgba(242,192,99,0.12)';
    const border = level === 'danger' ? 'rgba(255,107,107,0.4)' : 'rgba(242,192,99,0.35)';
    const color = level === 'danger' ? '#FF8A8A' : '#F2C063';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:' + bg + ';border-bottom:1px solid ' + border + ';font-family:-apple-system,sans-serif;font-size:12.5px;font-weight:600;color:' + color + ';';
    bar.innerHTML = '<span>' + msg + ' <a href="settings.html" style="color:inherit;text-decoration:underline;margin-left:6px">View settings →</a></span><button onclick="this.parentNode.remove()" style="border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer;padding:0 4px;line-height:1">×</button>';
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // -------- Your Coach — JARVIS-styled, present on every page --------
  // Present everywhere (this file is loaded on every page) rather than
  // living on one dedicated page, since the point is an always-available
  // assistant, not a destination you navigate to. Proactively surfaces
  // something noteworthy on first open per browser session (cached in
  // sessionStorage so re-opening on a different page doesn't re-spend
  // an AI call), then behaves as an ordinary cross-module chat.
  function initCoach() {
    const fab = document.getElementById('coachFab');
    const panelBg = document.getElementById('coachPanelBg');
    const feed = document.getElementById('coachFeed');
    const input = document.getElementById('coachInput');
    if (!fab || !panelBg) return;

    function dashboardData() {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        try { out[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { out[k] = localStorage.getItem(k); }
      }
      return out;
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
    function addMsg(role, text, proactive) {
      const el = document.createElement('div');
      el.className = 'coach-msg ' + role + (proactive ? ' proactive' : '');
      el.textContent = text;
      feed.appendChild(el);
      feed.scrollTop = feed.scrollHeight;
      return el;
    }
    function addLoading() {
      const el = document.createElement('div');
      el.className = 'coach-msg coach';
      el.innerHTML = '<span class="coach-dots"><i></i><i></i><i></i></span>';
      feed.appendChild(el);
      feed.scrollTop = feed.scrollHeight;
      return el;
    }

    const CHAT_SYS =
      "You are the user's personal coach embedded across their entire life-tracking dashboard — fitness, " +
      "health, finance, marathon training, college, nutrition, skincare, and more. You can see all of their " +
      "saved data below. Be direct, sharp, and concise — a few sentences or short bullets, never an essay. " +
      "Ground every answer in their actual data; if you don't have what you'd need, say so and ask one " +
      "focused question. Dashboard data as JSON:\n";
    const PROACTIVE_SYS =
      "You are the user's personal coach scanning their entire life-tracking dashboard for anything worth " +
      "flagging right now — overdue or upcoming deadlines, missed daily targets, low supplies, schedule " +
      "conflicts, anything time-sensitive across fitness/health/finance/college/marathon/etc. Pick the 1-3 " +
      "MOST relevant things only — not a status report of everything. If genuinely nothing stands out, say a " +
      "brief one-line all-clear instead of inventing concerns. Be direct and concise, a few short lines, no preamble.";

    async function callAI(system, userText) {
      const res = await fetch('/api/ai/ai-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-secret': (window.DASH_APP_SECRET || '') },
        body: JSON.stringify({
          system: system + JSON.stringify(dashboardData()),
          model: window.getPreferredModel ? window.getPreferredModel() : 'claude-opus-4-8',
          conservation: window.isConservationMode ? window.isConservationMode() : false,
          messages: [{ role: 'user', content: userText }],
        }),
      });
      if (window.logApiUsage) window.logApiUsage(res.headers.get('X-Usage-Input-Tokens'), res.headers.get('X-Usage-Output-Tokens'), res.headers.get('X-Usage-Model'), 'coach');
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Something went wrong.');
      return json.text || '(no response)';
    }

    let busy = false;
    async function ask(text) {
      text = (text || '').trim();
      if (!text || busy) return;
      busy = true;
      addMsg('user', text);
      input.value = '';
      const loading = addLoading();
      try {
        const reply = await callAI(CHAT_SYS, text);
        loading.textContent = reply;
        speak(reply);
      } catch (e) {
        loading.textContent = '⚠ ' + (e.message || 'Could not reach your coach.');
      }
      busy = false;
    }

    async function runProactiveScan() {
      const cached = sessionStorage.getItem('coach_proactive_text');
      if (cached) { addMsg('coach', cached, true); return; }
      // Conservation mode skips this entirely — it's the single biggest
      // recurring cost (a full dashboard-data scan on every session) since
      // it fires automatically rather than being something you asked for.
      if (window.isConservationMode && window.isConservationMode()) {
        addMsg('coach', 'Conservation mode is on, so I skipped the automatic scan — ask me anything directly instead.', true);
        return;
      }
      const loading = addLoading();
      try {
        const text = await callAI(PROACTIVE_SYS, 'Scan everything and tell me what is most worth knowing right now.');
        loading.textContent = text;
        loading.classList.add('proactive');
        sessionStorage.setItem('coach_proactive_text', text);
      } catch (e) {
        loading.remove();
      }
    }

    function openPanel() {
      panelBg.classList.add('show');
      fab.classList.remove('has-insight');
      if (!feed.childElementCount) {
        if (!sessionStorage.getItem('coach_proactive_seen')) {
          sessionStorage.setItem('coach_proactive_seen', '1');
          runProactiveScan();
        } else {
          const cached = sessionStorage.getItem('coach_proactive_text');
          if (cached) addMsg('coach', cached, true);
        }
      }
      setTimeout(() => input.focus(), 80);
    }
    function closePanel() { panelBg.classList.remove('show'); }

    fab.addEventListener('click', openPanel);
    document.getElementById('coachClose').addEventListener('click', closePanel);
    panelBg.addEventListener('click', (e) => { if (e.target === panelBg) closePanel(); });
    document.getElementById('coachSend').addEventListener('click', () => ask(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(input.value); });

    // A subtle "something's worth a look" indicator before the panel's
    // ever been opened this session — removed the instant it's opened.
    if (!sessionStorage.getItem('coach_proactive_seen')) fab.classList.add('has-insight');

    // ---- Voice: same pattern as Nova Lite (browser-native, free) ----
    let voiceOn = false;
    const voiceToggle = document.getElementById('coachVoiceToggle');
    try { voiceOn = localStorage.getItem('coach_voice_on') === '1'; } catch (e) {}
    voiceToggle.classList.toggle('on', voiceOn);
    voiceToggle.addEventListener('click', () => {
      voiceOn = !voiceOn;
      voiceToggle.classList.toggle('on', voiceOn);
      try { localStorage.setItem('coach_voice_on', voiceOn ? '1' : '0'); } catch (e) {}
      if (!voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
    });
    function speak(text) {
      if (!voiceOn || !text) return;
      const clean = text.replace(/\*\*/g, '').replace(/^[-•*]\s+/gm, '').trim();
      if (!clean) return;
      // Prefer ElevenLabs when configured — much higher quality than the
      // browser's built-in synthesis and suits the JARVIS aesthetic better.
      // Falls back to Web Speech if ELEVENLABS_API_KEY isn't set in Vercel.
      if (window.DASH_ELEVENLABS_ENABLED) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        fetch('/api/elevenlabs-tts', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-secret': (window.DASH_APP_SECRET || '') },
          body: JSON.stringify({ text: clean }),
        }).then(r => r.ok ? r.arrayBuffer() : null).then(buf => {
          if (!buf || !voiceOn) return;
          const blob = new Blob([buf], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.onended = () => URL.revokeObjectURL(url);
          audio.play().catch(() => {});
        }).catch(() => {});
        return;
      }
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(clean));
    }

    const micBtn = document.getElementById('coachMic');
    // Whisper (OpenAI) transcription via MediaRecorder is significantly more
    // accurate than the browser's SpeechRecognition and also works on iOS
    // (which doesn't support SpeechRecognition at all). We prefer it when
    // OPENAI_API_KEY is configured, fall back to SpeechRecognition otherwise.
    if (window.DASH_OPENAI_ENABLED && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      let recorder = null, chunks = [];
      micBtn.addEventListener('click', async () => {
        if (recorder && recorder.state === 'recording') {
          recorder.stop(); return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          chunks = [];
          recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = async () => {
            micBtn.classList.remove('listening');
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.onload = async () => {
              const base64 = reader.result.split(',')[1];
              micBtn.textContent = '⟳'; // transcribing indicator
              try {
                const res = await fetch('/api/whisper-transcribe', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-app-secret': (window.DASH_APP_SECRET || '') },
                  body: JSON.stringify({ audio: base64, mimeType: blob.type }),
                });
                const json = await res.json();
                if (json.text) { input.value = json.text; input.focus(); }
              } catch (e) {}
              micBtn.textContent = '🎙️';
            };
            reader.readAsDataURL(blob);
          };
          recorder.start();
          micBtn.classList.add('listening');
        } catch (e) { micBtn.classList.remove('listening'); }
      });
    } else {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        micBtn.style.display = 'none';
      } else {
        const recognizer = new SR();
        recognizer.lang = 'en-US'; recognizer.interimResults = false; recognizer.maxAlternatives = 1;
        let listening = false;
        recognizer.onresult = (e) => { const said = e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript; if (said) input.value = said; };
        recognizer.onend = () => { listening = false; micBtn.classList.remove('listening'); };
        recognizer.onerror = () => { listening = false; micBtn.classList.remove('listening'); };
        micBtn.addEventListener('click', () => {
          if (listening) { recognizer.stop(); return; }
          listening = true; micBtn.classList.add('listening');
          try { recognizer.start(); } catch (e) { listening = false; micBtn.classList.remove('listening'); }
        });
      }
    }
  }

  // -------- Boot --------
  function boot() {
    injectStyleAndHTML();
    const btn = document.getElementById('topbarWaterAdd');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); addWater(); });
    render();
    lockGestures();
    startModalLock();

    // Re-render when localStorage changes from another tab/window OR when
    // the page becomes visible (sync may have pulled in the background).
    window.addEventListener('storage', render);
    window.addEventListener('focus', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

    // Periodic refresh so counts stay current after midnight rollover etc.
    setInterval(render, 30 * 1000);

    // ---- Push-notification registration (silently, no permission prompt
    // unless the user has already granted Notification permission) ----
    // Only runs once per page session, only when the VAPID public key is
    // configured. Doesn't ask for permission itself — permission prompts are
    // triggered by an explicit user action (a "Enable notifications" button
    // in the settings panel), which stores the user's choice separately.
    // Here we just register the service worker unconditionally (needed for
    // offline-support basics too) and subscribe to push if permission is
    // already 'granted', or if the user just granted it.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
        const vapidPublicKey = window.DASH_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey || Notification.permission !== 'granted') return;
        reg.pushManager.getSubscription().then((existing) => {
          if (existing) return; // already subscribed on this device
          reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidPublicKey }).then((sub) => {
            fetch('/api/push-subscribe', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-app-secret': (window.DASH_APP_SECRET || '') },
              body: JSON.stringify({ subscription: sub.toJSON() }),
            }).catch(() => {});
          }).catch(() => {});
        });
      }).catch(() => {});
    }
  }

  // ---- Expose helper for requesting push permission (used by settings panel) ----
  // Apply the saved theme immediately — runs BEFORE paint so there's no
  // flash of the wrong theme. Setting data-theme on <html> lets the CSS
  // rules injected above cascade to every element on the page.
  function applyTheme() {
    try {
      const t = localStorage.getItem('settings:theme') || 'default';
      if (t && t !== 'default') document.documentElement.setAttribute('data-theme', t);
      else document.documentElement.removeAttribute('data-theme');
    } catch (e) {}
  }
  applyTheme();
  window.applyTheme = applyTheme; // expose so settings.html can call it live

  // Returns the Claude model string the user has chosen in Settings.
  // Pages pass this to the server so responses use the right tier.
  // Falls back to Opus (the current default) if nothing is saved.
  window.getPreferredModel = function () {
    try { return localStorage.getItem('settings:model') || 'claude-opus-4-8'; } catch (e) { return 'claude-opus-4-8'; }
  };

  // Conservation mode reduces AI spend by skipping background-initiated
  // calls (proactive scans, auto-classifications) and capping response length.
  window.isConservationMode = function () {
    try { return localStorage.getItem('settings:conservation_mode') === '1'; } catch (e) { return false; }
  };

  window.requestPushPermission = function () {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return Promise.reject(new Error('Push notifications not supported in this browser.'));
    }
    const vapidPublicKey = window.DASH_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      return Promise.reject(new Error('VAPID_PUBLIC_KEY not configured in Vercel env vars yet.'));
    }
    return Notification.requestPermission().then((permission) => {
      if (permission !== 'granted') throw new Error('Permission denied.');
      return navigator.serviceWorker.ready;
    }).then((reg) => reg.pushManager.getSubscription().then((existing) => existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidPublicKey })))
      .then((sub) => fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-secret': (window.DASH_APP_SECRET || '') },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      })).then((r) => r.json());
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
