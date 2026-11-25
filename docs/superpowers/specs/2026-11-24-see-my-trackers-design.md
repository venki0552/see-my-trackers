# See My Trackers: Design Spec

- **Date:** 2026-11-24
- **Status:** Approved for build (owner: Venkat; free hand given to build, test, package)
- **Type:** Open-source, cross-browser WebExtension (Manifest V3)

---

## 1. Problem

Cookie banners promise a choice. Independent research shows the choice is often ignored:

| Finding | Source |
|---|---|
| >65.4% of sites with an opt-out option collect data despite explicit refusal; 73.4% do so when the user never touches the banner | USENIX Security 2024 (Bouhoula et al.), 97k sites |
| >75% of tracking activity happened before a choice, or after the user rejected | WWW 2021 (Papadogiannakis et al.), ~1M sites |
| 57.5% of sites do not delete cookies after consent is revoked | PoPETs 2025, "Johnny Can't Revoke Consent Either" |
| Only 12% of sites with a US Privacy String opted users out after receiving a GPC signal | Zimmeck et al. (NSF PAR 10482130) |

Ordinary users have no way to see this. Blockers (uBlock Origin, Ghostery, Privacy Badger) block trackers but don't compare **what you chose** with **what then happened**. Existing consent auditors are prototypes (Cookie Consent Lie Detector: 0 stars, Chrome-only, unpublished), abandoned (Cookie Glasses), freemium (ConsentScope), or for developers only (cookie-consent-validator, Blacklight).

## 2. Product statement

> **See My Trackers shows you which companies your browser talked to after you said "no", with the evidence, in plain language, and lets you enforce your "no" yourself.**

### Goals
1. **Consent receipt:** record what the user chose on each site (when, how, which consent platform, decoded consent string).
2. **After-reject audit:** list every third-party company contacted, cookie set, cookie sent, fingerprinting call and ID hand-off after the choice. Each item is labeled by phase: *before choice / after reject / after accept / no banner*.
3. **Name the companies:** map domains to the organizations that own them, with category, country and privacy contact.
4. **Cross-site profile:** "Google saw you on 41 sites this week, 12 of them after you rejected."
5. **Evidence:** export per-site JSON plus a human-readable HTML report, suitable for a complaint or a data access request.
6. **Enforce (opt-in, per site):** block tracking companies and delete their cookies on sites where you rejected.
7. **Send opt-out signals:** Global Privacy Control (GPC), on by default, and report whether the site's own privacy strings honored it.
8. **Honest limits:** an in-app Limitations page and per-finding confidence levels. No legal verdicts.

### Non-goals (v1)
- Full ad blocking (use uBlock Origin; we coexist with it).
- Server-side tracking detection (impossible from the browser; documented as a limitation).
- Any backend, account, telemetry or analytics. **Zero network calls by the extension.**
- Legal advice or "illegal" labels. We report observations.

## 3. Users and core flows

**Everyday user (primary)**
1. Install → onboarding page explains what's watched, confirms permissions (Firefox may need an extra grant), and shows the limits.
2. Visit a site → click "Reject all" on the banner (or have it auto-recorded from the consent platform's API).
3. The toolbar badge shows a red count of tracking companies contacted **after reject** (orange = before any choice).
4. Click the icon → the popup shows the receipt ("You rejected at 10:42 via OneTrust"), the company list grouped by phase, and plain-language explanations.
5. Optional: "Enforce my No on this site" → blocks those companies and deletes their cookies from then on.
6. Dashboard → cross-site company profile, site list, export of evidence.

**Power user / journalist / regulator (secondary):** per-site evidence export with timestamps, request URLs (values hashed by default), consent strings and the extension version, so it can be reproduced.

## 4. Platform reality (verified Nov 2026)

| Capability | Chrome / Edge / Brave / Opera (desktop) | Firefox desktop + Android | Edge Android | Safari macOS / iOS |
|---|---|---|---|---|
| Observe all network requests (`webRequest`, non-blocking) | ✅ MV3 | ✅ MV3 | ✅ (Chromium) | ❌ MV3 non-persistent background cannot listen to webRequest |
| See `Cookie` / `Set-Cookie` headers | ✅ with `extraHeaders` | ✅ | ✅ | ❌ |
| `cookies` API + `onChanged` | ✅ | ✅ | ✅ | ⚠️ partial |
| Main-world script at document_start (CMP / API probe) | ✅ (manifest `world: "MAIN"`) | ✅ Firefox 128+ | ✅ | ⚠️ not via registerContentScripts |
| Block (`declarativeNetRequest`) | ✅ | ✅ | ✅ | ✅ |
| Blocking `webRequest` | ❌ (policy installs only) | ✅ (not used: one code path) | ❌ | ❌ |
| CNAME uncloaking (`dns.resolve`) | ❌ | ✅ | ❌ | ❌ |
| Third-party cookies by default | **On** (Google kept them; Privacy Sandbox retired Oct 2025) | Partitioned (Total Cookie Protection) | On | Blocked (ITP) |
| Store | Chrome Web Store ($5 one-time) / Edge Add-ons (free) | AMO (free) | Edge Add-ons | App Store (Xcode + $99/yr) |

**Decision:** one MV3 codebase, observation via `webRequest` (unspoofable by pages), blocking via `declarativeNetRequest` everywhere. **Safari is out of scope** (owner decision, 2026-11-24): it can't observe network requests from an MV3 extension.

## 5. Architecture

```
┌──────────────────────── Web page (each frame) ────────────────────────┐
│ MAIN world: probe.js (document_start)                                 │
│   - reads consent APIs: __tcfapi, __gpp, OneTrust, Cookiebot, Didomi, │
│     Usercentrics, Google Consent Mode (dataLayer)                     │
│   - observe-only hooks: canvas/WebGL/audio/font fingerprint APIs,     │
│     document.cookie writes, localStorage writes                       │
│   - sets navigator.globalPrivacyControl = true (if GPC on)            │
│        │ window.postMessage (tagged)                                  │
│ ISOLATED world: relay.js ── runtime.sendMessage ──┐                   │
└───────────────────────────────────────────────────│───────────────────┘
                                                    ▼
┌──────────── Background (Chrome service worker / Firefox event page) ──┐
│ webRequest observers ─► normalize ─► classify (site, 3p, entity,      │
│ cookies.onChanged    ─►              category, phase, signals)        │
│ consent intake       ─► ReceiptStore                                  │
│ rules engine         ─► Findings (per tab + per site)                 │
│ badge updater, DNR manager (GPC header, Enforce rules)                │
│ EventStore (IndexedDB, batched writes, retention)                     │
└──────────────────────────────▲────────────────────────────────────────┘
                               │ runtime messages
            popup.html  ·  dashboard.html  ·  onboarding.html
```

### 5.1 Modules (pure core = unit-tested; adapters = thin)
| Module | Responsibility |
|---|---|
| `core/domain.ts` | eTLD+1 (tldts), third-party test with same-owner exception (e.g. `youtube.com` on `google.com` sites is the same company) |
| `core/trackers.ts` | host → `{patternId, name, category, org, orgName, country, privacyContact}` by suffix walk over the bundled TrackerDB map |
| `core/consent.ts` | normalize CMP payloads into `ConsentState {choice: rejected/accepted/partial/unknown, source, purposes, ts}`; TCF decode via `@iabtechlabtcf/core` |
| `core/phase.ts` | event timestamp + receipt timeline → `pre_choice/after_reject/after_accept/after_partial/no_banner` |
| `core/signals.ts` | per-request signals: data-sending type (beacon/ping/xhr/image with params/POST), cookies sent, identifier-like params, Google Consent Mode `gcs`, US Privacy / GPP strings |
| `core/idsync.ts` | hashed identifier values seen at 2+ different organizations on one page → ID hand-off finding |
| `core/rules.ts` | findings with severity + confidence and plain-language text |
| `core/redact.ts` | URL redaction: keep scheme/host/path and param names; values replaced by salted SHA-256 prefixes |
| `core/cookies.ts` | known-cookie dictionary (e.g. `_ga`, `_fbp`, `IDE`): purpose, owner, typical lifetime |
| `bg/*` | listeners, tab/frame → top-site map, stores, badge, DNR, messaging |
| `ui/*` | popup, dashboard, onboarding, limitations (Preact-free vanilla TS; every page-derived string HTML-escaped) |

### 5.2 Data model
```ts
type Phase = 'pre_choice' | 'after_reject' | 'after_accept' | 'after_partial' | 'no_banner';
interface ConsentReceipt { site: string; ts: number; choice: 'rejected'|'accepted'|'partial'|'unknown';
  source: 'tcf'|'gpp'|'onetrust'|'cookiebot'|'didomi'|'usercentrics'|'gcm'|'manual';
  purposes?: Record<string, boolean>; tcfSummary?: {...}; gpc: boolean; }
interface TrackerEvent { ts: number; tabId: number; site: string; host: string; org?: string;
  category?: string; kind: 'request'|'cookie_set'|'cookie_sent'|'fingerprint'|'storage'|'blocked';
  reqType?: string; dataSending: boolean; phase: Phase; urlRedacted: string; detail?: Record<string, unknown>; }
```
Stored in IndexedDB (`events`, `receipts`, `sites`, `settings`). Retention defaults to 30 days, with a one-click wipe. Raw identifier values are **never stored**; only salted hashes (the salt is random per install and never leaves the device).

### 5.3 Phase logic
- No receipt yet and no consent platform detected → `no_banner` (we can't tell if a banner exists; shown neutrally).
- Consent platform detected, no choice yet → `pre_choice`.
- After a receipt → phase follows the **latest** receipt at event time (handles revocation and changes).
- Manual receipts ("I rejected") override API-reported state, and any conflict between the two is itself a finding: *"Site recorded consent although you said you rejected."*

### 5.4 Findings (initial rule set)
| ID | Rule | Severity |
|---|---|---|
| R1 | Tracking-category org received **data-sending** request after reject | High |
| R2 | Tracking-category org contacted (script/resource) after reject | Medium |
| R3 | Tracking cookie **set** after reject | High |
| R4 | Existing tracking cookie still **sent** to its owner after reject | High |
| R5 | Fingerprinting API pattern (canvas readback / WebGL renderer / audio) by a third-party script after reject | Medium (confidence: heuristic) |
| R6 | Identifier hand-off between 2+ organizations (same hashed value) | High |
| R7 | Consent platform reports consent after the user's manual reject | High |
| R8 | GPC sent, but the site's US Privacy/GPP string doesn't show opt-out | Medium |
| R9 | Tracking before any choice (pre_choice) | Medium |
| R10 | Google Consent Mode "denied" pings still sent to Google (cookieless pings): **informational** | Info |

"Tracking category" = `advertising`, `site_analytics`, `social_media`, `pornvertising`. `customer_interaction`, `audio_video_player`, `misc` = "other third parties" (shown, not counted in the red badge). `hosting`, `consent`, `utilities`, `extensions`, first-party = not counted.

### 5.5 Enforce mode
Per site, opt-in. Adds DNR dynamic block rules for tracking-category domains seen on that site (`initiatorDomains: [site]`, `domains` from org patterns), and deletes those orgs' cookies. Blocked attempts are still recorded (`onErrorOccurred` → `net::ERR_BLOCKED_BY_CLIENT`) as `kind: 'blocked'`, so the report shows "tried after you rejected (blocked)". Requests blocked by other blockers (uBlock etc.) are recorded the same way, as evidence the site *tried*.

### 5.6 GPC
Default **on** (toggle in settings): DNR `modifyHeaders` adds `Sec-GPC: 1` to all requests; the main-world probe defines `navigator.globalPrivacyControl = true`. The receipt records that GPC was sent. R8 checks `usprivacy` / GPP strings for opt-out.

## 6. Privacy, security and resilience ("nobody can stop this")
- **Local-only:** no servers, accounts, telemetry or remote config. Works offline. No kill switch exists to be pulled.
- **No remote code** (store policy compliance). Tracker data is bundled and updated with each release.
- **Unspoofable core:** network evidence comes from the browser's `webRequest` layer, which pages cannot see or block. Page-world evidence (consent API, fingerprinting hooks) is labeled *page-reported*; a hostile page can only hide or fake its own data.
- **Minimal hooks:** observe-only wrappers (no spoofing) to reduce site breakage; per-site "pause probe" switch.
- **XSS-safe UI:** every cookie name, URL and consent string is hostile input → `textContent` only, never `innerHTML`. Strict extension CSP.
- **Supply chain:** 3 runtime dependencies (tldts MIT, @iabtechlabtcf/core Apache-2.0, bundled TrackerDB data), lockfile, reproducible build script, CI on every commit, signed release artifacts.
- **Multi-channel distribution:** Chrome Web Store, Edge Add-ons, Firefox AMO, GitHub Releases (zip + AMO-signed .xpi). If one store delists it, the others plus GitHub keep it available.
- **License:** code **GPL-3.0-or-later** (forks must stay open). Bundled tracker data from Ghostery TrackerDB, **CC BY-NC-SA 4.0** (non-commercial, share-alike), kept under `data/` with attribution. Alternatives (DuckDuckGo Tracker Radar, Disconnect) carry the same license, so this project stays non-commercial. That matches the owner's intent.
- **Legal posture:** wording is "observed", "contacted", "may indicate", never "illegal". Company names are factual; no logos.

## 7. Limitations (shown in-app, verbatim intent)
1. **Server-to-server sharing is invisible.** Once a site has your data, it can forward it from its servers (e.g. Meta Conversions API, server-side Tag Manager). No browser tool can see that.
2. **Disguised first-party trackers.** Trackers on the site's own subdomain (CNAME cloaking) look first-party. Firefox can partly detect them; Chrome/Edge cannot.
3. **Unknown companies.** Domains missing from the tracker database are listed as "unknown third party", not as trackers.
4. **Fingerprinting detection is heuristic.** It can miss techniques or flag legitimate uses (e.g. anti-fraud on login pages).
5. **"Necessary" exceptions.** Some contacts (payment, fraud prevention, a CDN owned by an ad company) may be legitimate. We show the category; you judge.
6. **Legitimate interest.** Under the IAB framework, sites may claim "legitimate interest" for some purposes even after you reject. We show those claims separately.
7. **Other extensions and browser shields** (uBlock, Brave, Firefox ETP) block some requests first. We show those as "blocked attempts" when the browser reports them.
8. **Before install / before the probe loads.** Cookies set before install and very early inline scripts may be missed.
10. **Not legal advice.** Whether something is a violation depends on law, location and context.

## 8. Testing and acceptance
- **Unit (node:test):** all `core/*` modules. ≥90% branch coverage on rules/phase/consent/domain.
- **Fixture e2e (Chrome for Testing + Firefox via Playwright/Selenium):** local fixture site with a fake TCF consent platform and fake trackers on separate hostnames (`site.test`, `ads.tracker.test`, mapped to localhost). Scripted flow: load → reject → tracker fires → assert findings R1/R3/R6/R9 and badge count.
- **Real-site validation:** ≥15 consent-banner-heavy sites (EU news, US news, shopping) in Chrome, Edge, Firefox. For each, compare the extension's after-reject list against a DevTools/HAR capture. Target: ≥95% precision on R1/R2 (every reported company really was contacted after reject).
- **Performance:** extension overhead <5% page-load time on the top 10 test sites; handler p95 <2 ms.
- **Release gates:** `web-ext lint` clean; Chrome package loads with zero errors; no network calls by the extension (verified via `chrome://net-export` / HAR filter).

## 9. Roadmap
| Version | Scope |
|---|---|
| **v1.0** (this build) | Receipts (TCF, GPP, OneTrust, Cookiebot, Didomi, Usercentrics, GCM, manual), request + cookie + fingerprint observation, R1–R10, popup, dashboard with cross-site profile, evidence export (JSON + HTML), Enforce mode, GPC, retention/wipe, onboarding + limitations. Chrome / Edge / Firefox desktop. |
| v1.1 | Auto-reject banners via `@duckduckgo/autoconsent` (MPL-2.0): precise receipts without clicking. Firefox CNAME uncloaking. |
| v1.2 | Complaint/DSAR templates (GDPR authority, US state attorneys general), localization (DE/FR/ES/IT/NL). |
| v1.3 | Firefox Android + Edge Android verification, mobile popup layout. |
| **v2.0** | **First-party & self-hosted analytics detection** (see §11). Lightbeam-style graph view. (Safari: out of scope.) |

## 11. v2: First-party and self-hosted analytics (owner request, 2026-11-24)

**Gap:** v1 counts *third-party* companies. Sites increasingly run analytics on their own domain: self-hosted PostHog, Matomo, Plausible, Umami, Snowplow, RudderStack; proxied Google Analytics / server-side Tag Manager on `metrics.site.com`; or home-built trackers. Those requests look first-party, so v1 doesn't count them.

**Detection layers (each labeled with confidence):**
| Layer | How | Confidence |
|---|---|---|
| L1 Library fingerprint | MAIN-world probe checks globals and init calls: `posthog`, `_paq`/`Matomo`, `plausible`, `umami`, `fathom`, `mixpanel`, `amplitude`, `analytics` (Segment), `rudderanalytics`, `GlobalSnowplowNamespace`, `heap`, `Countly`, `OpenReplay`, `LogRocket`, `FS` (FullStory), `clarity`, `hj` | High |
| L2 Endpoint signatures | First-party request paths: PostHog `/e/`, `/i/v0/e/`, `/decide/`, `/flags/`, `/s/`; Matomo `matomo.php`/`piwik.php`; Plausible `/api/event`; Umami `/api/send`; Snowplow `/com.snowplowanalytics.snowplow/tp2`; Segment/Rudder `/v1/t`, `/v1/p`, `/v1/track`; Amplitude `/2/httpapi`; Mixpanel `/track`, `/engage`; proxied GA4 `/g/collect` with `tid=G-`; server-side GTM (`gtm.js` / `gtag/js` served from the site's own subdomain) | High |
| L3 Hidden third parties | Firefox: `dns.resolve` CNAME uncloaking of first-party subdomains (e.g. `metrics.site.com → *.posthog.com / *.eulerian.net`) against a CNAME tracker list | High (Firefox only) |
| L4 Session replay | Probe notes rrweb-style recording: full-DOM serialization + MutationObserver + input/mouse listeners, followed by batched compressed POSTs to a first-party endpoint | Medium |
| L5 Home-built heuristics | First-party beacons/POSTs on `pagehide`/`visibilitychange` carrying a stable identifier (same hashed ID on every page and across visits, persisted in a first-party cookie/localStorage) | Heuristic |

**Reporting:** a new tier **"Site's own analytics"**, shown in its own section with the product name when identified ("Self-hosted PostHog: 14 events after you rejected, session replay active"). Not counted in the red badge by default, because some privacy regulators exempt strictly limited first-party audience measurement (e.g. France's CNIL). Session replay and persistent cross-visit IDs after a reject **do** count and get their own findings: R11 (first-party analytics after reject), R12 (session replay after reject), R13 (stable first-party ID after reject).

**Limits:** purely server-side logging (web-server logs, edge analytics) is invisible, as is anything sent inside the site's own API calls without a recognizable pattern.

## 10. Decisions log
| # | Decision | Why |
|---|---|---|
| D1 | Plain TypeScript + esbuild, no framework | Few dependencies, full control over per-browser manifests, small audit surface |
| D2 | Observe-only by default; Enforce opt-in per site | Measuring requires letting requests happen; users choose when to switch to protection |
| D3 | Hash identifier values, never store raw | Evidence without creating a new tracking database |
| D4 | TrackerDB as primary data source | Maintained, includes organizations, categories, countries, privacy contacts; same license as alternatives |
| D5 | GPC on by default | Matches the mission; legally meaningful in 12+ US states |
| D6 | GPL-3.0 code | Keeps derivatives open |

## References
- USENIX Sec '24: https://usenix.org/system/files/usenixsecurity24-bouhoula.pdf
- WWW '21: https://arxiv.org/abs/2102.08779
- PoPETs '25 revocation: https://arxiv.org/html/2411.15414v3
- GPC compliance: https://par.nsf.gov/servlets/purl/10482130
- Chrome webRequest (MV3): https://developer.chrome.com/docs/extensions/reference/api/webRequest
- Chrome declarativeNetRequest: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- Firefox 128 MAIN world: https://blog.mozilla.org/addons/ (MV3 updates landed in Firefox 128)
- Safari webRequest limitation (why Safari is out of scope): https://developer.apple.com/forums/thread/781636
- Chrome 3P cookies kept: https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies
- Ghostery TrackerDB (CC BY-NC-SA 4.0): https://github.com/ghostery/trackerdb
- Prior art: github.com/MohammedSabith/cookie-lie-detector · github.com/Ben1991/CookieBuddy · github.com/Perdu/Cookie-Glasses · github.com/dibollinger/CookieBlock · themarkup.org/blacklight · jshelter.org
