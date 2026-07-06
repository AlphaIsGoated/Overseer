// ============================================================
// GET /api/obsidian-proxy?path=/vault/&obsBase=http://localhost:27124
// Authorization: Bearer <Obsidian Local REST API key>
//
// Proxies requests to a local Obsidian Local REST API instance.
// Needed because browsers block HTTPS → HTTP requests (mixed content),
// so the dashboard (on HTTPS) can't call localhost:27124 (HTTP) directly.
// Running through this server-side proxy sidesteps that restriction since
// Node.js isn't subject to browser mixed-content rules.
//
// The Obsidian API key is passed from the client in the Authorization header
// and forwarded directly — it never touches Vercel env vars.
//
// Gated by APP_SECRET if configured.
// ============================================================
import { requireAppSecret } from './_lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-App-Secret, Accept');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Obsidian API key required (Authorization: Bearer <key>)' });

  const obsBase = (req.query && req.query.obsBase) || '';
  const path = (req.query && req.query.path) || '/';

  // Validate obsBase is a local/private URL — don't let this become an open SSRF proxy
  if (!obsBase || !/^https?:\/\/(localhost|127\.0\.0\.[0-9]+|\[::1\])(:[0-9]+)?$/.test(obsBase)) {
    return res.status(400).json({ error: 'obsBase must be a local URL like http://localhost:27124' });
  }

  const accept = req.headers.accept || 'application/json';
  const url = obsBase + path;

  try {
    const r = await fetch(url, {
      headers: { Authorization: auth, Accept: accept },
      signal: AbortSignal.timeout(10000), // 10s — Obsidian should be local and fast
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Obsidian returned ' + r.status + ': ' + text.slice(0, 200) });
    }
    const ct = r.headers.get('content-type') || 'application/json';
    const body = await r.text();
    res.setHeader('Content-Type', ct);
    return res.status(200).send(body);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return res.status(502).json({ error: 'Could not reach Obsidian — make sure the app is open and the Local REST API plugin is enabled.' });
    }
    return res.status(500).json({ error: msg });
  }
}
