# See My Trackers: Privacy Policy

_Last updated: 24 November 2026_

**Short version:** See My Trackers collects nothing about you and sends nothing anywhere. Everything it records stays on your device.

## What the extension processes, on your device only
- **Web requests your browser makes** (address, type, time) so it can tell you which companies a page contacted. Before anything is saved, the value of every URL parameter (and any part of the address that looks like an ID or an email address) is replaced with a keyed hash (HMAC-SHA-256). The key is random per install and never leaves your device, so the same ID can't be matched across two people's reports.
- **Cookie names** (not values) that tracking companies set or read.
- **Consent banner state** (for example "rejected via OneTrust at 10:42") read from the banner's public JavaScript API, or your own "I rejected/I accepted" mark.
- **Names of browser features** called by third-party scripts that are commonly used for fingerprinting (for example "canvas.toDataURL").

This is stored in your browser's local extension storage (IndexedDB) and automatically deleted after your retention period (default 30 days). You can delete everything at any time in Settings → "Delete all data".

## What the extension never does
- No accounts, servers, analytics, telemetry, crash reporting or remote configuration.
- No network requests of its own. The tracker database ships inside the extension and is updated only when the extension updates.
- No selling, sharing or transferring of data. There is nothing to share: the developer never receives any data.
- No reading of page content, form fields, passwords or messages.

## Signals sent to websites
If enabled (the default), the extension adds the **Global Privacy Control** header (`Sec-GPC: 1`) and the `navigator.globalPrivacyControl` property to tell websites you opt out of the sale/sharing of your personal data. You can turn this off in Settings.

## Exports
When you click Export, a report file is created on your device. Identifiers inside URLs are hashed. What you do with that file is up to you.

## Permissions and why
| Permission | Why |
|---|---|
| Access to all websites, `webRequest`, `webNavigation` | See which companies each page contacts (observation only) |
| `cookies` | Detect tracking cookies and delete them when you turn on "Enforce my No" |
| `declarativeNetRequest` | Block tracking companies on sites where you enable "Enforce", and add the GPC header |
| `scripting` | Register the GPC page signal |
| `storage`, `unlimitedStorage`, `alarms` | Keep your history on your device and run the daily clean-up |

## Contact
Open an issue on the project's GitHub repository.

## License
Code: GPL-3.0-or-later. Tracker data: Ghostery TrackerDB, CC BY-NC-SA 4.0.
