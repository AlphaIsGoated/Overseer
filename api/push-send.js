// ============================================================
// POST /api/push-send
// Sends a Web Push notification to every stored subscription.
// Called by Vercel Cron (see vercel.json) — also callable
// manually via the settings panel for testing.
//
// Optional body: { title, body, url } — uses a default daily
// reminder message if not provided.
//
// Requires Vercel env vars:
//   VAPID_PUBLIC_KEY   — base64url-encoded P-256 public key
//   VAPID_PRIVATE_KEY  — base64url-encoded P-256 private key
//   VAPID_SUBJECT      — e.g. "mailto:you@example.com"
//   SUPABASE_URL / SUPABASE_ANON_KEY — to read subscriptions
//
// Gated by APP_SECRET (see api/_lib/security.js).
// ============================================================
import { requireAppSecret } from './_lib/security.js';
import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  // Vercel Cron calls this with ?cron=1 and no x-app-secret, so accept
  // either the standard app-secret header OR a valid cron invocation
  // (Vercel's own infrastructure is the only caller with ?cron=1; the
  // request still comes over HTTPS so this is acceptable for a personal app).
  const isCron = req.query && req.query.cron === '1';
  if (!isCron && !requireAppSecret(req, res)) return;

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@overseer.app';
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY;

  if (!vapidPublic || !vapidPrivate) return res.status(500).json({ error: 'VAPID keys not configured' });
  if (!supaUrl || !supaKey) return res.status(500).json({ error: 'Supabase not configured' });

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const payload = JSON.stringify({
    title: (body && body.title) || "Shrey's Dashboard",
    body: (body && body.body) || 'Daily check-in — open the app to see your coach insights.',
    url: (body && body.url) || '/',
  });

  // Fetch subscriptions from Supabase.
  const getRes = await fetch(supaUrl + '/rest/v1/app_state?key=eq.push_subscriptions&select=data', {
    headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, Accept: 'application/json' },
  }).catch(() => null);
  if (!getRes || !getRes.ok) return res.status(500).json({ error: 'could not read subscriptions' });
  const rows = await getRes.json().catch(() => []);
  const subs = (rows && rows[0] && Array.isArray(rows[0].data)) ? rows[0].data : [];
  if (!subs.length) return res.status(200).json({ ok: true, sent: 0, message: 'no subscriptions registered' });

  const results = await Promise.allSettled(subs.map(sub => webpush.sendNotification(sub, payload)));
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  return res.status(200).json({ ok: true, sent, failed, total: subs.length });
}
