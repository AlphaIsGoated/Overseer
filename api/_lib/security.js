// ============================================================
// Shared security helpers used across api/ai/* and api/integrations/*.
// Not a route itself — Vercel excludes any file or folder under /api
// whose name starts with "_" (this whole _lib/ folder) from becoming
// a Serverless Function.
// ============================================================

// Require a shared app token on every request, IF the operator has
// configured one (APP_SECRET env var in Vercel). If unset, the
// endpoint stays open — this only protects deployments that opt in.
// See api/config.js for the full threat-model explanation: this is
// not a real secret once it ships to the browser, it just raises the
// bar against drive-by/automated abuse of an exposed LLM proxy.
export function requireAppSecret(req, res) {
  const required = process.env.APP_SECRET;
  if (!required) return true;
  const provided = req.headers['x-app-secret'];
  if (provided !== required) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// Basic abuse/cost guardrails — reject absurdly large payloads before
// they reach Anthropic at all, regardless of whether APP_SECRET is set.
// `value` may be a string or any JSON-serializable value.
export function rejectIfTooLarge(value, maxChars, res, label) {
  const size = typeof value === 'string' ? value.length : JSON.stringify(value == null ? '' : value).length;
  if (size > maxChars) {
    res.status(413).json({ error: (label || 'payload') + ' too large (' + size + ' chars, max ' + maxChars + ')' });
    return true;
  }
  return false;
}
