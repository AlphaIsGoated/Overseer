// ============================================================
// POST /api/push-send?type=morning|training|nutrition|skincare|reminders&cron=1
// Sends context-aware push notifications to all registered devices.
// Called by Vercel Cron (see vercel.json) on different schedules per type,
// or manually with ?type=test to test any notification.
//
// Reads the user's synced data from Supabase (app_state table) to
// generate personalized content — e.g. today's actual marathon workout
// instead of a generic "go train" message.
//
// Requires Vercel env vars:
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
//   SUPABASE_URL / SUPABASE_ANON_KEY (to read user data + subscriptions)
//
// Gated by APP_SECRET for manual calls; cron invocations use ?cron=1.
// ============================================================
import { requireAppSecret } from './_lib/security.js';
import webpush from 'web-push';

// Fetch any module's synced data from Supabase
async function fetchModuleData(supaUrl, supaKey, appKey) {
  try {
    const r = await fetch(
      supaUrl + '/rest/v1/app_state?key=eq.' + encodeURIComponent(appKey) + '&select=data',
      { headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, Accept: 'application/json' } }
    );
    const rows = await r.json().catch(() => []);
    return (rows && rows[0] && rows[0].data) ? rows[0].data : null;
  } catch (e) { return null; }
}

function dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function isoWeekKey(d) {
  const dt = new Date(d); dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // back up to Monday
  return dateKey(dt);
}

function readMarathonPlan(raw) {
  if (!raw) return null;
  return raw['marathon_plan_v1'] || raw; // sync.js nests data under the localStorage key name
}

async function buildPayload(type, supaUrl, supaKey) {
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 86400000));
  const MODULE_URL = '/index.html';

  switch (type) {
    case 'training': {
      const plan = readMarathonPlan(await fetchModuleData(supaUrl, supaKey, 'marathon'));
      const entries = (plan && plan.entries) || [];
      const todayEntry = entries.find(e => e.date === today);
      const tomorrowEntry = entries.find(e => e.date === tomorrow);
      if (todayEntry && todayEntry.type !== 'rest') {
        const dist = todayEntry.plannedDistanceMi ? ` (${todayEntry.plannedDistanceMi} mi)` : '';
        return { tag: 'training', title: '🏃 Training · Marathon', body: `Today: ${todayEntry.label || todayEntry.type}${dist}. ${todayEntry.completed ? 'Already marked done ✓' : 'Tap to log your run.'}`, url: '/marathon.html' };
      }
      if (tomorrowEntry && tomorrowEntry.type !== 'rest') {
        const dist = tomorrowEntry.plannedDistanceMi ? ` (${tomorrowEntry.plannedDistanceMi} mi)` : '';
        return { tag: 'training', title: '🏃 Training · Marathon', body: `Tomorrow: ${tomorrowEntry.label || tomorrowEntry.type}${dist}. Plan ahead.`, url: '/marathon.html' };
      }
      return { tag: 'training', title: '💪 Training Reminder', body: 'Stay consistent — check your Fitness and Marathon modules.', url: '/gym.html' };
    }

    case 'nutrition':
      return { tag: 'nutrition', title: '🥗 Nutrition · Log Check-in', body: 'Have you logged meals today? Track calories and macros to stay on target.', url: '/nutrition.html' };

    case 'skincare': {
      const hour = new Date().getUTCHours();
      const isEvening = hour >= 20 || hour < 6;
      return { tag: 'skincare', title: '🧖 Skincare · Routine Reminder', body: isEvening ? 'Time for your PM skincare routine.' : 'Start the day right — complete your AM skincare routine.', url: '/skincare.html' };
    }

    case 'reminders': {
      const thisWeek = isoWeekKey(new Date());
      const yesterday = dateKey(new Date(Date.now() - 86400000));
      const [goalsData, choresData, pcData] = await Promise.all([
        fetchModuleData(supaUrl, supaKey, 'goals'),
        fetchModuleData(supaUrl, supaKey, 'chores'),
        fetchModuleData(supaUrl, supaKey, 'personalcare'),
      ]);

      // Main goals (main.html) — primary source for this notification.
      // goals:today is only created in the browser after the user opens main.html.
      // If the notification fires before the app is opened (9 AM), fall back to
      // goals:yesterday — rollover copies uncompleted goals to today, so yesterday's
      // pending goals are the same tasks the user needs to do today.
      const todayGoals = (goalsData && goalsData['goals:' + today]) || [];
      const yesterdayGoals = (goalsData && goalsData['goals:' + yesterday]) || [];
      const goalsSource = todayGoals.length > 0 ? todayGoals : yesterdayGoals;
      const goalsPending = goalsSource.filter(g => g && !g.done).map(g => g.text).filter(Boolean);

      if (goalsPending.length > 0) {
        let body;
        if (goalsPending.length === 1) {
          body = `Still to do: "${goalsPending[0]}"`;
        } else if (goalsPending.length === 2) {
          body = `Still to do: "${goalsPending[0]}" and "${goalsPending[1]}"`;
        } else {
          body = `Still to do: "${goalsPending[0]}", "${goalsPending[1]}" + ${goalsPending.length - 2} more`;
        }
        return { tag: 'reminders', title: `✅ ${goalsPending.length} goal${goalsPending.length === 1 ? '' : 's'} remaining`, body, url: '/main.html' };
      }

      // All main goals done — fall back to chores / personal care
      const choreItems = (choresData && (Array.isArray(choresData) ? choresData : choresData['chores:items'])) || [];
      const chorePending = choreItems.filter(c => {
        if (c.recurring === 'daily') return c.lastDoneKey !== today;
        if (c.recurring === 'weekly') return c.lastDoneKey !== thisWeek;
        return !c.done;
      }).map(c => c.text);

      const pcItems = (pcData && pcData['personalcare:items']) || [];
      const pcPending = pcItems.filter(i => i.kind === 'daily' && i.lastDoneKey !== today).map(i => i.name);

      const allPending = [...chorePending, ...pcPending];
      if (allPending.length > 0) {
        const body = allPending.length === 1
          ? `"${allPending[0]}" is still pending.`
          : `${allPending.length} tasks pending — "${allPending[0]}" and ${allPending.length - 1} more.`;
        return { tag: 'reminders', title: '✅ Reminders · ' + allPending.length + ' pending', body, url: '/chores.html' };
      }

      return { tag: 'reminders', title: '✅ All done for today!', body: 'All goals and tasks complete. Keep it up!', url: '/main.html' };
    }

    case 'morning':
    default: {
      const yesterday = dateKey(new Date(Date.now() - 86400000));
      const [plan, goalsData] = await Promise.all([
        fetchModuleData(supaUrl, supaKey, 'marathon').then(readMarathonPlan),
        fetchModuleData(supaUrl, supaKey, 'goals'),
      ]);
      const todayRun = ((plan && plan.entries) || []).find(e => e.date === today && e.type !== 'rest');
      // goals:today may not exist yet if app hasn't been opened — fall back to yesterday's
      const todayGoals = (goalsData && goalsData['goals:' + today]) || [];
      const yGoals = (goalsData && goalsData['goals:' + yesterday]) || [];
      const goalsSource = todayGoals.length > 0 ? todayGoals : yGoals;
      const pendingCount = goalsSource.filter(g => g && !g.done).length;

      const parts = [];
      if (todayRun) {
        const dist = todayRun.plannedDistanceMi ? ` (${todayRun.plannedDistanceMi} mi)` : '';
        parts.push(`Run: ${todayRun.label || todayRun.type}${dist}`);
      }
      if (pendingCount > 0) parts.push(`${pendingCount} goal${pendingCount === 1 ? '' : 's'} to do`);

      const body = parts.length > 0
        ? parts.join(' · ') + '. Open coach for full briefing.'
        : 'Your daily check-in is ready. Open coach for your full briefing.';
      return { tag: 'morning', title: "Shrey's Dashboard · Good morning", body, url: '/index.html' };
    }
  }
}

export default async function handler(req, res) {
  // Vercel Cron sends GET with "Authorization: Bearer <CRON_SECRET>".
  // Manual test button (Settings) sends GET/POST with X-App-Secret.
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = (req.headers && req.headers.authorization) || '';
  // isCron: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" (serverless
  // runtime always has CRON_SECRET even if Edge Middleware doesn't).
  // The ?cron=1 query param is kept as a fallback so the manual test button in
  // the dashboard still works without needing APP_SECRET in the URL.
  const isCron = (cronSecret && authHeader === 'Bearer ' + cronSecret)
              || (req.query && req.query.cron === '1');

  if (!isCron && !requireAppSecret(req, res)) return;

  const type = (req.query && req.query.type) || 'morning';
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@overseer.app';
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!vapidPublic || !vapidPrivate) return res.status(500).json({ error: 'VAPID keys not configured' });
  if (!supaUrl || !supaKey) return res.status(500).json({ error: 'Supabase not configured (missing SUPABASE_SERVICE_ROLE_KEY)' });

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  // Read subscriptions from Supabase
  const getRes = await fetch(supaUrl + '/rest/v1/app_state?key=eq.push_subscriptions&select=data', {
    headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, Accept: 'application/json' },
  }).catch(() => null);
  if (!getRes || !getRes.ok) return res.status(500).json({ error: 'could not read subscriptions' });
  const rows = await getRes.json().catch(() => []);
  const subs = (rows && rows[0] && Array.isArray(rows[0].data)) ? rows[0].data : [];
  if (!subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'no subscriptions' });

  // Build contextual payload for this notification type
  const payload = await buildPayload(type, supaUrl, supaKey);
  const payloadStr = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subs.map(({ endpoint, keys, expirationTime }) => webpush.sendNotification({ endpoint, keys, expirationTime }, payloadStr))
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  // Collect error details with status codes for diagnosis
  const failures = results
    .map((r, i) => r.status === 'rejected' ? { endpoint: subs[i].endpoint.slice(-40), error: String(r.reason), status: r.reason && r.reason.statusCode } : null)
    .filter(Boolean);
  // Remove any subscription that fails — if the push service can't deliver
  // it for any reason it's considered dead. User can re-subscribe.
  const deadEndpoints = results
    .map((r, i) => r.status === 'rejected' ? subs[i].endpoint : null)
    .filter(Boolean);

  // Auto-remove dead subscriptions so they stop accumulating
  if (deadEndpoints.length > 0) {
    const cleaned = subs.filter(s => !deadEndpoints.includes(s.endpoint));
    await fetch(supaUrl + '/rest/v1/app_state', {
      method: 'POST',
      headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key: 'push_subscriptions', data: cleaned, updated_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, type, sent, failed: failures.length, failures, deadRemoved: deadEndpoints.length, total: subs.length, payload });
}
