// ============================================================
// POST /api/notes-organize
//
// Uses Claude (Haiku) to group a list of notes into suggested folders
// and return assignment mappings.
//
// Body: { notes: string }   — compact note list (index: title — snippet)
// Reply: { folders: [{name, color}], assignments: {index: folderName} }
//
// Gated by APP_SECRET.
// ============================================================
import { requireAppSecret } from './_lib/security.js';

const SYSTEM = `You are organizing a user's personal notes into folders.
Given a numbered list of notes (title + snippet), create 3-8 meaningful folder categories that cover the themes present, then assign each note index to the most fitting folder.

Return ONLY valid JSON (no markdown, no explanation):
{
  "folders": [
    {"name": "Work & Career", "color": "#7DD3FC"},
    {"name": "Personal", "color": "#6BE3A4"}
  ],
  "assignments": {
    "0": "Work & Career",
    "1": "Personal"
  }
}

Available colors: #6BE3A4 (mint), #7DD3FC (sky), #F2C063 (amber), #FF8A8A (coral), #C9B8FF (lavender), #67E8F9 (cyan), #FCA5A5 (pink), #86EFAC (green).
Rules:
- Folder names should be short (2-4 words)
- Every note index must appear in assignments
- Assign notes based on dominant theme/topic
- Create a "Miscellaneous" or "General" folder for notes that don't fit elsewhere
- Do not create more than 8 folders`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const notes = (body && body.notes) || '';
  if (!notes.trim()) return res.status(400).json({ error: 'notes is required' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: 'user', content: 'Notes to organize:\n' + notes }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data.error && data.error.message) || 'Claude error ' + r.status);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      .replace(/^```json\s*/m, '').replace(/\s*```$/m, '').trim();
    const parsed = JSON.parse(text);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
