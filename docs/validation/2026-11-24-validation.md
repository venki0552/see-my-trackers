# Validation report: See My Trackers 1.0.0 (2026-11-24)

## 1. Automated tests
| Suite | Browser | Result |
|---|---|---|
| Unit tests (core engine) | Node 22 | **15/15 pass** |
| End-to-end, fixture site (fake TCF banner + 3 trackers) | Chromium 153 (Chrome for Testing) | **PASS** |
| End-to-end, fixture site | Firefox 161 | **PASS** |

The e2e checks cover: TCF reject receipt; R1 data sent after reject; R3 cookie set after reject; R5 canvas fingerprinting by a third-party script; R6 same ID sent to two companies; R9 tracking before choice; CDN not counted as tracking; `Sec-GPC: 1` header + `navigator.globalPrivacyControl`; Enforce mode blocks the tracker (0 requests reach it) and logs the blocked attempts; export never contains the raw identifier.

## 2. Real sites in the owner's Chrome (macOS, Charlotte NC, logged-in profile)
Method: Claude in Chrome drove the real browser; banner rejected by clicking it like a user; report read from the validation build. **Ground truth:** for every company reported "after reject", the page's own Resource Timing log must contain a request to that company's domain after the click time.

| Site | Banner / signal | What the user did | Receipt recorded | Tracking cos. after reject | Verified by network log | Before any choice | Notable findings |
|---|---|---|---|---|---|---|---|
| stackoverflow.com | OneTrust + GCM + GPP | "Necessary cookies only" | rejected (OneTrust) | 1: Google | 1/1 | 4 (Google, Meta, Automattic…) | Google: 2 data-sending requests after reject; Consent Mode "denied" pings |
| lemonde.fr | IAB TCF | "Reject all cookies" | rejected (TCF, 0/10 purposes) in 1.3 s | 1: AppsFlyer | 1/1 | 1 (Magnite) | Largely honored |
| elpais.com | TCF + Didomi (1,043 partners) | Configuration → "Disagree to all" | rejected (TCF 0.5 s, Didomi 0.7 s) | 2: Adobe, Marfeel | 2/2 | 8 | Marfeel set 4 cookies and read 7 after reject |
| nytimes.com | GPP (US) | nothing (GPC on) | opted out (GPP: 3/3 opt-outs) | 1: Google | 1/1 | 7 | Google: 19 data-sending requests + Google cookies sent after opt-out |
| theguardian.com | GPP (US) | nothing (GPC on) | *missed → fixed* | 0 | n/a | 1 | Site displayed "GPC detected; opt-out honored" (GPC works) |
| independent.co.uk | TCF + GPP + GCM, no banner shown (US) | nothing | none | 0 | n/a | 23 (verified 22/23) | ID sharing between companies |
| spiegel.de | TCF "pay or consent" wall (no free reject) | nothing | none | 0 | n/a | 2 | Free option is only "accept" |
| booking.com | OneTrust, no banner shown (US) | nothing | none | 0 | n/a | 2 (2/2) | |
| dailymail.com | none | nothing | none | 0 | n/a | 0 (4 tracking cos., 3/4 in Resource Timing; the 4th sent beacons, which Resource Timing does not list) | |

**Precision (owner's Chrome):** 6/6 after-reject companies confirmed by the network log; 27/28 "before choice/no banner" tracking companies confirmed. The one miss is a `sendBeacon`, which Resource Timing doesn't record.

## 3. Real sites, automated (cloud Chromium, US egress, 16 sites)
See `real-sites-chrome.json`. **49/51** after-reject company reports were confirmed by the browser's own request log. The 2 unconfirmed were cookie-only events on first-party cookies. Notable: NYTimes, 35 tracking companies after the GPC opt-out; Stack Overflow, 13 after OneTrust reject (in that run with no logged-in profile); Independent, 54 before any choice.

## 4. Bugs found by validation and fixed
1. **GPP opt-out missed while the site shows its "GPC honored" notice** (Guardian). `cmpDisplayStatus: visible` was read as "no choice yet". Fix: a recorded opt-out or `Gpc: true` counts as the user's choice. Unit test added.
2. **"Before you made a choice" was misleading** on sites whose consent platform shows no banner in the US (Booking, Independent). Renamed to "before any consent choice was recorded".
3. **US opt-out ≠ reject.** GPP receipts now read "opted out of sale/sharing" instead of "rejected tracking".
4. Duplicate company rows for ID-sharing partners (fixed in the fixture run).
5. Enforce mode missed Firefox `beacon` requests (fixed; now blocks every resource type except the page itself).

## 5. Known limits observed
- Receipts arrive 0.5–1.3 s after the click. Requests in that window are labeled "before any choice", which errs toward not over-accusing.
- Requests made by `sendBeacon` don't appear in Resource Timing (affects the ground-truth check, not the extension).
- Many US visitors see no banner at all; GPC is the meaningful signal there.
- Edge: same Chromium engine and same package; validated by the owner's manual checklist (below).

## 6. Edge checklist (manual)
1. `edge://extensions`: See My Trackers loaded with no errors.
2. Open lemonde.fr → "Reject all cookies" → toolbar icon shows a number (or none) → popup shows "You rejected tracking … via IAB TCF".
3. Open stackoverflow.com → "Necessary cookies only" → popup lists Google under "After you rejected".
4. Popup → Dashboard → Companies tab lists the companies.
