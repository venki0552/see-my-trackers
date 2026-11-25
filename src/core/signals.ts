import { looksLikeId } from './redact';

const ALWAYS_SENDING = new Set(['ping', 'beacon', 'csp_report', 'websocket']);
const MAYBE_SENDING = new Set(['xmlhttprequest', 'image', 'imageset', 'other', 'sub_frame', 'object']);

/**
 * Did this request carry data out (beacon/pixel/collect call), as opposed to just fetching a
 * script or style? Heuristic, documented in LIMITATIONS.
 */
export function isDataSending(reqType: string | undefined, url: string, method?: string, hasBody?: boolean): boolean {
  const t = (reqType ?? '').toLowerCase();
  if (ALWAYS_SENDING.has(t)) return true;
  if (method && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') return true;
  if (hasBody) return true;
  if (!MAYBE_SENDING.has(t)) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  let params = 0;
  let idLike = 0;
  u.searchParams.forEach((v) => { params++; if (looksLikeId(v)) idLike++; });
  if (t === 'xmlhttprequest' || t === 'other') return params >= 1;
  if (t === 'image' || t === 'imageset') return params >= 2 || idLike >= 1;
  if (t === 'sub_frame' || t === 'object') return idLike >= 1;
  return false;
}

const NON_USER_PARAMS = new Set([
  'v', 'ver', 'version', 'cb', 'rnd', 'random', 'r', 'z', 't', 'ts', 'timestamp', '_', 'cachebuster',
  'tid', 'gtm', 'gtag', 'en', 'dl', 'dr', 'dt', 'ul', 'sr', 'vp', 'de', 'url', 'ref', 'referrer', 'page',
  'callback', 'jsonp', 'format', 'lang', 'locale', 'currency', 'size', 'sz', 'w', 'h', 'width', 'height',
]);
const NON_USER_PARAM_RE = /(page|article|content|post|item|product|sku|creative|campaign|placement|slot|unit|adunit|position|template|layout|section|category|title|keyword|query|hash|checksum|signature|sig|token_type|nonce)/i;
const CONTAINER_ID_RE = /^(G|UA|GTM|AW|DC|GT|AP|MC)-[A-Z0-9-]+$/i;

/** Identifier-like parameter values (candidates for user IDs / ID sync). */
export function idParams(url: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let u: URL;
  try { u = new URL(url); } catch { return out; }
  u.searchParams.forEach((v, k) => {
    const key = k.toLowerCase();
    if (NON_USER_PARAMS.has(key) || NON_USER_PARAM_RE.test(key)) return;
    if (CONTAINER_ID_RE.test(v)) return;
    if (v.length < 12) return;
    if (looksLikeId(v)) out.push([k, v]);
  });
  return out;
}

/** GA4 / Google tag "gcs" parameter: G1<ad_storage><analytics_storage>, e.g. G100 = both denied. */
export function parseGcs(url: string): { ad: boolean; analytics: boolean } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const gcs = u.searchParams.get('gcs');
  if (!gcs || !/^G1[01]{2}$/.test(gcs)) return null;
  return { ad: gcs[2] === '1', analytics: gcs[3] === '1' };
}

/** us_privacy param (CCPA string) found in a request URL. */
export function uspParam(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get('us_privacy') ?? u.searchParams.get('usp') ?? null;
  } catch {
    return null;
  }
}

/** Cookie names from a Cookie request header. */
export function cookieNames(header: string | undefined): string[] {
  if (!header) return [];
  return header.split(';').map((p) => p.split('=')[0]!.trim()).filter(Boolean).slice(0, 50);
}

/** Cookie names + max-age (seconds) from Set-Cookie header values. */
export function parseSetCookie(values: string[]): Array<{ name: string; maxAgeSec: number | null }> {
  const out: Array<{ name: string; maxAgeSec: number | null }> = [];
  for (const line of values) {
    for (const raw of line.split(/\n/)) {
      const [nv, ...attrs] = raw.split(';');
      const name = nv?.split('=')[0]?.trim();
      if (!name) continue;
      let maxAgeSec: number | null = null;
      for (const a of attrs) {
        const [ak, av] = a.split('=').map((s) => s.trim());
        if (!ak || av === undefined) continue;
        if (ak.toLowerCase() === 'max-age') maxAgeSec = Number(av);
        else if (ak.toLowerCase() === 'expires' && maxAgeSec === null) {
          const t = Date.parse(av);
          if (!Number.isNaN(t)) maxAgeSec = Math.round((t - Date.now()) / 1000);
        }
      }
      out.push({ name, maxAgeSec });
    }
  }
  return out;
}
