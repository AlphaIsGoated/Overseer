// ============================================================
// Shared session-token helpers for the cookie-based login gate.
// Used by middleware.js (Edge Runtime) AND api/login.js / api/logout.js
// (Node serverless runtime) — built only on Web-standard APIs
// (crypto.subtle, TextEncoder), which both runtimes support, so the
// exact same code works unmodified in both places.
//
// Stateless design: the token embeds its own issue timestamp and a
// SHA-256 signature over "timestamp:SITE_PASSWORD". Verifying just
// recomputes that signature — no database/session store needed. A
// side effect: changing SITE_PASSWORD instantly invalidates every
// existing session, which is a reasonable way to "log everyone out".
// ============================================================
export const SESSION_COOKIE = 'overseer_session';
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 180; // 180 days

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function makeSessionToken(secret) {
  const ts = Date.now().toString(36);
  const sig = await sha256Hex(ts + ':' + secret);
  return ts + '.' + sig;
}

export async function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [ts, sig] = token.split('.');
  const tsNum = parseInt(ts, 36);
  if (!tsNum || Number.isNaN(tsNum)) return false;
  if (Date.now() - tsNum > SESSION_MAX_AGE_SEC * 1000) return false;
  const expected = await sha256Hex(ts + ':' + secret);
  return timingSafeEqual(expected, sig);
}

export function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}
