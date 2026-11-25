// End-to-end in real Firefox (WebDriver BiDi) with the *test* build (adds a page→extension test bridge;
// release builds don't contain it). Same fixture and assertions as the Chrome test.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startServer } from '../fixtures/server.mjs';

const EXT = resolve(process.argv[2] ?? 'dist/firefox-test');
const { srv, hits } = await startServer(80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  browser: 'firefox', executablePath: process.env.FIREFOX_BIN ?? '/opt/ff/firefox/firefox', headless: true,
  extraPrefsFirefox: {
    'network.dns.localDomains': 'news-fixture.com,p161.net,mmtro.com,creative-serving.com,cdnjs.cloudflare.com',
    'network.proxy.type': 0, 'dom.security.https_first': false, 'dom.security.https_only_mode': false,
    'extensions.originControls.grantByDefault': true,
  },
});
const rpc = (page, msg) => page.evaluate((m) => new Promise((res) => {
  document.addEventListener('__smt_v1__testResult', (e) => res(JSON.parse(e.detail)), { once: true });
  document.dispatchEvent(new CustomEvent('__smt_v1__test', { detail: JSON.stringify(m) }));
}), msg);

let failed = false;
try {
  console.log('installed', await browser.installExtension(EXT), await browser.version());
  await sleep(2500);
  const page = await browser.newPage();
  await page.goto('http://news-fixture.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(1500);
  await page.click('#reject');
  await sleep(3000);
  const gpcJs = await page.evaluate(() => navigator.globalPrivacyControl);
  const rep = await rpc(page, { type: 'getTabReport', tabId: 0 });
  const rules = rep.findings.map((f) => f.rule).sort();
  console.log('receipt:', rep.receipt?.choice, rep.receipt?.source);
  console.log('counts:', JSON.stringify(rep.counts));
  console.log('findings:', rules.join(','));
  for (const f of rep.findings) console.log(`  [${f.severity}] ${f.rule} ${f.text}`);
  console.log('orgs:', rep.orgs.map((o) => `${o.orgName}(${o.tier})`).join(', '));
  assert.equal(rep.receipt?.choice, 'rejected');
  assert.equal(rep.receipt?.source, 'tcf');
  for (const r of ['R1', 'R5', 'R6', 'R9']) assert.ok(rules.includes(r), `expected ${r}`);
  assert.equal(rep.counts.afterRejectTrackingOrgs, 2);
  assert.equal(gpcJs, true, 'navigator.globalPrivacyControl');
  assert.ok(hits.some((h) => h.host === 'p161.net' && h.gpc === '1'), 'Sec-GPC header sent');
  if (!rules.includes('R3')) console.log('note: R3 (Set-Cookie) not observed in Firefox');

  const enf = await rpc(page, { type: 'setEnforce', site: 'news-fixture.com', on: true });
  console.log('enforce:', JSON.stringify(enf));
  const before = hits.filter((h) => h.host === 'p161.net').length;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(1000);
  await page.evaluate(() => window.__fixtureChoose(false)).catch(() => {});
  await sleep(2500);
  const after = hits.filter((h) => h.host === 'p161.net').length;
  assert.equal(after, before, 'p161.net blocked under Enforce');
  const rep2 = await rpc(page, { type: 'getTabReport', tabId: 0 });
  const blocked = rep2.orgs.reduce((n, o) => n + Object.values(o.phases).reduce((m, s) => m + (s.blocked || 0), 0), 0);
  console.log('blocked attempts recorded:', blocked);
  assert.ok(blocked >= 1, 'blocked attempts recorded');
  const exp = await rpc(page, { type: 'exportSite', site: 'news-fixture.com' });
  assert.ok(exp.html.includes('Tracking report for news-fixture.com'));
  assert.ok(!JSON.stringify(exp.json).includes('u8K2mQ9xZ4pL7rT3vW1y'), 'raw identifier never exported');
  const prof = await rpc(page, { type: 'getProfile' });
  assert.ok(prof.orgs.length >= 2);
  console.log('\nFIREFOX E2E: PASS');
} catch (e) {
  failed = true;
  console.error('FIREFOX E2E: FAIL', e);
} finally {
  await browser.close();
  srv.close();
  process.exit(failed ? 1 : 0);
}
