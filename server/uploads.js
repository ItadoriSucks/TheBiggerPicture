'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { UPLOADS_DIR } = require('./db');

const MAX_BYTES = 12 * 1024 * 1024;

// Decode a base64 image dataURL, write it to /uploads, return its web path ('' on failure).
function saveDataUrl(dataUrl, userId) {
  if (typeof dataUrl !== 'string') return '';
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) return '';
  const ext = /jpe?g/i.test(m[1]) ? 'jpg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES) return '';
  const fname = `u${userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fname), buf);
  return `/uploads/${fname}`;
}

function removeUpload(webPath) {
  if (typeof webPath !== 'string' || !webPath.startsWith('/uploads/')) return;
  const fname = webPath.slice('/uploads/'.length);
  if (fname.includes('/') || fname.includes('\\') || fname.includes('..')) return;
  fs.promises.unlink(path.join(UPLOADS_DIR, fname)).catch(() => {});
}

module.exports = { saveDataUrl, removeUpload };
