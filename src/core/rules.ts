import { phaseAt, currentReceipt, rejectVerb } from './phase';
import type { Category, ConsentReceipt, Finding, Phase, Tier, TrackerEvent } from './types';

export interface PhaseStats {
  requests: number;
  dataSending: number;
  cookiesSet: string[];
  cookiesSent: string[];
  fingerprint: string[];
  blocked: number;
  idSync: number;
  gcmDeniedPings: number;
  firstTs: number;
}

export interface OrgRow {
  orgId: string;
  orgName: string;
  category: Category | null;
  tier: Tier;
  country: string | null;
  privacyContact: string | null;
  hosts: string[];
  phases: Partial<Record<Phase, PhaseStats>>;
  sampleUrls: string[];
}

export interface SiteReport {
  site: string;
  generatedAt: number;
  receipt: ConsentReceipt | null;
  receipts: ConsentReceipt[];
  cmpDetected: boolean;
  gpc: boolean;
  orgs: OrgRow[];
  findings: Finding[];
  counts: { afterRejectTrackingOrgs: number; preChoiceTrackingOrgs: number; trackingOrgs: number; thirdPartyOrgs: number };
}

export interface OrgMeta { country: string | null; privacyContact: string | null }

function emptyStats(ts: number): PhaseStats {
  return { requests: 0, dataSending: 0, cookiesSet: [], cookiesSent: [], fingerprint: [], blocked: 0, idSync: 0, gcmDeniedPings: 0, firstTs: ts };
}
function pushUnique(arr: string[], v: string, max = 20) {
  if (!arr.includes(v) && arr.length < max) arr.push(v);
}

export function buildReport(
  site: string,
  events: readonly TrackerEvent[],
  receipts: readonly ConsentReceipt[],
  opts: { cmpDetected: boolean; gpc: boolean; orgMeta?: (orgId: string) => OrgMeta | null; now?: number },
): SiteReport {
  const rows = new Map<string, OrgRow>();
  const sorted = [...receipts].sort((a, b) => a.ts - b.ts);

  for (const e of events) {
    if (e.site !== site) continue;
    const key = e.orgId ?? `host:${e.hostSite}`;
    let row = rows.get(key);
    if (!row) {
      const meta = e.orgId && opts.orgMeta ? opts.orgMeta(e.orgId) : null;
      row = {
        orgId: key, orgName: e.orgName ?? e.hostSite, category: e.category, tier: e.tier,
        country: meta?.country ?? null, privacyContact: meta?.privacyContact ?? null,
        hosts: [], phases: {}, sampleUrls: [],
      };
      rows.set(key, row);
    }
    // A known tracking cookie upgrades an org's tier (e.g. first-party _ga → Google).
    if (e.tier === 'tracking') row.tier = 'tracking';
    pushUnique(row.hosts, e.host, 10);
    const phase = phaseAt(e.ts, sorted, opts.cmpDetected);
    const st = (row.phases[phase] ??= emptyStats(e.ts));
    st.firstTs = Math.min(st.firstTs, e.ts);
    switch (e.kind) {
      case 'request':
        st.requests++;
        if (e.dataSending) st.dataSending++;
        if (e.detail?.idSync) st.idSync++;
        if (e.detail?.gcmDenied) st.gcmDeniedPings++;
        if (e.urlRedacted) pushUnique(row.sampleUrls, e.urlRedacted, 5);
        break;
      case 'cookie_set': pushUnique(st.cookiesSet, String(e.detail?.name ?? '?')); break;
      case 'cookie_sent': for (const n of (e.detail?.names as string[] | undefined) ?? []) pushUnique(st.cookiesSent, n); break;
      case 'fingerprint': pushUnique(st.fingerprint, String(e.detail?.api ?? '?')); break;
      case 'blocked': st.blocked++; break;
      case 'storage': break;
      case 'idsync': st.idSync++; break;
    }
  }

  const orgs = [...rows.values()].sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.orgName.localeCompare(b.orgName));
  const findings = deriveFindings(orgs, sorted, opts.gpc);
  const tracking = orgs.filter((o) => o.tier === 'tracking');
  return {
    site,
    generatedAt: opts.now ?? Date.now(),
    receipt: currentReceipt(sorted),
    receipts: sorted,
    cmpDetected: opts.cmpDetected,
    gpc: opts.gpc,
    orgs,
    findings,
    counts: {
      afterRejectTrackingOrgs: tracking.filter((o) => active(o.phases.after_reject)).length,
      preChoiceTrackingOrgs: tracking.filter((o) => active(o.phases.pre_choice)).length,
      trackingOrgs: tracking.length,
      thirdPartyOrgs: orgs.length,
    },
  };
}

function tierRank(t: Tier): number {
  return t === 'tracking' ? 0 : t === 'other' ? 1 : t === 'unknown' ? 2 : 3;
}

/** "Active" = actually contacted or stored something (blocked-only attempts are not counted). */
function active(st: PhaseStats | undefined): boolean {
  return !!st && (st.requests > 0 || st.cookiesSet.length > 0 || st.cookiesSent.length > 0 || st.fingerprint.length > 0);
}

function list(xs: string[], n = 4): string {
  return xs.length <= n ? xs.join(', ') : `${xs.slice(0, n).join(', ')} +${xs.length - n} more`;
}

export function deriveFindings(orgs: OrgRow[], receipts: ConsentReceipt[], gpc: boolean): Finding[] {
  const out: Finding[] = [];
  const v = rejectVerb(currentReceipt(receipts));
  for (const o of orgs) {
    const ar = o.phases.after_reject;
    const pc = o.phases.pre_choice;
    const base = { orgId: o.orgId, orgName: o.orgName, hosts: o.hosts };
    if (o.tier === 'tracking' && ar) {
      if (ar.dataSending > 0) {
        out.push({ ...base, rule: 'R1', severity: 'high', confidence: 'high', count: ar.dataSending, firstTs: ar.firstTs,
          text: `${o.orgName} received ${ar.dataSending} data-sending request(s) after you ${v.past}.` });
      } else if (ar.requests > 0) {
        out.push({ ...base, rule: 'R2', severity: 'medium', confidence: 'high', count: ar.requests, firstTs: ar.firstTs,
          text: `Your browser contacted ${o.orgName} ${ar.requests} time(s) after you ${v.short}. Each contact shares your IP address and the page you are on.` });
      }
      if (ar.cookiesSet.length) {
        out.push({ ...base, rule: 'R3', severity: 'high', confidence: 'high', count: ar.cookiesSet.length, firstTs: ar.firstTs,
          text: `${o.orgName} set tracking cookie(s) after you ${v.short}: ${list(ar.cookiesSet)}.` });
      }
      if (ar.cookiesSent.length) {
        out.push({ ...base, rule: 'R4', severity: 'high', confidence: 'high', count: ar.cookiesSent.length, firstTs: ar.firstTs,
          text: `Existing ${o.orgName} cookies were still sent to it after you ${v.short}: ${list(ar.cookiesSent)}.` });
      }
    }
    if (ar && ar.fingerprint.length) {
      out.push({ ...base, rule: 'R5', severity: 'medium', confidence: 'heuristic', count: ar.fingerprint.length, firstTs: ar.firstTs,
        text: `A script from ${o.orgName} used browser features often used for fingerprinting (${list(ar.fingerprint)}) after you ${v.short}.` });
    }
    const syncs = (ar?.idSync ?? 0) + (pc?.idSync ?? 0) + (o.phases.no_banner?.idSync ?? 0);
    if (syncs > 0) {
      out.push({ ...base, rule: 'R6', severity: ar?.idSync ? 'high' : 'medium', confidence: 'medium', count: syncs,
        firstTs: Math.min(ar?.firstTs ?? Infinity, pc?.firstTs ?? Infinity, o.phases.no_banner?.firstTs ?? Infinity),
        text: `${o.orgName} received an identifier that was also sent to another company on this page (possible ID sharing).` });
    }
    if (o.tier === 'tracking' && pc && (pc.dataSending > 0 || pc.cookiesSet.length > 0)) {
      out.push({ ...base, rule: 'R9', severity: 'medium', confidence: 'high', count: pc.dataSending + pc.cookiesSet.length, firstTs: pc.firstTs,
        text: `${o.orgName} collected data before any consent choice was recorded on this site (a consent platform was present).` });
    }
    if (ar && ar.gcmDeniedPings > 0) {
      out.push({ ...base, rule: 'R10', severity: 'info', confidence: 'high', count: ar.gcmDeniedPings, firstTs: ar.firstTs,
        text: `Google still received ${ar.gcmDeniedPings} "consent denied" ping(s) (Google Consent Mode). Google says these carry no cookies, but they still send page and device details.` });
    }
  }

  // R7: consent platform reports consent after you manually rejected.
  const lastManualReject = [...receipts].reverse().find((r) => r.source === 'manual' && r.choice === 'rejected');
  if (lastManualReject) {
    const conflicting = receipts.find((r) => r.source !== 'manual' && r.userActed && r.ts > lastManualReject.ts && (r.choice === 'accepted' || r.choice === 'partial'));
    const newerManual = receipts.some((r) => r.source === 'manual' && r.ts > lastManualReject.ts);
    if (conflicting && !newerManual) {
      out.push({ rule: 'R7', severity: 'high', confidence: 'medium', orgId: null, orgName: 'Consent banner', count: 1, firstTs: conflicting.ts, hosts: [],
        text: `The site's consent banner reports "${conflicting.choice}" although you marked that you rejected. If you didn't change your mind, your choice was not stored correctly.` });
    }
  }

  // R8: GPC sent but site's US privacy signal says not opted out.
  if (gpc) {
    const gpp = [...receipts].reverse().find((r) => r.source === 'gpp');
    if (gpp && (gpp.choice === 'accepted' || gpp.choice === 'partial')) {
      out.push({ rule: 'R8', severity: 'medium', confidence: 'medium', orgId: null, orgName: 'US privacy signal', count: 1, firstTs: gpp.ts, hosts: [],
        text: 'Your browser sent Global Privacy Control (an opt-out of sale/sharing), but the site\'s own privacy signal still says you have not opted out.' });
    }
  }

  const sevRank = { high: 0, medium: 1, info: 2 } as const;
  const ruleRank: Record<Finding['rule'], number> = { R1: 0, R3: 1, R4: 2, R7: 3, R6: 4, R2: 5, R9: 6, R5: 7, R8: 8, R10: 9 };
  return out.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || ruleRank[a.rule] - ruleRank[b.rule] || a.firstTs - b.firstTs);
}
