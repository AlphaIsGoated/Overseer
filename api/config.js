// ============================================================
// GET /api/config  →  returns a tiny JS file that sets the
// public Supabase + Strava + app-token config on `window` from
// Vercel env vars:
//   SUPABASE_URL          (your project URL)
//   SUPABASE_ANON_KEY     (the public anon / publishable key)
//   STRAVA_CLIENT_ID      (public OAuth client id, from strava.com/settings/api)
//   APP_SECRET            (shared token gating the AI proxy endpoints — see below)
//
// Loaded via <script src="/api/config"></script> in the <head>
// BEFORE sync.js / topbar.js. If the env vars aren't set (or the
// site is opened locally), it sets empty strings and the pages
// fall back to whatever default is hardcoded in the JS.
//
// These are PUBLIC values (they ship to the browser anyway), so
// it's fine to expose them — this just lets people configure the
// app with env vars instead of editing files. The matching secrets
// (Supabase service key, STRAVA_CLIENT_SECRET, ANTHROPIC_API_KEY)
// stay server-side only and are never returned here.
//
// APP_SECRET is NOT a real cryptographic secret once it ships to the
// browser — anyone who loads the page can read it in devtools. Its
// purpose is narrower: it stops drive-by/automated abuse of the AI
// endpoints (api/ai-chat, api/vision-tool, api/nova, api/scan) by
// scripts/bots that hit those URLs directly without ever loading the
// page, which is the realistic abuse pattern for an exposed LLM
// proxy. It is NOT a substitute for real authentication.
// ============================================================
export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';
  const stravaClientId = process.env.STRAVA_CLIENT_ID || '';
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
  const elevenLabsEnabled = process.env.ELEVENLABS_API_KEY ? 'true' : 'false';
  const openAiEnabled = process.env.OPENAI_API_KEY ? 'true' : 'false';
  const apifyEnabled = process.env.APIFY_API_TOKEN ? 'true' : 'false';
  const appSecret = process.env.APP_SECRET || '';
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(
    'window.DASH_SUPABASE_URL=' + JSON.stringify(url) + ';' +
    'window.DASH_SUPABASE_KEY=' + JSON.stringify(key) + ';' +
    'window.DASH_STRAVA_CLIENT_ID=' + JSON.stringify(stravaClientId) + ';' +
    'window.DASH_GOOGLE_CLIENT_ID=' + JSON.stringify(googleClientId) + ';' +
    'window.DASH_VAPID_PUBLIC_KEY=' + JSON.stringify(vapidPublicKey) + ';' +
    'window.DASH_ELEVENLABS_ENABLED=' + elevenLabsEnabled + ';' +
    'window.DASH_OPENAI_ENABLED=' + openAiEnabled + ';' +
    'window.DASH_APIFY_ENABLED=' + apifyEnabled + ';' +
    'window.DASH_APP_SECRET=' + JSON.stringify(appSecret) + ';'
  );
}
