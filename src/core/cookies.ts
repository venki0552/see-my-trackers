/** Plain-language dictionary of common tracking cookies. Written for this project (GPL-3.0). */
export interface CookieInfo { owner: string; purpose: string; }

const EXACT: Record<string, CookieInfo> = {
  _ga: { owner: 'Google', purpose: 'Google Analytics visitor ID (usually 2 years)' },
  _gid: { owner: 'Google', purpose: 'Google Analytics 24-hour visitor ID' },
  _gat: { owner: 'Google', purpose: 'Google Analytics request throttling' },
  _gcl_au: { owner: 'Google', purpose: 'Google Ads conversion tracking' },
  _gcl_aw: { owner: 'Google', purpose: 'Google Ads click ID' },
  IDE: { owner: 'Google (DoubleClick)', purpose: 'Ad targeting and measurement across sites' },
  DSID: { owner: 'Google (DoubleClick)', purpose: 'Links ad activity to your Google account' },
  test_cookie: { owner: 'Google (DoubleClick)', purpose: 'Checks if your browser accepts ad cookies' },
  NID: { owner: 'Google', purpose: 'Preferences and ad personalization' },
  __gads: { owner: 'Google', purpose: 'Ad serving and measurement' },
  __gpi: { owner: 'Google', purpose: 'Ad serving and measurement' },
  _fbp: { owner: 'Meta (Facebook)', purpose: 'Meta Pixel browser ID for ad targeting (90 days)' },
  _fbc: { owner: 'Meta (Facebook)', purpose: 'Stores the Facebook ad click ID' },
  fr: { owner: 'Meta (Facebook)', purpose: 'Ad delivery and measurement across sites' },
  datr: { owner: 'Meta (Facebook)', purpose: 'Browser identification' },
  _ttp: { owner: 'TikTok', purpose: 'TikTok Pixel browser ID for ad measurement' },
  _tt_enable_cookie: { owner: 'TikTok', purpose: 'TikTok Pixel cookie check' },
  _uetsid: { owner: 'Microsoft (Bing Ads)', purpose: 'Bing Ads session ID' },
  _uetvid: { owner: 'Microsoft (Bing Ads)', purpose: 'Bing Ads visitor ID (about 13 months)' },
  MUID: { owner: 'Microsoft', purpose: 'Cross-site browser ID for ads' },
  _clck: { owner: 'Microsoft Clarity', purpose: 'Session recording visitor ID' },
  _clsk: { owner: 'Microsoft Clarity', purpose: 'Session recording session ID' },
  _hjSessionUser: { owner: 'Hotjar', purpose: 'Session recording / heatmap visitor ID' },
  _pin_unauth: { owner: 'Pinterest', purpose: 'Pinterest tag visitor ID' },
  _pinterest_ct_ua: { owner: 'Pinterest', purpose: 'Pinterest conversion tracking' },
  li_sugr: { owner: 'LinkedIn', purpose: 'Browser ID for ads' },
  bcookie: { owner: 'LinkedIn', purpose: 'Browser ID' },
  lidc: { owner: 'LinkedIn', purpose: 'Routing / ad measurement' },
  UserMatchHistory: { owner: 'LinkedIn', purpose: 'Ad ID syncing' },
  personalization_id: { owner: 'X (Twitter)', purpose: 'Ad personalization across sites' },
  muc_ads: { owner: 'X (Twitter)', purpose: 'Ad measurement' },
  uuid2: { owner: 'Xandr (Microsoft)', purpose: 'Ad exchange user ID' },
  anj: { owner: 'Xandr (Microsoft)', purpose: 'Ad exchange user ID' },
  uid: { owner: 'Ad tech (various)', purpose: 'Advertising user ID' },
  cto_bundle: { owner: 'Criteo', purpose: 'Retargeting ads user ID bundle' },
  criteo_write_test: { owner: 'Criteo', purpose: 'Cookie check for retargeting' },
  tuuid: { owner: 'Ad tech (various)', purpose: 'Advertising user ID' },
  TDID: { owner: 'The Trade Desk', purpose: 'Ad exchange user ID' },
  TDCPM: { owner: 'The Trade Desk', purpose: 'Ad exchange user ID' },
  A3: { owner: 'Yahoo', purpose: 'Ad targeting ID' },
  IDSYNC: { owner: 'Yahoo', purpose: 'ID syncing with ad partners' },
  demdex: { owner: 'Adobe', purpose: 'Adobe Audience Manager ID' },
  dpm: { owner: 'Adobe', purpose: 'Adobe Audience Manager ID' },
  s_ecid: { owner: 'Adobe', purpose: 'Adobe Experience Cloud ID' },
  AMCV_: { owner: 'Adobe', purpose: 'Adobe Experience Cloud visitor ID' },
  _scid: { owner: 'Snap', purpose: 'Snap Pixel visitor ID' },
  _rdt_uuid: { owner: 'Reddit', purpose: 'Reddit Pixel visitor ID' },
  ajs_anonymous_id: { owner: 'Segment', purpose: 'Analytics anonymous ID' },
  mp_: { owner: 'Mixpanel', purpose: 'Product analytics ID' },
  _parsely_visitor: { owner: 'Parse.ly', purpose: 'Content analytics visitor ID' },
  OptanonConsent: { owner: 'OneTrust', purpose: 'Stores your consent choice (functional)' },
  OptanonAlertBoxClosed: { owner: 'OneTrust', purpose: 'Remembers the banner was closed (functional)' },
  CookieConsent: { owner: 'Cookiebot', purpose: 'Stores your consent choice (functional)' },
  euconsent: { owner: 'IAB TCF', purpose: 'Stores your consent choice (functional)' },
  'euconsent-v2': { owner: 'IAB TCF', purpose: 'Stores your consent choice (functional)' },
};

const PREFIX: Array<[string, CookieInfo]> = [
  ['_ga_', EXACT._ga!],
  ['_hjSession', { owner: 'Hotjar', purpose: 'Session recording / heatmaps' }],
  ['_hj', { owner: 'Hotjar', purpose: 'Session recording / heatmaps' }],
  ['AMCV_', EXACT.AMCV_!],
  ['mp_', EXACT.mp_!],
  ['_pk_id', { owner: 'Matomo', purpose: 'Analytics visitor ID' }],
  ['_dc_gtm_', { owner: 'Google', purpose: 'Tag Manager rate limiting' }],
];

export const CONSENT_COOKIES = new Set(['OptanonConsent', 'OptanonAlertBoxClosed', 'CookieConsent', 'euconsent', 'euconsent-v2', 'didomi_token', 'usprivacy', 'uc_settings']);

/** Representative tracker domain per owner, used to resolve the TrackerDB organization. */
const OWNER_DOMAIN: Array<[RegExp, string]> = [
  [/^Google/, 'google-analytics.com'], [/^Meta/, 'facebook.net'], [/^TikTok/, 'tiktok.com'],
  [/^Microsoft Clarity/, 'clarity.ms'], [/^Microsoft/, 'bing.com'], [/^Xandr/, 'adnxs.com'], [/^Hotjar/, 'hotjar.com'],
  [/^Pinterest/, 'pinterest.com'], [/^LinkedIn/, 'linkedin.com'], [/^X \(Twitter\)/, 'ads-twitter.com'],
  [/^Criteo/, 'criteo.com'], [/^The Trade Desk/, 'adsrvr.org'], [/^Yahoo/, 'yahoo.com'], [/^Adobe/, 'demdex.net'],
  [/^Snap/, 'sc-static.net'], [/^Reddit/, 'redditstatic.com'], [/^Segment/, 'segment.com'], [/^Mixpanel/, 'mixpanel.com'],
  [/^Parse\.ly/, 'parsely.com'], [/^Matomo/, 'matomo.cloud'],
];

export function ownerDomain(owner: string): string | null {
  for (const [re, d] of OWNER_DOMAIN) if (re.test(owner)) return d;
  return null;
}

export function describeCookie(name: string): CookieInfo | null {
  if (EXACT[name]) return EXACT[name]!;
  for (const [p, info] of PREFIX) if (name.startsWith(p)) return info;
  return null;
}

/** First-party cookies that are known tracker IDs (e.g. _ga set on the site's own domain). */
export function isKnownTrackingCookie(name: string): boolean {
  if (CONSENT_COOKIES.has(name)) return false;
  return describeCookie(name) !== null;
}
