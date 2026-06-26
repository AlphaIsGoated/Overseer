// ============================================================
// GET /api/strava-callback?code=...&state=...
// Receives the OAuth code from Strava, exchanges it for tokens,
// and bounces back to /marathon.html with the tokens in the URL
// hash. The hash never reaches the server — only the browser
// reads it, then stores the tokens in localStorage.
// Env vars required on Vercel:
//   STRAVA_CLIENT_ID
//   STRAVA_CLIENT_SECRET
// (the redirect URI is derived from the live request host, same
// as the WHOOP callback, so it always matches what was used to
// start the OAuth flow regardless of domain/env vars)
// ============================================================
export default async function handler(req, res) {
  const code = req.query && req.query.code;
  const errorParam = req.query && req.query.error;
  if (errorParam) return res.status(400).send('Strava auth error: ' + errorParam);
  if (!code) return res.status(400).send('Missing code parameter.');

  const clientId     = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send('Server not configured (missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET).');
  }

  try {
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      client_id:     clientId,
      client_secret: clientSecret,
    });
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await tokenRes.text();
    if (!tokenRes.ok) {
      return res.status(500).send('Strava token exchange failed: ' + text);
    }
    let json;
    try { json = JSON.parse(text); } catch (e) {
      return res.status(500).send('Strava returned non-JSON: ' + text);
    }
    const access = json.access_token || '';
    const refresh = json.refresh_token || '';
    const expiresAt = json.expires_at ? json.expires_at * 1000 : Date.now() + 21600 * 1000;
    const hash = new URLSearchParams({
      strava_access:  access,
      strava_refresh: refresh,
      strava_expires: String(expiresAt),
    }).toString();
    res.writeHead(302, { Location: '/marathon.html#' + hash });
    res.end();
  } catch (e) {
    res.status(500).send('Unexpected error: ' + (e && e.message ? e.message : String(e)));
  }
}
