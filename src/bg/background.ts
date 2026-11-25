import trackerData from '../../data/trackers.json';
import { api, DEFAULT_SETTINGS, IS_FIREFOX, type Msg, type PageMsg, type Settings } from '../shared/api';
import { siteOf, hostOf, isThirdParty, isWebUrl } from '../core/domain';
import { TrackerIndex, tierOf, type TrackerData } from '../core/trackers';
import { normalizeConsent, type RawConsent } from '../core/consent';
import { phaseAt } from '../core/phase';
import { redactUrl, hashValue } from '../core/redact';
import { isDataSending, idParams, parseGcs, cookieNames, parseSetCookie } from '../core/signals';
import { IdSyncTracker } from '../core/idsync';
import { describeCookie, isKnownTrackingCookie, ownerDomain, CONSENT_COOKIES } from '../core/cookies';
import { buildReport, type SiteReport } from '../core/rules';
import type { ConsentReceipt, TrackerEvent, TrackerInfo, Phase } from '../core/types';
import * as store from './store';
import { renderHtmlReport } from './report-html';

declare const __TEST__: boolean;
declare const __BRIDGE_READONLY__: boolean;
const idx = new TrackerIndex(trackerData as unknown as TrackerData);
const VERSION = api.runtime.getManifest().version;

// ---------------- settings ----------------
let settings: Settings | null = null;
async function getSettings(): Promise<Settings> {
  if (settings) return settings;
  const got = (await api.storage.local.get('settings')) as { settings?: Partial<Settings> };
  const s = { ...DEFAULT_SETTINGS, ...(got.settings ?? {}) } as Settings;
  if (!s.salt) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    s.salt = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    await api.storage.local.set({ settings: s });
  }
  settings = s;
  return s;
}
async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = { ...(await getSettings()), ...patch };
  settings = s;
  await api.storage.local.set({ settings: s });
  return s;
}

// ---------------- per-tab page state ----------------
interface TabState {
  site: string;
  url: string;
  startedAt: number;
  cmpDetected: boolean;
  cmpNames: string[];
  idsync: IdSyncTracker;
  afterReject: Set<string>;
  preChoice: Set<string>;
  orgHosts: Map<string, { info: TrackerInfo | null; host: string }>;
  scriptHosts: Set<string>;
  stored: number;
}
const tabs = new Map<number, TabState>();

function newTabState(url: string, ts: number): TabState {
  return { site: siteOf(url), url, startedAt: ts, cmpDetected: false, cmpNames: [], idsync: new IdSyncTracker(), afterReject: new Set(), preChoice: new Set(), orgHosts: new Map(), scriptHosts: new Set(), stored: 0 };
}

async function persistTab(tabId: number): Promise<void> {
  const t = tabs.get(tabId);
  if (!t || !api.storage.session) return;
  try {
    await api.storage.session.set({ [`tab:${tabId}`]: { site: t.site, url: t.url, startedAt: t.startedAt, cmpDetected: t.cmpDetected, cmpNames: t.cmpNames } });
  } catch { /* storage.session may be unavailable */ }
}

/** Recover tab state after a service-worker restart. */
async function tabState(tabId: number): Promise<TabState | null> {
  const t = tabs.get(tabId);
  if (t) return t;
  try {
    const key = `tab:${tabId}`;
    const got = api.storage.session ? ((await api.storage.session.get(key)) as Record<string, any>)[key] : null;
    if (got) {
      const s = newTabState(got.url, got.startedAt);
      s.cmpDetected = got.cmpDetected;
      s.cmpNames = got.cmpNames ?? [];
      tabs.set(tabId, s);
      return s;
    }
    const tab = await api.tabs.get(tabId);
    if (tab?.url && isWebUrl(tab.url)) {
      const s = newTabState(tab.url, Date.now());
      tabs.set(tabId, s);
      return s;
    }
  } catch { /* tab gone */ }
  return null;
}

function startPage(tabId: number, url: string, ts: number): void {
  const prev = tabs.get(tabId);
  // Same-document navigations / redirects to the same site keep the session.
  if (prev && prev.site === siteOf(url) && ts - prev.startedAt < 1500) { prev.url = url; return; }
  tabs.set(tabId, newTabState(url, ts));
  void store.getReceipts(siteOf(url));
  void persistTab(tabId);
  void updateBadge(tabId);
}

// ---------------- classification ----------------
function phaseNow(t: TabState, ts: number): Phase {
  const rs = store.cachedReceipts(t.site) ?? [];
  return phaseAt(ts, rs, t.cmpDetected);
}

function makeEvent(t: TabState, tabId: number, host: string, info: TrackerInfo | null, partial: Partial<TrackerEvent>, ts: number): TrackerEvent {
  const tier = info ? tierOf(info.category) : 'unknown';
  return {
    ts, tabId, site: t.site, host, hostSite: siteOf(host),
    orgId: info?.orgId ?? null, orgName: info?.orgName ?? null, category: info?.category ?? null,
    tier, kind: 'request', dataSending: false, phase: phaseNow(t, ts), ...partial,
  };
}

/** Per-page storage cap: a hostile page can fire unlimited requests; never let it flood IndexedDB. */
const MAX_EVENTS_PER_PAGE = 5000;

function record(t: TabState, tabId: number, e: TrackerEvent): void {
  if (t.stored < MAX_EVENTS_PER_PAGE) { t.stored++; store.addEvent(e); }
  if (e.tier === 'tracking' && e.kind !== 'blocked' && e.kind !== 'idsync') {
    const k = e.orgId ?? e.hostSite;
    const before = t.afterReject.size + t.preChoice.size * 1000;
    if (e.phase === 'after_reject') t.afterReject.add(k);
    else if (e.phase === 'pre_choice') t.preChoice.add(k);
    if (t.afterReject.size + t.preChoice.size * 1000 !== before) scheduleBadge(tabId);
  }
}

async function isPaused(site: string): Promise<boolean> {
  return !!(await getSettings()).pausedSites[site];
}

// ---------------- webRequest listeners (registered synchronously at top level) ----------------
interface Hdr { name: string; value?: string }
interface ReqDetails { url: string; type: string; tabId: number; timeStamp: number; method?: string; requestBody?: { raw?: unknown[]; formData?: unknown } | null; initiator?: string; documentUrl?: string; originUrl?: string }
interface HdrDetails extends ReqDetails { requestHeaders?: Hdr[]; responseHeaders?: Hdr[] }
interface ErrDetails extends ReqDetails { error: string }

function pageUrlOf(d: { initiator?: string; documentUrl?: string; originUrl?: string }): string | undefined {
  return d.documentUrl ?? d.originUrl ?? d.initiator;
}

async function onBeforeRequest(d: ReqDetails): Promise<void> {
  if (!isWebUrl(d.url)) return;
  if (d.type === 'main_frame') { if (d.tabId >= 0) startPage(d.tabId, d.url, d.timeStamp); return; }
  if (d.tabId < 0) return; // service-worker / extension requests (documented limitation)
  const t = await tabState(d.tabId);
  if (!t || !t.site) return;
  const host = hostOf(d.url);
  if (!isThirdParty(host, t.site, idx.ownerOf)) return;
  if (await isPaused(t.site)) return;
  if (d.type === 'script' && t.scriptHosts.size < 500) t.scriptHosts.add(host);
  const s = await getSettings();
  const info = idx.lookup(host);
  const hasBody = !!(d.requestBody && (d.requestBody.raw?.length || d.requestBody.formData));
  const dataSending = isDataSending(d.type, d.url, d.method, hasBody);
  const detail: Record<string, unknown> = {};
  if (info?.orgId === 'google') {
    const g = parseGcs(d.url);
    if (g && !g.ad && !g.analytics) detail.gcmDenied = true;
  }
  const e = makeEvent(t, d.tabId, host, info, { kind: 'request', reqType: d.type, dataSending, urlRedacted: redactUrl(d.url, s.salt), detail }, d.timeStamp);
  record(t, d.tabId, e);
  // ID sync: same identifier value reaching 2+ different organizations on this page.
  const orgKey = info?.orgId ?? siteOf(host);
  if (!t.orgHosts.has(orgKey)) t.orgHosts.set(orgKey, { info, host });
  for (const [, v] of idParams(d.url)) {
    const h = hashValue(v, s.salt);
    const orgs = t.idsync.record(h, orgKey);
    if (orgs) {
      const names = orgs.map((o) => t.orgHosts.get(o)?.info?.orgName ?? o);
      for (const o of orgs) {
        const known = t.orgHosts.get(o) ?? { info: null, host: o };
        record(t, d.tabId, makeEvent(t, d.tabId, known.host, known.info, { kind: 'idsync', detail: { hash: h, orgs: names } }, d.timeStamp));
      }
    }
  }
}

async function onSendHeaders(d: HdrDetails): Promise<void> {
  if (d.tabId < 0 || d.type === 'main_frame' || !isWebUrl(d.url)) return;
  const t = await tabState(d.tabId);
  if (!t || !t.site) return;
  const host = hostOf(d.url);
  if (!isThirdParty(host, t.site, idx.ownerOf)) return;
  const cookie = d.requestHeaders?.find((h) => h.name.toLowerCase() === 'cookie')?.value;
  if (!cookie) return;
  const info = idx.lookup(host);
  const tier = info ? tierOf(info.category) : 'unknown';
  const names = cookieNames(cookie).filter((n) => !CONSENT_COOKIES.has(n));
  const relevant = tier === 'tracking' ? names : names.filter(isKnownTrackingCookie);
  if (!relevant.length || (await isPaused(t.site))) return;
  const e = makeEvent(t, d.tabId, host, info, { kind: 'cookie_sent', detail: { names: relevant.slice(0, 20) } }, d.timeStamp);
  if (tier !== 'tracking') e.tier = 'tracking';
  record(t, d.tabId, e);
}

async function onHeadersReceived(d: HdrDetails): Promise<void> {
  if (d.tabId < 0 || d.type === 'main_frame' || !isWebUrl(d.url)) return;
  const setCookies = d.responseHeaders?.filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value ?? '') ?? [];
  if (!setCookies.length) return;
  const t = await tabState(d.tabId);
  if (!t || !t.site) return;
  const host = hostOf(d.url);
  if (!isThirdParty(host, t.site, idx.ownerOf)) return;
  if (await isPaused(t.site)) return;
  const info = idx.lookup(host);
  const tier = info ? tierOf(info.category) : 'unknown';
  for (const c of parseSetCookie(setCookies)) {
    if (CONSENT_COOKIES.has(c.name)) continue;
    if (c.maxAgeSec !== null && c.maxAgeSec <= 0) continue; // deletion
    if (tier !== 'tracking' && !isKnownTrackingCookie(c.name)) continue;
    const e = makeEvent(t, d.tabId, host, info, { kind: 'cookie_set', detail: { name: c.name, maxAgeSec: c.maxAgeSec, via: 'header' } }, d.timeStamp);
    e.tier = 'tracking';
    record(t, d.tabId, e);
  }
}

const BLOCK_ERRORS = /ERR_BLOCKED_BY_CLIENT|NS_ERROR_TRACKING_URI|NS_ERROR_BLOCKED_BY_POLICY|NS_ERROR_CONTENT_BLOCKED|NS_ERROR_ABORT/;
async function onErrorOccurred(d: ErrDetails): Promise<void> {
  if (d.tabId < 0 || d.type === 'main_frame' || !isWebUrl(d.url) || !BLOCK_ERRORS.test(d.error)) return;
  const t = await tabState(d.tabId);
  if (!t || !t.site) return;
  const host = hostOf(d.url);
  if (!isThirdParty(host, t.site, idx.ownerOf)) return;
  const info = idx.lookup(host);
  record(t, d.tabId, makeEvent(t, d.tabId, host, info, { kind: 'blocked', reqType: d.type, detail: { error: d.error } }, d.timeStamp));
}

const FILTER = { urls: ['<all_urls>'] };
function addListenerCompat(ev: any, fn: any, specs: string[]) {
  try { ev.addListener(fn, FILTER, specs); } catch {
    ev.addListener(fn, FILTER, specs.filter((s) => s !== 'extraHeaders'));
  }
}
const safe = <T>(fn: (d: T) => Promise<void>) => (d: T) => { fn(d).catch((err) => console.warn('[smt]', err)); };
addListenerCompat(api.webRequest.onBeforeRequest, safe(onBeforeRequest), ['requestBody']);
addListenerCompat(api.webRequest.onSendHeaders, safe(onSendHeaders), IS_FIREFOX ? ['requestHeaders'] : ['requestHeaders', 'extraHeaders']);
addListenerCompat(api.webRequest.onHeadersReceived, safe(onHeadersReceived), IS_FIREFOX ? ['responseHeaders'] : ['responseHeaders', 'extraHeaders']);
(api.webRequest.onErrorOccurred as any).addListener(safe(onErrorOccurred), FILTER);

// Navigation: authoritative page start (covers bfcache / prerender activations).
api.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0 || !isWebUrl(d.url)) return;
  const t = tabs.get(d.tabId);
  if (!t || t.url !== d.url) startPage(d.tabId, d.url, d.timeStamp);
});
api.tabs.onRemoved.addListener((tabId) => { tabs.delete(tabId); void api.storage.session?.remove(`tab:${tabId}`); });

// First-party tracking cookies written by scripts (e.g. _ga, _fbp on the site's own domain).
api.cookies.onChanged.addListener((info) => {
  void (async () => {
    if (info.removed || !isKnownTrackingCookie(info.cookie.name)) return;
    const cookieSite = siteOf(info.cookie.domain.replace(/^\./, ''));
    for (const [tabId, t] of tabs) {
      if (t.site !== cookieSite || (await isPaused(t.site))) continue;
      const desc = describeCookie(info.cookie.name)!;
      const od = ownerDomain(desc.owner);
      const orgInfo = od ? idx.lookup(od) : null;
      const e = makeEvent(t, tabId, info.cookie.domain.replace(/^\./, ''), orgInfo, { kind: 'cookie_set', detail: { name: info.cookie.name, via: 'script', firstParty: true } }, Date.now());
      if (!orgInfo) { e.orgName = desc.owner; e.orgId = `owner:${desc.owner}`; }
      e.tier = 'tracking';
      e.category = orgInfo?.category ?? 'site_analytics';
      record(t, tabId, e);
      break; // attribute to one tab
    }
  })();
});

// ---------------- page probe messages ----------------
api.runtime.onMessage.addListener((msg: Msg | PageMsg, sender, sendResponse) => {
  if ((msg as PageMsg).type === 'page') {
    if (__TEST__ && (msg as any).kind === 'test' && sender.tab?.id !== undefined) {
      const req = (msg as any).payload as Msg;
      // Validation builds expose only this tab's read-only report; CI test builds expose everything.
      if (__BRIDGE_READONLY__ && req.type !== 'getTabReport') { sendResponse({ error: 'read-only bridge' }); return false; }
      const forTab = req.type === 'getTabReport' || req.type === 'setManualReceipt' ? { ...req, tabId: sender.tab.id } : req;
      handleUi(forTab as Msg).then(sendResponse, (err) => sendResponse({ error: String(err) }));
      return true;
    }
    void handlePage(msg as PageMsg, sender);
    return false;
  }
  // UI messages must come from our own extension pages.
  if (sender.id !== api.runtime.id || (sender.tab && !sender.url?.startsWith(api.runtime.getURL('')))) return false;
  handleUi(msg as Msg).then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true;
});

async function handlePage(msg: PageMsg, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0) return;
  const t = await tabState(tabId);
  if (!t || !t.site) return;
  const now = Date.now();
  if (msg.kind === 'cmp') {
    if (sender.frameId !== 0) return;
    if (!t.cmpDetected || !t.cmpNames.includes(msg.payload.name)) {
      t.cmpDetected = true;
      if (!t.cmpNames.includes(msg.payload.name)) t.cmpNames.push(msg.payload.name);
      void persistTab(tabId);
    }
    return;
  }
  if (msg.kind === 'consent') {
    if (sender.frameId !== 0) return;
    const state = normalizeConsent(msg.payload as RawConsent);
    if (!state) return;
    t.cmpDetected = true;
    if (!t.cmpNames.includes(state.source)) t.cmpNames.push(state.source);
    void persistTab(tabId);
    if (!state.userActed) return;
    const s = await getSettings();
    const changed = await store.addReceipt({ ...state, site: t.site, ts: now, gpc: s.gpc });
    if (changed) { t.afterReject.clear(); t.preChoice.clear(); scheduleBadge(tabId); }
    return;
  }
  if (await isPaused(t.site)) return;
  if (msg.kind === 'fingerprint') {
    const scriptUrl = msg.payload.scriptUrl;
    const host = scriptUrl && isWebUrl(scriptUrl) ? hostOf(scriptUrl) : '';
    if (!host || !isThirdParty(host, t.site, idx.ownerOf)) return; // only third-party scripts
    // The page probe runs in the page's world, so a hostile page could forge a report blaming
    // another company. Only accept attributions to script hosts this tab really loaded.
    if (!t.scriptHosts.has(host)) return;
    const info = idx.lookup(host);
    record(t, tabId, makeEvent(t, tabId, host, info, { kind: 'fingerprint', detail: { api: String(msg.payload.api).slice(0, 60) } }, now));
  }
}

// ---------------- badge ----------------
const badgeTimers = new Map<number, ReturnType<typeof setTimeout>>();
function scheduleBadge(tabId: number) {
  if (badgeTimers.has(tabId)) return;
  badgeTimers.set(tabId, setTimeout(() => { badgeTimers.delete(tabId); void updateBadge(tabId); }, 300));
}
async function updateBadge(tabId: number): Promise<void> {
  const t = tabs.get(tabId);
  try {
    if (!t) { await api.action.setBadgeText({ tabId, text: '' }); return; }
    const n = t.afterReject.size;
    const p = t.preChoice.size;
    if (n > 0) {
      await api.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
      await api.action.setBadgeText({ tabId, text: String(n) });
      await api.action.setTitle({ tabId, title: `See My Trackers: ${n} tracking compan${n === 1 ? 'y' : 'ies'} contacted after you rejected` });
    } else if (p > 0) {
      await api.action.setBadgeBackgroundColor({ tabId, color: '#e8710a' });
      await api.action.setBadgeText({ tabId, text: String(p) });
      await api.action.setTitle({ tabId, title: `See My Trackers: ${p} tracking compan${p === 1 ? 'y' : 'ies'} before any consent choice was recorded` });
    } else {
      await api.action.setBadgeText({ tabId, text: '' });
      await api.action.setTitle({ tabId, title: 'See My Trackers' });
    }
  } catch { /* tab closed */ }
}

// ---------------- reports ----------------
const orgMeta = idx.orgMeta;

async function tabReport(tabId: number): Promise<(SiteReport & { tabUrl: string; pageStartedAt: number; enforce: boolean; paused: boolean; cmpNames: string[] }) | null> {
  const t = await tabState(tabId);
  if (!t || !t.site) return null;
  const s = await getSettings();
  const [events, receipts] = await Promise.all([store.eventsForSite(t.site, t.startedAt, tabId), store.getReceipts(t.site)]);
  const rep = buildReport(t.site, events, receipts, { cmpDetected: t.cmpDetected, gpc: s.gpc, orgMeta });
  // Keep badge in sync with the exact report.
  t.afterReject = new Set(rep.orgs.filter((o) => o.tier === 'tracking' && o.phases.after_reject && (o.phases.after_reject.requests || o.phases.after_reject.cookiesSet.length || o.phases.after_reject.cookiesSent.length)).map((o) => o.orgId));
  t.preChoice = new Set(rep.orgs.filter((o) => o.tier === 'tracking' && o.phases.pre_choice && o.phases.pre_choice.requests).map((o) => o.orgId));
  void updateBadge(tabId);
  return { ...rep, tabUrl: t.url, pageStartedAt: t.startedAt, enforce: !!s.enforce[t.site], paused: !!s.pausedSites[t.site], cmpNames: t.cmpNames };
}

async function siteReport(site: string): Promise<SiteReport> {
  const s = await getSettings();
  const [events, receipts] = await Promise.all([store.eventsForSite(site), store.getReceipts(site)]);
  const cmp = receipts.length > 0 || events.some((e) => e.phase !== 'no_banner');
  return buildReport(site, events, receipts, { cmpDetected: cmp, gpc: s.gpc, orgMeta });
}

async function profile() {
  const [aggs, receiptRows] = await Promise.all([store.allAggregates(), store.allReceiptSites()]);
  // Sites with a consent banner: activity recorded before the banner was detected counts as "before you chose".
  const bannerSites = new Set(receiptRows.map((r) => r.site));
  const byOrg = new Map<string, { orgKey: string; orgName: string; category: string | null; tier: string; sites: Set<string>; afterRejectSites: Set<string>; preChoiceSites: Set<string>; lastTs: number; total: number }>();
  for (const a of aggs) {
    let o = byOrg.get(a.orgKey);
    if (!o) { o = { orgKey: a.orgKey, orgName: a.orgName, category: a.category, tier: a.tier, sites: new Set(), afterRejectSites: new Set(), preChoiceSites: new Set(), lastTs: 0, total: 0 }; byOrg.set(a.orgKey, o); }
    if (a.tier === 'tracking') o.tier = 'tracking';
    o.sites.add(a.site);
    if (a.counts.after_reject) o.afterRejectSites.add(a.site);
    if (a.counts.pre_choice || (a.counts.no_banner && bannerSites.has(a.site))) o.preChoiceSites.add(a.site);
    o.lastTs = Math.max(o.lastTs, a.lastTs);
    o.total += Object.values(a.counts).reduce((x, y) => x + (y ?? 0), 0);
  }
  const allSites = new Set(aggs.map((a) => a.site));
  return {
    totalSites: allSites.size,
    orgs: [...byOrg.values()].map((o) => ({ ...o, sites: [...o.sites], afterRejectSites: [...o.afterRejectSites], preChoiceSites: [...o.preChoiceSites] }))
      .sort((a, b) => b.afterRejectSites.length - a.afterRejectSites.length || b.sites.length - a.sites.length),
  };
}

async function listSites() {
  const [aggs, receipts] = await Promise.all([store.allAggregates(), store.allReceiptSites()]);
  const sites = new Map<string, { site: string; trackingOrgs: Set<string>; afterRejectOrgs: Set<string>; lastTs: number; choice: string | null }>();
  for (const a of aggs) {
    let s = sites.get(a.site);
    if (!s) { s = { site: a.site, trackingOrgs: new Set(), afterRejectOrgs: new Set(), lastTs: 0, choice: null }; sites.set(a.site, s); }
    if (a.tier === 'tracking') s.trackingOrgs.add(a.orgKey);
    if (a.tier === 'tracking' && a.counts.after_reject) s.afterRejectOrgs.add(a.orgKey);
    s.lastTs = Math.max(s.lastTs, a.lastTs);
  }
  for (const r of receipts) {
    const last = [...r.list].reverse().find((x) => x.userActed);
    let s = sites.get(r.site);
    if (!s) { s = { site: r.site, trackingOrgs: new Set(), afterRejectOrgs: new Set(), lastTs: last?.ts ?? 0, choice: null }; sites.set(r.site, s); }
    s.choice = last?.choice ?? null;
  }
  return [...sites.values()].map((s) => ({ site: s.site, trackingOrgs: s.trackingOrgs.size, afterRejectOrgs: s.afterRejectOrgs.size, lastTs: s.lastTs, choice: s.choice }))
    .sort((a, b) => b.lastTs - a.lastTs);
}

/** Browser name + major version only: a full user-agent string in a shared report is itself identifying. */
function coarseBrowser(): string {
  const ua = navigator.userAgent;
  const m = ua.match(/(Firefox|Edg|Chrome)\/(\d+)/);
  if (!m) return 'unknown';
  return `${m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2]}`;
}

async function exportSite(site: string) {
  const rep = await siteReport(site);
  const events = await store.eventsForSite(site);
  const json = {
    tool: 'See My Trackers', version: VERSION, trackerDb: `Ghostery TrackerDB ${idx.version} (CC BY-NC-SA 4.0)`,
    exportedAt: new Date().toISOString(), browser: coarseBrowser(),
    note: 'Parameter values in URLs are replaced by salted hashes (#...) so no personal data is exported. Observations only; not legal advice.',
    report: rep,
    events: events.map(({ tabId: _t, ...e }) => ({ ...e, time: new Date(e.ts).toISOString() })),
  };
  return { json, html: renderHtmlReport(rep, { version: VERSION, trackerDb: idx.version }) };
}

// ---------------- enforce + GPC (declarativeNetRequest) ----------------
const GPC_RULE_ID = 1;
async function applyGpc(on: boolean): Promise<void> {
  const ALL = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other', ...(IS_FIREFOX ? ['beacon', 'imageset'] : [])] as any;
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [GPC_RULE_ID],
    addRules: on ? [{ id: GPC_RULE_ID, priority: 1, action: { type: 'modifyHeaders' as any, requestHeaders: [{ header: 'Sec-GPC', operation: 'set' as any, value: '1' }] }, condition: { resourceTypes: ALL } }] : [],
  });
  try {
    const existing = await api.scripting.getRegisteredContentScripts({ ids: ['gpc'] });
    if (on && !existing.length) {
      await api.scripting.registerContentScripts([{ id: 'gpc', js: ['gpc.js'], matches: ['<all_urls>'], runAt: 'document_start', allFrames: true, world: 'MAIN' as any, persistAcrossSessions: true } as any]);
    } else if (!on && existing.length) {
      await api.scripting.unregisterContentScripts({ ids: ['gpc'] });
    }
  } catch (err) { console.warn('[smt] GPC JS signal unavailable in this browser', err); }
}

/** Sign-in and anti-bot hosts that share an apex domain with ad products: never blocked by Enforce. */
const AUTH_AND_CAPTCHA_HOSTS = [
  'accounts.google.com', 'recaptcha.net', 'www.recaptcha.net', 'appleid.apple.com',
  'login.microsoftonline.com', 'login.live.com', 'challenges.cloudflare.com',
];
/** reCAPTCHA is served from www.google.com/recaptcha/: allow just that path, at higher priority. */
const ALLOW_PATHS = ['||www.google.com/recaptcha/', '||www.gstatic.com/recaptcha/'];
const ALLOW_RULE_OFFSET = 1_000_000;

function ruleIdForSite(site: string): number {
  let h = 0;
  for (let i = 0; i < site.length; i++) h = (Math.imul(h, 31) + site.charCodeAt(i)) >>> 0;
  return 1000 + (h % 1_000_000);
}

async function applyEnforce(site: string, on: boolean): Promise<{ blockedDomains: number; cookiesDeleted?: number }> {
  const id = ruleIdForSite(site);
  if (!on) {
    await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id, ...ALLOW_PATHS.map((_, i) => id + ALLOW_RULE_OFFSET * (i + 1))] });
    return { blockedDomains: 0 };
  }
  const aggs = await store.aggregatesForSite(site);
  const siteOwner = idx.ownerOf(site);
  const domains = new Set<string>();
  for (const a of aggs) {
    if (a.tier !== 'tracking') continue;
    if (a.orgKey.startsWith('host:')) { domains.add(a.orgKey.slice(5)); continue; }
    if (a.orgKey.startsWith('owner:') || a.orgKey === siteOwner) continue;
    for (const d of idx.trackingDomainsOfOrg(a.orgKey)) domains.add(d);
  }
  domains.delete(site);
  // Never block or wipe a domain the user visits directly (e.g. google.com): it would break
  // sign-in widgets and log the user out everywhere.
  const visited = new Set((await store.allAggregates()).map((a) => a.site));
  for (const r of await store.allReceiptSites()) visited.add(r.site);
  for (const v of visited) domains.delete(v);
  const list = [...domains].slice(0, 4000);
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [id, ...ALLOW_PATHS.map((_, i) => id + ALLOW_RULE_OFFSET * (i + 1))],
    addRules: list.length ? [{ id, priority: 2, action: { type: 'block' as any }, condition: {
      requestDomains: list, initiatorDomains: [site], excludedResourceTypes: ['main_frame'] as any,
      excludedRequestDomains: AUTH_AND_CAPTCHA_HOSTS,
    } }, ...ALLOW_PATHS.map((urlFilter, i) => ({ id: id + ALLOW_RULE_OFFSET * (i + 1), priority: 3,
      action: { type: 'allow' as any }, condition: { urlFilter, initiatorDomains: [site] } }))] : [],
  });
  // Delete cookies only for tracker domains actually seen on this site.
  const seen = new Set((await store.eventsForSite(site)).filter((e) => e.tier === 'tracking').map((e) => e.hostSite));
  let deleted = 0;
  for (const d of [...seen].filter((x) => domains.has(x)).slice(0, 200)) {
    try {
      const cookies = await api.cookies.getAll({ domain: d });
      for (const c of cookies) {
        const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`;
        await api.cookies.remove({ url, name: c.name, storeId: c.storeId, ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}) } as any);
        deleted++;
      }
    } catch { /* ignore */ }
  }
  return { blockedDomains: list.length, cookiesDeleted: deleted };
}

// ---------------- UI RPC ----------------
async function handleUi(msg: Msg): Promise<unknown> {
  switch (msg.type) {
    case 'getTabReport': return tabReport(msg.tabId);
    case 'getSiteReport': return siteReport(msg.site);
    case 'getProfile': return profile();
    case 'listSites': return listSites();
    case 'setManualReceipt': {
      const t = await tabState(msg.tabId);
      if (!t) return null;
      const s = await getSettings();
      const r: ConsentReceipt = { site: t.site, ts: Date.now(), source: 'manual', choice: msg.choice, userActed: true, gpc: s.gpc, raw: 'Marked by you in See My Trackers' };
      await store.addReceipt(r);
      t.afterReject.clear(); t.preChoice.clear();
      return tabReport(msg.tabId);
    }
    case 'setEnforce': {
      const s = await getSettings();
      const enforce = { ...s.enforce };
      if (msg.on) enforce[msg.site] = true; else delete enforce[msg.site];
      await saveSettings({ enforce });
      return applyEnforce(msg.site, msg.on);
    }
    case 'setPaused': {
      const s = await getSettings();
      const pausedSites = { ...s.pausedSites };
      if (msg.on) pausedSites[msg.site] = true; else delete pausedSites[msg.site];
      await saveSettings({ pausedSites });
      return true;
    }
    case 'exportSite': return exportSite(msg.site);
    case 'getSettings': { const { salt: _s, ...rest } = await getSettings(); return { ...rest, version: VERSION, trackerDb: idx.version, firefox: IS_FIREFOX }; }
    case 'setSettings': {
      const before = await getSettings();
      const s = await saveSettings(msg.patch);
      if (msg.patch.gpc !== undefined && msg.patch.gpc !== before.gpc) await applyGpc(s.gpc);
      return true;
    }
    case 'wipe': await store.wipeAll(); for (const t of tabs.values()) { t.afterReject.clear(); t.preChoice.clear(); } return true;
    case 'stats': return store.stats();
  }
}

// ---------------- lifecycle ----------------
async function init(): Promise<void> {
  const s = await getSettings();
  await applyGpc(s.gpc).catch((e) => console.warn('[smt] gpc', e));
  // Re-apply enforce rules (dynamic rules persist, but keep them in sync with settings).
  for (const site of Object.keys(s.enforce)) await applyEnforce(site, true).catch(() => {});
}

api.runtime.onInstalled.addListener((d) => {
  void init();
  api.alarms.create('retention', { periodInMinutes: 24 * 60 });
  if (d.reason === 'install') void api.tabs.create({ url: api.runtime.getURL('onboarding.html') });
});
api.runtime.onStartup.addListener(() => { void init(); });
api.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'retention') return;
  const s = await getSettings();
  await store.purgeOlderThan(Date.now() - s.retentionDays * 86400_000);
});
