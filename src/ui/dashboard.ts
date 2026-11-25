import { h, send, timeAgo, download, COUNTRY, api } from './shared';
import { CATEGORY_LABEL } from '../core/trackers';
import { SOURCE_LABEL } from '../core/consent';
import { PHASE_LABEL } from '../core/phase';
import type { SiteReport, PhaseStats } from '../core/rules';
import type { Category, Phase } from '../core/types';
import { LIMITATIONS } from './limits';

const main = document.getElementById('main')!;
const nav = document.getElementById('nav')!;

const VIEWS: Record<string, [string, () => Promise<Node[]>]> = {
  companies: ['Companies', companies],
  sites: ['Sites', sites],
  settings: ['Settings', settingsView],
  limitations: ['What we can\'t see', limitations],
  about: ['About', about],
};

function navTo(view: string) { location.hash = view; }

async function route() {
  const [view, arg] = decodeURIComponent(location.hash.slice(1)).split(':');
  nav.replaceChildren(...Object.entries(VIEWS).map(([k, [label]]) => h('a', { class: k === (view || 'companies') ? 'active' : '', onclick: () => navTo(k) }, label)));
  main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    if (view === 'site' && arg) main.replaceChildren(...(await siteView(arg)));
    else main.replaceChildren(...(await (VIEWS[view || 'companies']?.[1] ?? companies)()));
  } catch (e) {
    main.replaceChildren(h('p', {}, 'Error: ' + String(e)));
  }
}

interface ProfileOrg { orgKey: string; orgName: string; category: Category | null; tier: string; sites: string[]; afterRejectSites: string[]; preChoiceSites: string[]; lastTs: number; total: number }

async function companies(): Promise<Node[]> {
  const p = await send<{ totalSites: number; orgs: ProfileOrg[] }>({ type: 'getProfile' });
  const tracking = p.orgs.filter((o) => o.tier === 'tracking');
  if (!p.orgs.length) return [h('h1', {}, 'Companies'), h('p', { class: 'muted' }, 'Browse a few websites and come back. Everything stays on this device.')];
  const top = tracking[0];
  return [
    h('h1', {}, 'Who follows you across sites'),
    h('p', {}, `Across ${p.totalSites} site${p.totalSites === 1 ? '' : 's'} you visited, ${tracking.length} tracking compan${tracking.length === 1 ? 'y' : 'ies'} were contacted.`,
      top ? ` ${top.orgName} showed up on ${top.sites.length} site${top.sites.length === 1 ? '' : 's'}${top.afterRejectSites.length ? `, ${top.afterRejectSites.length} of them after you rejected` : ''}.` : ''),
    h('table', {},
      h('tr', {}, h('th', {}, 'Company'), h('th', {}, 'Category'), h('th', {}, 'Sites'), h('th', {}, 'After you rejected'), h('th', {}, 'Before any choice'), h('th', {}, 'Last seen')),
      ...tracking.map((o) => h('tr', {},
        h('td', {}, h('b', {}, o.orgName)),
        h('td', {}, o.category ? CATEGORY_LABEL[o.category] : '—'),
        h('td', { title: o.sites.join(', ') }, String(o.sites.length)),
        h('td', { title: o.afterRejectSites.join(', ') }, o.afterRejectSites.length ? h('span', { class: 'chip red' }, String(o.afterRejectSites.length)) : '0'),
        h('td', { title: o.preChoiceSites.join(', ') }, String(o.preChoiceSites.length)),
        h('td', {}, timeAgo(o.lastTs))))),
    h('details', { style: 'margin-top:16px' }, h('summary', {}, `Other third parties (${p.orgs.length - tracking.length})`),
      h('table', {}, ...p.orgs.filter((o) => o.tier !== 'tracking').map((o) => h('tr', {}, h('td', {}, o.orgName), h('td', {}, o.category ? CATEGORY_LABEL[o.category] : 'Unknown'), h('td', {}, String(o.sites.length)))))),
  ];
}

async function sites(): Promise<Node[]> {
  const list = await send<Array<{ site: string; trackingOrgs: number; afterRejectOrgs: number; lastTs: number; choice: string | null }>>({ type: 'listSites' });
  if (!list.length) return [h('h1', {}, 'Sites'), h('p', { class: 'muted' }, 'No sites yet.')];
  return [
    h('h1', {}, 'Sites'),
    h('table', {},
      h('tr', {}, h('th', {}, 'Site'), h('th', {}, 'Your choice'), h('th', {}, 'Tracking companies'), h('th', {}, 'After you rejected'), h('th', {}, 'Last activity'), h('th', {}, '')),
      ...list.map((s) => h('tr', {},
        h('td', {}, h('a', { onclick: () => navTo('site:' + s.site) }, s.site)),
        h('td', {}, s.choice ? h('span', { class: `chip ${s.choice === 'rejected' ? 'green' : s.choice === 'accepted' ? 'red' : 'orange'}` }, s.choice) : h('span', { class: 'muted' }, '—')),
        h('td', {}, String(s.trackingOrgs)),
        h('td', {}, s.afterRejectOrgs ? h('span', { class: 'chip red' }, String(s.afterRejectOrgs)) : '0'),
        h('td', {}, s.lastTs ? timeAgo(s.lastTs) : '—'),
        h('td', {}, h('a', { onclick: () => navTo('site:' + s.site) }, 'Report'))))),
  ];
}

function statsText(st: PhaseStats): string {
  const b: string[] = [];
  if (st.requests) b.push(`${st.requests} req${st.dataSending ? ` (${st.dataSending} sending data)` : ''}`);
  if (st.cookiesSet.length) b.push(`set: ${st.cookiesSet.join(', ')}`);
  if (st.cookiesSent.length) b.push(`read: ${st.cookiesSent.join(', ')}`);
  if (st.fingerprint.length) b.push(`fingerprint: ${st.fingerprint.join(', ')}`);
  if (st.idSync) b.push('ID shared');
  if (st.blocked) b.push(`${st.blocked} blocked`);
  return b.join(' · ');
}

async function siteView(site: string): Promise<Node[]> {
  const rep = await send<SiteReport>({ type: 'getSiteReport', site });
  const phases: Phase[] = ['after_reject', 'after_partial', 'pre_choice', 'no_banner', 'after_accept'];
  const exportBtns = h('div', { class: 'row' },
    h('button', { onclick: async () => { const r = await send<{ json: unknown; html: string }>({ type: 'exportSite', site }); download(`see-my-trackers-${site}.json`, JSON.stringify(r.json, null, 2), 'application/json'); } }, 'Export evidence (JSON)'),
    h('button', { onclick: async () => { const r = await send<{ json: unknown; html: string }>({ type: 'exportSite', site }); download(`see-my-trackers-${site}.html`, r.html, 'text/html'); } }, 'Export report (HTML)'));
  return [
    h('p', {}, h('a', { onclick: () => navTo('sites') }, '← All sites')),
    h('h1', {}, site),
    h('p', {}, rep.receipt ? `Your current choice: ${rep.receipt.choice} (${SOURCE_LABEL[rep.receipt.source]}, ${new Date(rep.receipt.ts).toLocaleString()}).` : 'No consent choice recorded.'),
    h('p', {}, `${rep.counts.afterRejectTrackingOrgs} tracking companies after you rejected · ${rep.counts.preChoiceTrackingOrgs} before any choice · ${rep.counts.thirdPartyOrgs} third parties (last ${'30'} days).`),
    exportBtns,
    h('h2', {}, 'Findings'),
    ...(rep.findings.length ? rep.findings.map((f) => h('div', { class: `finding ${f.severity}` }, f.text, ' ', h('small', {}, `${f.rule} · confidence ${f.confidence} · ${new Date(f.firstTs).toLocaleString()}`))) : [h('p', { class: 'muted' }, 'None.')]),
    h('h2', {}, 'Companies'),
    h('table', {},
      h('tr', {}, h('th', {}, 'Company'), ...phases.map((p) => h('th', {}, PHASE_LABEL[p]))),
      ...rep.orgs.filter((o) => o.tier !== 'functional').map((o) => h('tr', {},
        h('td', {}, h('b', {}, o.orgName), h('br'), h('small', {}, `${o.category ? CATEGORY_LABEL[o.category] : 'Unknown'}${o.country ? ' · ' + (COUNTRY[o.country] ?? o.country) : ''}`), h('br'), h('small', { class: 'mono' }, o.hosts.join(', '))),
        ...phases.map((p) => h('td', {}, o.phases[p] ? statsText(o.phases[p]!) : '—'))))),
    h('h2', {}, 'Consent receipts'),
    h('ul', {}, ...rep.receipts.map((r) => h('li', {}, `${new Date(r.ts).toLocaleString()}: ${r.choice} via ${SOURCE_LABEL[r.source]}${r.raw ? ` (${r.raw})` : ''}${r.gpc ? ' · GPC sent' : ''}`))),
  ];
}

async function settingsView(): Promise<Node[]> {
  const s = await send<{ gpc: boolean; retentionDays: number; version: string; trackerDb: string; firefox: boolean }>({ type: 'getSettings' });
  const st = await send<{ events: number; sites: number }>({ type: 'stats' });
  const msg = h('p', { class: 'muted' });
  const perm = await api.permissions.contains({ origins: ['<all_urls>'] });
  return [
    h('h1', {}, 'Settings'),
    perm ? null : h('div', { class: 'card', style: 'border-color:var(--red)' }, 'See My Trackers needs access to all websites to watch requests. ',
      h('button', { class: 'primary', onclick: async () => { await api.permissions.request({ origins: ['<all_urls>'] }); location.reload(); } }, 'Grant access')),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: s.gpc, onchange: async (e: Event) => { await send({ type: 'setSettings', patch: { gpc: (e.target as HTMLInputElement).checked } }); msg.textContent = 'Saved.'; } }),
      h('span', {}, 'Send Global Privacy Control (GPC): tells sites you opt out of sale/sharing of your data. Legally binding in California and other US states.')),
    h('p', {}, 'Keep history for ',
      (() => {
        const sel = h('select', { onchange: async (e: Event) => { await send({ type: 'setSettings', patch: { retentionDays: Number((e.target as HTMLSelectElement).value) } }); msg.textContent = 'Saved.'; } },
          ...[7, 14, 30, 90, 365].map((d) => h('option', { value: String(d), selected: d === s.retentionDays }, `${d} days`)));
        return sel;
      })()),
    h('p', {}, `Stored on this device: ${st.events.toLocaleString()} observations, ${st.sites} sites with consent receipts.`),
    h('button', { class: 'danger', onclick: async () => { if (confirm('Delete all history and consent receipts from this device? This cannot be undone.')) { await send({ type: 'wipe' }); msg.textContent = 'All data deleted.'; } } }, 'Delete all data'),
    msg,
    h('p', { class: 'muted' }, `Version ${s.version} · Tracker data: Ghostery TrackerDB ${s.trackerDb} (CC BY-NC-SA 4.0)`),
  ].filter(Boolean) as Node[];
}

async function limitations(): Promise<Node[]> {
  return [
    h('h1', {}, 'What See My Trackers can\'t see'),
    h('p', {}, 'We want you to trust what we show, so here is exactly where the limits are.'),
    ...LIMITATIONS.map(([t, d]) => h('div', { class: 'card', style: 'margin:8px 0' }, h('b', {}, t), h('div', {}, d))),
  ];
}

async function about(): Promise<Node[]> {
  return [
    h('h1', {}, 'About'),
    h('p', {}, 'See My Trackers is free, open-source software (GPL-3.0). It shows which companies your browser talks to after you say "no" on a cookie banner.'),
    h('div', { class: 'card' }, h('b', {}, 'Your data stays here. '), 'No accounts, no servers, no analytics. The extension makes no network requests of its own. Everything is stored on this device and deleted after your retention period.'),
    h('p', {}, 'Identifiers in URLs are replaced by salted hashes before anything is saved, so the evidence never contains your personal values.'),
    h('p', { class: 'muted' }, 'Company data: Ghostery TrackerDB, CC BY-NC-SA 4.0.'),
  ];
}

window.addEventListener('hashchange', () => void route());
void route();
