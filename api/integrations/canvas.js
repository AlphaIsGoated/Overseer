// ============================================================
// GET /api/integrations/canvas?base=https://canvas.case.edu&path=/api/v1/courses&...   (Authorization: Bearer <Canvas Personal Access Token>)
// Proxies to <base><path> — needed because Canvas's API doesn't send
// CORS headers, so the browser can't call it directly.
//
// Unlike the WHOOP/Strava/Google integrations, there's no fixed
// third-party host here — every school runs its own Canvas instance —
// so the base URL is supplied per-request by the client (whatever the
// user typed into the College module's settings) rather than hardcoded.
// Restricted to https:// and a plausible hostname to keep this from
// being a wide-open URL-fetch proxy.
//
// No OAuth flow needed: Canvas Personal Access Tokens are self-serve
// (Canvas -> Account -> Settings -> New Access Token) and used directly
// as a Bearer token — there's no refresh/callback endpoint to build.
//
// Gated by APP_SECRET (see api/_lib/security.js) if configured.
// ============================================================
import { requireAppSecret } from '../_lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing bearer token' });

  const base = (req.query && req.query.base) || '';
  const path = (req.query && req.query.path) || '';
  if (!/^https:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:\d+)?$/.test(base)) {
    return res.status(400).json({ error: 'base must be a plain https://host URL, e.g. https://canvas.case.edu' });
  }
  if (!path || !path.startsWith('/')) return res.status(400).json({ error: 'path required (must start with /)' });

  const fwd = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k !== 'base' && k !== 'path') fwd.set(k, String(v));
  }
  const qs = fwd.toString();
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
