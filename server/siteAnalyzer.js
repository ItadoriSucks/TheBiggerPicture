'use strict';

// Fetches a user-supplied website and extracts a small "business profile"
// used to ground generated marketing copy in real on-site content.
//
// SECURITY: fetching an arbitrary user-supplied URL is an SSRF risk. We follow
// the OWASP SSRF Prevention Cheat Sheet:
//   - allowlist http/https only
//   - DNS-resolve the host and reject loopback / private / link-local /
//     cloud-metadata / multicast ranges (for every resolved IP)
//   - handle redirects manually, re-validating each hop
//   - cap time and response size
// https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
//
// Residual note: there is a small TOCTOU window between DNS validation and the
// actual fetch (DNS rebinding). For a local, single-user tool reading the
// owner's own business site this is an acceptable tradeoff; behind a public
// deployment, pin the validated IP via a custom undici dispatcher.

const net = require('node:net');
const dns = require('node:dns').promises;

const TIMEOUT_MS    = 8000;
const MAX_BYTES     = 1.5 * 1024 * 1024;  // 1.5 MB of HTML is plenty
const MAX_REDIRECTS = 3;
const UA = 'TheBiggerPicture/1.0 (+local small-business marketing tool)';

// ---- Blocked IP ranges (fail closed) ----
const blocked = new net.BlockList();
// IPv4
blocked.addSubnet('0.0.0.0', 8, 'ipv4');         // "this" network
blocked.addSubnet('10.0.0.0', 8, 'ipv4');        // private
blocked.addSubnet('100.64.0.0', 10, 'ipv4');     // CGNAT
blocked.addSubnet('127.0.0.0', 8, 'ipv4');       // loopback
blocked.addSubnet('169.254.0.0', 16, 'ipv4');    // link-local (incl. 169.254.169.254 metadata)
blocked.addSubnet('172.16.0.0', 12, 'ipv4');     // private
blocked.addSubnet('192.0.0.0', 24, 'ipv4');      // IETF protocol
blocked.addSubnet('192.0.2.0', 24, 'ipv4');      // TEST-NET-1
blocked.addSubnet('192.168.0.0', 16, 'ipv4');    // private
blocked.addSubnet('198.18.0.0', 15, 'ipv4');     // benchmarking
blocked.addSubnet('198.51.100.0', 24, 'ipv4');   // TEST-NET-2
blocked.addSubnet('203.0.113.0', 24, 'ipv4');    // TEST-NET-3
blocked.addSubnet('224.0.0.0', 4, 'ipv4');       // multicast
blocked.addSubnet('240.0.0.0', 4, 'ipv4');       // reserved
blocked.addAddress('255.255.255.255', 'ipv4');   // broadcast
// IPv6
blocked.addAddress('::1', 'ipv6');               // loopback
blocked.addAddress('::', 'ipv6');                // unspecified
blocked.addSubnet('fc00::', 7, 'ipv6');          // unique local
blocked.addSubnet('fe80::', 10, 'ipv6');         // link-local
blocked.addSubnet('ff00::', 8, 'ipv6');          // multicast

function isBlockedIp(ip) {
  let addr = ip;
  let type = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip); // IPv4-mapped IPv6
  if (mapped) { addr = mapped[1]; type = 'ipv4'; }
  try { return blocked.check(addr, type); } catch { return true; } // unknown form -> fail closed
}

async function assertPublicHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) throw new Error('That website address is not valid.');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host === 'metadata.google.internal') {
    throw new Error('That address points to a local/internal host and cannot be read.');
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error('That address is on a private network and cannot be read.');
    return;
  }
  let records;
  try { records = await dns.lookup(host, { all: true }); }
  catch { throw new Error('Could not resolve that website address.'); }
  if (!records.length) throw new Error('Could not resolve that website address.');
  for (const r of records) {
    if (isBlockedIp(r.address)) {
      throw new Error('That website resolves to a private network and cannot be read.');
    }
  }
}

// ---- URL handling ----
function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s; // default scheme
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u;
}

// ---- HTML download (manual redirects, timeout, size cap) ----
async function readCapped(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { try { await reader.cancel(); } catch {} break; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchHtml(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url.href, {
        signal: ac.signal,
        redirect: 'manual',
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'The website took too long to respond.' : 'Could not reach that website.');
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      let next;
      try { next = new URL(res.headers.get('location'), url); } catch { throw new Error('The website sent an invalid redirect.'); }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error('The website redirected to an unsupported address.');
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`The website returned an error (HTTP ${res.status}).`);

    const ctype = res.headers.get('content-type') || '';
    if (ctype && !/text\/html|application\/xhtml\+xml/i.test(ctype)) {
      throw new Error('That link is not a web page we can read.');
    }
    const html = await readCapped(res, MAX_BYTES);
    return { html, finalUrl: url.href };
  }
  throw new Error('The website redirected too many times.');
}

// ---- HTML extraction (no dependencies) ----
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } });
}
function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, ' '); }

function metaContent(html, key) {
  const esc = key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp('<meta\\b[^>]*\\b(?:name|property)\\s*=\\s*["\']' + esc + '["\'][^>]*>', 'i');
  const tag = html.match(re);
  if (!tag) return '';
  const c = tag[0].match(/\bcontent\s*=\s*["']([\s\S]*?)["']/i);
  return c ? decodeEntities(c[1]).trim() : '';
}

function extractHeadings(html) {
  const out = [];
  const re = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 12) {
    const t = decodeEntities(stripTags(m[2])).replace(/\s+/g, ' ').trim();
    if (t && t.length > 1) out.push(t.slice(0, 120));
  }
  return out;
}

function textSnippet(html, max) {
  const s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, max);
}

const STOPWORDS = new Set(('the a an and or but of to in for on with your you we our us is are be was were been ' +
  'this that these those at from by as it its their they them he she his her i me my mine will can may not no ' +
  'all any more most some such own so than too very just into out up down over under then here there when ' +
  'where who what which how about also have has had do does did get got make made new now one two get').split(/\s+/));

function topKeywords(text, n) {
  const freq = Object.create(null);
  for (const w of (String(text).toLowerCase().match(/[a-z][a-z'’-]{2,}/g) || [])) {
    const word = w.replace(/['’-]+$/, '');
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    freq[word] = (freq[word] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function extractProfile(html, finalUrl, requestedUrl) {
  const ogTitle = metaContent(html, 'og:title');
  const ogDesc  = metaContent(html, 'og:description');
  const ogSite  = metaContent(html, 'og:site_name');
  const ogImage = metaContent(html, 'og:image');
  const metaDesc = metaContent(html, 'description');
  const theme    = metaContent(html, 'theme-color');
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1];

  const title = (ogTitle || decodeEntities(stripTags(titleTag))).replace(/\s+/g, ' ').trim().slice(0, 200);
  const description = (ogDesc || metaDesc).replace(/\s+/g, ' ').trim().slice(0, 400);
  const headings = extractHeadings(html).slice(0, 8);
  const text = textSnippet(html, 1500);

  let host = '';
  try { host = new URL(finalUrl).hostname.replace(/^www\./, ''); } catch {}
  let image = ogImage;
  if (image) { try { image = new URL(image, finalUrl).href; } catch {} }

  return {
    url: requestedUrl,
    finalUrl,
    siteName: (ogSite || host).slice(0, 120),
    title,
    description,
    headings,
    keywords: topKeywords([title, description, headings.join(' '), text].join(' '), 8),
    themeColor: /^#[0-9a-f]{3,8}$/i.test(theme) ? theme.toUpperCase() : '',
    image: image || '',
    textSnippet: text,
    fetchedAt: Date.now(),
  };
}

// ---- Public API ----
async function analyzeSite(rawUrl) {
  const u = normalizeUrl(rawUrl);
  if (!u) return { error: 'Please enter a valid website URL (e.g. yourbakery.com).' };
  try {
    const { html, finalUrl } = await fetchHtml(u);
    const profile = extractProfile(html, finalUrl, u.href);
    if (!profile.title && !profile.description && !profile.headings.length) {
      return { error: 'We reached the site but couldn’t read any usable content.' };
    }
    return { profile };
  } catch (e) {
    return { error: e.message || 'Could not read that website.' };
  }
}

module.exports = { analyzeSite, normalizeUrl };
