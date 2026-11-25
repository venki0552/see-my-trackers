# AGENTS.md: guide for AI coding agents (and humans)

See My Trackers is a local-only, cross-browser (Chrome/Edge/Firefox) MV3 extension that records the user's cookie-consent choice and shows which tracking companies their browser contacts relative to that choice.

## Read first
1. `docs/superpowers/specs/2026-11-24-see-my-trackers-design.md`: the design spec (source of truth for behavior, rules, limits).
2. `docs/superpowers/plans/2026-11-24-see-my-trackers-v1.md`: the task plan, including the v2 milestone.
3. `LIMITATIONS.md` and `PRIVACY.md`: promises to users. Don't break them.

## Commands
```bash
npm ci                 # install
npm test               # unit tests (node:test via tsx) — must stay green
npm run typecheck      # tsc --noEmit — must stay clean
npm run build          # dist/{chrome,edge,firefox}
SMT_TEST=1 node scripts/build.mjs firefox chrome   # test builds with the page→extension test bridge
node tests/e2e/chrome.e2e.mjs                      # Chromium e2e (fixture site)
node tests/e2e/firefox.e2e.mjs                     # Firefox e2e (uses dist/firefox-test)
npx web-ext lint --source-dir dist/firefox --self-hosted   # must report 0 errors / 0 warnings
npm run package        # release zips
```

## Layout
| Path | What lives there |
|---|---|
| `src/core/` | **Pure TypeScript.** No browser APIs. All logic: domains, tracker lookup, consent normalization, phases, signals, ID-sync, rules, redaction, cookie dictionary. Every change needs unit tests in `tests/unit/`. |
| `src/bg/` | Background adapters: webRequest/cookies/webNavigation listeners, IndexedDB store, badge, DNR (GPC + Enforce), UI RPC. Keep thin. |
| `src/content/probe.ts` | MAIN-world probe at `document_start`. Reads consent-platform APIs; observes fingerprinting APIs. |
| `src/content/relay.ts` | ISOLATED-world relay: probe → background. |
| `src/content/gpc.ts` | MAIN-world `navigator.globalPrivacyControl`, registered only while GPC is on. |
| `src/ui/` | Popup, dashboard, onboarding. Vanilla TS + one CSS file. |
| `scripts/` | `build.mjs` (per-browser manifests), `build-data.mjs` (TrackerDB → `data/trackers.json`), `package.mjs`. |
| `tests/` | `unit/`, `fixtures/` (fake site + fake TCF CMP + fake trackers), `e2e/`. |

## Invariants (don't break these)
1. **No network requests by the extension.** No fetch/XHR to any server, no remote config, no telemetry, no remote code (store policy + privacy promise).
2. **Never store raw identifiers.** URL parameter values go through `redactUrl` / `hashValue` (salted, per install) before storage or export. The e2e tests assert that the raw fixture ID never appears in an export.
3. **Page strings are hostile.** In the UI, use `h()` / `textContent`, never `innerHTML`. `report-html.ts` escapes every value with `esc()`.
4. **The probe must never break pages.** Everything is wrapped in try/catch, hooks are observe-only (Proxy + `Reflect.apply`), and there's no spoofing.
5. **Register MV3 listeners synchronously at top level** in `background.ts`. The service worker can restart at any time, so rebuild state from `storage.session` / IndexedDB.
6. **One codebase for all browsers.** Use the `api` handle from `src/shared/api.ts`. Feature-detect (e.g. the `extraHeaders` fallback); don't branch on user agent beyond `IS_FIREFOX`.
7. **Wording is observational.** Say "contacted", "observed", "may indicate"; never "illegal". US/GPP receipts say "opted out of sale/sharing", not "rejected".
8. **Test-only code** stays behind `__TEST__` / `__BRIDGE_READONLY__`. Release builds must not contain the test bridge (check: `grep -c testResult dist/chrome/relay.js` → 0).
9. **Licenses.** Code is GPL-3.0-or-later. `data/trackers.json` is CC BY-NC-SA 4.0 (Ghostery TrackerDB): keep the attribution and don't make it commercial. Check any new data source's license before bundling it.

## Adding a consent platform
1. Add a raw payload variant + normalizer in `src/core/consent.ts`, with unit tests for reject / accept / partial / pending.
2. Read it in `probe.ts` (top frame only), emitting a `consent` message only when the state changes.
3. Add a `SOURCE_LABEL` entry and, if useful, a fixture page.

## Adding a finding rule
1. Add the rule id to `Finding['rule']` in `src/core/types.ts`.
2. Implement it in `deriveFindings` (`src/core/rules.ts`) with severity, confidence and plain-language text. Add it to `ruleRank`.
3. Add unit tests, plus a README findings-table row.

## Definition of done
Unit tests green · typecheck clean · Chromium and Firefox e2e PASS · `web-ext lint` 0/0/0 · no raw IDs in exports · docs updated (README, spec/plan when behavior changes).
