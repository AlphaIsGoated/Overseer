// ============================================================
// POST /api/auth   { password }           -> log in, sets session cookie
// POST /api/auth   { logout: true }       -> log out, clears session cookie
// Combined login+logout into one file to stay under Vercel Hobby's
// 12-Serverless-Function-per-deployment cap.
//
// This + middleware.js + login.html implement the cookie-based site
// gate — see lib/session.js for the stateless token design.
// ============================================================
import { makeSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from '../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  if (body && body.logout) {
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
    return res.status(200).json({ ok: true });
  }

  const password = process.env.SITE_PASSWORD;
  if (!password) return res.status(503).json({ error: 'SITE_PASSWORD not configured' });

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
