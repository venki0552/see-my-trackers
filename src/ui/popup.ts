import { h, send, api, timeAgo, COUNTRY, download } from './shared';
import { SOURCE_LABEL } from '../core/consent';
import { rejectVerb } from '../core/phase';
import { CATEGORY_LABEL } from '../core/trackers';
import type { OrgRow, PhaseStats, SiteReport } from '../core/rules';
import type { Phase } from '../core/types';

type TabReport = SiteReport & { tabUrl: string; pageStartedAt: number; enforce: boolean; paused: boolean; cmpNames: string[] };

const root = document.getElementById('app')!;
let tabId = -1;

async function main() {
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  const tab = forced ? await api.tabs.get(forced) : (await api.tabs.query({ active: true, currentWindow: true }))[0];
  tabId = tab?.id ?? -1;
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    root.replaceChildren(header(''), h('div', { class: 'card' }, 'Open a website to see who it shares data with.'), footer(null));
    return;
  }
  await load();
}

async function load() {
  const rep = await send<TabReport | null>({ type: 'getTabReport', tabId });
  if (!rep) {
    root.replaceChildren(header(''), h('div', { class: 'card' }, 'Reload the page so See My Trackers can watch it from the start.'), footer(null));
    return;
  }
  render(rep);
}

function header(site: string) {
  return h('div', { class: 'row spread', style: 'margin-bottom:10px' },
    h('div', { class: 'row' }, h('img', { src: 'icons/icon-32.png', width: '22', height: '22', alt: '' }), h('b', {}, 'See My Trackers')),
    h('span', { class: 'muted mono', title: site }, site));
}

function receiptCard(rep: TabReport) {
  const r = rep.receipt;
  const mark = (choice: 'rejected' | 'accepted') => async () => {
    const next = await send<TabReport>({ type: 'setManualReceipt', tabId, choice });
    if (next) render(next);
  };
  let status: HTMLElement;
  if (r) {
    const cls = r.choice === 'rejected' ? 'green' : r.choice === 'accepted' ? 'red' : 'orange';
    const word = r.choice === 'rejected' ? (r.source === 'gpp' ? 'You opted out of sale/sharing (US)' : 'You rejected tracking') : r.choice === 'accepted' ? 'You accepted tracking' : 'You allowed some purposes';
    status = h('div', {}, h('span', { class: `chip ${cls}` }, word), ' ', h('small', {}, `${timeAgo(r.ts)} · via ${SOURCE_LABEL[r.source]}`));
  } else if (rep.cmpDetected) {
    status = h('div', {}, h('span', { class: 'chip orange' }, 'Banner detected, no choice yet'), ' ', h('small', {}, rep.cmpNames.map((n) => SOURCE_LABEL[n as keyof typeof SOURCE_LABEL] ?? n).join(', ')));
  } else {
    status = h('div', {}, h('span', { class: 'chip' }, 'No consent banner detected'), h('div', {}, h('small', {}, 'If you used a banner we could not read, mark your choice:')));
  }
  return h('div', { class: 'card' }, status,
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { onclick: mark('rejected'), title: 'Record that you rejected tracking on this site' }, 'I rejected'),
      h('button', { onclick: mark('accepted'), title: 'Record that you accepted tracking on this site' }, 'I accepted'),
      rep.gpc ? h('span', { class: 'chip', title: 'Global Privacy Control opt-out signal is being sent' }, 'GPC on') : null));
}

function nums(rep: TabReport) {
  const other = rep.orgs.filter((o) => o.tier !== 'functional' && o.tier !== 'tracking').length;
  return h('div', { class: 'nums', style: 'margin-top:10px' },
    h('div', { class: 'num red' }, h('b', {}, String(rep.counts.afterRejectTrackingOrgs)), h('small', {}, `tracking companies after you ${rejectVerb(rep.receipt).short}`)),
    h('div', { class: 'num orange' }, h('b', {}, String(rep.counts.preChoiceTrackingOrgs)), h('small', {}, 'before any choice')),
    h('div', { class: 'num' }, h('b', {}, String(rep.counts.trackingOrgs)), h('small', {}, `tracking total · ${other} other 3rd parties`)));
}

function statsLine(st: PhaseStats): string {
  const bits: string[] = [];
  if (st.requests) bits.push(`${st.requests} request${st.requests > 1 ? 's' : ''}${st.dataSending ? ` (${st.dataSending} sent data)` : ''}`);
  if (st.cookiesSet.length) bits.push(`set cookies: ${st.cookiesSet.join(', ')}`);
  if (st.cookiesSent.length) bits.push(`read cookies: ${st.cookiesSent.join(', ')}`);
  if (st.fingerprint.length) bits.push(`fingerprinting APIs: ${st.fingerprint.join(', ')}`);
  if (st.idSync) bits.push('shared an ID with another company');
  if (st.blocked) bits.push(`${st.blocked} blocked attempt${st.blocked > 1 ? 's' : ''}`);
  return bits.join(' · ') || '—';
}

const PHASE_SHORT: Record<Phase, string> = { after_reject: 'After reject', after_partial: 'After partial', after_accept: 'After accept', pre_choice: 'Before choice', no_banner: 'No banner' };

function orgRow(o: OrgRow, focus: Phase | null) {
  const st = focus ? o.phases[focus] : undefined;
  const cat = o.category ? CATEGORY_LABEL[o.category] : 'Unknown third party';
  const n = st ? st.requests + st.cookiesSet.length + st.cookiesSent.length : 0;
  const right = n ? `${n} hit${n > 1 ? 's' : ''}` : '';
  return h('details', { class: 'org' },
    h('summary', {}, h('span', {}, h('b', {}, o.orgName), ' ', h('small', {}, cat + (o.country ? ` · ${COUNTRY[o.country] ?? o.country}` : ''))), h('small', {}, right)),
    h('div', { class: 'body' },
      ...(Object.entries(o.phases) as Array<[Phase, PhaseStats]>).map(([p, s]) => h('div', {}, h('b', {}, PHASE_SHORT[p] + ': '), statsLine(s))),
      h('div', { class: 'muted' }, 'Domains: ', h('span', { class: 'mono' }, o.hosts.join(', '))),
      o.sampleUrls.length ? h('div', { class: 'muted' }, 'Example (values hashed): ', h('div', { class: 'mono' }, o.sampleUrls[0]!)) : null,
      o.privacyContact ? h('div', { class: 'muted' }, 'Privacy contact: ', h('span', { class: 'mono' }, o.privacyContact)) : null));
}

function groups(rep: TabReport) {
  const out: Node[] = [];
  const has = (o: OrgRow, p: Phase) => { const s = o.phases[p]; return !!s && (s.requests > 0 || s.cookiesSet.length > 0 || s.cookiesSent.length > 0 || s.fingerprint.length > 0 || s.blocked > 0); };
  const tracking = rep.orgs.filter((o) => o.tier === 'tracking');
  const afterReject = tracking.filter((o) => has(o, 'after_reject'));
  const pre = tracking.filter((o) => has(o, 'pre_choice') && !afterReject.includes(o));
  const rest = tracking.filter((o) => !afterReject.includes(o) && !pre.includes(o));
  const others = rep.orgs.filter((o) => o.tier === 'other' || o.tier === 'unknown');
  if (afterReject.length) out.push(h('div', { class: 'section-title' }, `After you ${rejectVerb(rep.receipt).short} (${afterReject.length})`), ...afterReject.map((o) => orgRow(o, 'after_reject')));
  if (pre.length) out.push(h('div', { class: 'section-title' }, `Before any consent choice (${pre.length})`), ...pre.map((o) => orgRow(o, 'pre_choice')));
  if (rest.length) out.push(h('div', { class: 'section-title' }, `Other tracking on this page (${rest.length})`), ...rest.map((o) => orgRow(o, null)));
  if (others.length) {
    out.push(h('details', {}, h('summary', { class: 'section-title' }, `Other third parties (${others.length})`), ...others.map((o) => orgRow(o, null))));
  }
  if (!out.length) out.push(h('div', { class: 'card', style: 'margin-top:10px' }, 'No third-party tracking seen on this page yet.'));
  return out;
}

function findings(rep: TabReport) {
  if (!rep.findings.length) return null;
  const top = rep.findings.filter((f) => f.severity !== 'info').slice(0, 5);
  const info = rep.findings.filter((f) => f.severity === 'info');
  return h('div', {}, h('div', { class: 'section-title' }, 'What we noticed'),
    ...[...top, ...info.slice(0, 1)].map((f) => h('div', { class: `finding ${f.severity}` }, f.text, ' ', h('small', {}, `(${f.rule}, confidence: ${f.confidence})`))));
}

function footer(rep: TabReport | null) {
  const enforce = rep ? h('label', { class: 'switch', title: 'Block the tracking companies seen on this site and delete their cookies' },
    h('input', { type: 'checkbox', checked: rep.enforce, onchange: async (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      const res = await send<{ blockedDomains: number }>({ type: 'setEnforce', site: rep.site, on });
      note.textContent = on ? `Blocking ${res.blockedDomains} tracking domains on ${rep.site}. Reload the page.` : 'Enforcement off. Reload the page.';
    } }), h('span', {}, 'Enforce my "No" on this site')) : null;
  const pause = rep ? h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: rep.paused, onchange: async (e: Event) => {
    await send({ type: 'setPaused', site: rep.site, on: (e.target as HTMLInputElement).checked });
    note.textContent = 'Saved. Reload the page.';
  } }), h('span', {}, 'Pause watching this site')) : null;
  const note = h('div', { class: 'muted', style: 'min-height:16px' });
  const exp = rep ? h('a', { onclick: async () => {
    const res = await send<{ json: unknown; html: string }>({ type: 'exportSite', site: rep.site });
    download(`see-my-trackers-${rep.site}-${new Date().toISOString().slice(0, 10)}.html`, res.html, 'text/html');
  } }, 'Export report') : null;
  return h('div', { style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:10px' },
    enforce, pause, note,
    h('div', { class: 'row spread' },
      h('a', { onclick: () => api.tabs.create({ url: api.runtime.getURL('dashboard.html') }) }, 'Dashboard'),
      exp,
      h('a', { onclick: () => api.tabs.create({ url: api.runtime.getURL('dashboard.html#limitations') }) }, 'What we can\'t see')));
}

function render(rep: TabReport) {
  root.replaceChildren(header(rep.site), receiptCard(rep), nums(rep), findings(rep) ?? '', ...groups(rep), footer(rep));
}

main().catch((e) => { root.textContent = 'Error: ' + String(e); });
