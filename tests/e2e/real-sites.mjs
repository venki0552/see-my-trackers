// Real-site validation in Chromium with the built extension.
// For each site: load → wait → click "Reject" on the consent banner (several strategies) → wait → read the extension's report.
// Ground truth: puppeteer's own request log; every org the extension reports "after reject" must have
// at least one request to one of its hosts after the reject click (precision check).
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const EXT = resolve(process.env.EXT ?? 'dist/chrome');
const SITES = (process.argv[2] ?? 'theguardian.com,bbc.com,reuters.com,spiegel.de,lemonde.fr,cnn.com,forbes.com,independent.co.uk,dailymail.co.uk,weather.com,elpais.com,corriere.it,imdb.com,booking.com,stackoverflow.com,nytimes.com').split(',');
const OUT = process.env.OUT ?? 'docs/validation/real-sites-chrome.json';
mkdirSync('docs/validation', { recursive: true });
mkdirSync('tests/e2e/out', { recursive: true });

const REJECT_SELECTORS = [
  '#onetrust-reject-all-handler', 'button.ot-pc-refuse-all-handler',
  '#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
  '#didomi-notice-disagree-button', '.didomi-continue-without-agreeing',
  'button[data-testid="uc-deny-all-button"]',
  '.qc-cmp2-summary-buttons button[mode="secondary"]', 'button.fc-cta-do-not-consent',
  'button[title="Reject all"]', 'button[title="Reject All"]', 'button[aria-label="Reject all"]',
  '#truste-consent-required', '.truste-button2', 'button.sp_choice_type_13', 'button.sp_choice_type_REJECT_ALL',
];
const REJECT_TEXT = /^(reject all|reject|decline all|decline|deny all|deny|refuse all|i do not accept|only necessary|necessary only|use necessary cookies only|reject optional cookies|alle ablehnen|ablehnen|tout refuser|refuser|continuer sans accepter|rechazar todo|rechazar|rifiuta tutto|rifiuta|weigeren|alles weigeren|nur notwendige)$/i;

async function tryReject(page) {
  // JS APIs first (most reliable, no clicking)
  const viaApi = await page.evaluate(() => {
    try { if (window.UC_UI?.denyAllConsents) { window.UC_UI.denyAllConsents(); return 'usercentrics-api'; } } catch {}
    try { if (window.Didomi?.setUserDisagreeToAll) { window.Didomi.setUserDisagreeToAll(); return 'didomi-api'; } } catch {}
    try { if (window.Cookiebot?.withdraw && window.Cookiebot?.dialog) { window.Cookiebot.submitCustomConsent(false, false, false); return 'cookiebot-api'; } } catch {}
    return null;
  }).catch(() => null);
  if (viaApi) return viaApi;
  for (const frame of page.frames()) {
    for (const sel of REJECT_SELECTORS) {
      try {
        const el = await frame.$(sel);
        if (el && (await el.boundingBox())) { await el.click(); return `selector:${sel}`; }
      } catch {}
    }
  }
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate((src) => {
        const re = new RegExp(src, 'i');
        const nodes = [...document.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"]')];
        for (const n of nodes) {
          const t = (n.innerText || n.value || '').trim().replace(/\s+/g, ' ');
          const r = n.getBoundingClientRect();
          if (t && t.length < 50 && re.test(t) && r.width > 0 && r.height > 0) { n.click(); return t; }
        }
        return null;
      }, REJECT_TEXT.source);
      if (clicked) return `text:${clicked}`;
    } catch {}
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox', '--no-first-run', '--window-size=1366,900', '--lang=en-GB'],
  defaultViewport: { width: 1366, height: 900 },
});
const results = [];
try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  await sleep(1500);
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/dashboard.html#about`, { waitUntil: 'domcontentloaded' });

  for (const site of SITES) {
    const page = await browser.newPage();
    await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    const reqLog = [];
    page.on('request', (r) => reqLog.push({ t: Date.now(), url: r.url() }));
    const row = { site, ok: false };
    try {
      await page.goto(`https://www.${site}/`, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(async () => page.goto(`https://${site}/`, { waitUntil: 'domcontentloaded', timeout: 35000 }));
      await sleep(7000);
      const rejectAt = Date.now();
      row.rejectMethod = await tryReject(page);
      await sleep(2500);
      if (!row.rejectMethod) row.rejectMethod2 = await tryReject(page); // two-step banners
      await page.evaluate(() => window.scrollBy(0, 1500)).catch(() => {});
      await sleep(9000);
      const tabId = await ext.evaluate(async (s) => (await chrome.tabs.query({})).find((t) => t.url && new URL(t.url).hostname.endsWith(s))?.id, site);
      const rep = await ext.evaluate((id) => chrome.runtime.sendMessage({ type: 'getTabReport', tabId: id }), tabId);
      if (!rep) throw new Error('no report');
      const after = rep.orgs.filter((o) => o.tier === 'tracking' && o.phases.after_reject && (o.phases.after_reject.requests || o.phases.after_reject.cookiesSet.length || o.phases.after_reject.cookiesSent.length));
      // precision: each after-reject org must have a request to one of its hosts after the reject click (by our ground-truth log)
      const verified = after.filter((o) => reqLog.some((r) => r.t >= rejectAt - 500 && o.hosts.some((h) => { try { const hn = new URL(r.url).hostname; return hn === h || hn.endsWith('.' + h); } catch { return false; } })));
      Object.assign(row, {
        ok: true, url: page.url(), cmp: rep.cmpNames, receipt: rep.receipt ? `${rep.receipt.choice} (${rep.receipt.source})` : null,
        counts: rep.counts, findings: [...new Set(rep.findings.map((f) => f.rule))].sort(),
        afterRejectOrgs: after.map((o) => o.orgName), verifiedAfterReject: verified.length,
        preChoiceOrgs: rep.orgs.filter((o) => o.tier === 'tracking' && o.phases.pre_choice?.requests).map((o) => o.orgName),
        trackingOrgs: rep.orgs.filter((o) => o.tier === 'tracking').map((o) => o.orgName),
        gcmDenied: rep.findings.some((f) => f.rule === 'R10'), requestsSeenByPuppeteer: reqLog.length,
      });
      if (results.length < 3) {
        const pop = await browser.newPage();
        await pop.setViewport({ width: 400, height: 1000 });
        await pop.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`, { waitUntil: 'domcontentloaded' });
        await sleep(800);
        await pop.screenshot({ path: `tests/e2e/out/popup-${site}.png`, fullPage: true });
        await pop.close();
      }
    } catch (e) {
      row.error = String(e).slice(0, 200);
    }
    results.push(row);
    console.log(JSON.stringify(row));
    await page.close().catch(() => {});
  }
  const prof = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'getProfile' }));
  writeFileSync(OUT, JSON.stringify({ when: new Date().toISOString(), browser: await browser.version(), results, topCompanies: prof.orgs.slice(0, 15).map((o) => ({ org: o.orgName, sites: o.sites.length, afterRejectSites: o.afterRejectSites.length })) }, null, 2));
  console.log('wrote', OUT);
} finally {
  await browser.close();
}
