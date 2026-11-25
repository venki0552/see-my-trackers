import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siteOf, isThirdParty, hostOf } from '../../src/core/domain';
import { TrackerIndex, tierOf, type TrackerData } from '../../src/core/trackers';
import { normalizeConsent, uspOptedOut } from '../../src/core/consent';
import { phaseAt, currentReceipt } from '../../src/core/phase';
import { redactUrl, looksLikeId, hashValue } from '../../src/core/redact';
import { isDataSending, idParams, parseGcs, cookieNames, parseSetCookie } from '../../src/core/signals';
import { IdSyncTracker } from '../../src/core/idsync';
import { describeCookie, isKnownTrackingCookie } from '../../src/core/cookies';
import { buildReport } from '../../src/core/rules';
import type { ConsentReceipt, TrackerEvent } from '../../src/core/types';

const data = JSON.parse(readFileSync('data/trackers.json', 'utf8')) as TrackerData;
const idx = new TrackerIndex(data);

test('siteOf handles eTLD+1, multi-part TLDs, IPs, localhost', () => {
  assert.equal(siteOf('https://www.bbc.co.uk/news'), 'bbc.co.uk');
  assert.equal(siteOf('a.b.example.com'), 'example.com');
  assert.equal(siteOf('http://127.0.0.1:8080/x'), '127.0.0.1');
  assert.equal(siteOf('localhost'), 'localhost');
  assert.equal(siteOf(''), '');
  assert.equal(hostOf('https://Sub.Example.com/x'), 'sub.example.com');
});

test('isThirdParty uses eTLD+1 and same-owner exception', () => {
  assert.equal(isThirdParty('cdn.example.com', 'example.com'), false);
  assert.equal(isThirdParty('www.google-analytics.com', 'example.com', idx.ownerOf), true);
  // youtube.com and google.com share an owner in TrackerDB?
  const ytOwner = idx.ownerOf('youtube.com');
  const gOwner = idx.ownerOf('doubleclick.net');
  if (ytOwner && gOwner && ytOwner === gOwner) {
    assert.equal(isThirdParty('doubleclick.net', 'youtube.com', idx.ownerOf), false);
  }
});

test('TrackerIndex longest-suffix lookup and tiers', () => {
  const ga = idx.lookup('www.google-analytics.com');
  assert.ok(ga);
  assert.equal(ga!.category, 'site_analytics');
  assert.match(ga!.orgName, /Google/i);
  assert.equal(tierOf(ga!.category), 'tracking');
  assert.equal(idx.lookup('definitely-not-a-tracker-xyz.example'), null);
  const cf = idx.lookup('cdnjs.cloudflare.com');
  assert.equal(tierOf(cf?.category), 'functional');
  assert.equal(tierOf(null), 'unknown');
  assert.ok(idx.domainsOfOrg(ga!.orgId!).includes('google-analytics.com'));
});

test('TCF normalization: reject, accept, partial, pending, gdpr not applying', () => {
  const none = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 1), false]));
  const all = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i + 1), true]));
  const rej = normalizeConsent({ type: 'tcf', eventStatus: 'useractioncomplete', tcString: 'x', purposeConsents: { ...none, '1': true } });
  assert.equal(rej?.choice, 'rejected');
  assert.equal(rej?.userActed, true);
  const acc = normalizeConsent({ type: 'tcf', eventStatus: 'tcloaded', tcString: 'x', purposeConsents: all });
  assert.equal(acc?.choice, 'accepted');
  const part = normalizeConsent({ type: 'tcf', eventStatus: 'useractioncomplete', tcString: 'x', purposeConsents: { ...none, '8': true } });
  assert.equal(part?.choice, 'partial');
  const pending = normalizeConsent({ type: 'tcf', eventStatus: 'cmpuishown', tcString: '' });
  assert.equal(pending?.userActed, false);
  assert.equal(pending?.choice, 'unknown');
  assert.equal(normalizeConsent({ type: 'tcf', gdprApplies: false }), null);
});

test('OneTrust, Cookiebot, Didomi, Usercentrics, GCM, GPP normalization', () => {
  assert.equal(normalizeConsent({ type: 'onetrust', activeGroups: ',C0001,C0003,', alertClosed: true })?.choice, 'rejected');
  assert.equal(normalizeConsent({ type: 'onetrust', activeGroups: ',C0001,C0002,C0003,C0004,C0005,', alertClosed: true })?.choice, 'accepted');
  assert.equal(normalizeConsent({ type: 'onetrust', activeGroups: ',C0001,C0002,C0004,', alertClosed: false })?.userActed, false);
  assert.equal(normalizeConsent({ type: 'cookiebot', consent: { statistics: false, marketing: false }, hasResponse: true })?.choice, 'rejected');
  assert.equal(normalizeConsent({ type: 'cookiebot', consent: { statistics: true, marketing: false }, hasResponse: true })?.choice, 'partial');
  assert.equal(normalizeConsent({ type: 'didomi', enabled: [], disabled: ['a', 'b'], shouldCollect: false })?.choice, 'rejected');
  assert.equal(normalizeConsent({ type: 'usercentrics', services: [{ status: true, category: 'essential' }, { status: false, category: 'marketing' }], consentRequired: false })?.choice, 'rejected');
  assert.equal(normalizeConsent({ type: 'gcm', kind: 'update', state: { ad_storage: 'denied', analytics_storage: 'denied' } })?.choice, 'rejected');
  assert.equal(normalizeConsent({ type: 'gcm', kind: 'default', state: { ad_storage: 'denied' } })?.userActed, false);
  assert.equal(normalizeConsent({ type: 'gpp', signalStatus: 'ready', usnat: { SaleOptOut: 1, SharingOptOut: 1, TargetedAdvertisingOptOut: 1 } })?.choice, 'rejected');
  assert.equal(normalizeConsent({ type: 'gpp', signalStatus: 'ready', usnat: { SaleOptOut: 2, SharingOptOut: 2, TargetedAdvertisingOptOut: 0 } })?.choice, 'accepted');
  const vis = normalizeConsent({ type: 'gpp', signalStatus: 'ready', cmpDisplayStatus: 'visible', usnat: { SaleOptOut: 1, SharingOptOut: 1, TargetedAdvertisingOptOut: 1, Gpc: true } });
  assert.equal(vis?.userActed, true, 'GPC-honored opt-out counts while notice is visible');
  assert.match(vis!.raw!, /Global Privacy Control/);
  assert.equal(normalizeConsent({ type: 'gpp', signalStatus: 'ready', cmpDisplayStatus: 'visible', usnat: { SaleOptOut: 2, SharingOptOut: 2 } })?.userActed, false);
  assert.equal(uspOptedOut('1YYN'), true);
  assert.equal(uspOptedOut('1YNN'), false);
  assert.equal(uspOptedOut('1---'), null);
});

const R = (ts: number, choice: ConsentReceipt['choice'], source: ConsentReceipt['source'] = 'tcf', userActed = true): ConsentReceipt =>
  ({ site: 'news.example', ts, choice, source, userActed, gpc: false });

test('phaseAt: latest receipt wins; pre_choice vs no_banner; revocation', () => {
  assert.equal(phaseAt(5, [], false), 'no_banner');
  assert.equal(phaseAt(5, [], true), 'pre_choice');
  const rs = [R(10, 'rejected'), R(20, 'accepted'), R(30, 'rejected', 'manual')];
  assert.equal(phaseAt(5, rs, true), 'pre_choice');
  assert.equal(phaseAt(15, rs, true), 'after_reject');
  assert.equal(phaseAt(25, rs, true), 'after_accept');
  assert.equal(phaseAt(35, rs, true), 'after_reject');
  assert.equal(phaseAt(15, [R(10, 'unknown', 'tcf', false)], true), 'pre_choice');
  assert.equal(currentReceipt(rs)?.ts, 30);
});

test('redactUrl hashes values and id-like path segments, keeps names', () => {
  const r = redactUrl('https://t.example.com/collect/AbC123xYz789Qw?cid=1234567890.1700000000&en=page_view', 'salt');
  assert.ok(r.startsWith('https://t.example.com/collect/#'));
  assert.ok(r.includes('cid=#'));
  assert.ok(r.includes('en=#'));
  assert.ok(!r.includes('1234567890'));
  assert.ok(!r.includes('page_view'));
  assert.equal(hashValue('a', 's'), hashValue('a', 's'));
  assert.notEqual(hashValue('a', 's'), hashValue('a', 't'));
  assert.equal(redactUrl('not a url', 's'), '[invalid url]');
});

test('looksLikeId heuristics', () => {
  assert.equal(looksLikeId('GA1.2.1234567.1700000000'), true);
  assert.equal(looksLikeId('fb.1.1700000000000.123456789'), true);
  assert.equal(looksLikeId('5f2b8c9e1a7d4e3f'), true);
  assert.equal(looksLikeId('1700000000000'), false);
  assert.equal(looksLikeId('page-view-event'), false);
  assert.equal(looksLikeId('short'), false);
});

test('isDataSending', () => {
  assert.equal(isDataSending('ping', 'https://a.com/'), true);
  assert.equal(isDataSending('beacon', 'https://a.com/'), true);
  assert.equal(isDataSending('script', 'https://www.googletagmanager.com/gtag/js?id=G-ABC123'), false);
  assert.equal(isDataSending('image', 'https://www.facebook.com/tr?id=123&ev=PageView&noscript=1'), true);
  assert.equal(isDataSending('image', 'https://cdn.example.com/logo.png'), false);
  assert.equal(isDataSending('xmlhttprequest', 'https://region1.google-analytics.com/g/collect?v=2&tid=G-X'), true);
  assert.equal(isDataSending('xmlhttprequest', 'https://api.example.com/x', 'POST'), true);
  assert.equal(isDataSending('stylesheet', 'https://a.com/x.css?v=1'), false);
});

test('idParams finds user ids but not container ids or timestamps', () => {
  const ids = idParams('https://x.com/c?tid=G-ABC123&cid=1234567890.1700000000&_=1700000000000&uid=a8F3kL9mQ2xZ7pR4');
  const names = ids.map(([k]) => k);
  assert.deepEqual(names.sort(), ['cid', 'uid']);
  assert.deepEqual(idParams('https://x.com/?page_id=Abc123Def456Ghi'), []);
});

test('parseGcs, cookieNames, parseSetCookie', () => {
  assert.deepEqual(parseGcs('https://www.google-analytics.com/g/collect?gcs=G100'), { ad: false, analytics: false });
  assert.deepEqual(parseGcs('https://x/?gcs=G111'), { ad: true, analytics: true });
  assert.equal(parseGcs('https://x/?gcs=bad'), null);
  assert.deepEqual(cookieNames('IDE=abc; DSID=def;  x=1'), ['IDE', 'DSID', 'x']);
  const sc = parseSetCookie(['IDE=abc; Max-Age=3600; Path=/', 'test_cookie=CheckForPermission; expires=Thu, 01 Jan 2099 00:00:00 GMT']);
  assert.equal(sc[0]!.name, 'IDE');
  assert.equal(sc[0]!.maxAgeSec, 3600);
  assert.equal(sc[1]!.name, 'test_cookie');
  assert.ok((sc[1]!.maxAgeSec ?? 0) > 0);
});

test('IdSyncTracker reports at 2 orgs, then on new orgs', () => {
  const t = new IdSyncTracker();
  assert.equal(t.record('h1', 'google'), null);
  assert.equal(t.record('h1', 'google'), null);
  assert.deepEqual(t.record('h1', 'criteo')?.sort(), ['criteo', 'google']);
  assert.equal(t.record('h1', 'criteo'), null);
  assert.equal(t.record('h1', 'meta')?.length, 3);
});

test('cookie dictionary', () => {
  assert.match(describeCookie('_ga_ABC123')!.owner, /Google/);
  assert.equal(isKnownTrackingCookie('_fbp'), true);
  assert.equal(isKnownTrackingCookie('OptanonConsent'), false);
  assert.equal(isKnownTrackingCookie('session'), false);
});

const ev = (p: Partial<TrackerEvent>): TrackerEvent => ({
  ts: 0, tabId: 1, site: 'news.example', host: 'x', hostSite: 'x', orgId: null, orgName: null, category: null,
  tier: 'unknown', kind: 'request', dataSending: false, phase: 'no_banner', ...p,
});

test('buildReport + findings: R1/R2/R3/R4/R5/R6/R9/R10/R7/R8', () => {
  const g = { orgId: 'google', orgName: 'Google', category: 'site_analytics' as const, tier: 'tracking' as const, host: 'www.google-analytics.com', hostSite: 'google-analytics.com' };
  const c = { orgId: 'criteo', orgName: 'Criteo', category: 'advertising' as const, tier: 'tracking' as const, host: 'sslwidget.criteo.com', hostSite: 'criteo.com' };
  const cdn = { orgId: 'cloudflare', orgName: 'Cloudflare', category: 'hosting' as const, tier: 'functional' as const, host: 'cdnjs.cloudflare.com', hostSite: 'cloudflare.com' };
  const events: TrackerEvent[] = [
    ev({ ...g, ts: 5, dataSending: true }),                                    // pre_choice data → R9
    ev({ ...g, ts: 15, dataSending: true, detail: { gcmDenied: true } }),       // after reject → R1 + R10
    ev({ ...c, ts: 16 }),                                                       // after reject script → R2
    ev({ ...c, ts: 17, kind: 'cookie_set', detail: { name: 'cto_bundle' } }),   // R3
    ev({ ...c, ts: 18, kind: 'cookie_sent', detail: { names: ['uid'] } }),      // R4
    ev({ ...c, ts: 19, kind: 'fingerprint', detail: { api: 'canvas.toDataURL' } }), // R5
    ev({ ...c, ts: 20, detail: { idSync: true } }),                             // R6
    ev({ ...cdn, ts: 21 }),
    ev({ ...g, ts: 22, site: 'other.example' }),                                // other site ignored
  ];
  const rep = buildReport('news.example', events, [R(10, 'rejected', 'manual')], { cmpDetected: true, gpc: true, now: 100 });
  const rules = rep.findings.map((f) => f.rule).sort();
  for (const r of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R9', 'R10']) assert.ok(rules.includes(r as any), `missing ${r}: ${rules}`);
  assert.equal(rep.orgs[0]!.tier, 'tracking');
  assert.equal(rep.orgs.at(-1)!.orgName, 'Cloudflare');
  assert.equal(rep.counts.afterRejectTrackingOrgs, 2);
  assert.equal(rep.counts.preChoiceTrackingOrgs, 1);
  // R7 + R8: banner/GPP report consent after the user's manual reject
  const receipts = [R(10, 'rejected', 'manual'), R(12, 'accepted', 'tcf'), R(13, 'accepted', 'gpp')];
  const rep2 = buildReport('news.example', [], receipts, { cmpDetected: true, gpc: true });
  assert.deepEqual(rep2.findings.map((f) => f.rule).sort(), ['R7', 'R8']);
  // newer manual mark clears R7
  const rep3 = buildReport('news.example', [], [...receipts, R(20, 'accepted', 'manual')], { cmpDetected: true, gpc: false });
  assert.deepEqual(rep3.findings.map((f) => f.rule), []);
  assert.equal(rep.counts.trackingOrgs, 2);
});

test('buildReport counts after-reject orgs and ignores blocked-only orgs', () => {
  const events = [
    ev({ orgId: 'a', orgName: 'A', category: 'advertising', tier: 'tracking', host: 'a.com', hostSite: 'a.com', ts: 20, dataSending: true }),
    ev({ orgId: 'b', orgName: 'B', category: 'advertising', tier: 'tracking', host: 'b.com', hostSite: 'b.com', ts: 20, kind: 'blocked' }),
  ];
  const rep = buildReport('news.example', events, [R(10, 'rejected')], { cmpDetected: true, gpc: false });
  assert.equal(rep.counts.afterRejectTrackingOrgs, 1);
  assert.equal(rep.receipt?.choice, 'rejected');
  assert.deepEqual(rep.findings.map((f) => f.rule), ['R1']);
});

import { createHmac, createHash } from 'node:crypto';
import { sha256, hmacSha256, toHex } from '../../src/core/hmac';
import { looksPersonal } from '../../src/core/redact';

test('sha256 + hmacSha256 match node:crypto (incl. multi-block and long keys)', () => {
  for (const msg of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'ünïcödé ✓']) {
    assert.equal(toHex(sha256(new TextEncoder().encode(msg))), createHash('sha256').update(msg).digest('hex'));
    for (const key of ['k', 'salt-0123456789abcdef', 'K'.repeat(100)]) {
      assert.equal(toHex(hmacSha256(key, msg)), createHmac('sha256', key).update(msg).digest('hex'));
    }
  }
  assert.equal(hashValue('v', 's'), createHmac('sha256', 's').update('v').digest('hex').slice(0, 16));
});

test('redactUrl hashes personal path segments (emails, long tokens)', () => {
  const r = redactUrl('https://t.example.com/u/jane.doe@example.com/track/aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgdG9rZW4=', 's');
  assert.ok(!r.includes('jane.doe'), r);
  assert.ok(!r.includes('aGVsbG8'), r);
  assert.ok(r.includes('/u/#') && r.includes('/track/#'), r);
  assert.equal(looksPersonal('jane%40example.com'), true);
  assert.equal(looksPersonal('collect'), false);
});
