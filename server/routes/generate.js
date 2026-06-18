'use strict';

// POST /api/generate — AI marketing copy via Gemini 2.0 Flash (free tier).
// No auth, so guests can try it. Returns headline/tagline/eyebrow/ribbon/caption/hashtags.
//
// @google/genai is ESM; this project is CommonJS, so we load it via dynamic import().
// Model + JSON-mode usage verified against the official Google Gen AI SDK docs:
//   https://googleapis.github.io/js-genai/  ·  https://ai.google.dev/gemini-api/docs

const express = require('express');
const router = express.Router();

const MODEL = 'gemini-2.0-flash';

let _GoogleGenAI = null;
async function loadSDK() {
  if (!_GoogleGenAI) { const m = await import('@google/genai'); _GoogleGenAI = m.GoogleGenAI; }
  return _GoogleGenAI;
}

function getApiKey() {
  const k = (process.env.GEMINI_API_KEY || '').trim();
  if (!k || k === 'paste-your-key-here') return '';
  return k;
}

function buildPrompt(b) {
  const lines = [
    'You are an expert marketing copywriter for local small businesses.',
    'Write punchy, on-brand copy for a printable poster and a matching Instagram post.',
    '',
    `Business name: ${b.businessName || 'the business'}`,
    b.businessType ? `Business type: ${b.businessType}` : '',
    b.campaign ? `Campaign type: ${b.campaign}` : '',
    b.voice ? `Brand voice: ${b.voice}` : '',
    b.location ? `Location: ${b.location}` : '',
    b.prompt ? `What the owner wants to promote (the brief): ${b.prompt}` : '',
  ];
  if (b.siteProfile && typeof b.siteProfile === 'object') {
    const p = b.siteProfile;
    lines.push('', 'Real details from their website (ground the copy in these; do NOT invent facts beyond them):');
    if (p.siteName) lines.push(`- Site name: ${p.siteName}`);
    if (p.title) lines.push(`- Title: ${p.title}`);
    if (p.description) lines.push(`- Description: ${p.description}`);
    if (Array.isArray(p.keywords) && p.keywords.length) lines.push(`- Keywords: ${p.keywords.slice(0, 8).join(', ')}`);
  }
  lines.push(
    '',
    'Return a JSON object with EXACTLY these string fields:',
    '- "headline": 4-7 words, punchy',
    '- "tagline": one sentence that supports the headline',
    '- "eyebrow": a 2-3 word label (e.g. "Summer Special")',
    '- "ribbon": short promo text in caps (e.g. "20% OFF THIS WEEK")',
    '- "caption": a 1-2 sentence Instagram caption',
    '- "hashtags": 5 relevant hashtags as one space-separated string',
    'Do not invent specific prices, dates, discounts, or claims that are not present in the brief or the website details above.',
    'Respond with ONLY the JSON object, no markdown, no preamble.',
  );
  return lines.filter(l => l !== '').join('\n');
}

router.post('/', async (req, res) => {
  const key = getApiKey();
  if (!key) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set. Add your free key to .env to enable AI copy.' });
  }
  const b = req.body || {};
  try {
    const GoogleGenAI = await loadSDK();
    const ai = new GoogleGenAI({ apiKey: key });
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: buildPrompt(b),
      config: { responseMimeType: 'application/json', temperature: 0.9 },
    });
    const text = resp.text;
    let data;
    try { data = JSON.parse(text); } catch { return res.status(500).json({ error: 'AI returned malformed JSON.' }); }
    res.json({
      headline: String(data.headline || '').slice(0, 80),
      tagline:  String(data.tagline  || '').slice(0, 200),
      eyebrow:  String(data.eyebrow  || '').slice(0, 40),
      ribbon:   String(data.ribbon   || '').slice(0, 60),
      caption:  String(data.caption  || '').slice(0, 400),
      hashtags: String(data.hashtags || '').slice(0, 200),
    });
  } catch (e) {
    console.error('generate (copy) error:', e && e.message ? e.message : e);
    res.status(500).json({ error: (e && e.message) || 'AI copy generation failed.' });
  }
});

module.exports = router;
