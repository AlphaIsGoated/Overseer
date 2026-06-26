// ============================================================
// Edge Middleware — password-gates the ENTIRE site (every page and
// every /api/* route) at the network edge, before any HTML or
// function code runs. This is free on Vercel's Hobby plan — unlike
// Deployment Protection on production, which requires a paid plan.
//
// Uses plain HTTP Basic Auth (the browser's native login prompt), so
// there's no custom login page to build or maintain. Once a browser
// enters the right credentials for this origin, it caches them and
// sends them automatically on every later request to the same
// origin — including the app's own fetch() calls to /api/*, and the
// browser being redirected back here after a WHOOP/Strava OAuth flow.
//
// Setup (REQUIRED — see below):
//   1. Vercel → Project → Settings → Environment Variables
//   2. Add SITE_PASSWORD (required) and optionally SITE_USER
//      (defaults to "admin" if not set)
//   3. Redeploy
//
// IMPORTANT: until SITE_PASSWORD is set, this fails CLOSED (blocks
// everything with a 503) rather than failing open — a security fix
// that's silently inactive until someone remembers to configure it
// isn't a fix. Set the env var right after this deploys.
// ============================================================

export const config = {
  matcher: '/(.*)',
};

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export default function middleware(req) {
  const password = process.env.SITE_PASSWORD;
  const username = process.env.SITE_USER || 'admin';

  if (!password) {
    return new Response(
      'Site password not configured. Set SITE_PASSWORD in Vercel → Settings → Environment Variables, then redeploy.',
      { status: 503, headers: { 'Content-Type': 'text/plain' } }
    );
  }

  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(':');
      const u = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const p = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (timingSafeEqual(u, username) && timingSafeEqual(p, password)) {
        return; // credentials match — let the request through
      }
    } catch (e) {
      // malformed header — fall through to the 401 below
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Overseer", charset="UTF-8"' },
  });
}
