// End-to-end: real Chromium + built extension + fixture site with a fake TCF banner.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startServer } from '../fixtures/server.mjs';

const EXT = resolve(process.argv[2] ?? 'dist/chrome');
const CHROME = process.env.CHROME_BIN ?? '/usr/bin/google-chrome';
const { srv, hits } = await startServer(8080);
mkdirSync('tests/e2e/out', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
    '--host-resolver-rules=MAP news-fixture.com 127.0.0.1:8080, MAP p161.net 127.0.0.1:8080, MAP mmtro.com 127.0.0.1:8080, MAP creative-serving.com 127.0.0.1:8080, MAP cdnjs.cloudflare.com 127.0.0.1:8080',
    '--no-sandbox', '--no-first-run', '--no-proxy-server', '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
  ],
});
let failed = false;
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  console.log('extension id', extId);
  await new Promise((r) => setTimeout(r, 1500)); // let onInstalled finish (GPC rule, onboarding tab)

  const page = await browser.newPage();
  console.log('step: goto fixture');
  await page.goto('http://news-fixture.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.log('step: loaded');
  await new Promise((r) => setTimeout(r, 1500));
  await page.click('#reject');
  console.log('step: rejected');
  await new Promise((r) => setTimeout(r, 3000));
  const gpcJs = await page.evaluate(() => navigator.globalPrivacyControl);

  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/dashboard.html`);
  const tabId = await ext.evaluate(async () => (await chrome.tabs.query({ url: 'http://news-fixture.com/*' }))[0].id);
  const rep = await ext.evaluate((id) => chrome.runtime.sendMessage({ type: 'getTabReport', tabId: id }), tabId);

  const rules = rep.findings.map((f) => f.rule).sort();
  console.log('receipt:', rep.receipt?.choice, rep.receipt?.source);
  console.log('counts:', rep.counts);
  console.log('findings:', rules.join(','));
  for (const f of rep.findings) console.log(`  [${f.severity}] ${f.rule} ${f.text}`);
  console.log('orgs:', rep.orgs.map((o) => `${o.orgName}(${o.tier})`).join(', '));

  assert.equal(rep.receipt?.choice, 'rejected', 'receipt recorded from TCF');
  assert.equal(rep.receipt?.source, 'tcf');
  for (const r of ['R1', 'R3', 'R5', 'R6', 'R9']) assert.ok(rules.includes(r), `expected ${r}`);
  assert.equal(rep.counts.afterRejectTrackingOrgs, 2, 'Platform161 + 1000mercis after reject');
  assert.ok(rep.counts.preChoiceTrackingOrgs >= 1, '1000mercis before choice');
  assert.ok(!rep.orgs.some((o) => o.tier === 'tracking' && /cloudflare/i.test(o.orgName)), 'CDN not tracking');
  assert.equal(gpcJs, true, 'navigator.globalPrivacyControl');
  assert.ok(hits.some((h) => h.host === 'p161.net' && h.gpc === '1'), 'Sec-GPC header sent');

  // Popup render for the tab (screenshot for docs)
  const pop = await browser.newPage();
  await pop.setViewport({ width: 400, height: 900 });
  await pop.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
  await new Promise((r) => setTimeout(r, 800));
  const txt = await pop.evaluate(() => document.body.innerText);
  assert.match(txt, /You rejected tracking/);
  assert.match(txt, /Platform161/);
  await pop.screenshot({ path: 'tests/e2e/out/popup-chrome.png', fullPage: true });

  // Enforce mode: block and verify the tracker is no longer reached.
  const enf = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'setEnforce', site: 'news-fixture.com', on: true }));
  console.log('enforce:', enf);
  assert.ok(enf.blockedDomains >= 2);
  const before = hits.filter((h) => h.host === 'p161.net').length;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => window.__fixtureChoose(false)).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  const after = hits.filter((h) => h.host === 'p161.net').length;
  assert.equal(after, before, 'p161.net blocked under Enforce');
  const rep2 = await ext.evaluate((id) => chrome.runtime.sendMessage({ type: 'getTabReport', tabId: id }), tabId);
  const blocked = rep2.orgs.reduce((n, o) => n + Object.values(o.phases).reduce((m, s) => m + (s.blocked || 0), 0), 0);
  console.log('blocked attempts recorded:', blocked);
  assert.ok(blocked >= 2, 'blocked attempts recorded as evidence');

  // Dashboard renders and export works
  const dash = await browser.newPage();
  await dash.setViewport({ width: 1100, height: 700 });
  await dash.goto(`chrome-extension://${extId}/dashboard.html#companies`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1000));
  await dash.screenshot({ path: 'tests/e2e/out/dashboard-chrome.png' });
  console.log('step: dashboard ok');
  const exp = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'exportSite', site: 'news-fixture.com' }));
  assert.ok(exp.html.includes('Tracking report for news-fixture.com'));
  assert.ok(!JSON.stringify(exp.json).includes('u8K2mQ9xZ4pL7rT3vW1y'), 'raw identifier never exported');
  console.log('\nCHROME E2E: PASS');
} catch (e) {
  failed = true;
  console.error('CHROME E2E: FAIL', e);
} finally {
  await browser.close();
  srv.close();
  process.exit(failed ? 1 : 0);
}
