'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { saveDataUrl, removeUpload } = require('../uploads');

const router = express.Router();
router.use(requireAuth);

const SELECT = `
  SELECT id, folder_id AS folderId, title, image_path AS imageUrl,
         state_json AS stateJson, sort_order AS sortOrder,
         created_at AS createdAt, updated_at AS updatedAt
  FROM designs`;

function asStateJson(v, fallback) {
  if (v === undefined) return fallback;
  return typeof v === 'string' ? v : JSON.stringify(v || {});
}

router.get('/', (req, res) => {
  const rows = db.prepare(`${SELECT} WHERE user_id = ? ORDER BY sort_order ASC, id DESC`).all(req.user.id);
  res.json({ designs: rows });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const now = Date.now();
  const title = String(b.title || 'Untitled').slice(0, 200);
  const stateJson = asStateJson(b.stateJson, '{}');
  const imagePath = saveDataUrl(b.imageData, req.user.id);
  const folderId = b.folderId ? Number(b.folderId) : null;
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM designs WHERE user_id = ?').get(req.user.id);
  const info = db.prepare(`
    INSERT INTO designs (user_id, folder_id, title, image_path, state_json, sort_order, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, folderId, title, imagePath, stateJson, max.m + 1, now, now);
  res.json({ design: db.prepare(`${SELECT} WHERE id = ?`).get(Number(info.lastInsertRowid)) });
});

// Bulk reorder — must be declared before '/:id'
router.put('/reorder', (req, res) => {
  const order = Array.isArray(req.body && req.body.order) ? req.body.order : [];
  const stmt = db.prepare('UPDATE designs SET sort_order = ? WHERE id = ? AND user_id = ?');
  db.exec('BEGIN');
  try {
    order.forEach((it, i) => stmt.run(Number(it.sortOrder ?? i), Number(it.id), req.user.id));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Reorder failed.' });
  }
  res.json({ ok: true });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM designs WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};

  const title = b.title !== undefined ? String(b.title).slice(0, 200) : existing.title;
  const folderId = b.folderId !== undefined ? (b.folderId ? Number(b.folderId) : null) : existing.folder_id;
  const stateJson = asStateJson(b.stateJson, existing.state_json);
  let imagePath = existing.image_path;
  if (typeof b.imageData === 'string' && b.imageData.startsWith('data:')) {
    const np = saveDataUrl(b.imageData, req.user.id);
    if (np) { removeUpload(existing.image_path); imagePath = np; }
  }

  db.prepare('UPDATE designs SET title=?, folder_id=?, image_path=?, state_json=?, updated_at=? WHERE id=? AND user_id=?')
    .run(title, folderId, imagePath, stateJson, Date.now(), id, req.user.id);
  res.json({ design: db.prepare(`${SELECT} WHERE id = ?`).get(id) });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT image_path FROM designs WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  db.prepare('DELETE FROM designs WHERE id = ? AND user_id = ?').run(id, req.user.id);
  removeUpload(existing.image_path);
  res.json({ ok: true });
});

module.exports = router;
