import { hmacSha256, toHex } from './hmac';

/**
 * Keyed hash of a value: HMAC-SHA-256(salt, value), first 16 hex chars (64 bits).
 * The salt is random per install and never leaves the device, so exported hashes can be
 * compared with each other but not reversed or dictionary-attacked by a reader of the export.
 */
export function hashValue(value: string, salt: string): string {
  return toHex(hmacSha256(salt, value)).slice(0, 16);
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
    .map((seg) => (looksLikeId(seg) || looksPersonal(seg) ? '#' + hashValue(seg, salt) : seg))
    .join('/');
  let out = `${u.protocol}//${u.host}${path}${parts.length ? '?' + parts.join('&') : ''}`;
  if (out.length > MAX_URL) out = out.slice(0, MAX_URL) + '…';
  return out;
}

/** Path segments that may carry personal data (emails, long tokens, encoded payloads). */
export function looksPersonal(seg: string): boolean {
  if (!seg) return false;
  let d = seg;
  try { d = decodeURIComponent(seg); } catch { /* keep raw */ }
  return d.includes('@') || d.length > 32 || /[=+]{1,2}$/.test(d) && d.length > 12;
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
