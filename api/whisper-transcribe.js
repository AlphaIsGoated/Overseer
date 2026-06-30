// ============================================================
// POST /api/whisper-transcribe
// Body: { audio: "<base64>", mimeType: "audio/webm" }
// Reply: { text: "transcribed text" }
//
// Receives browser-recorded audio (MediaRecorder output), sends it
// to OpenAI's Whisper API (whisper-1 model), and returns the
// transcription. Much more accurate than the browser's native
// SpeechRecognition API, and works on iOS Safari which doesn't
// support SpeechRecognition at all.
//
// Cost: ~$0.006/minute of audio — cheap for short voice inputs.
//
// Falls back gracefully: if OPENAI_API_KEY isn't set, the client
// stays on browser SpeechRecognition (or no mic if unsupported).
// The client checks window.DASH_OPENAI_ENABLED before calling here.
//
// Gated by APP_SECRET (see api/_lib/security.js).
// ============================================================
import { requireAppSecret, rejectIfTooLarge } from './_lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const audio = body && body.audio;
  const mimeType = (body && body.mimeType) || 'audio/webm';
  if (!audio) return res.status(400).json({ error: 'audio required' });
  // ~4MB base64 ≈ ~3MB raw audio ≈ ~3 minutes — generous for a voice query
  if (rejectIfTooLarge(audio, 4000000, res, 'audio')) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const buf = Buffer.from(audio, 'base64');
    // Determine file extension for Whisper — it uses this to know the codec.
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mimeType }), 'audio.' + ext);
    form.append('model', 'whisper-1');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Whisper error: ' + errText });
    }
    const data = await r.json();
    return res.status(200).json({ text: data.text || '' });
  } catch (e) {
    return res.status(500).json({ error: 'fetch error: ' + (e && e.message ? e.message : String(e)) });
  }
}
