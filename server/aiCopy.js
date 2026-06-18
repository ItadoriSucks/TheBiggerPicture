'use strict';

// Turns a website "business profile" + campaign brief into poster/social copy.
//
// Hybrid:
//   - aiGenerateCopy(): uses the Anthropic Messages API when an ANTHROPIC_API_KEY
//     is present (in env or server/.env). Strictly grounded — the model is told
//     to use ONLY facts from the provided source and never invent claims.
//     https://platform.claude.com/docs/en/api/messages
//   - localCopy(): a zero-dependency heuristic fallback that weaves the site's
//     own title/description/headings into the copy. Always available, fully local.

const fs = require('node:fs');
const path = require('node:path');

const MODEL = 'claude-haiku-4-5';          // fast, inexpensive — ideal for short copy
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

let _keyChecked = false;
let _key = '';
function getApiKey() {
  if (_keyChecked) return _key;
  _keyChecked = true;
  if (process.env.ANTHROPIC_API_KEY) { _key = process.env.ANTHROPIC_API_KEY.trim(); return _key; }
  const envPath = path.join(__dirname, '.env');
  // Prefer Node's built-in loader when available (Node >= 20.12 / 21.7).
  try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath); } catch { /* no .env */ }
  if (process.env.ANTHROPIC_API_KEY) { _key = process.env.ANTHROPIC_API_KEY.trim(); return _key; }
  // Manual fallback parse.
  try {
    const txt = fs.readFileSync(envPath, 'utf8');
    const m = txt.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/m);
    if (m) _key = m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* no .env file — local mode */ }
  return _key;
}

// Exposed so a route can report which mode is active.
function aiAvailable() { return !!getApiKey(); }

function profileText(p) {
  if (!p) return '(no website content available)';
  const lines = [];
  if (p.siteName)    lines.push(`Business / site name: ${p.siteName}`);
  if (p.title)       lines.push(`Page title: ${p.title}`);
  if (p.description) lines.push(`Description: ${p.description}`);
  if (p.headings && p.headings.length) lines.push(`Section headings: ${p.headings.join(' | ')}`);
  if (p.keywords && p.keywords.length) lines.push(`Recurring terms: ${p.keywords.join(', ')}`);
  if (p.textSnippet) lines.push(`Page text excerpt: ${p.textSnippet.slice(0, 900)}`);
  return lines.join('\n');
}

function buildUserPrompt(brief) {
  const p = brief.profile;
  return [
    `Campaign type: ${brief.purpose || 'general'}`,
    brief.businessName ? `Business name: ${brief.businessName}` : '',
    brief.city ? `Location: ${brief.city}` : '',
    brief.voice ? `Brand voice: ${brief.voice}` : '',
    brief.prompt ? `What the owner wants to promote: ${brief.prompt}` : '',
    '',
    'WEBSITE CONTENT (the only source of truth about this business):',
    profileText(p),
    '',
    'Write the copy now as a single JSON object.',
  ].filter(s => s !== undefined).join('\n');
}

const SYSTEM = [
  'You are an expert marketing copywriter for local small businesses.',
  'You write short, punchy copy for a printable poster and matching social caption.',
  'STRICT RULES:',
  '- Use ONLY facts found in the provided website content and the campaign brief.',
  '- Never invent prices, dates, discounts, awards, claims, or offerings not present in the source.',
  "- If a specific detail isn't in the source, stay general rather than fabricating.",
  '- Match the requested brand voice; keep it natural, not hypey.',
  'Respond with ONLY a JSON object, no preamble, of the exact shape:',
  '{"headline": string, "subhead": string, "eyebrow": string, "caption": string}',
  'Length limits: headline <= 22 characters; eyebrow <= 28 characters; subhead <= 80 characters; caption = 1-2 short sentences.',
].join('\n');

function extractJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

async function aiGenerateCopy(brief) {
  const key = getApiKey();
  if (!key) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildUserPrompt(brief) }],
      }),
    });
    if (!res.ok) { console.warn('aiCopy: Messages API returned', res.status); return null; }
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const json = extractJson(text);
    if (!json) return null;
    return {
      headline: String(json.headline || '').trim().slice(0, 40),
      subhead:  String(json.subhead  || '').trim().slice(0, 140),
      eyebrow:  String(json.eyebrow  || '').trim().slice(0, 40),
      caption:  String(json.caption  || '').trim().slice(0, 300),
      themeColor: (brief.profile && brief.profile.themeColor) || '',
      source: 'ai',
    };
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('aiCopy error:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Local, dependency-free fallback: weave real site text into the copy ----
function firstSentence(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^.*?[.!?](?:\s|$)/);
  return (m ? m[0] : t).trim().slice(0, max);
}

function localCopy(brief) {
  const p = brief.profile || {};
  const biz = brief.businessName || p.siteName || '';
  const desc = (p.description || '').trim();
  const tagline = firstSentence(desc, 80) || (p.headings && p.headings[0]) || '';
  const eyebrow = (p.siteName || biz || '').slice(0, 28);
  const subhead = (tagline || desc).slice(0, 80);
  const city = brief.city ? ` in ${String(brief.city).split(',')[0]}` : '';
  const caption = ([biz ? `${biz}${city}` : '', firstSentence(desc, 120)]
    .filter(Boolean).join(' — ') || `Visit ${biz}${city}.`).slice(0, 240);
  return {
    headline: '',            // leave the campaign headline to the prompt-driven template
    subhead,
    eyebrow,
    caption,
    themeColor: p.themeColor || '',
    source: 'local',
  };
}

module.exports = { aiGenerateCopy, localCopy, aiAvailable };
