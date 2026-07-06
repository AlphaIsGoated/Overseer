// ============================================================
// POST /api/search-opportunities
//
// Two-phase endpoint:
//
// PHASE 1 — no additionalInfo in body
//   Body: { type, field, university?, location?, resumeContext }
//   Reply: { needsInfo: true, questions: [{id, question, type, options?, placeholder?, reason}] }
//   Claude analyzes the resume + field and asks only for the SPECIFIC extra
//   info it needs to find well-matched opportunities (GPA, year, citizenship,
//   subfield, availability, etc.).
//
// PHASE 2 — additionalInfo present
//   Body: { type, field, university?, location?, resumeContext, additionalInfo:{...} }
//   Reply: { opportunities: [{id, title, company, description, url, recruiter,
//            howToApply, matchScore, matchReason, qualificationNotes, draftEmail}] }
//   Claude generates ONLY opportunities the student is genuinely qualified for,
//   using the full profile (resume + additional info). Match score ≥ 7 required.
//
// Apify search runs as optional background context in Phase 2 only.
// Requires: APIFY_API_TOKEN, ANTHROPIC_API_KEY in Vercel env vars.
// Gated by APP_SECRET.
// ============================================================
import { requireAppSecret, rejectIfTooLarge } from './_lib/security.js';

const APIFY_ACTOR = 'apify~google-search-scraper';

async function runApify(apiToken, queries) {
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${apiToken}&timeout=55&maxItems=20&maxTotalChargeUsd=1`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: queries.join('\n'), resultsPerPage: 6, maxPagesPerQuery: 1 }),
  });
  if (!r.ok) return [];
  const items = await r.json();
  return Array.isArray(items) ? items.filter(i => i.title && i.url) : [];
}

async function callClaude(anthropicKey, system, userPrompt, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: maxTokens, system, messages: [{ role: 'user', content: userPrompt }] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error && data.error.message) || 'Claude error ' + r.status);
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  // Strip markdown code fences if present
  return text.replace(/^```json\s*/m, '').replace(/\s*```$/m, '').trim();
}

// ---- Phase 1: generate the clarifying questions ----
const QUESTIONS_SYSTEM = `You are analyzing a student's internship or research job search.
Based on their resume and the field they're searching in, determine what SPECIFIC additional
information you need to find opportunities they are actually qualified for.

Common things that matter but aren't always in resumes:
- GPA (many programs have hard minimums like 3.0 or 3.5)
- Year in college (some programs target specific years, e.g. REU often targets sophomores/juniors)
- US citizenship or work authorization (required by many government labs, NSF REU, some companies)
- Specific subfield interests within the broad field (e.g. "machine learning" vs "systems" in CS)
- Availability window (some programs have strict dates)
- Whether they can relocate (for in-person positions)

ONLY ask for information that is genuinely missing from the resume AND would meaningfully change
which opportunities are appropriate. Do NOT ask for things already clear from the resume.
Ask at most 4-5 questions. Make them concise and easy to answer.

Return ONLY valid JSON (no markdown):
{
  "questions": [
    {
      "id": "gpa",
      "question": "What is your current GPA?",
      "type": "number",
      "placeholder": "e.g. 3.7",
      "required": true,
      "reason": "Many programs require minimum 3.0-3.5 GPA"
    },
    {
      "id": "year",
      "question": "What year are you in college?",
      "type": "select",
      "options": ["Freshman", "Sophomore", "Junior", "Senior", "Graduate student"],
      "required": true,
      "reason": "Some programs restrict eligibility by year"
    }
  ]
}

Valid types: "text", "number", "select", "boolean"
For boolean, options should be ["Yes", "No"]`;

// ---- Phase 2: generate qualified opportunities ----
const OPPORTUNITIES_SYSTEM = `You are a career advisor finding real internship and research opportunities that match a student's ACTUAL qualifications.

CRITICAL: Only generate opportunities where the student is GENUINELY QUALIFIED based on their complete profile. Be honest and selective:
- If a program requires 3.5 GPA and theirs is 3.2, skip it
- If a program requires US citizenship and they haven't confirmed it, note this
- If they are a freshman and a program targets juniors/seniors, skip it
- Only include opportunities with a realistic chance of success

Generate the requested number of REAL, SPECIFIC opportunities from your training knowledge of the job market:
- Use REAL company and institution names
- Use realistic role titles these organizations actually offer
- Provide real application channels you know about
- For research: include REU programs, specific lab types, national labs, industry research
- For internships: include companies across different sizes that hire at this level

For each opportunity include a "qualificationNotes" field explaining SPECIFICALLY which of
the student's qualifications make them competitive (cite actual skills, experiences, or credentials).

Score fit honestly: 9-10 = exceptional match, 7-8 = strong match, only include 7+.

Return ONLY valid JSON (no markdown):
{
  "opportunities": [
    {
      "id": "opp_1",
      "title": "Specific role title",
      "company": "Real company or institution",
      "description": "What the role is and why it's a strong fit for this student (2-3 sentences)",
      "url": "https://real-careers-page.com/apply",
      "recruiter": "",
      "howToApply": "Specific instructions — portal name, direct link, or email",
      "matchScore": 8,
      "matchReason": "Why this is a strong match overall",
      "qualificationNotes": "Specifically: [skill from resume] matches [requirement]; [experience] is directly relevant to [aspect of role]",
      "draftEmail": "Subject: ...\\n\\nDear Hiring Team,\\n\\n[personalized body referencing specific qualifications]\\n\\nBest,\\n[Student Name]"
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

  const type         = (body && body.type)         || 'internship';
  const field        = (body && body.field)        || '';
  const university   = (body && body.university)   || '';
  const location     = (body && body.location)     || '';
  const resumeCtx    = (body && body.resumeContext)|| '';
  const addInfo      = (body && body.additionalInfo);  // undefined in Phase 1
  const count        = Math.min(20, Math.max(1, parseInt(body && body.count, 10) || 5));

  if (!field) return res.status(400).json({ error: 'field is required' });
  if (rejectIfTooLarge(resumeCtx, 10000, res, 'resume context')) return;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // ================================================================
  // PHASE 1: return clarifying questions (no additionalInfo yet)
  // ================================================================
  if (addInfo === undefined || addInfo === null) {
    const prompt = `Search type: ${type === 'research' ? 'Research position' : 'Internship'}
Field: ${field}
${university ? 'Target university/institution: ' + university : ''}
${location ? 'Location: ' + location : ''}

Student resume/background:
${resumeCtx || '(No resume provided yet)'}

What additional information do you need to find opportunities this student is actually qualified for?`;

    try {
      const text = await callClaude(anthropicKey, QUESTIONS_SYSTEM, prompt, 1000);
      const parsed = JSON.parse(text);
      return res.status(200).json({ needsInfo: true, questions: parsed.questions || [] });
    } catch (e) {
      // If Claude fails to parse, return a sensible default set of questions
      return res.status(200).json({
        needsInfo: true,
        questions: [
          { id: 'gpa', question: 'What is your current GPA?', type: 'number', placeholder: 'e.g. 3.7', required: true, reason: 'Many programs have GPA minimums' },
          { id: 'year', question: 'What year are you in college?', type: 'select', options: ['Freshman','Sophomore','Junior','Senior','Graduate student'], required: true, reason: 'Some programs restrict by year' },
          { id: 'citizen', question: 'Are you a US citizen or permanent resident?', type: 'boolean', options: ['Yes','No'], required: false, reason: 'Required for some federal programs' },
          { id: 'availability', question: 'When are you available? (e.g. "May-Aug 2026")', type: 'text', placeholder: 'e.g. May-August 2026', required: false, reason: 'Programs have specific date windows' },
        ]
      });
    }
  }

  // ================================================================
  // PHASE 2: generate qualified opportunities with full profile
  // ================================================================
  const apifyToken = process.env.APIFY_API_TOKEN;

  // Build a complete profile string from resume + answers
  const addInfoStr = Object.entries(addInfo || {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const fullProfile = `${resumeCtx || 'Strong undergraduate student in ' + field}

Additional profile information:
${addInfoStr || '(none provided)'}`;

  // Apify search runs opportunistically for real URL context
  let searchContext = '';
  if (apifyToken) {
    const queries = type === 'research'
      ? [`${field} research internship ${university || ''} apply ${new Date().getFullYear()}`, `${field} REU undergraduate research program`]
      : [`${field} internship ${new Date().getFullYear()} ${location || ''} careers apply`, `${field} summer internship program undergraduate`];
    try {
      const results = await runApify(apifyToken, queries);
      if (results.length > 0) {
        searchContext = '\n\nLive search results for real URLs (use where relevant):\n'
          + results.slice(0, 12).map((r, i) => `[${i+1}] ${r.title}\n${r.url}\n${(r.description || '').slice(0, 180)}`).join('\n\n');
      }
    } catch (e) { /* proceed without */ }
  }

  const prompt = `Find exactly ${count} ${type === 'research' ? 'research position' : 'internship'} opportunities in: ${field}
${university ? 'Prioritize opportunities at/near: ' + university : ''}
${location ? 'Location preference: ' + location : ''}

Complete student profile:
${fullProfile}
${searchContext}

Generate EXACTLY ${count} opportunities (no more, no fewer).`;

  try {
    const text = await callClaude(anthropicKey, OPPORTUNITIES_SYSTEM, prompt, 4096);
    const parsed = JSON.parse(text);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: 'AI processing failed: ' + e.message });
  }
}
