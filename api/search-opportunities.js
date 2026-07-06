// ============================================================
// POST /api/search-opportunities
// Body: { type: 'internship'|'research', field, university?, location?,
//         resumeContext }
// Reply: { opportunities: [{id, title, company, description, url, recruiter,
//           howToApply, matchScore, draftEmail}] }
//
// Pipeline:
//   1. Builds 3-4 targeted Google search queries from the user's field,
//      type, and optional university.
//   2. Runs Apify's google-search-scraper actor to get real results.
//   3. Passes the results + resume context to Claude, which:
//      - Ranks each result by resume fit (0-10)
//      - Extracts structured info (company, title, apply link, recruiter)
//      - Drafts a personalized outreach email per opportunity
//
// Requires: APIFY_API_TOKEN, ANTHROPIC_API_KEY in Vercel env vars.
// Gated by APP_SECRET.
// ============================================================
import { requireAppSecret, rejectIfTooLarge } from './_lib/security.js';

// Apify API uses ~ to separate owner/name in the URL path (not /)
// apify/google-search-scraper in the UI = apify~google-search-scraper in the API
const APIFY_ACTOR = 'apify~google-search-scraper';

async function runApify(apiToken, queries) {
  // maxTotalChargeUsd caps what Apify can charge per run — must be ≥ $0.50.
  // Actual cost per search is typically a few cents; the cap just prevents surprises.
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${apiToken}&timeout=55&maxItems=30&maxTotalChargeUsd=1`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queries: queries.join('\n'),
      resultsPerPage: 8,
      maxPagesPerQuery: 1,
      outputEncodingOverride: 'utf-8',
    }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Apify error ' + r.status + ': ' + t.slice(0, 200)); }
  const items = await r.json();
  // Each item has: title, url, description (organic results)
  return Array.isArray(items) ? items.filter(i => i.title && i.url) : [];
}

// Claude generates opportunities from its own training knowledge — this is the
// primary mechanism. Google search results are supplementary context only.
// Claude knows real companies, real programs, real application channels in any
// field, and always returns results regardless of what scrapers found.
const CLAUDE_SYSTEM = `You are a career advisor who helps students find real internship and research opportunities.

Your PRIMARY job is to generate 6 SPECIFIC, REAL opportunities from your training knowledge of the job market in the requested field. Do NOT wait for or rely on search results — generate opportunities based on what you know about companies and programs that actively hire in this field.

For each opportunity:
- Use REAL company or institution names that actually exist and hire in this field
- Use realistic role titles these organizations actually offer
- Provide real application channels (actual career page URLs you know about, real program websites)
- For research: include real REU programs, specific universities' lab groups, national labs
- For internships: include large companies, startups, and mid-size companies across different segments

Then, if any search results are provided at the end, you may use any useful URLs from them as the url field for relevant opportunities — but do not let the quality of search results limit how many opportunities you generate.

Return ONLY valid JSON (no markdown code blocks):
{
  "opportunities": [
    {
      "id": "opp_1",
      "title": "Specific role title",
      "company": "Real company or institution name",
      "description": "What the role is and why it is a good opportunity (2-3 sentences)",
      "url": "https://real-careers-page.com/apply",
      "recruiter": "",
      "howToApply": "How to apply (portal name, direct link, or email)",
      "matchScore": 8,
      "matchReason": "Why this specifically matches the student's background",
      "draftEmail": "Subject: ...\\n\\nDear Hiring Team,\\n\\n[body]\\n\\nBest,\\n[Student Name]"
    }
  ]
}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const type = (body && body.type) || 'internship';
  const field = (body && body.field) || '';
  const university = (body && body.university) || '';
  const location = (body && body.location) || '';
  const resumeContext = (body && body.resumeContext) || '';
  if (!field) return res.status(400).json({ error: 'field is required' });
  if (rejectIfTooLarge(resumeContext, 10000, res, 'resume context')) return;

  const apifyToken = process.env.APIFY_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!apifyToken) return res.status(500).json({ error: 'APIFY_API_TOKEN not configured — add it to Vercel env vars' });
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // Apify search runs opportunistically — if it finds good URLs we pass them
  // to Claude as context. If it fails or returns nothing, Claude still generates
  // real opportunities from its training knowledge. Never block on Apify results.
  const year = new Date().getFullYear();
  const queries = type === 'research'
    ? [
        `${field} internship research ${university || ''} apply ${year}`,
        `${field} REU NSF undergraduate research ${year}`,
      ]
    : [
        `${field} internship ${year} ${location || ''} apply careers`,
        `${field} summer internship program undergraduate ${year}`,
      ];

  let searchContext = '';
  try {
    const searchResults = await runApify(apifyToken, queries);
    if (searchResults.length > 0) {
      searchContext = '\n\nHere are some live search results — use any relevant URLs for the url field of your opportunities:\n'
        + searchResults.slice(0, 16).map((r, i) =>
            `[${i+1}] ${r.title}\n${r.url}\n${(r.description || '').slice(0, 200)}`
          ).join('\n\n');
    }
  } catch (e) {
    // Apify failed — proceed with Claude-knowledge-only approach (still works great)
    searchContext = '';
  }

  const userPrompt = `Generate 6 real, specific ${type === 'research' ? 'research position' : 'internship'} opportunities in ${field}.
${university ? 'Prioritize opportunities at or near: ' + university : ''}
${location ? 'Location preference: ' + location : ''}

Student background:
${resumeContext || 'Strong undergraduate student in ' + field + '. Use general criteria for a competitive candidate.'}
${searchContext}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-8', max_tokens: 4096,
        system: CLAUDE_SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(500).json({ error: (data.error && data.error.message) || 'Claude error ' + r.status });
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    try {
      const parsed = JSON.parse(text);
      return res.status(200).json(parsed);
    } catch (e) {
      // Claude sometimes wraps in markdown — strip it
      const stripped = text.replace(/^```json\s*|\s*```$/g, '').trim();
      return res.status(200).json(JSON.parse(stripped));
    }
  } catch (e) {
    return res.status(500).json({ error: 'AI processing failed: ' + e.message });
  }
}
