'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const dna = db.prepare(`
    SELECT name, logo_path AS logoUrl, voice,
           primary_color AS primaryColor, accent_color AS accentColor, location
    FROM business_dna WHERE user_id = ?`).get(req.user.id);
  res.json({ dna: dna || null });
});

router.put('/', (req, res) => {
  const b = req.body || {};
  const now = Date.now();
  const name = String(b.name || '').slice(0, 200);
  const logo = String(b.logoUrl || '').slice(0, 500000); // logo dataURL, capped
  const voice = String(b.voice || 'warm').slice(0, 40);
  const primary = String(b.primaryColor || '#1A1614').slice(0, 32);
  const accent = String(b.accentColor || '#DD4B25').slice(0, 32);
  const location = String(b.location || '').slice(0, 200);

  db.prepare(`
    INSERT INTO business_dna (user_id, name, logo_path, voice, primary_color, accent_color, location, updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      name=excluded.name, logo_path=excluded.logo_path, voice=excluded.voice,
      primary_color=excluded.primary_color, accent_color=excluded.accent_color,
      location=excluded.location, updated_at=excluded.updated_at
  `).run(req.user.id, name, logo, voice, primary, accent, location, now);

  res.json({ ok: true });
});

module.exports = router;
