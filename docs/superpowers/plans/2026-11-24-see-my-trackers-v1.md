# See My Trackers v1.0: Implementation Plan

> **For agentic workers:** execute task by task. Each task = write failing test → implement → test passes → commit. Spec: `docs/superpowers/specs/2026-11-24-see-my-trackers-design.md`.

**Goal:** A local-only MV3 extension for Chrome, Edge and Firefox that records consent receipts and shows which companies were contacted after you rejected, with evidence, an optional Enforce mode and GPC.

**Architecture:** Pure TypeScript core (unit-tested with `node:test`) + thin browser adapters. Build with esbuild into `dist/chrome`, `dist/edge`, `dist/firefox`, each with its own manifest.

**Tech stack:** TypeScript 5, esbuild, tldts, @iabtechlabtcf/core, Ghostery TrackerDB (build-time → `data/trackers.json`), node:test, Playwright (Chromium e2e), Selenium + geckodriver (Firefox e2e), web-ext (lint/sign).

---

## File structure
```
see-my-trackers/
  manifest/base.json, chrome.json, firefox.json   # merged per target
  scripts/build.mjs, build-data.mjs, package.mjs
  data/trackers.json, data/LICENSE (CC BY-NC-SA 4.0 + attribution)
  src/core/{domain,trackers,consent,phase,signals,idsync,rules,redact,cookies,types}.ts
  src/bg/{background,store,tabs,badge,dnr,messages}.ts
  src/content/{probe,relay}.ts
  src/ui/{popup,dashboard,onboarding,limitations}.{html,ts,css}, src/ui/shared.ts
  tests/unit/*.test.ts
  tests/fixtures/site/* (fake site, fake TCF CMP, fake trackers), tests/fixtures/server.mjs
  tests/e2e/chrome.e2e.mjs, tests/e2e/firefox.e2e.mjs
  store/ (listing text, screenshots, privacy policy)
  LICENSE (GPL-3.0-or-later), README.md, PRIVACY.md, LIMITATIONS.md
```

## Milestone 0: Spike (validate platform assumptions)
- [ ] **T0.1** Chrome for Testing: MV3 service worker receives `webRequest.onBeforeRequest`/`onSendHeaders`(`extraHeaders`)/`onHeadersReceived`/`onErrorOccurred` after the worker has been idle and killed. *Accept:* events are logged after a 60 s idle period.
- [ ] **T0.2** Firefox: same, with an event-page background; host permission grant flow on install.
- [ ] **T0.3** MAIN-world content script at `document_start` can call `__tcfapi` and see `dataLayer` pushes (Chrome + Firefox 128+).
- [ ] **T0.4** DNR-blocked request shows up as `onErrorOccurred` with `net::ERR_BLOCKED_BY_CLIENT` (Chrome) / `NS_ERROR_ABORT` (Firefox).
- [ ] **T0.5** License check of every runtime dependency → recorded in `NOTICE`.

## Milestone 1: Core (pure, TDD)
- [ ] **T1.1 `domain.ts`:** `siteOf(url)`, `isThirdParty(reqHost, site, ownerOf)`. Tests: subdomains, IPs, localhost, `.co.uk`, same-owner exception.
- [ ] **T1.2 `build-data.mjs` + `trackers.ts`:** compact map `{domains: {d: pid}, patterns: {pid: [name, cat, orgId]}, orgs: {orgId: [name, country, contact, policyUrl]}}`; `lookup(host)` walks suffixes. Tests: `www.google-analytics.com` → Google/site_analytics; unknown → null; longest suffix wins.
- [ ] **T1.3 `consent.ts`:** normalizers for TCF (`tcData` + decoded string), GPP, OneTrust (`OptanonActiveGroups`), Cookiebot (`Cookiebot.consent`), Didomi, Usercentrics, GCM (`['consent','update',{...}]`). Output `ConsentState`. Tests per platform: reject / accept / partial / still pending.
- [ ] **T1.4 `phase.ts`:** latest-receipt-wins timeline; cmp-detected-without-choice → `pre_choice`. Tests: revocation, manual overrides API, events before first receipt.
- [ ] **T1.5 `redact.ts`:** salted SHA-256 prefix for values; keep param names; cap URL length. Tests: deterministic per salt, no raw value survives.
- [ ] **T1.6 `signals.ts`:** `dataSending(type, url, hasBody)`, identifier-like param extraction (length ≥ 8, high entropy, not timestamps/common words), `gcs` parse, `usprivacy`/GPP opt-out parse. Tests with real captured URLs (GA4 collect, Meta pixel, DoubleClick).
- [ ] **T1.7 `idsync.ts`:** per-tab map hash → orgs; emits a finding when the count of orgs reaches ≥ 2 (excluding the first party). Tests.
- [ ] **T1.8 `rules.ts`:** R1–R10 → `Finding {id, severity, confidence, org, count, firstTs, text}`; aggregation per site and per org. Tests per rule + plain-language text snapshot.
- [ ] **T1.9 `cookies.ts`:** known-cookie dictionary (~60 common trackers) + `classifyCookie(name, domain)`. Tests.

## Milestone 2: Background adapters
- [ ] **T2.1 `tabs.ts`:** tabId → top site from `webNavigation.onCommitted` (frameId 0) plus a request-initiator fallback; handles prerender and back/forward cache.
- [ ] **T2.2 `background.ts`:** top-level listener registration (MV3 rule); normalize Chrome `initiator` vs Firefox `documentUrl/originUrl`; drop extension/own requests; classify → event.
- [ ] **T2.3 `store.ts`:** IndexedDB with batched writes (500 ms), per-tab in-memory index rebuilt from IDB on worker wake; retention sweep on startup + daily alarm.
- [ ] **T2.4 `badge.ts`:** red = after-reject tracking orgs, orange = pre-choice orgs; per tab; resets on navigation.
- [ ] **T2.5 `dnr.ts`:** GPC header rule (id 1); Enforce rules per site (ids 1000+); cookie cleanup on enable.
- [ ] **T2.6 `messages.ts`:** typed RPC for popup/dashboard (`getTabReport`, `getSiteReport`, `getProfile`, `setManualReceipt`, `setEnforce`, `exportSite`, `wipe`, `settings`). Validate sender is the extension itself.

## Milestone 3: Page probes
- [ ] **T3.1 `probe.ts` (MAIN):** consent-platform polling with backoff (0–15 s) plus event listeners; `dataLayer.push` wrapper; GPC navigator property; observe-only fingerprint wrappers with stack → script URL attribution; one tagged postMessage channel. Must not throw into the page (all wrapped in try/catch).
- [ ] **T3.2 `relay.ts` (ISOLATED):** accepts only same-window messages with the tag; forwards to background; per-frame rate limit.

## Milestone 4: UI
- [ ] **T4.1 Popup:** receipt card + "I rejected / I accepted" buttons; findings grouped (After you rejected / Before you chose / Other third parties); company rows expand to evidence; Enforce toggle; links to dashboard & limitations.
- [ ] **T4.2 Dashboard:** company profile table (sites seen, after-reject sites, categories, country), site list, site report view, export JSON/HTML, settings (GPC, retention, wipe).
- [ ] **T4.3 Onboarding + Limitations pages;** Firefox host-permission request button.

## Milestone 5: Verification
- [ ] **T5.1 Fixture e2e (Chromium):** fake TCF site: reject → tracker beacon → popup report contains R1, R3, R6, R9 and badge = 2.
- [ ] **T5.2 Fixture e2e (Firefox):** same via Selenium/geckodriver.
- [ ] **T5.3 Real sites (Chrome/Edge/Firefox):** ≥15 sites; log the results table in `docs/validation/2026-11-real-sites.md`; investigate every false positive.
- [ ] **T5.4 Performance + "no outbound calls" check.**

## Milestone 6: Release
- [ ] **T6.1** `npm run package` → `see-my-trackers-chrome.zip`, `-edge.zip`, `-firefox.zip`, plus the source zip for AMO review.
- [ ] **T6.2** Store listings, privacy policy, screenshots in `store/`.
- [ ] **T6.3** GitHub repo + v1.0.0 release (owner's account; owner approves publishing).
- [ ] **T6.4** Owner submits to Chrome Web Store, Edge Add-ons, AMO with the prepared files.

## Milestone 7 (v2): First-party & self-hosted analytics (spec §11)
- [ ] **T7.1** `core/firstparty.ts`: endpoint signature table + matcher (tests with real captured URLs for PostHog, Matomo, Plausible, Umami, Snowplow, Segment, Rudder, Amplitude, Mixpanel, proxied GA4, sGTM).
- [ ] **T7.2** Probe: library-global fingerprints (L1) → `analyticsLib` page messages.
- [ ] **T7.3** Background: stop dropping first-party requests; classify via T7.1 into tier `own_analytics`.
- [ ] **T7.4** Firefox CNAME uncloaking (L3) with a cached `dns.resolve` + CNAME tracker list (license check first).
- [ ] **T7.5** Session-replay heuristic (L4) + stable first-party ID heuristic (L5) with false-positive corpus.
- [ ] **T7.6** Rules R11–R13, popup section "Site's own analytics", dashboard column.
- [ ] **T7.7** Fixture pages for each product + real-site validation (≥10 sites known to self-host PostHog/Matomo/Plausible).
