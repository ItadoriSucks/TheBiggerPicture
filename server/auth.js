'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');

// --- Password hashing (Node built-in scrypt; OWASP-approved params N=2^17, r=8, p=1) ---
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length,
      { N: +N, r: +r, p: +p, maxmem: 256 * 1024 * 1024 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// --- Sessions (persistent, survive server restarts) ---
const COOKIE_NAME = 'tbp_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expires = now + SESSION_MS;
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, now, expires);
  return { token, expires };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.expires_at, u.id, u.email, u.display_name, u.avatar_url
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) { destroySession(token); return null; }
  return { id: row.id, email: row.email, display_name: row.display_name, avatar_url: row.avatar_url };
}

function cleanupExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

// --- Cookies ---
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token, expires) {
  const maxAge = Math.max(0, Math.floor((expires - Date.now()) / 1000));
  // HttpOnly + SameSite=Lax. Secure is omitted because http://localhost would drop it;
  // enable `Secure` when serving over HTTPS.
  res.append('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// --- Middleware ---
function attachUser(req, res, next) {
  const cookies = parseCookies(req);
  req.sessionToken = cookies[COOKIE_NAME] || null;
  req.user = getUserByToken(req.sessionToken);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in.' });
  next();
}

module.exports = {
  hashPassword, verifyPassword,
  createSession, destroySession, getUserByToken, cleanupExpiredSessions,
  setSessionCookie, clearSessionCookie,
  attachUser, requireAuth,
};
