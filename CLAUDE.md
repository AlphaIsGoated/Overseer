# Overseer-1 · Claude Working File

> **Read this before touching any code.** Update the relevant module changelog at the bottom of every session before committing. This file is the authoritative trace of what changed, when, and why — the first place to look when something breaks.

---

## Change Protocol

**Before any change:**
1. Read the changelog section for every module you are about to touch.
2. Identify any recent changes that could interact with your change.
3. State your plan in one sentence. If it touches `sync.js` behavior or `localStorage` keys, re-read the Architecture Invariants section first.

**While changing:**
- One logical change per commit. Do not bundle unrelated fixes.
- Never change a shared module (`sync.js`, `topbar.js`) without considering every page that loads it.
- If a function is called from both an IIFE and from outside it, check scope — functions defined inside an IIFE are invisible to outside scripts.

**After every change:**
- Append an entry to every affected module's changelog (bottom of this file). Format: `YYYY-MM-DD | commit hash | what changed | what it could break`.
- Push immediately after committing.
- If the change touches the coach, bump `COACH_PROMPT_BUILD` in `topbar.js` (search for that constant) so stale proactive scans are invalidated same-day.

---

## Architecture Invariants

These rules encode bugs that were already discovered and fixed. Breaking any of them will reproduce the same class of bug.

### 1. initCloudSync scope
`initCloudSync()`'s `onApplied` callback runs inside `sync.js`. Any helper function it calls (`rollover`, `getActiveDateString`, `storeListKeys`, `processStreak`, `loadToday`, etc.) must be in scope — i.e., the `initCloudSync` call must be **inside the same IIFE** that defines those helpers.

Putting `initCloudSync` in a separate `<script>` block causes every `onApplied` call to throw a silent `ReferenceError` (swallowed by sync.js's try/catch), making `onApplied` a permanent no-op.

**Affected file:** `main.html` (goals module). Fixed in commit `088d1a3`.

### 2. sync.js applyRemote is REPLACE-ALL
`applyRemote(remote)` does two things:
- Sets every key from the server snapshot into localStorage.
- **Deletes** every local key that is NOT in the server snapshot (for keys that `matches()` returns true for).

This means: if rollover creates `goals:2026-07-14` locally, then sync fetches a server snapshot that only knows about `goals:2026-07-13`, it will **delete** `goals:2026-07-14`. Always account for this when designing what keys to sync.

### 3. Goals rollover timing
`rollover()` in `main.html` runs synchronously during HTML parsing (inside the main IIFE). `initCloudSync` runs in `DOMContentLoaded` (slightly later), and its `init()` fetch is async. The sequence is:

1. Page parses → IIFE executes → `rollover()` runs → creates `goals:today` from past keys.
2. DOMContentLoaded → `initCloudSync` init → fetch (async).
3. Fetch returns → `applyRemote(serverSnapshot)` → server only has yesterday's key → **deletes** `goals:today`.
4. `onApplied` fires → re-runs `rollover()` → re-creates `goals:today` → corrects state.

`onApplied` calling `rollover()` is intentional and load-bearing. But rollover must guard against running when there are no past keys (the `changed` flag, added in `216269a`).

### 4. onApplied must not clear an active UI session
If `onApplied` wipes DOM state (e.g. `feed.innerHTML = ''`) it will fire at any time — on a 30-second poll or on a slow init fetch — and destroy whatever the user is currently doing.

**Rule:** `onApplied` may update `localStorage`, call re-render functions, or dispatch events. It must **never** clear UI elements that the user may have populated (chat feed, form inputs, etc.).

**Lesson learned from:** `c2422fd` introduced a coach sync with `onApplied` that did `feed.innerHTML = ''` → caused conversations to be deleted mid-typing. Fixed in `6130451`.

### 5. strava activities: never pass raw date to Claude
When building the `dashboardData()` payload for the AI in `topbar.js`, strava activity entries must NOT include a raw `date`/timestamp field. Claude will re-derive relative time from the raw date and get it wrong. Instead, include only a precomputed `when` string (`'today'`, `'yesterday'`, `'2 days ago'`, etc.) computed in JS at call time.

**Affected function:** `dashboardData()` in `topbar.js`, the `strava_activities_v1` branch. Fixed in `6ef89dd`.

### 6. coach_proactive_* must NOT be synced
These are ephemeral per-day keys (`coach_proactive_YYYY-MM-DD = "1"`) that record whether the proactive scan ran today. Syncing them across devices prevents a fresh session from re-running the scan with the current prompt code. They must stay local-only.

**Rule:** never add `coach_proactive_` to any `syncedKeys` or `syncedPrefixes` in `initCloudSync`.

### 7. COACH_PROMPT_BUILD version key
When the coach scan prompt or `dashboardData()` formatting changes, bump the constant `COACH_PROMPT_BUILD` in `topbar.js`. On page load, `initCoach()` compares `localStorage.getItem('coach_prompt_build')` to this constant. If they differ, today's proactive key is cleared and the scan re-runs with the new code. Without this, users see the old (wrong) cached scan until the next calendar day.

### 8. Never share an appKey between pages that sync different key sets
`sync.js` `pushNow()` sends the **complete** `collect()` snapshot for a given `initCloudSync` instance — not just changed keys. If page A syncs `{stack:items, po_water_v1}` under `appKey: 'health'`, and page B syncs only `{po_water_v1}` under the same `appKey: 'health'`, then a push from page B sends `{po_water_v1: ...}` to the server — overwriting the entire `health` row and deleting `stack:items` from the server. The next `applyRemote` on page A then removes `stack:items` from localStorage.

**Rule:** Each `appKey` must be owned by one logical domain. If two pages need to sync overlapping but non-identical key sets, give each domain its own `appKey`. See the appKey registry table in the Project Map.

**Fixed in:** `po-water.html`, `index.html`, `health.html` — previously all shared `appKey: 'health'`. `po_water_v1` moved to `appKey: 'profile'`.

---

## Project Map

| File | Module | What it does |
|------|--------|--------------|
| `topbar.js` | **Topbar / Coach / Usage** | Injected on every page. Renders the top bar (water, supplements, XP). Contains the entire Coach (JARVIS-style AI panel), proactive scan, voice, history. Also runs goal rollover on pages that aren't `main.html`. |
| `sync.js` | **Cloud Sync** | Shared library. `initCloudSync({appKey, syncedKeys, syncedPrefixes, onApplied})` per page. Patches `localStorage.setItem/removeItem` to schedule pushes. Polls server every 30 s. REPLACE-ALL on `applyRemote`. |
| `main.html` | **Goals / To-Do** | Goals list, drag-reorder, streaks, tomorrow planning, push-to-tomorrow. Calls `initCloudSync` inside the main IIFE so `onApplied` has access to helper functions. |
| `index.html` | **Home / Bento Grid** | Dashboard landing page with bento tiles linking to all modules. |
| `gym.html` | **Workout Tracker** | PPL plan builder, set/rep logger, progressive overload, rest timer, 1RM goals. Synced via `initCloudSync`. |
| `finance.html` | **Finance** | Net worth, budget, jobs/income, account transfers, activity feed. |
| `saved-links.html` | **Saved Links** | Paste/share links, AI auto-categorize via Claude. |
| `health.html` | **Supplements** | Daily supplement stack tracker. |
| `marathon.html` | **Marathon** | Marathon training plan, long-run tracking. |
| `brain.html` | **Notes / Brain** | Obsidian-connected notes and observations. |
| `api/db.js` | **DB Proxy** | Server-side Supabase proxy. All sync reads/writes go through `/api/db`. |
| `api/ai/ai-chat.js` | **AI Chat Proxy** | Server-side proxy to Anthropic API. Used by coach and link auto-categorize. |
| `middleware.js` | **Auth** | Vercel edge middleware. Checks `x-app-secret` header on all `/api/*` routes. |

**localStorage key namespaces** (important for sync scoping):

| Prefix | Module | Synced? | appKey |
|--------|--------|---------|--------|
| `goals:YYYY-MM-DD` | Goals | Yes (prefix `goals:`) | `goals` |
| `goals_history_v1` | Goals | No (local archive only) | — |
| `coach_chat_history` | Coach | Yes (exact key) | `coach` |
| `coach_proactive_YYYY-MM-DD` | Coach | **No** — must never be synced | — |
| `coach_prompt_build` | Coach | No | — |
| `apiusage:log` | Usage | Yes (exact key) | `apiusage` |
| `strava_activities_v1` | Strava | No (pulled fresh by integration) | — |
| `po_coach_v1` | Workout Coach | No | — |
| `po_coach_workout_done` | Workout | No | — |
| `savedlinks:items` | Saved Links | Yes (exact key) | `savedlinks` |
| `stack:items`, `stack:version`, `stack:low`, `stack:taken:*` | Supplements | Yes (keys + prefix) | `health` |
| `po_water_v1` | Profile / Water | Yes (exact key) | `profile` |
| `subs`, `wishlist`, `nw:*` etc. | Finance | Yes | `finance` |
| `caf:logs`, `caf:custom` | Caffeine | Yes | `caffeine` |

**appKey registry** — each appKey must be unique to its data domain. Never share an appKey between two pages that sync different sets of keys (Invariant §8).

| appKey | Owner pages | Keys synced |
|--------|-------------|-------------|
| `goals` | `main.html` | prefix `goals:` |
| `coach` | `topbar.js` (all pages) | `coach_chat_history` |
| `apiusage` | `topbar.js` (all pages) | `apiusage:log` |
| `health` | `health.html` | `stack:items`, `stack:version`, `stack:low`, prefix `stack:taken:` |
| `profile` | `health.html`, `index.html`, `po-water.html` | `po_water_v1` |
| `finance` | `finance.html` | `subs`, `wishlist`, `nw:*`, etc. |
| `savedlinks` | `saved-links.html` | `savedlinks:items` |
| `caffeine` | `caffeine.html` | `caf:logs`, `caf:custom` |
| `marathon` | `marathon.html` | `PLAN_KEY` |
| `nutrition` | `nutrition.html` | store key |
| `notes` | `notes.html` | store key, cat key |
| `shopping` | `shopping.html` | purchase key |
| `personalcare` | `personal-care.html` | store key |
| `skincare` | `skincare.html` | store key |
| `chores` | `chores.html` | store key |

---

## Module Changelogs

Entries are newest-first within each section. Add a new entry at the **top** of the relevant section after every change.

---

### `topbar.js` — Topbar / Coach

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| 2026-07-16 | *(this session)* | Fixed `pushWaterMergedToSupabase` writing to `key:'health'` instead of `key:'profile'` (undid appKey fix). Added `primeCoachData()` — fetches goals/health/profile/marathon/caffeine/gym rows from server into localStorage when coach panel opens so dashboardData() always has current data. Added `coach_memory` persistent instructions: messages matching instruction patterns saved to localStorage and injected into CHAT_SYS at top of system prompt. Added `onApplied` to coach sync that reloads history if panel opened before server data arrived. Increased MAX_SAVED to 80, MAX_CTX to 40. Updated PROACTIVE_SYS: structured output (tasks first, then alerts), collects last 3 briefings to prevent any repetition, strict no-repeat rule. Bumped COACH_PROMPT_BUILD to '2026-07-16-v1'. | If primeCoachData writes keys watched by another page's initCloudSync, those syncs will schedule redundant pushes (idempotent, not harmful). coach_memory accumulates up to 20 instructions — stale instructions must be manually cleared from localStorage if user changes their mind. |
| 2026-07-14 | `6130451` | Removed `onApplied` body from coach sync (was clearing `feed.innerHTML` mid-conversation). Removed `coach_proactive_*` from syncedPrefixes. Added `COACH_PROMPT_BUILD = '2026-07-14-v3'` version key that clears today's proactive flag on deploy so scan re-runs with fixed code. | If COACH_PROMPT_BUILD is not bumped after future prompt changes, users will see stale scan results. |
| 2026-07-14 | `c2422fd` | Added `initCloudSync` for coach data inside `initCoach()`. Synced `coach_chat_history` and `coach_proactive_*`. `onApplied` cleared the feed and reloaded. | **INTRODUCED BUG** (fixed in `6130451`): onApplied fired mid-conversation and deleted what the user was typing. Syncing `coach_proactive_*` caused the proactive scan to never re-run after a bug fix. |
| 2026-07-14 | `6ef89dd` | Replaced `date: a.date` with `when: <human string>` in strava slim payload. Removed raw date entirely so Claude cannot re-derive timing. Updated CHAT_SYS and PROACTIVE_SYS notes to reference `when`. | If strava data format changes upstream, the `when` computation in `dashboardData()` may need updating. |
| 2026-07-14 | `8d06bd8` | Added `daysAgo` precomputed field to strava entries. Added system-prompt DATA NOTES instructing Claude to use `daysAgo` not raw date. Added po_coach_v1 slim handler (last 10 log entries, 60-day cutoff). Removed `po_coach_workout_done` from SKIP set so coach can see gym sessions. | (Later superseded by `6ef89dd` which dropped raw date entirely.) |
| 2026-07-14 | `f8e7d91` | Anti-repetition: reads last proactive briefing from history and includes it in PROACTIVE_SYS as context. Updated PROACTIVE_SYS with DATA NOTES (goals done=true means completed, daysAgo for strava, po_coach_workout_done format). | Coach may skip mentioning genuinely recurring issues if it looks like repetition. |

---

### `main.html` — Goals / To-Do

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| 2026-07-14 | `088d1a3` | Moved `initCloudSync` call from a separate `<script>` block into the main IIFE. This gives `onApplied` access to `getActiveDateString`, `storeListKeys`, `rollover`, `processStreak`, `loadToday`, `loadTomorrow`. Also replaced separate `storage` event dispatch with direct `loadToday()`/`loadTomorrow()` calls in `onApplied`. Removed bounds check from delete handler (root cause was empty backing store, not stale index). | If helper functions are ever moved out of the IIFE, re-examine `onApplied` scope. |
| 2026-07-14 | `fd322af` | Added bounds check `if (idx < 0 \|\| idx >= list.length) return` to delete handler and `hasPastKeys` guard in `onApplied` to only call `rollover()` when sync genuinely restored past-date keys. | **INTRODUCED BUG** (fixed in `088d1a3`): `onApplied` was still out-of-scope in a separate `<script>` block, so `getActiveDateString` threw silently. Bounds check caused delete to do nothing because backing store was empty (wiped by applyRemote). |
| 2026-07-14 | `216269a` | Added `changed` flag to `rollover()` so `setGoals` is only called when goals were actually added (prevents writing empty array when `onApplied` calls rollover with no past keys). | If rollover is called in a context where `changed` logic is wrong, newly added goals could be silently discarded. |
| 2026-07-14 | `f0db269` | Added `rollover()` call to `onApplied` so rollover re-runs after sync restores old server state. Changed `saveToHistory` from skip-if-exists to upsert (fixes history showing incorrect data). | Rolling over in `onApplied` can have cascading effects if called without `changed` flag guard — see `216269a`. |

---

### `sync.js` — Cloud Sync

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| *(no changes — treat as read-only)* | — | sync.js has not been modified. All sync behavior is configured via `initCloudSync` callers. | Any change here affects ALL pages simultaneously. Read Architecture Invariants §1 and §2 before touching. |

---

### `gym.html` — Workout Tracker

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| 2026-07-14 | `fd5bb87` | Smart day matching on plan import (replaces accumulated days instead of appending). | Plan import could silently overwrite days if matching logic is too aggressive. |
| 2026-07-14 | `164962a` | Added rest timer, 1RM strength goals. | Rest timer state is in-memory only (no persistence). |
| 2026-07-14 | `1d50910` | One-time data cleanup: removed Sharms day, seeded exercises from PPL days. | One-time only — should not be re-run. |
| 2026-07-14 | `779a5eb` | Fixed localStorage quota crash. Seeds bodyweight exercises from last recorded weight. | If bodyweight key is missing, seeding silently skips. |
| 2026-07-14 | `cd28a1c` | Fixed plan days being lost on cross-device sync. | Sync merge strategy for plan days — check if days still interleave correctly after a sync conflict. |
| 2026-07-14 | `cdcb587` | Added coach review + change-request flow to plan import. | Requires `/api/ai/ai-chat` endpoint. If AI is unavailable, import should gracefully fall back. |

---

### `finance.html` — Finance

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| 2026-07-14 | `21212d0` | Fixed transfer cash bug. Transfers now logged to activity feed. | Activity feed display order depends on timestamp sort. |
| 2026-07-14 | `6116117` | Added account transfer feature to Net Worth tab. | Transfer between same account is not guarded — could silently no-op or create duplicate entries. |
| 2026-07-14 | `3e84dbb` / `147d424` / `895702d` | Three successive fixes for OTI Log Payment button not responding. Final fix: standalone synchronous script block with `onclick` + `window` exposure. | Button relies on global `window.logPayment` — if the function is ever moved inside a module/IIFE, it will break again. |
| 2026-07-14 | `9725837` | Fixed one-time income destination dropdown not showing bank accounts. | Dropdown is populated at render time. If accounts change after render, dropdown needs a refresh. |
| 2026-07-14 | `ab85581` | Added one-time income logging and next-paycheck date to Jobs tab. | — |

---

### `saved-links.html` — Saved Links

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| 2026-07-15 | *(this session)* | Fixed sync race condition: moved `initCloudSync` to before `handleSharedParams` so setItem patch is active when the share is saved. Added `pendingSharedLink` — `onApplied` re-inserts the link if `applyRemote` REPLACE-ALL wiped it before the push fired. Claude response handler also re-adds if not found by ID. Fixed Shortcut setup card steps (Text + Open URLs, `?url=` in copy URL). | If `pendingSharedLink` is not cleared (fetch never resolves), `onApplied` will re-insert on every 30s poll. Both `.then` and `.catch` clear it to prevent this. |
| 2026-07-14 | `36dda8b` | Added iOS Shortcut setup card. | — |
| 2026-07-14 | `164962a` | Added AI auto-categorize on share sheet receive. | Requires `/api/ai/ai-chat`. If Claude returns unexpected JSON shape, category defaults to `'Saved'`. |

---

## Debugging Playbook

When something breaks, start here before reading code.

### "Goals all disappeared / wrong goals showing"
1. Check `main.html` changelog — any recent change to `initCloudSync`, `rollover`, or `onApplied`?
2. Was `initCloudSync` called from INSIDE the main IIFE? (Invariant §1)
3. Did `applyRemote` delete `goals:today`? (Invariant §2 + §3) — check if server snapshot has today's key.
4. Is `onApplied` calling `rollover()` with the `changed` flag guard in place?

### "Delete one goal wipes all goals"
Root cause: `getGoals(key)` returned `[]` at click time, so `splice` on empty array + `setGoals(key, [])` wiped all goals. This happens when `applyRemote` deleted `goals:today` from localStorage BEFORE the delete click. Fix: ensure `onApplied` re-runs `rollover()` to restore today's key.

### "Coach says 'yesterday' for an activity 2+ days ago"
Check `dashboardData()` in `topbar.js`, the `strava_activities_v1` branch. The entry must have a `when` string and NOT a raw `date` field. If `date` is present, Claude will re-derive timing and get it wrong.

### "Coach conversation deleted when I send a message"
`onApplied` for the coach sync is clearing the feed. `onApplied` must never touch `feed.innerHTML`. See Invariant §4 and commit `6130451`.

### "Coach scan re-runs every page load / never re-runs after a fix"
- **Re-runs every load:** something deleted `coach_proactive_YYYY-MM-DD` from localStorage. Check if it was added to `syncedPrefixes` accidentally (Invariant §6).
- **Never re-runs after fix:** `COACH_PROMPT_BUILD` was not bumped after the change (Invariant §7).

### "Clicking a button does nothing (finance/other page)"
Check if the handler function is defined inside an IIFE but called via `onclick` attribute or `addEventListener` from outside. Handlers wired via `onclick` attributes or global calls need to be exposed on `window`. See the OTI Log Payment bug history in `finance.html` changelog.

### "Supplement stack data disappeared (stack:items, stack:taken:*)"
A page that only knows about `po_water_v1` pushed to the `health` server row, overwriting it with just `{po_water_v1: ...}`. On next `applyRemote` in health.html, stack keys weren't in the server snapshot → deleted locally. See Invariant §8. Fixed: `po_water_v1` now lives under `appKey: 'profile'`, stack data under `appKey: 'health'`.

### "Two pages syncing the same appKey are overwriting each other's data"
See Invariant §8. Check the appKey registry table in the Project Map. Each appKey must own a non-overlapping set of keys.

### "Data pushed to wrong server row / sync conflict between pages"
Each `initCloudSync` call must use an appKey from the registry in the Project Map. If adding a new sync, add a new row to the registry first and verify no existing page uses the same appKey with different keys.

---

### `health.html` — Supplements

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| 2026-07-14 | *(this session)* | Removed `po_water_v1` from `appKey: 'health'` syncedKeys. Added separate `initCloudSync({appKey: 'profile', syncedKeys: ['po_water_v1']})`. Prevents index.html/po-water.html pushes from wiping supplement stack data on the server. | If any future page needs to sync po_water_v1, it must use `appKey: 'profile'`, not `appKey: 'health'`. |

---

### `index.html` — Home / Bento Grid

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| 2026-07-14 | *(this session)* | Changed sync from `appKey: 'health'` to `appKey: 'profile'` for po_water_v1. Prevents profile saves from overwriting the supplement stack on the server. | — |

---

### `po-water.html` — Water Tracker

| Date | Commit | Change | What could break |
|------|--------|--------|-----------------|
| 2026-07-14 | *(this session)* | Changed sync from `appKey: 'health'` to `appKey: 'profile'` for po_water_v1. Same fix as index.html. | — |
