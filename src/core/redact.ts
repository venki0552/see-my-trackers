/** FNV-1a 64-bit (as hex) of salt+value. Synchronous, fast, good enough for equality matching. */
export function hashValue(value: string, salt: string): string {
  let h1 = 0x811c9dc5 ^ 0;
  let h2 = 0xcbf29ce4 ^ 0;
  const s = salt + '\u0000' + value;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + 0x9e37), 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

const MAX_URL = 400;

/**
 * Keeps scheme, host, path and parameter names. Replaces every parameter value with a salted
 * hash prefix, so evidence shows *what kind* of data was sent without storing the data itself.
 */
export function redactUrl(url: string, salt: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '[invalid url]';
  }
  const parts: string[] = [];
  u.searchParams.forEach((v, k) => {
    parts.push(`${encodeURIComponent(k)}=${v ? '#' + hashValue(v, salt) : ''}`);
  });
  // Path segments that look like identifiers are hashed too.
  const path = u.pathname
    .split('/')
    .map((seg) => (looksLikeId(seg) ? '#' + hashValue(seg, salt) : seg))
    .join('/');
  let out = `${u.protocol}//${u.host}${path}${parts.length ? '?' + parts.join('&') : ''}`;
  if (out.length > MAX_URL) out = out.slice(0, MAX_URL) + '…';
  return out;
}

/** Heuristic: long, mixed alphanumeric tokens are probably identifiers. */
export function looksLikeId(s: string): boolean {
  if (!s || s.length < 8 || s.length > 200) return false;
  if (/^\d{10,13}$/.test(s)) return false; // unix timestamps
  if (/^(true|false|null|undefined)$/i.test(s)) return false;
  if (/^https?:/i.test(s)) return false;
  if (/^[a-z]+([-_][a-z]+)*$/i.test(s)) return false; // plain words / slugs
  if (/^\d{6,}\.\d{6,}$/.test(s)) return true; // GA-style client ids: 1234567890.1700000000
  if (/^\d+(\.\d+)*$/.test(s) && s.length < 16) return false; // versions, small numbers
  const classes = [/[a-z]/.test(s), /[A-Z]/.test(s), /\d/.test(s)].filter(Boolean).length;
  return classes >= 2 || /^[0-9a-f]{16,}$/i.test(s) || /^\d{16,}$/.test(s);
}
