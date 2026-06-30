// ============================================================
// POST /api/elevenlabs-tts
// Body: { text: "...", voiceId?: "..." }
// Reply: audio/mpeg stream — the TTS audio for the given text,
// suitable for playing directly in an <audio> element via a
// blob URL or ArrayBuffer. The ElevenLabs API key stays
// server-side; the browser sends text, gets audio back.
//
// voiceId defaults to the "Adam" pre-built voice (deep, clear,
// JARVIS-adjacent). Override with any valid ElevenLabs voice ID.
//
// Gated by APP_SECRET (see api/_lib/security.js) if configured.
// ============================================================
import { requireAppSecret, rejectIfTooLarge } from '../_lib/security.js';

const DEFAULT_VOICE = 'pNInz6obpgDQGcFmaJgB'; // Adam — clear, deep, neutral

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
  if (rejectIfTooLarge(text, 5000, res, 'text')) return;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'ElevenLabs error: ' + errText });
    }
    // Pipe the audio stream directly to the client.
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    const buf = await r.arrayBuffer();
    return res.status(200).end(Buffer.from(buf));
  } catch (e) {
    return res.status(500).json({ error: 'fetch error: ' + (e && e.message ? e.message : String(e)) });
  }
}
