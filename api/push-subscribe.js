// ============================================================
// POST /api/push-subscribe
// Body: { subscription: <PushSubscription JSON> }
// Saves/updates the device's push subscription in Supabase
// (stored as a JSON array under key 'push_subscriptions' in the
// existing app_state table — no schema migration needed).
// ============================================================
import { requireAppSecret } from './_lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const sub = body && body.subscription;
  const deviceId = (body && body.deviceId) || null;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'subscription required' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase not configured (missing SUPABASE_SERVICE_ROLE_KEY)' });

  try {
    // Read current subscriptions, upsert/merge this device's sub, write back.
    const getRes = await fetch(url + '/rest/v1/app_state?key=eq.push_subscriptions&select=data', {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
    });
    const rows = await getRes.json().catch(() => []);
    const current = (rows && rows[0] && rows[0].data) ? rows[0].data : [];
    const subs = Array.isArray(current) ? current : [];
    // Deduplicate + purge old ghost entries:
    // - Remove any entry matching this deviceId (same device re-subscribing)
    // - Remove any entry matching this endpoint (exact duplicate)
    // - Remove any entry WITHOUT a deviceId when we have one — these are
    //   pre-deviceId ghosts that can never be deduped and just accumulate
    const filtered = subs.filter(s => {
      if (deviceId && s.deviceId === deviceId) return false; // same device, will replace
      if (s.endpoint === sub.endpoint) return false;          // exact duplicate
      if (deviceId && !s.deviceId) return false;             // old ghost, purge
      return true;
    });
    filtered.push({ ...sub, ...(deviceId ? { deviceId } : {}) });
    const upsertRes = await fetch(url + '/rest/v1/app_state', {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key: 'push_subscriptions', data: filtered, updated_at: new Date().toISOString() }),
    });
    if (!upsertRes.ok) { const t = await upsertRes.text(); return res.status(500).json({ error: 'Supabase upsert failed: ' + t }); }
    return res.status(200).json({ ok: true, count: filtered.length });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
}
