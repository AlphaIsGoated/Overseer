// ============================================================
// GET /api/strava-data?path=/athlete/activities&per_page=30
// Authorization: Bearer <user's Strava access_token>
// Proxies the request to https://www.strava.com/api/v3<path> and
// returns the JSON. Strava's API doesn't send CORS headers, so the
// browser can't call it directly — this is a thin pass-through.
//
// Gated by APP_SECRET (see api/_security.js) if configured — without
// it, this endpoint is an open relay to the Strava API for anyone who
// supplies their own bearer token, which costs nothing directly but
// burns Vercel invocation/bandwidth quota and risks this deployment
// getting flagged by Strava if abused at volume.
// ============================================================
import { requireAppSecret } from './_security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing bearer token' });

  const path = (req.query && req.query.path) || '';
  if (!path || !path.startsWith('/')) return res.status(400).json({ error: 'path required (must start with /)' });

  const fwd = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k !== 'path') fwd.set(k, String(v));
  }
  const qs = fwd.toString();
  const url = 'https://www.strava.com/api/v3' + path + (qs ? '?' + qs : '');

  try {
    const r = await fetch(url, {
      headers: { 'Authorization': auth, 'Accept': 'application/json' },
    });
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json');
    return res.send(text);
  } catch (e) {
    return res.status(500).json({ error: 'proxy fetch failed: ' + (e && e.message ? e.message : String(e)) });
  }
}
