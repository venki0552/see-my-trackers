# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub's **Report a vulnerability** button on the [Security tab](https://github.com/venki0552/see-my-trackers/security/advisories/new). Don't open a public issue for anything that could hurt users. You'll get a reply within 7 days.

In scope: the extension code in `src/`, the build and packaging scripts, and the GitHub workflows.

## Threat model

See My Trackers runs on every page you visit, so it treats every page as hostile.

| Threat | Mitigation |
|---|---|
| A page injects HTML or script into the popup, dashboard or exported report | All page-derived strings are rendered with `textContent` / escaped (`esc()`); no `innerHTML` with page data. MV3 CSP forbids inline and remote script. |
| A page forges messages to the extension (the MAIN-world probe can be imitated) | Fingerprinting reports are accepted only for third-party script hosts the background saw load on that tab. Per-page event cap of 5,000 stops storage flooding. Consent messages only change that site's own receipt. |
| Identifiers leak through stored data or exports | URL parameter values and ID-like or personal path segments are replaced with HMAC-SHA-256 hashes keyed by a random per-install salt. Exports contain a coarse browser name, not the user agent. Nothing is sent over the network. |
| Enforce breaks sites or logs the user out | Only tracking-category domains are blocked; sites the user visits directly, sign-in and CAPTCHA hosts are never blocked; cookies are deleted only for tracker hosts seen on that site. |
| Compromised CI or build dependency | Actions pinned to commit SHAs, least-privilege `permissions`, no event data interpolated into shell, `execFileSync` without a shell, `npm ci` from a lockfile. Release builds are checked for the absence of the test bridge. |

## Not in scope

Things the extension cannot see by design (server-to-server data sharing, CNAME-cloaked trackers) are documented in [LIMITATIONS.md](LIMITATIONS.md), not treated as vulnerabilities.
