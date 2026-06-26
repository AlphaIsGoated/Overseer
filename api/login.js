// ============================================================
// POST /api/login
// Body: { password: "..." }
// On success: sets a signed, HttpOnly session cookie and returns 200.
// On failure: 401 with { error }.
//
// This + middleware.js + login.html replace the earlier HTTP Basic
// Auth gate — Basic Auth depends on Safari's native autofill/Keychain
// UI, which iOS doesn't extend to web apps launched from a home-
// screen icon. A plain session cookie has no such dependency: once
// set, it's just sent automatically on every request to this origin,
// in Safari or a home-screen-launched standalone web app alike.
// ============================================================
import { makeSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from '../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const password = process.env.SITE_PASSWORD;
  if (!password) return res.status(503).json({ error: 'SITE_PASSWORD not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const supplied = (body && body.password) || '';
  if (!supplied || supplied !== password) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const token = await makeSessionToken(password);
  res.setHeader('Set-Cookie',
    SESSION_COOKIE + '=' + encodeURIComponent(token) +
    '; Path=/; Max-Age=' + SESSION_MAX_AGE_SEC + '; HttpOnly; Secure; SameSite=Lax'
  );
  return res.status(200).json({ ok: true });
}
