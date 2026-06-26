// ============================================================
// POST /api/nova
// Body: { messages: [{ role, content }], finance: {...} }
// Reply: { text }
// Nova is the finance dashboard's money coach. The Anthropic key
// stays server-side — the browser never sees it.
//
// Gated by APP_SECRET (see api/_security.js) if configured, and capped
// to reasonable payload sizes regardless — this endpoint spends real
// money per call, so it's deliberately not left wide open.
// ============================================================
import { requireAppSecret, rejectIfTooLarge } from './_security.js';
const SYSTEM_PROMPT =
  "You are Nova, the built-in money coach for a personal net-worth dashboard. "
  + "A JSON snapshot of the user's own finances is included below — use it to give "
  + "specific, grounded, practical guidance about their money.\n\n"
  + "How to respond:\n"
  + "- Be warm, direct and concise. Lead with the answer, then a short reason. A few "
  + "sentences or a tight bulleted list — never an essay.\n"
  + "- Ground every claim in their actual data. Quote real figures (with the currency "
  + "shown) instead of speaking in generalities. If the snapshot doesn't contain what "
  + "you'd need, say so and ask one focused follow-up question.\n"
  + "- Net-worth amounts in the snapshot are stored in the dashboard's base currency; "
  + "\"currency\" is the user's display currency. Subscriptions list a cost and billing "
  + "period; orders are incoming purchases; wishlist items are things they're saving for.\n"
  + "- You give general financial education and guidance, not regulated investment, tax "
  + "or legal advice. For big or irreversible money decisions, remind them to confirm "
  + "with a qualified professional.\n"
  + "- Never invent balances, holdings or transactions that aren't in the snapshot.\n"
  + "- Reply with your final answer only — no internal reasoning, no \"Based on...\" preamble.\n\n"
  + "Finance snapshot (JSON):\n";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const messages = Array.isArray(body && body.messages) ? body.messages : [];
  const finance = (body && body.finance) || {};
  if (!messages.length) return res.status(400).json({ error: 'messages required' });
  if (messages.length > 60) return res.status(400).json({ error: 'too many messages' });
  if (rejectIfTooLarge(messages, 100000, res, 'messages')) return;
  if (rejectIfTooLarge(finance, 200000, res, 'finance snapshot')) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        system: SYSTEM_PROMPT + JSON.stringify(finance),
        messages,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ('Anthropic API error (' + r.status + ')');
      return res.status(500).json({ error: msg });
    }
    const text = (data.content || [])
      .filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim() || '(no response)';
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'fetch error: ' + (e && e.message ? e.message : String(e)) });
  }
}
