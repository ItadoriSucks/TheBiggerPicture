'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { saveDataUrl, removeUpload } = require('../uploads');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const draft = db.prepare(
    'SELECT state_json AS stateJson, image_path AS imageUrl, updated_at AS updatedAt FROM drafts WHERE user_id = ?'
  ).get(req.user.id);
  res.json({ draft: draft || null });
});

router.put('/', (req, res) => {
  const b = req.body || {};
  const stateJson = typeof b.stateJson === 'string' ? b.stateJson : JSON.stringify(b.stateJson || {});
  const now = Date.now();

  const prev = db.prepare('SELECT image_path FROM drafts WHERE user_id = ?').get(req.user.id);
  let imagePath = prev ? prev.image_path : '';
  if (typeof b.imageData === 'string' && b.imageData.startsWith('data:')) {
    const np = saveDataUrl(b.imageData, req.user.id);
    if (np) { if (prev && prev.image_path) removeUpload(prev.image_path); imagePath = np; }
  }

  db.prepare(`
    INSERT INTO drafts (user_id, state_json, image_path, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      state_json=excluded.state_json, image_path=excluded.image_path, updated_at=excluded.updated_at
  `).run(req.user.id, stateJson, imagePath, now);

  res.json({ ok: true });
});

router.delete('/', (req, res) => {
  const prev = db.prepare('SELECT image_path FROM drafts WHERE user_id = ?').get(req.user.id);
  if (prev) removeUpload(prev.image_path);
  db.prepare('DELETE FROM drafts WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
