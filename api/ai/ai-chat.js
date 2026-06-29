// ============================================================
// POST /api/ai/ai-chat
// Body: { system: "...", messages: [{role, content}], tool?: <schema> }
// Reply: { text } — or, when `tool` is provided, that tool's parsed
// input object directly (forced tool-use, for structured extraction
// from plain text — e.g. reading a training plan out of a markdown
// file, the text equivalent of /api/ai/vision-tool for images).
// Generic Anthropic chat proxy shared by Nova (nova-lite.html, the
// gym coach widget) and the marathon module's text-plan importer —
// the API key stays server-side in ANTHROPIC_API_KEY and is never
// sent to the browser, so every device hits the same key automatically
// with nothing to paste.
//
// Gated by APP_SECRET (see api/_lib/security.js) if configured, and capped
// to reasonable payload sizes regardless — this endpoint spends real
// money per call, so it's deliberately not left wide open.
// ============================================================
import { requireAppSecret, rejectIfTooLarge, setUsageHeaders } from '../_lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const messages = Array.isArray(body && body.messages) ? body.messages : [];
  const system = (body && body.system) || '';
  const tool = body && body.tool;
  if (!messages.length) return res.status(400).json({ error: 'messages required' });
  if (messages.length > 60) return res.status(400).json({ error: 'too many messages' });
  if (rejectIfTooLarge(messages, 400000, res, 'messages')) return;
  if (rejectIfTooLarge(system, 50000, res, 'system prompt')) return;
  if (tool && rejectIfTooLarge(tool, 20000, res, 'tool schema')) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const payload = {
      model: 'claude-opus-4-8',
      max_tokens: tool ? 8192 : 1024,
      system,
      messages,
    };
    if (tool && tool.name) {
      payload.tools = [tool];
      payload.tool_choice = { type: 'tool', name: tool.name };
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ('Anthropic API error (' + r.status + ')');
      return res.status(500).json({ error: msg });
    }
    setUsageHeaders(res, data, payload.model);
    if (tool && tool.name) {
      if (data.stop_reason === 'max_tokens') {
        return res.status(502).json({ error: 'Response was too large and got cut off (max_tokens reached) — try a smaller document or fewer weeks.' });
      }
      const block = (data.content || []).find((b) => b && b.type === 'tool_use' && b.name === tool.name);
      if (!block || !block.input) return res.status(502).json({ error: 'could not extract structured data' });
      return res.status(200).json(block.input);
    }
    const text = (data.content || [])
      .filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim() || '(no response)';
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'fetch error: ' + (e && e.message ? e.message : String(e)) });
  }
}
