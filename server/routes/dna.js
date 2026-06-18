'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const dna = db.prepare(`
    SELECT name, logo_path AS logoUrl, voice,
           primary_color AS primaryColor, accent_color AS accentColor, location,
           website, site_profile AS siteProfile, site_fetched_at AS siteFetchedAt
    FROM business_dna WHERE user_id = ?`).get(req.user.id);
  if (dna) {
    if (dna.siteProfile) { try { dna.siteProfile = JSON.parse(dna.siteProfile); } catch { dna.siteProfile = null; } }
    else dna.siteProfile = null;
  }
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
  const website = String(b.website || '').slice(0, 500);

  // The site profile is produced/persisted by POST /api/site/analyze. Here we
  // only carry it forward — preserved on save, cleared if the website is removed.
  const prev = db.prepare('SELECT site_profile, site_fetched_at FROM business_dna WHERE user_id = ?').get(req.user.id);
  let siteProfile = prev ? prev.site_profile : '';
  let siteFetchedAt = prev ? prev.site_fetched_at : null;
  if (!website) { siteProfile = ''; siteFetchedAt = null; }

  db.prepare(`
    INSERT INTO business_dna (user_id, name, logo_path, voice, primary_color, accent_color, location, website, site_profile, site_fetched_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      name=excluded.name, logo_path=excluded.logo_path, voice=excluded.voice,
      primary_color=excluded.primary_color, accent_color=excluded.accent_color,
      location=excluded.location, website=excluded.website,
      site_profile=excluded.site_profile, site_fetched_at=excluded.site_fetched_at,
      updated_at=excluded.updated_at
  `).run(req.user.id, name, logo, voice, primary, accent, location, website, siteProfile, siteFetchedAt, now);

  let profileObj = null;
  if (siteProfile) { try { profileObj = JSON.parse(siteProfile); } catch {} }
  res.json({ ok: true, siteProfile: profileObj, siteFetchedAt });
});

module.exports = router;
