'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { analyzeSite } = require('../siteAnalyzer');
const dna = require('../dnaClient');

const router = express.Router();

const isHex = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

// Map DNA Studio's ToneType -> this app's brand "voice" options.
function mapTone(t) {
  const m = {
    friendly: 'friendly', casual: 'friendly',
    professional: 'professional', formal: 'professional', authoritative: 'professional', technical: 'professional',
    playful: 'playful', minimalist: 'minimal',
    inspirational: 'bold', luxurious: 'bold',
  };
  return m[t] || 'warm';
}

// DNA Studio BrandDNA -> a rich site profile (stored + shown) for generation.
function dnaToProfile(brand, url) {
  const d = brand.dna || {};
  const colors = Array.isArray(d.colors) ? d.colors : [];
  const primary = (colors.find((c) => c.usage === 'primary') || {}).hex;
  return {
    url: brand.url || url,
    finalUrl: brand.url || url,
    siteName: d.name || brand.name || '',
    title: d.tagline || d.name || brand.name || '',
    description: (d.tone && d.tone.description) || d.tagline || '',
    keywords: Array.isArray(d.keywords) ? d.keywords.slice(0, 10) : [],
    themeColor: isHex(primary) ? primary.toUpperCase() : '',
    image: (d.logoUrl && /^https?:/i.test(d.logoUrl)) ? d.logoUrl : (d.ogImage || ''),
    textSnippet: String(d.rawText || '').slice(0, 1500),
    // Rich DNA Studio fields:
    brandName: d.name || brand.name || '',
    tagline: d.tagline || '',
    colors: colors.map((c) => ({ hex: c.hex, usage: c.usage, name: c.name })).slice(0, 8),
    fonts: (Array.isArray(d.fonts) ? d.fonts : []).map((f) => f.family).filter(Boolean).slice(0, 4),
    tone: d.tone ? { primary: d.tone.primary, description: d.tone.description } : null,
    industry: d.industry || '',
    audience: d.audience
      ? { primary: d.audience.primary, interests: (d.audience.interests || []).slice(0, 6), painPoints: (d.audience.painPoints || []).slice(0, 4) }
      : null,
    source: 'dna-studio',
    fetchedAt: Date.now(),
  };
}

// DNA Studio BrandDNA -> suggested brand fields the client applies to state.brand.
function dnaToBrand(brand) {
  const d = brand.dna || {};
  const colors = Array.isArray(d.colors) ? d.colors : [];
  const primary = (colors.find((c) => c.usage === 'primary') || colors.find((c) => c.usage === 'text') || colors[0] || {}).hex;
  const accent = (colors.find((c) => c.usage === 'accent') || colors.find((c) => c.usage === 'secondary') || colors[1] || {}).hex;
  const logo = (d.logoUrl && /^https?:/i.test(d.logoUrl)) ? d.logoUrl : '';
  return {
    name: d.name || brand.name || '',
    primaryColor: isHex(primary) ? primary.toUpperCase() : null,
    accentColor: isHex(accent) ? accent.toUpperCase() : null,
    voice: d.tone ? mapTone(d.tone.primary) : null,
    logoUrl: logo,
  };
}

// Scan a website and persist the extracted profile to the user's Business DNA.
// Prefers DNA Studio's rich crawler (colors/fonts/tone/audience); falls back to
// the fast built-in scanner if DNA Studio isn't reachable.
router.post('/analyze', requireAuth, async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ error: 'Please enter a website URL.' });

  let profile = null;
  let brand = null;

  if (await dna.isUp()) {
    try {
      const b = await dna.analyzeBrand(url);
      profile = dnaToProfile(b, url);
      brand = dnaToBrand(b);
    } catch (_) { /* fall back to the basic scanner */ }
  }

  if (!profile) {
    const result = await analyzeSite(url);
    if (result.error) return res.status(400).json({ error: result.error });
    profile = result.profile;
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO business_dna (user_id, website, site_profile, site_fetched_at, updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      website = excluded.website,
      site_profile = excluded.site_profile,
      site_fetched_at = excluded.site_fetched_at,
      updated_at = excluded.updated_at
  `).run(req.user.id, profile.url || url, JSON.stringify(profile), now, now);

  res.json({ profile, brand, fetchedAt: now });
});

module.exports = router;
