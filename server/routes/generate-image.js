'use strict';

// POST /api/generate-image — AI poster background via Pollinations.ai.
// Free, no API key, no billing. No auth so guests can use it.
// Fixed upstream host (no SSRF surface); the user prompt is URL-encoded into the path.
// Returns { imageUrl: "data:image/...;base64,..." } so it slots straight into
// makePoster()'s <img class="poster-bg-img" src="${e.imageUrl}">.

const express = require('express');
const router = express.Router();

const TIMEOUT_MS = 45000;                 // Pollinations (flux) can take 10-30s
const MAX_BYTES  = 10 * 1024 * 1024;      // 10 MB cap
const WIDTH = 640, HEIGHT = 800;          // ~4:5 portrait, matches the 400x500 poster

router.post('/', async (req, res) => {
  const prompt = String((req.body || {}).prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Missing image prompt.' });

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
              `?width=${WIDTH}&height=${HEIGHT}&nologo=true&model=flux`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ac.signal, headers: { 'Accept': 'image/*' } });
    if (!resp.ok) return res.status(500).json({ error: `Image service returned HTTP ${resp.status}.` });
    const ctype = resp.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//i.test(ctype)) return res.status(500).json({ error: 'Image service did not return an image.' });
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) return res.status(500).json({ error: 'Image service returned an empty image.' });
    if (buf.length > MAX_BYTES) return res.status(500).json({ error: 'Generated image is too large.' });
    res.json({ imageUrl: `data:${ctype};base64,${buf.toString('base64')}` });
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'Image generation timed out.' : ((e && e.message) || 'Image generation failed.');
    res.status(500).json({ error: msg });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
