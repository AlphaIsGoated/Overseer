// ============================================================
// Edge Middleware — password-gates the ENTIRE site (every page and
// every /api/* route) at the network edge, before any HTML or
// function code runs. Free on Vercel's Hobby plan — unlike
// Deployment Protection on production, which requires a paid plan.
//
// Cookie-based (not HTTP Basic Auth): Basic Auth depends on Safari's
// native autofill/Keychain UI, which iOS doesn't reliably extend to
// web apps launched from a home-screen icon — the password just never
// autofills there. A signed session cookie has no such dependency:
// once /api/auth sets it, the browser sends it automatically on
// every later request to this origin, in regular Safari or a
// home-screen-launched standalone web app alike.
//
// /login.html and /api/auth (login+logout combined) are exempted from
// the gate itself, otherwise visiting the login page would be blocked
// by the very check it exists to satisfy.
//
// Setup (REQUIRED):
//   1. Vercel -> Project -> Settings -> Environment Variables
//   2. Add SITE_PASSWORD
//   3. Redeploy
//
// Fails CLOSED (503) if SITE_PASSWORD isn't set, rather than failing
// open — a security fix that's silently inactive until someone
// remembers to configure it isn't a fix.
// ============================================================
import { verifySessionToken, parseCookie, SESSION_COOKIE } from './lib/session.js';

export const config = {
  matcher: '/(.*)',
};

// /api/config only returns intentionally-public values (Supabase URL,
// Strava client ID, feature flags like DASH_APIFY_ENABLED) — no secrets.
// Making it public ensures it loads reliably for all pages including the
// login page itself, and avoids any edge-case auth failures that would
// leave window.DASH_* variables undefined.
const PUBLIC_PATHS = ['/login.html', '/api/auth', '/api/config', '/sw.js', '/manifest.json'];

export default async function middleware(req) {
  const { pathname } = new URL(req.url);
  if (PUBLIC_PATHS.includes(pathname)) return;

  // Vercel Cron jobs are headless server requests — they have no session cookie.
  // Vercel automatically sets CRON_SECRET and sends it as "Authorization: Bearer <secret>"
  // on every cron invocation. Verify it here so cron calls bypass the login gate.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get('authorization') || '';
    if (authHeader === 'Bearer ' + cronSecret) return;
  }

  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return new Response(
      'Site password not configured. Set SITE_PASSWORD in Vercel → Settings → Environment Variables, then redeploy.',
      { status: 503, headers: { 'Content-Type': 'text/plain' } }
    );
  }

  const token = parseCookie(req.headers.get('cookie'), SESSION_COOKIE);
  if (await verifySessionToken(token, password)) return; // valid session — let the request through

  // API/fetch calls can't follow an HTML redirect usefully — fail with
  // a plain 401 so the calling code's own error handling kicks in.
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const loginUrl = new URL('/login.html', req.url);
  loginUrl.searchParams.set('next', pathname + (new URL(req.url).search || ''));
  return Response.redirect(loginUrl, 302);
}
