'use strict';

// Server-side client for the local DNA Studio instance (Docker, on :3100).
// DNA Studio's API is NextAuth-gated, so we hold a service session here and
// proxy brand analysis + campaign generation (which DNA Studio powers via free Groq).
// Both endpoints stream Server-Sent Events; we read them to completion.

const DNA_URL = (process.env.DNA_STUDIO_URL || 'http://localhost:3100').replace(/\/$/, '');
const SERVICE_EMAIL = process.env.DNA_SERVICE_EMAIL || 'service@bigger-picture.local';
const SERVICE_PASSWORD = process.env.DNA_SERVICE_PASSWORD || 'bp-dna-service-2026-x9q2';
const SERVICE_NAME = 'Bigger Picture Service';

let _cookie = null;
let _cookieExp = 0;

function setCookies(res) {
  return (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [])
    .map((c) => c.split(';')[0]);
}

async function ensureSession() {
  if (_cookie && Date.now() < _cookieExp - 60000) return _cookie;

  // Register the service account (idempotent — 409 if it already exists).
  try {
    await fetch(`${DNA_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: SERVICE_NAME, email: SERVICE_EMAIL, password: SERVICE_PASSWORD }),
    });
  } catch (_) { /* may already exist */ }

  // CSRF token + cookie.
  const csrfRes = await fetch(`${DNA_URL}/api/auth/csrf`);
  if (!csrfRes.ok) throw new Error('DNA Studio is not reachable.');
  const { csrfToken } = await csrfRes.json();
  const csrfCookies = setCookies(csrfRes);

  // Credentials login.
  const loginRes = await fetch(`${DNA_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookies.join('; ') },
    body: new URLSearchParams({ csrfToken, email: SERVICE_EMAIL, password: SERVICE_PASSWORD, json: 'true' }).toString(),
    redirect: 'manual',
  });
  const all = [...csrfCookies, ...setCookies(loginRes)];
  if (!all.some((c) => c.includes('session-token='))) {
    throw new Error('DNA Studio login failed (no session cookie).');
  }
  _cookie = all.join('; ');
  _cookieExp = Date.now() + 25 * 24 * 60 * 60 * 1000; // JWT lasts 30d
  return _cookie;
}

// Read an SSE response to completion, returning all parsed `data:` payloads.
async function readSSE(res) {
  const events = [];
  if (!res.body) return events;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = block.split('\n').find((l) => l.startsWith('data:'));
      if (line) { try { events.push(JSON.parse(line.slice(5).trim())); } catch (_) {} }
    }
  }
  return events;
}

async function postSSE(path, body, label) {
  const cookie = await ensureSession();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120000); // safety: never hang forever
  try {
    const res = await fetch(`${DNA_URL}${path}`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    if (res.status === 401) { _cookie = null; throw new Error('DNA Studio session expired — please retry.'); }
    if (!res.ok) throw new Error(`${label} failed (HTTP ${res.status}).`);
    const events = await readSSE(res);
    const complete = events.find((e) => e.type === 'complete');
    const error = events.find((e) => e.type === 'error');
    if (!complete) throw new Error(error ? error.message : `${label} did not complete.`);
    return complete;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`${label} timed out.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeBrand(url) {
  const c = await postSSE('/api/brands/analyze', { url }, 'Brand analysis');
  return c.brand; // { id, name, url, dna, colors, ... }
}

async function generateCampaign({ brandId, goal, platforms, language }) {
  const c = await postSSE('/api/campaigns/generate', {
    brandId, goal, platforms, language: language || 'English',
  }, 'Campaign generation');
  return c.campaign; // { id, goal, concepts:[{ title, assets:[{platform,caption,hashtags,imagePrompt}] }] }
}

async function isUp() {
  try {
    const r = await fetch(`${DNA_URL}/api/auth/csrf`, { signal: AbortSignal.timeout(3500) });
    return r.ok;
  } catch { return false; }
}

module.exports = { analyzeBrand, generateCampaign, ensureSession, isUp, DNA_URL };
