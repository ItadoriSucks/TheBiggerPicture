'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url };
}

router.post('/signup', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const displayName = String(b.displayName || '').trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  const now = Date.now();
  const info = db.prepare(
    'INSERT INTO users (email, password_hash, display_name, avatar_url, created_at) VALUES (?,?,?,?,?)'
  ).run(email, auth.hashPassword(password), displayName || email.split('@')[0], '', now);

  const userId = Number(info.lastInsertRowid);
  const { token, expires } = auth.createSession(userId);
  auth.setSessionCookie(res, token, expires);
  const row = db.prepare('SELECT id, email, display_name, avatar_url FROM users WHERE id = ?').get(userId);
  res.json({ user: publicUser(row) });
});

router.post('/login', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !auth.verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  const { token, expires } = auth.createSession(row.id);
  auth.setSessionCookie(res, token, expires);
  res.json({ user: publicUser(row) });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ? { id: req.user.id, email: req.user.email, displayName: req.user.display_name, avatarUrl: req.user.avatar_url } : null });
});

// Update profile (display name + avatar dataURL)
router.put('/profile', auth.requireAuth, (req, res) => {
  const b = req.body || {};
  const displayName = b.displayName !== undefined ? String(b.displayName).trim().slice(0, 120) : null;
  const avatarUrl = b.avatarUrl !== undefined ? String(b.avatarUrl).slice(0, 500000) : null;
  if (displayName !== null) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.user.id);
  if (avatarUrl !== null) db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);
  const row = db.prepare('SELECT id, email, display_name, avatar_url FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(row) });
});

module.exports = router;
