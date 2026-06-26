// ============================================================
// GET /api/config  →  returns a tiny JS file that sets the
// public Supabase + Strava config on `window` from Vercel env vars:
//   SUPABASE_URL          (your project URL)
//   SUPABASE_ANON_KEY     (the public anon / publishable key)
//   STRAVA_CLIENT_ID      (public OAuth client id, from strava.com/settings/api)
//
// Loaded via <script src="/api/config"></script> in the <head>
// BEFORE sync.js / topbar.js. If the env vars aren't set (or the
// site is opened locally), it sets empty strings and the pages
// fall back to whatever default is hardcoded in the JS.
//
// These are PUBLIC values (they ship to the browser anyway), so
// it's fine to expose them — this just lets people configure the
// app with env vars instead of editing files. The matching secrets
// (Supabase service key, STRAVA_CLIENT_SECRET) stay server-side
// only and are never returned here.
// ============================================================
export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';
  const stravaClientId = process.env.STRAVA_CLIENT_ID || '';
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(
    'window.DASH_SUPABASE_URL=' + JSON.stringify(url) + ';' +
    'window.DASH_SUPABASE_KEY=' + JSON.stringify(key) + ';' +
    'window.DASH_STRAVA_CLIENT_ID=' + JSON.stringify(stravaClientId) + ';'
  );
}
