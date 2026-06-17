'use strict';

const express = require('express');
const path = require('node:path');
const { UPLOADS_DIR } = require('./db');
const { attachUser, cleanupExpiredSessions } = require('./auth');

const app = express();
const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'the-bigger-picture.html');
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '25mb' }));
app.use(attachUser);

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dna', require('./routes/dna'));
app.use('/api/designs', require('./routes/designs'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/draft', require('./routes/drafts'));
app.use('/api/comments', require('./routes/comments'));

// Uploaded design images
app.use('/uploads', express.static(UPLOADS_DIR));

// The app itself
app.get('/', (req, res) => res.sendFile(HTML));
app.get('/the-bigger-picture.html', (req, res) => res.sendFile(HTML));

// JSON error handler (e.g. payload too large)
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload too large.' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

cleanupExpiredSessions();
app.listen(PORT, () => console.log(`The Bigger Picture running at http://localhost:${PORT}`));
