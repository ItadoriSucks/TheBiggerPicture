'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const dna = require('../dnaClient');

const router = express.Router();
router.use(requireAuth);

const VALID_PLATFORMS = ['instagram', 'linkedin', 'facebook', 'twitter'];

// Is the local DNA Studio service reachable?
router.get('/status', async (req, res) => {
  res.json({ up: await dna.isUp(), url: dna.DNA_URL });
});

// List the signed-in user's saved campaigns.
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT id, brand_name AS brandName, url, goal, data, created_at AS createdAt FROM campaigns WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.user.id);
  for (const r of rows) { try { r.data = JSON.parse(r.data); } catch { r.data = null; } }
  res.json({ campaigns: rows });
});

// Generate a campaign via DNA Studio (Groq) and save it like any other asset.
router.post('/', async (req, res) => {
  const b = req.body || {};
  const url = String(b.url || '').trim();
  const goal = String(b.goal || '').trim();
  let platforms = Array.isArray(b.platforms) ? b.platforms.filter((p) => VALID_PLATFORMS.includes(p)) : [];
  if (!platforms.length) platforms = VALID_PLATFORMS.slice();
  if (!url) return res.status(400).json({ error: 'Enter your website URL.' });
  if (!goal) return res.status(400).json({ error: 'Describe what you want to promote.' });

  try {
    const brand = await dna.analyzeBrand(url);
    const campaign = await dna.generateCampaign({ brandId: brand.id, goal, platforms });
    const now = Date.now();
    const d = brand.dna || {};
    const payload = {
      brand: {
        name: brand.name,
        url: brand.url,
        tone: brand.tone,
        industry: brand.industry,
        colors: brand.colors || [],
        tagline: d.tagline || '',
        keywords: Array.isArray(d.keywords) ? d.keywords.slice(0, 5) : [],
        logoUrl: (d.logoUrl && /^https?:/i.test(d.logoUrl)) ? d.logoUrl : '',
      },
      campaign,
    };
    const info = db.prepare(
      'INSERT INTO campaigns (user_id, brand_name, url, goal, data, created_at) VALUES (?,?,?,?,?,?)'
    ).run(req.user.id, brand.name || '', url, goal, JSON.stringify(payload), now);
    res.json({ id: Number(info.lastInsertRowid), brandName: brand.name || '', url, goal, createdAt: now, data: payload });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Campaign generation failed.' });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
