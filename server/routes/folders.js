'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const folders = db.prepare(
    'SELECT id, name, sort_order AS sortOrder, created_at AS createdAt FROM folders WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(req.user.id);
  res.json({ folders });
});

router.post('/', (req, res) => {
  const name = (String((req.body || {}).name || '').trim().slice(0, 120)) || 'New collection';
  const now = Date.now();
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM folders WHERE user_id = ?').get(req.user.id);
  const info = db.prepare('INSERT INTO folders (user_id, name, sort_order, created_at) VALUES (?,?,?,?)')
    .run(req.user.id, name, max.m + 1, now);
  const folder = db.prepare('SELECT id, name, sort_order AS sortOrder, created_at AS createdAt FROM folders WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  res.json({ folder });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM folders WHERE id=? AND user_id=?').get(id, req.user.id)) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const name = String((req.body || {}).name || '').trim().slice(0, 120);
  if (name) db.prepare('UPDATE folders SET name=? WHERE id=? AND user_id=?').run(name, id, req.user.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM folders WHERE id=? AND user_id=?').run(id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
