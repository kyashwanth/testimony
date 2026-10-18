// Helpers for the per-site access model. Pure functions (no chrome.* calls) so they can be unit tested.

// A specific host ("uat.example.com") or a subdomain wildcard with at least a registrable-looking
// suffix ("*.example.com"). A bare "*" or "*.com" is rejected so the extension can't be widened to every site.
const PATTERN = /^(\*|https?):\/\/(\*\.[a-z0-9-]+\.[a-z0-9.-]+|[a-z0-9][a-z0-9.-]*)\/\*$/;

export const isWebUrl = (url) => /^https?:\/\//i.test(url || '');

// "https://uat.example.com:8443/app?x=1" -> "https://uat.example.com/*"
// (match patterns ignore ports, so this covers every port on that host)
export function patternForUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

// Accepts what a person might type: "uat.example.com", "*.example.com", "https://x.com/app", or a full pattern.
// Always returns "<scheme>://<host>/*" (or null if it isn't a valid host pattern).
export function normalizePattern(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/^(\*|https?):\/\/(.*)$/i);
  const scheme = m ? m[1].toLowerCase() : '*';
  const host = (m ? m[2] : s).split('/')[0].toLowerCase().replace(/:\d+$/, '');
  const out = `${scheme}://${host}/*`;
  return PATTERN.test(out) ? out : null;
}

// Keep only web origins from chrome.permissions.getAll().origins
export const webOrigins = (origins = []) =>
  origins.filter((o) => /^(\*|https?):\/\//.test(o) && o !== '<all_urls>');

// "https://uat.example.com/*" -> "uat.example.com"
export const label = (pattern) => pattern.replace(/^(\*|https?):\/\//, (m) => (m.startsWith('http:') ? 'http://' : '')).replace(/\/\*$/, '');
