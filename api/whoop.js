// ============================================================
// GET  /api/whoop?path=/recovery&limit=1   (Authorization: Bearer <access_token>)
//      Proxies to https://api.prod.whoop.com/developer/v1|v2<path> — needed
//      because WHOOP's API doesn't send CORS headers.
// POST /api/whoop   { refresh_token }
//      Exchanges a refresh_token for a new access_token via WHOOP's OAuth
//      endpoint, keeping the session alive past the 1-hour access-token expiry.
//
// Combined into one file (data-proxy + token-refresh both for WHOOP) to
// stay under Vercel Hobby's 12-Serverless-Function-per-deployment cap.
//
// Gated by APP_SECRET (see api/_security.js) if configured — without it,
// GET is an open relay to the WHOOP API for anyone with their own bearer
// token, and POST is a free token-refresh service using OUR client secret.
// ============================================================
import { requireAppSecret } from './_security.js';

async function handleData(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing bearer token' });

  const path = (req.query && req.query.path) || '';
  if (!path || !path.startsWith('/')) return res.status(400).json({ error: 'path required (must start with /)' });

  const fwd = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k !== 'path') fwd.set(k, String(v));
  }
  const qs = fwd.toString();
  // WHOOP moved most endpoints to v2; cycle is still on v1.
  const base = path.startsWith('/cycle')
    ? 'https://api.prod.whoop.com/developer/v1'
    : 'https://api.prod.whoop.com/developer/v2';
  const url = base + path + (qs ? '?' + qs : '');

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

async function handleRefresh(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const refresh = body && body.refresh_token;
  if (!refresh) return res.status(400).json({ error: 'refresh_token required' });

  const clientId     = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(500).json({ error: 'server not configured' });

  try {
    const form = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refresh,
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'offline',
    });
    const r = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    form,
    });
    const text = await r.text();
    if (!r.ok) return res.status(500).json({ error: 'refresh failed: ' + text });
    try { return res.status(200).json(JSON.parse(text)); }
    catch { return res.status(500).json({ error: 'non-JSON response from WHOOP' }); }
  } catch (e) {
    return res.status(500).json({ error: 'fetch error: ' + (e && e.message ? e.message : String(e)) });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!requireAppSecret(req, res)) return;

  if (req.method === 'GET') return handleData(req, res);
  if (req.method === 'POST') return handleRefresh(req, res);
  return res.status(405).json({ error: 'method not allowed' });
}
