// ============================================================
// GET /api/integrations/news
// Reply: { world: [{title,link}], us: [...], business: [...] }
// Pulls a few headlines from public RSS feeds (no API key needed,
// unlike most news APIs) — BBC World, NPR National, BBC Business.
// RSS hosts generally don't send CORS headers, so this has to be
// fetched server-side and handed to the browser as plain JSON.
//
// Gated by APP_SECRET (see api/_lib/security.js) if configured. No
// Anthropic cost here — just fetching and lightly parsing public RSS,
// no AI call, so this is the cheapest endpoint in the dashboard.
// ============================================================
import { requireAppSecret } from '../_lib/security.js';

const FEEDS = {
  world: 'http://feeds.bbci.co.uk/news/world/rss.xml',
  us: 'https://feeds.npr.org/1003/rss.xml',
  business: 'http://feeds.bbci.co.uk/news/business/rss.xml',
};
const PER_CATEGORY = 3;

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .trim();
}
function parseItems(xml, limit) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const titleRe = /<title>([\s\S]*?)<\/title>/i;
  const linkRe = /<link>([\s\S]*?)<\/link>/i;
  const matches = xml.match(itemRe) || [];
  for (const block of matches) {
    if (items.length >= limit) break;
    const tMatch = block.match(titleRe);
    const lMatch = block.match(linkRe);
    const title = decodeEntities(tMatch && tMatch[1]);
    const link = decodeEntities(lMatch && lMatch[1]);
    if (title) items.push({ title, link: link || '' });
  }
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-App-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!requireAppSecret(req, res)) return;

  const out = {};
  await Promise.all(Object.entries(FEEDS).map(async ([key, url]) => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OverseerDashboard/1.0)' } });
      if (!r.ok) { out[key] = []; return; }
      const xml = await r.text();
      out[key] = parseItems(xml, PER_CATEGORY);
    } catch (e) {
      out[key] = [];
    }
  }));
  // Cache briefly at the edge — headlines don't need to be fetched fresh
  // on every single page load, just reasonably current.
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
  return res.status(200).json(out);
}
