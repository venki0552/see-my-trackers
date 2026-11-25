import type { Choice, ConsentSource, ConsentState } from './types';

/** Raw payloads as collected by the page probe (plain, structured-cloneable data). */
export type RawConsent =
  | { type: 'tcf'; eventStatus?: string; tcString?: string; cmpId?: number; gdprApplies?: boolean;
      purposeConsents?: Record<string, boolean>; purposeLI?: Record<string, boolean>; vendorConsents?: Record<string, boolean> }
  | { type: 'gpp'; signalStatus?: string; cmpDisplayStatus?: string; applicableSections?: number[];
      usnat?: Record<string, unknown> | null; uspv1?: string | null }
  | { type: 'onetrust'; activeGroups?: string; alertClosed?: boolean }
  | { type: 'cookiebot'; consent?: Record<string, unknown>; hasResponse?: boolean }
  | { type: 'didomi'; enabled?: string[]; disabled?: string[]; shouldCollect?: boolean }
  | { type: 'usercentrics'; services?: Array<{ status: boolean; category?: string }>; consentRequired?: boolean }
  | { type: 'gcm'; kind: 'default' | 'update'; state: Record<string, string> };

function fromCounts(granted: number, denied: number): Choice {
  if (granted === 0 && denied === 0) return 'unknown';
  if (granted === 0) return 'rejected';
  if (denied === 0) return 'accepted';
  return 'partial';
}

function truthyMap(m: Record<string, unknown> | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!m) return out;
  for (const [k, v] of Object.entries(m)) out[k] = v === true || v === 1 || v === '1';
  return out;
}

export function normalizeTcf(r: Extract<RawConsent, { type: 'tcf' }>): ConsentState | null {
  if (r.gdprApplies === false) return null; // TCF says GDPR does not apply → no EU choice to record
  const purposes = truthyMap(r.purposeConsents);
  const li = truthyMap(r.purposeLI);
  const userActed =
    r.eventStatus === 'useractioncomplete' || (r.eventStatus === 'tcloaded' && !!r.tcString);
  // Purpose 1 (store/access on device) alone does not authorise tracking; judge on purposes 2..11.
  let granted = 0;
  let denied = 0;
  for (let p = 2; p <= 11; p++) {
    const v = purposes[String(p)];
    if (v === true) granted++;
    else denied++;
  }
  const vendorConsentCount = Object.values(truthyMap(r.vendorConsents)).filter(Boolean).length;
  return {
    source: 'tcf',
    choice: userActed ? fromCounts(granted, denied) : 'unknown',
    userActed,
    purposes,
    legitimateInterest: li,
    vendorConsentCount,
    cmpId: r.cmpId,
    raw: `TCF purposes granted: ${granted}/10, vendors with consent: ${vendorConsentCount}`,
  };
}

/** US Privacy string (CCPA) "1YNN": char 3 (index 2) = opted out of sale (Y/N/-). */
export function uspOptedOut(usp: string | null | undefined): boolean | null {
  if (!usp || usp.length < 4) return null;
  const c = usp[2]?.toUpperCase();
  if (c === 'Y') return true;
  if (c === 'N') return false;
  return null;
}

export function normalizeGpp(r: Extract<RawConsent, { type: 'gpp' }>): ConsentState | null {
  const n = r.usnat;
  let granted = 0;
  let denied = 0;
  if (n) {
    for (const key of ['SaleOptOut', 'SharingOptOut', 'TargetedAdvertisingOptOut']) {
      const v = Number(n[key]);
      if (v === 1) denied++; // 1 = opted out
      else if (v === 2) granted++; // 2 = did not opt out
    }
  }
  const usp = uspOptedOut(r.uspv1);
  if (usp === true) denied++;
  if (usp === false) granted++;
  if (granted === 0 && denied === 0) return null;
  const gpcHonored = n?.Gpc === true;
  // A recorded opt-out (or GPC) counts as the user's choice even while the site shows its notice.
  const userActed = r.signalStatus !== 'not ready' && (r.cmpDisplayStatus !== 'visible' || denied > 0 || gpcHonored);
  return {
    source: 'gpp',
    choice: fromCounts(granted, denied),
    userActed,
    raw: `US opt-out signals: ${denied} opted out, ${granted} not opted out${gpcHonored ? ' (site recorded your Global Privacy Control signal)' : ''}`,
  };
}

export function normalizeOneTrust(r: Extract<RawConsent, { type: 'onetrust' }>): ConsentState | null {
  if (typeof r.activeGroups !== 'string') return null;
  const groups = new Set(r.activeGroups.split(',').map((s) => s.trim()).filter(Boolean));
  // C0002 performance/analytics, C0004 targeting, C0005 social media
  const optional = ['C0002', 'C0004', 'C0005'];
  const granted = optional.filter((g) => groups.has(g)).length;
  const denied = optional.length - granted;
  const userActed = !!r.alertClosed;
  return {
    source: 'onetrust',
    choice: userActed ? fromCounts(granted, denied) : 'unknown',
    userActed,
    purposes: Object.fromEntries(optional.map((g) => [g, groups.has(g)])),
    raw: `OneTrust active groups: ${[...groups].join(',')}`,
  };
}

export function normalizeCookiebot(r: Extract<RawConsent, { type: 'cookiebot' }>): ConsentState | null {
  if (!r.consent) return null;
  const c = r.consent;
  const keys = ['preferences', 'statistics', 'marketing'];
  const purposes = Object.fromEntries(keys.map((k) => [k, c[k] === true]));
  const granted = ['statistics', 'marketing'].filter((k) => c[k] === true).length;
  const denied = 2 - granted;
  const userActed = !!r.hasResponse;
  return {
    source: 'cookiebot',
    choice: userActed ? fromCounts(granted, denied) : 'unknown',
    userActed,
    purposes,
    raw: `Cookiebot statistics=${c.statistics} marketing=${c.marketing}`,
  };
}

export function normalizeDidomi(r: Extract<RawConsent, { type: 'didomi' }>): ConsentState | null {
  if (!r.enabled && !r.disabled) return null;
  const enabled = r.enabled ?? [];
  const disabled = r.disabled ?? [];
  const userActed = r.shouldCollect === false;
  return {
    source: 'didomi',
    choice: userActed ? fromCounts(enabled.length, disabled.length) : 'unknown',
    userActed,
    raw: `Didomi purposes enabled: ${enabled.length}, disabled: ${disabled.length}`,
  };
}

export function normalizeUsercentrics(r: Extract<RawConsent, { type: 'usercentrics' }>): ConsentState | null {
  if (!r.services?.length) return null;
  const optional = r.services.filter((s) => s.category !== 'essential');
  const granted = optional.filter((s) => s.status).length;
  const denied = optional.length - granted;
  const userActed = r.consentRequired === false;
  return {
    source: 'usercentrics',
    choice: userActed ? fromCounts(granted, denied) : 'unknown',
    userActed,
    raw: `Usercentrics optional services consented: ${granted}/${optional.length}`,
  };
}

export function normalizeGcm(r: Extract<RawConsent, { type: 'gcm' }>): ConsentState | null {
  const keys = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];
  let granted = 0;
  let denied = 0;
  const purposes: Record<string, boolean> = {};
  for (const k of keys) {
    const v = r.state[k];
    if (v === 'granted') { granted++; purposes[k] = true; }
    else if (v === 'denied') { denied++; purposes[k] = false; }
  }
  if (granted === 0 && denied === 0) return null;
  const userActed = r.kind === 'update';
  return {
    source: 'gcm',
    choice: userActed ? fromCounts(granted, denied) : 'unknown',
    userActed,
    purposes,
    raw: `Google Consent Mode ${r.kind}: ${Object.entries(purposes).map(([k, v]) => `${k}=${v ? 'granted' : 'denied'}`).join(', ')}`,
  };
}

export function normalizeConsent(r: RawConsent): ConsentState | null {
  switch (r.type) {
    case 'tcf': return normalizeTcf(r);
    case 'gpp': return normalizeGpp(r);
    case 'onetrust': return normalizeOneTrust(r);
    case 'cookiebot': return normalizeCookiebot(r);
    case 'didomi': return normalizeDidomi(r);
    case 'usercentrics': return normalizeUsercentrics(r);
    case 'gcm': return normalizeGcm(r);
    default: return null;
  }
}

export const SOURCE_LABEL: Record<ConsentSource, string> = {
  tcf: 'IAB TCF consent banner',
  gpp: 'IAB Global Privacy Platform',
  onetrust: 'OneTrust banner',
  cookiebot: 'Cookiebot banner',
  didomi: 'Didomi banner',
  usercentrics: 'Usercentrics banner',
  gcm: 'Google Consent Mode',
  manual: 'You (marked manually)',
};

/** Precedence when several CMP signals arrive for one site. Manual always wins. */
export const SOURCE_RANK: Record<ConsentSource, number> = {
  manual: 100, tcf: 60, onetrust: 55, cookiebot: 55, didomi: 55, usercentrics: 55, gpp: 40, gcm: 30,
};
