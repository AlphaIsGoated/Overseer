// ============================================================
// POST /api/ai-chat
// Body: { system: "...", messages: [{role, content}] }
// Reply: { text }
// Generic Anthropic chat proxy shared by Nova (nova-lite.html and
// the gym coach widget) — the API key stays server-side in
// ANTHROPIC_API_KEY and is never sent to the browser, so every
// device hits the same key automatically with nothing to paste.
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const messages = Array.isArray(body && body.messages) ? body.messages : [];
  const system = (body && body.system) || '';
  if (!messages.length) return res.status(400).json({ error: 'messages required' });

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
        system,
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
