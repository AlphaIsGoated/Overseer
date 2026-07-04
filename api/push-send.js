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

async function buildPayload(type, supaUrl, supaKey) {
  const today = dateKey(new Date());
  const tomorrow = dateKey(new Date(Date.now() + 86400000));
  const MODULE_URL = '/index.html';

  switch (type) {
    case 'training': {
      // Read marathon plan and find today's + tomorrow's workout
      const plan = await fetchModuleData(supaUrl, supaKey, 'marathon');
      const entries = (plan && plan.entries) || [];
      const todayEntry = entries.find(e => e.date === today);
      const tomorrowEntry = entries.find(e => e.date === tomorrow);
      if (todayEntry && todayEntry.type !== 'rest') {
        const dist = todayEntry.plannedDistanceMi ? ` (${todayEntry.plannedDistanceMi} mi)` : '';
        return {
          title: '🏃 Training · Marathon',
          body: `Today: ${todayEntry.label || todayEntry.type}${dist}. ${todayEntry.completed ? 'Already marked done ✓' : 'Tap to log your run.'}`,
          url: '/marathon.html',
        };
      }
      if (tomorrowEntry && tomorrowEntry.type !== 'rest') {
        const dist = tomorrowEntry.plannedDistanceMi ? ` (${tomorrowEntry.plannedDistanceMi} mi)` : '';
        return {
          title: '🏃 Training · Marathon',
          body: `Tomorrow: ${tomorrowEntry.label || tomorrowEntry.type}${dist}. Plan your schedule accordingly.`,
          url: '/marathon.html',
        };
      }
      return {
        title: '💪 Training Reminder',
        body: 'Check your Fitness and Marathon modules — stay consistent with your training.',
        url: '/gym.html',
      };
    }

    case 'nutrition': {
      return {
        title: '🥗 Nutrition · Log Check-in',
        body: 'Have you logged your meals today? Track calories and macros in the Nutrition module to stay on target.',
        url: '/nutrition.html',
      };
    }

    case 'skincare': {
      const hour = new Date().getUTCHours();
      const isEvening = hour >= 20 || hour < 6;
      return {
        title: '🧖 Skincare · Routine Reminder',
        body: isEvening
          ? 'Time for your PM skincare routine. Open the app to check your evening steps.'
          : 'Start the day right — complete your AM skincare routine.',
        url: '/skincare.html',
      };
    }

    case 'reminders': {
      // Check chores for any pending items
      const chores = await fetchModuleData(supaUrl, supaKey, 'chores');
      const items = (chores && (Array.isArray(chores) ? chores : chores['chores:items'])) || [];
      const pending = items.filter(c => {
        if (c.recurring === 'daily') return c.lastDoneKey !== today;
        if (c.recurring === 'weekly') return true; // simplify
        return !c.done;
      });
      if (pending.length > 0) {
        return {
          title: '✅ Reminders · ' + pending.length + ' pending',
          body: pending.length === 1
            ? `"${pending[0].text}" is still on your list.`
            : `${pending.length} tasks pending — "${pending[0].text}" and ${pending.length - 1} more.`,
          url: '/chores.html',
        };
      }
      return {
        title: '✅ Reminders',
        body: 'No overdue tasks today. Check your chores and goals to stay on track.',
        url: '/chores.html',
      };
    }

    case 'morning':
    default: {
      // Morning overview: check if there's a marathon workout today
      const plan = await fetchModuleData(supaUrl, supaKey, 'marathon');
      const todayRun = ((plan && plan.entries) || []).find(e => e.date === today && e.type !== 'rest');
      if (todayRun) {
        const dist = todayRun.plannedDistanceMi ? ` — ${todayRun.plannedDistanceMi} mi` : '';
        return {
          title: "Shrey's Dashboard · Good morning",
          body: `Today: ${todayRun.label || todayRun.type}${dist}. Check your coach for a full day overview.`,
          url: '/index.html',
        };
      }
      return {
        title: "Shrey's Dashboard · Good morning",
        body: 'Your daily check-in is ready. Open the app to see your coach insights.',
        url: '/index.html',
      };
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const isCron = req.query && req.query.cron === '1';
  if (!isCron && !requireAppSecret(req, res)) return;

  const type = (req.query && req.query.type) || 'morning';
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@overseer.app';
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;

  if (!vapidPublic || !vapidPrivate) return res.status(500).json({ error: 'VAPID keys not configured' });
  if (!supaUrl || !supaKey) return res.status(500).json({ error: 'Supabase not configured' });

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

  const results = await Promise.allSettled(subs.map(sub => webpush.sendNotification(sub, payloadStr)));
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  return res.status(200).json({ ok: true, type, sent, failed, total: subs.length, payload });
}
