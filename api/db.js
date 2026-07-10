// ============================================================
// GET  /api/db?key=<appKey>  →  { data: {...} | null }
// POST /api/db               body: { key, data }  →  { ok: true }
//
// Server-side proxy for Supabase app_state reads/writes.
// Uses SUPABASE_SERVICE_ROLE_KEY (never sent to the browser),
// so the browser never needs any Supabase credential at all.
// Gated by APP_SECRET (same header as the AI endpoints).
// ============================================================
import { requireAppSecret } from './_lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireAppSecret(req, res)) return;

  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    return res.status(503).json({ error: 'Supabase not configured on this server' });
  }

  const authHeaders = {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
  };

  // ── GET: read one row by key ──────────────────────────────
  if (req.method === 'GET') {
    const appKey = req.query && req.query.key;
    if (!appKey) return res.status(400).json({ error: 'key required' });
    try {
      const r = await fetch(
        supaUrl + '/rest/v1/app_state?key=eq.' + encodeURIComponent(appKey) + '&select=data',
        { headers: authHeaders }
      );
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        return res.status(502).json({ error: 'upstream ' + r.status + ': ' + t.slice(0, 200) });
      }
      const rows = await r.json();
      const data = rows && rows[0] && rows[0].data ? rows[0].data : null;
      return res.status(200).json({ data });
    } catch (e) {
      return res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  }

  // ── POST: upsert one row ──────────────────────────────────
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const appKey = body && body.key;
    const data = body && body.data;
    if (!appKey) return res.status(400).json({ error: 'key required' });
    try {
      const r = await fetch(supaUrl + '/rest/v1/app_state?on_conflict=key', {
        method: 'POST',
        headers: { ...authHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: appKey, data, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        return res.status(502).json({ error: 'upstream ' + r.status + ': ' + t.slice(0, 200) });
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e && e.message ? e.message : String(e) });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}
