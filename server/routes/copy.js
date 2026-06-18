'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { aiGenerateCopy, localCopy, aiAvailable } = require('../aiCopy');

const router = express.Router();

// Generate website-grounded copy for the current campaign.
// Uses the stored site profile (server source of truth). AI when a key is
// configured, otherwise the local heuristic. Returns { copy: null } when the
// user has no analyzed website, so the client just keeps its template copy.
router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {};
  const dna = db.prepare('SELECT site_profile, name, voice, location FROM business_dna WHERE user_id = ?').get(req.user.id);
  let profile = null;
  if (dna && dna.site_profile) { try { profile = JSON.parse(dna.site_profile); } catch { profile = null; } }
  if (!profile) return res.json({ copy: null, aiAvailable: aiAvailable() });

  const brief = {
    prompt:       String(b.prompt || '').slice(0, 2000),
    purpose:      String(b.purpose || '').slice(0, 40),
    businessName: String(b.businessName || (dna && dna.name) || '').slice(0, 200),
    city:         String(b.city || (dna && dna.location) || '').slice(0, 120),
    voice:        String(b.voice || (dna && dna.voice) || '').slice(0, 40),
    profile,
  };

  let copy = null;
  try { copy = await aiGenerateCopy(brief); } catch { copy = null; }
  if (!copy) copy = localCopy(brief);

  res.json({ copy, aiAvailable: aiAvailable() });
});

module.exports = router;
