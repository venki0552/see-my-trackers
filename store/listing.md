# Store listing: See My Trackers 1.0.0

## Name
See My Trackers

## Short description (≤132 chars; Chrome/Edge summary)
See which companies your browser talks to after you reject cookies, with evidence. Local-only and open source.

## Category
Chrome Web Store: Privacy & Security · Edge: Privacy & security · AMO: Privacy & Security

## Full description
Cookie banners ask you to choose. See My Trackers checks what happens after you click "Reject".

Independent research on ~100,000 websites found that most sites with an opt-out still collect data after people refuse. Now you can see it for yourself.

WHAT IT SHOWS
• Your consent receipt: what you chose, when, and on which banner (IAB TCF, GPP, OneTrust, Cookiebot, Didomi, Usercentrics, Google Consent Mode), or mark it yourself with one click.
• A red badge with the number of tracking companies contacted AFTER you rejected (orange = before you chose).
• Which companies, by name, with category and country, and what they did: received data, set or read tracking cookies, shared an ID with another company, or ran fingerprinting code.
• A cross-site profile: which companies follow you across the sites you visit, and on how many of them after you said no.
• An evidence report (HTML/JSON) you can keep or send, with identifiers hashed.

WHAT IT CAN DO
• "Enforce my No": one switch blocks those companies on that site and deletes their cookies.
• Sends Global Privacy Control (GPC), the opt-out signal recognized by California and other US state laws (can be turned off).

PRIVATE BY DESIGN
• No accounts, servers, analytics or telemetry. The extension makes no network requests of its own.
• Everything stays on your device and is deleted after 30 days (configurable).
• URL values are hashed before anything is stored.
• Free and open source (GPL-3.0).

HONEST ABOUT LIMITS
No browser tool can see data that sites share server-to-server, and some legitimate services look like trackers. The extension shows observations, not legal verdicts, and has a built-in page explaining exactly what it can't see.

## Single purpose (Chrome Web Store)
Show users which third-party tracking companies a website contacts relative to the user's cookie-consent choice, and let the user block them.

## Permission justifications (Chrome Web Store "Privacy practices")
- host permissions (<all_urls>): needed to observe which third parties each page contacts, on any site the user visits.
- webRequest: observe (not modify) requests to identify tracking companies and the cookies they set/read.
- webNavigation: know when a new page starts so observations are grouped per page.
- cookies: detect tracking cookies written by scripts; delete tracking cookies when the user enables "Enforce".
- declarativeNetRequest: block tracking companies on sites where the user enables "Enforce"; add the Global Privacy Control header.
- scripting: register the Global Privacy Control page signal when the user has GPC enabled.
- storage / unlimitedStorage: keep the user's history on their own device.
- alarms: daily deletion of data older than the retention period.
- Remote code: No. All code is in the package.

## Data usage disclosures (Chrome Web Store)
- Collects: none. ("Web history" is processed locally only and never transmitted.)
- Certify: not sold to third parties; not used for unrelated purposes; not used for creditworthiness.

## Firefox AMO
- Data collection: none (`data_collection_permissions: none` in manifest).
- Source code: upload release/see-my-trackers-1.0.0-source.zip. Build: `npm ci && npm run data && node scripts/build.mjs firefox` (Node 22). Output is unminified.
- License: GPL-3.0-or-later (code); bundled data CC BY-NC-SA 4.0.

## Assets
- Icon 128: dist/chrome/icons/icon-128.png · 512: store/icon-512.png
- Screenshots (1280×800): store/screenshots/
- Privacy policy URL: link to PRIVACY.md in the GitHub repo
