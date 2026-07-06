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

const CLAUDE_SYSTEM = `You are a career advisor analyzing job search results for a student seeking opportunities.
Given a list of Google search results and the student's resume/background, your task is:
1. Identify which results are actual opportunities (positions, programs, labs, postings) — skip news articles, general info pages, etc.
2. For each real opportunity, extract: company/institution, role title, application URL, any visible recruiter or contact info, and how to apply.
3. Score each for resume fit (0-10) based on the student's background.
4. Draft a concise, personalized outreach email for each (3 short paragraphs max).
5. Return the top 6 opportunities sorted by fit score.

Return ONLY a valid JSON object in this exact format (no markdown):
{
  "opportunities": [
    {
      "id": "opp_1",
      "title": "Role title",
      "company": "Company or institution name",
      "description": "What the role is (2-3 sentences from the search result)",
      "url": "https://...",
      "recruiter": "Name or email if visible, else empty string",
      "howToApply": "Brief instructions (portal link, email address, etc.)",
      "matchScore": 8,
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

  // Build targeted search queries
  const year = new Date().getFullYear();
  const queries = [];
  if (type === 'research') {
    const uni = university || 'top universities';
    queries.push(`undergraduate research opportunities ${field} ${uni} ${year}`);
    queries.push(`research assistant position ${field} ${uni} application`);
    queries.push(`summer research program ${field} ${uni} students apply`);
  } else {
    const loc = location || 'remote United States';
    queries.push(`${field} internship ${year} apply now ${loc}`);
    queries.push(`${field} summer internship undergraduate ${year} application`);
    queries.push(`${field} internship program students ${year} apply`);
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
