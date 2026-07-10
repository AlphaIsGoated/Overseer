// ============================================================
// GET /api/config  →  returns a tiny JS file that sets runtime config
// on `window` from Vercel env vars. Loaded via:
//   <script src="/api/config"></script>
// in the <head> before sync.js / topbar.js.
//
// Supabase credentials are intentionally NOT included here — all
// Supabase access is proxied through /api/db (server-side, service
// role key). The browser never needs the anon key.
//
// APP_SECRET gates the AI + db proxy endpoints against drive-by
// abuse. It ships to the browser (anyone can read it in devtools)
// so it is not a true secret — it just raises the bar for automated
// abuse of an exposed LLM/db proxy.
// ============================================================
export default function handler(req, res) {
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
    'window.DASH_STRAVA_CLIENT_ID=' + JSON.stringify(stravaClientId) + ';' +
    'window.DASH_GOOGLE_CLIENT_ID=' + JSON.stringify(googleClientId) + ';' +
    'window.DASH_VAPID_PUBLIC_KEY=' + JSON.stringify(vapidPublicKey) + ';' +
    'window.DASH_ELEVENLABS_ENABLED=' + elevenLabsEnabled + ';' +
    'window.DASH_OPENAI_ENABLED=' + openAiEnabled + ';' +
    'window.DASH_APIFY_ENABLED=' + apifyEnabled + ';' +
    'window.DASH_APP_SECRET=' + JSON.stringify(appSecret) + ';'
  );
}
