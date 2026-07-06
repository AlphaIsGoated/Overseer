// ============================================================
// POST /api/extract-resume-text
//
// Accepts a base64-encoded PDF (or plain text) and returns the
// extracted resume text using Claude's native document parsing.
// Used by internship.html to let users upload a PDF resume
// instead of pasting text.
//
// Body: { pdfBase64: string, filename?: string }
// Reply: { text: string }
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

  const pdfBase64 = (body && body.pdfBase64) || '';
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 is required' });
  if (pdfBase64.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'PDF too large (max 5 MB)' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: 'Extract the full text content from this resume PDF. Return ONLY the extracted text — no comments, no JSON, no markdown formatting. Preserve the natural structure: name, contact info, education, experience, skills, etc. If this is not a resume, still extract all readable text.',
        messages: [{
          role: 'user',
          content: [{
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          }, {
            type: 'text',
            text: 'Extract all text from this resume.',
          }],
        }],
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data.error && data.error.message) || 'Claude error ' + r.status);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
