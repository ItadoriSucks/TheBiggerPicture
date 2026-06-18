'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { analyzeSite } = require('../siteAnalyzer');

const router = express.Router();

// Scan a website and persist the extracted profile to the user's Business DNA.
// Used by the "Scan site" / "Re-scan" button in the brand modal.
router.post('/analyze', requireAuth, async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ error: 'Please enter a website URL.' });

  const result = await analyzeSite(url);
  if (result.error) return res.status(400).json({ error: result.error });

  const now = Date.now();
  db.prepare(`
    INSERT INTO business_dna (user_id, website, site_profile, site_fetched_at, updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      website = excluded.website,
      site_profile = excluded.site_profile,
      site_fetched_at = excluded.site_fetched_at,
      updated_at = excluded.updated_at
  `).run(req.user.id, result.profile.url, JSON.stringify(result.profile), now, now);

  res.json({ profile: result.profile, fetchedAt: now });
});

module.exports = router;
