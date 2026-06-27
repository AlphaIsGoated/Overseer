// ============================================================
// GET  /api/integrations/strava?path=/athlete/activities&per_page=30   (Authorization: Bearer <access_token>)
//      Proxies to https://www.strava.com/api/v3<path> — needed because
//      Strava's API doesn't send CORS headers.
// POST /api/integrations/strava   { refresh_token }
//      Exchanges a refresh_token for a new access_token via Strava's OAuth
//      endpoint (access tokens expire after 6 hours).
//
// Combined into one file (data-proxy + token-refresh both for Strava) to
// stay under Vercel Hobby's 12-Serverless-Function-per-deployment cap.
//
// Gated by APP_SECRET (see api/_lib/security.js) if configured — without it,
// GET is an open relay to the Strava API for anyone with their own bearer
// token, and POST is a free token-refresh service using OUR client secret.
// ============================================================
import { requireAppSecret } from '../_lib/security.js';

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

async function handleRefresh(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const refresh = body && body.refresh_token;
  if (!refresh) return res.status(400).json({ error: 'refresh_token required' });

  const clientId     = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(500).json({ error: 'server not configured' });

  try {
    const form = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refresh,
      client_id:     clientId,
      client_secret: clientSecret,
    });
    const r = await fetch('https://www.strava.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    form,
    });
    const text = await r.text();
    if (!r.ok) return res.status(500).json({ error: 'refresh failed: ' + text });
    try { return res.status(200).json(JSON.parse(text)); }
    catch { return res.status(500).json({ error: 'non-JSON response from Strava' }); }
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
