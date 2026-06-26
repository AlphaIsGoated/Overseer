// ============================================================
// POST /api/logout
// Clears the session cookie set by /api/login.
// ============================================================
import { SESSION_COOKIE } from '../lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', SESSION_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  return res.status(200).json({ ok: true });
}
