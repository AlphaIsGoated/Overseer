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

const CLAUDE_SYSTEM = `You are a career advisor extracting internship and research opportunities from Google search results.

IMPORTANT: Be INCLUSIVE, not exclusive. If a URL looks like it COULD lead to a job listing, company careers page, lab opening, or research program — include it. It is far better to include something uncertain than to miss a real opportunity.

Include any result where the URL or title contains words like: jobs, careers, intern, research, position, apply, opening, lab, professor, program, fellowship, hire, recruiting, opportunity.

For each result you include:
- Use the title from the search result as the role title (make it specific if possible)
- Use the domain name as the company if nothing else is available
- Set howToApply to "Visit the link to apply" if no other info is visible
- Set recruiter to empty string if not visible
- Score fit 5-8 by default unless clearly irrelevant to the field
- Write a short 3-paragraph outreach email

Only skip a result if it is CLEARLY a news article, Wikipedia page, Reddit post, or generic career advice article with no specific opening.

Return ONLY valid JSON (no markdown code blocks):
{
  "opportunities": [
    {
      "id": "opp_1",
      "title": "Role title",
      "company": "Company or institution name",
      "description": "What the role is (2-3 sentences from the search result)",
      "url": "https://...",
      "recruiter": "",
      "howToApply": "Visit the link to apply",
      "matchScore": 7,
      "matchReason": "Why this fits the student's background",
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

  // Build targeted queries that hit actual job boards and career pages,
  // not generic career-advice articles. site: operators force results
  // from domains that host real postings.
  const year = new Date().getFullYear();
  const queries = [];
  if (type === 'research') {
    const uni = university || '';
    const uniStr = uni ? ` ${uni}` : '';
    queries.push(`site:linkedin.com/jobs "${field}" research intern${uniStr}`);
    queries.push(`${field} undergraduate research position${uniStr} apply ${year} site:edu OR site:org`);
    queries.push(`"research assistant" "${field}"${uniStr} opening ${year}`);
    queries.push(`${field} REU program ${year} apply site:nsf.gov OR site:edu`);
  } else {
    const loc = location ? ` ${location}` : '';
    queries.push(`site:linkedin.com/jobs "${field}" intern${loc}`);
    queries.push(`site:indeed.com "${field}" internship${loc} ${year}`);
    queries.push(`"${field}" internship ${year} apply site:careers OR site:jobs OR site:lever.co OR site:greenhouse.io`);
    queries.push(`${field} summer internship undergraduate ${year}${loc} -reddit -quora -glassdoor`);
  }

  let searchResults = [];
  try {
    searchResults = await runApify(apifyToken, queries);
  } catch (e) {
    return res.status(502).json({ error: 'Search failed: ' + e.message });
  }
  if (!searchResults.length) return res.status(200).json({ opportunities: [], message: 'No search results found — try broadening your search terms.' });

  // Summarize results for Claude (keep under token limits)
  const resultsText = searchResults.slice(0, 24).map((r, i) =>
    `[${i+1}] Title: ${r.title}\nURL: ${r.url}\nSnippet: ${(r.description || '').slice(0, 300)}`
  ).join('\n\n');

  const userPrompt = `Type: ${type === 'research' ? 'Research position' : 'Internship'}
Field: ${field}
${university ? 'Target university/institution: ' + university : ''}
${location ? 'Location preference: ' + location : ''}

Student background:
${resumeContext || '(No resume context provided — use general criteria for a strong undergraduate student)'}

Search results to analyze:
${resultsText}`;

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
