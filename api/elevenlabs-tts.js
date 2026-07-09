// ============================================================
// POST /api/elevenlabs-tts
// Body: { text: "...", voiceId?: "..." }
// Reply: audio/mpeg stream — the TTS audio for the given text,
// suitable for playing directly in an <audio> element via a
// blob URL or ArrayBuffer. The ElevenLabs API key stays
// server-side; the browser sends text, gets audio back.
//
// voiceId defaults to Rachel (21m00Tcm4TlvDq8ikWAM) — one of
// ElevenLabs' original pre-built voices, stable across all plan tiers.
//
// Gated by APP_SECRET (see api/_lib/security.js) if configured.
// ============================================================
import { requireAppSecret, rejectIfTooLarge } from './_lib/security.js';

const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // Rachel — warm, clear, stable

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = (body && body.text) || '';
  const voiceId = (body && body.voiceId) || DEFAULT_VOICE;
  if (!text.trim()) return res.status(400).json({ error: 'text required' });
  if (rejectIfTooLarge(text, 2000, res, 'text')) return;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('[elevenlabs-tts] API error', r.status, errText.slice(0, 500));
      // Always return 400 (not the upstream status) so Vercel doesn't
      // intercept 5xx responses and replace the body with HTML.
      return res.status(400).json({ error: 'ElevenLabs ' + r.status + ': ' + errText.slice(0, 300) });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    const buf = await r.arrayBuffer();
    return res.status(200).end(Buffer.from(buf));
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('[elevenlabs-tts] fetch error', msg);
    return res.status(500).json({ error: 'fetch error: ' + msg });
  }
}
