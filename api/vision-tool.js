// ============================================================
// POST /api/vision-tool
// Body: { system, tool: <Anthropic tool schema>, image: "<base64>", mediaType }
// Reply: the named tool's parsed input object
// Generic forced-tool-use vision proxy — reads an image and returns
// structured JSON via Claude's tool use, server-side. The Anthropic
// key stays in ANTHROPIC_API_KEY and is never sent to the browser.
//
// Gated by APP_SECRET (see api/_security.js) if configured, and capped
// to reasonable payload sizes regardless — this endpoint spends real
// money per call, so it's deliberately not left wide open.
// ============================================================
import { requireAppSecret, rejectIfTooLarge } from './_security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const tool = body && body.tool;
  const image = body && body.image;
  const mediaType = (body && body.mediaType) || 'image/jpeg';
  const system = (body && body.system) || '';
  const prompt = (body && body.prompt) || 'Read this image and record its figures.';
  if (!image) return res.status(400).json({ error: 'image required' });
  if (!tool || !tool.name) return res.status(400).json({ error: 'tool schema required' });
  // Base64 inflates size ~33%; 9M chars ≈ 6.75MB raw, comfortably above
  // what the client-side downscale-to-1568px step ever produces (~1-2MB).
  if (rejectIfTooLarge(image, 9000000, res, 'image')) return;
  if (rejectIfTooLarge(tool, 20000, res, 'tool schema')) return;
  if (rejectIfTooLarge(system, 50000, res, 'system prompt')) return;

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
        max_tokens: 8192,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: prompt }
          ]
        }]
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ('Anthropic API error (' + r.status + ')');
      return res.status(500).json({ error: msg });
    }
    if (data.stop_reason === 'max_tokens') {
      return res.status(502).json({ error: 'Response was too large and got cut off (max_tokens reached) — try a smaller/simpler image.' });
    }
    const block = (data.content || []).find((b) => b && b.type === 'tool_use' && b.name === tool.name);
    if (!block || !block.input) return res.status(502).json({ error: 'could not read that image' });
    return res.status(200).json(block.input);
  } catch (e) {
    return res.status(500).json({ error: 'fetch error: ' + (e && e.message ? e.message : String(e)) });
  }
}
