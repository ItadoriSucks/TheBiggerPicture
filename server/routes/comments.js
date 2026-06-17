'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// Public read
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, user_id AS userId, body, author_name AS authorName,
           author_business AS authorBusiness, created_at AS createdAt
    FROM comments ORDER BY created_at DESC LIMIT 500`).all();
  const mine = req.user ? req.user.id : null;
  for (const r of rows) { r.own = r.userId === mine; delete r.userId; }
  res.json({ comments: rows });
});

// Post — login required, snapshots the author's Business DNA name
router.post('/', requireAuth, (req, res) => {
  const body = String((req.body || {}).body || '').trim();
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });
  if (body.length > 2000) return res.status(400).json({ error: 'Comment is too long (2000 char max).' });

  const dna = db.prepare('SELECT name FROM business_dna WHERE user_id = ?').get(req.user.id);
  const authorBusiness = dna && dna.name ? dna.name : '';
  const authorName = req.user.display_name || req.user.email;
  const now = Date.now();
  const info = db.prepare(
    'INSERT INTO comments (user_id, body, author_name, author_business, created_at) VALUES (?,?,?,?,?)'
  ).run(req.user.id, body, authorName, authorBusiness, now);

  const c = db.prepare(
    'SELECT id, body, author_name AS authorName, author_business AS authorBusiness, created_at AS createdAt FROM comments WHERE id = ?'
  ).get(Number(info.lastInsertRowid));
  c.own = true;
  res.json({ comment: c });
});

// Delete own comment only
router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found.' });
  if (existing.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own comments.' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
